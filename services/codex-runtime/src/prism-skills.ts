import { createHash } from 'node:crypto';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { gunzipSync } from 'node:zlib';
import tar from 'tar-stream';
import { config } from './config.js';

type SkillRecord = {
  name: string;
  path: string;
  description: string;
  requiredCredentials: string[];
  downloadPath?: string;
  source: 'prism-memory' | 'app-api';
};

type SkillIndexResponse = {
  skills?: Array<{
    name?: string;
    path?: string;
    description?: string | null;
    downloadPath?: string;
    requiredCredentials?: unknown;
  }>;
};

const REQUIREMENT_KEY_PATTERN = /^[a-zA-Z][a-zA-Z0-9_.:-]{0,119}$/;

function normalizeRequirements(value: unknown) {
  const entries = Array.isArray(value) ? value : typeof value === 'string' ? value.split(',') : [];
  return Array.from(new Set(entries
    .filter((entry): entry is string => typeof entry === 'string')
    .map((entry) => entry.trim())
    .filter((entry) => REQUIREMENT_KEY_PATTERN.test(entry))));
}

function namedRequirementsFromSkillMarkdown(content: string, keyPattern: RegExp) {
  const lines = content.split(/\r?\n/);
  if (lines[0]?.trim() !== '---') return [];
  let activeKey = false;
  const values: string[] = [];
  for (let index = 1; index < lines.length; index += 1) {
    const line = lines[index];
    const trimmed = line.trim();
    if (trimmed === '---') break;
    const keyMatch = trimmed.match(keyPattern);
    if (keyMatch) {
      activeKey = true;
      const inline = keyMatch[2].trim();
      if (inline.startsWith('[') && inline.endsWith(']')) {
        values.push(...inline.slice(1, -1).split(',').map((entry) => entry.trim().replace(/^['"]|['"]$/g, '')));
      } else if (inline) {
        values.push(...inline.split(',').map((entry) => entry.trim().replace(/^['"]|['"]$/g, '')));
      }
      continue;
    }
    if (activeKey) {
      const item = trimmed.match(/^-\s+(.+)$/);
      if (item) {
        values.push(item[1].trim().replace(/^['"]|['"]$/g, ''));
        continue;
      }
      if (trimmed && !line.startsWith(' ') && !line.startsWith('\t')) activeKey = false;
    }
  }
  return normalizeRequirements(values);
}

export function credentialRequirementsFromSkillMarkdown(content: string) {
  return namedRequirementsFromSkillMarkdown(
    content,
    /^(gateway-credentials|gatewayCredentials):\s*(.*)$/,
  );
}

type SkillCacheEntry = {
  content: string;
  files: SkillBundleFile[];
  fetchedAt: number;
};

type SkillBundleFile = {
  path: string;
  content: Buffer;
  mode: number;
};

let skillIndexCache: { skills: SkillRecord[]; fetchedAt: number } | null = null;
const skillContentCache = new Map<string, SkillCacheEntry>();

function hasValidCache(fetchedAt: number) {
  return Date.now() - fetchedAt < config.prismSkillCacheTtlMs;
}

async function prismRequest(path: string) {
  if (!config.prismApiBase || !config.prismApiKey) {
    throw new Error('PRISM_SKILLS_NOT_CONFIGURED');
  }

  const response = await fetch(`${config.prismApiBase}${path}`, {
    headers: {
      'X-Prism-Api-Key': config.prismApiKey,
    },
  });

  if (!response.ok) {
    const text = await response.text().catch(() => '');
    throw new Error(`PRISM_REQUEST_FAILED:${response.status}:${path}:${text.slice(0, 200)}`);
  }

  return response;
}

async function appApiRequest(path: string) {
  if (!config.appApiBaseUrl || !config.appServiceToken) {
    throw new Error('APP_SKILLS_NOT_CONFIGURED');
  }

  const response = await fetch(`${config.appApiBaseUrl}${path}`, {
    headers: {
      'x-service-token': config.appServiceToken,
    },
  });

  if (!response.ok) {
    const text = await response.text().catch(() => '');
    throw new Error(`APP_API_REQUEST_FAILED:${response.status}:${path}:${text.slice(0, 200)}`);
  }

  return response;
}

function normalizeSkillRecord(
  source: SkillRecord['source'],
  entry: {
    name?: string;
    path?: string;
    description?: string | null;
    downloadPath?: string;
    requiredCredentials?: unknown;
  },
): SkillRecord | null {
  if (typeof entry.name !== 'string' || !entry.name.trim()) {
    return null;
  }

  return {
    name: entry.name.trim(),
    path: typeof entry.path === 'string' ? entry.path : '',
    description: typeof entry.description === 'string' ? entry.description : '',
    requiredCredentials: normalizeRequirements(entry.requiredCredentials),
    downloadPath: typeof entry.downloadPath === 'string' ? entry.downloadPath : undefined,
    source,
  } satisfies SkillRecord;
}

function isSkillRecord(entry: SkillRecord | null): entry is SkillRecord {
  return entry !== null;
}

async function listPrismMemorySkills() {
  if (!config.prismApiBase || !config.prismApiKey) {
    return [] as SkillRecord[];
  }

  const response = await prismRequest('/skills');
  const payload = await response.json() as SkillIndexResponse;
  return (Array.isArray(payload.skills) ? payload.skills : [])
    .map((entry) => normalizeSkillRecord('prism-memory', entry))
    .filter(isSkillRecord);
}

async function listAppHostedSkills() {
  if (!config.appApiBaseUrl || !config.appServiceToken) {
    return [] as SkillRecord[];
  }

  const response = await appApiRequest('/agent/skills');
  const payload = await response.json() as SkillIndexResponse;
  return (Array.isArray(payload.skills) ? payload.skills : [])
    .map((entry) => normalizeSkillRecord('app-api', entry))
    .filter(isSkillRecord);
}

export async function listPrismSkills() {
  if (skillIndexCache && hasValidCache(skillIndexCache.fetchedAt)) {
    return skillIndexCache.skills;
  }

  const [prismSkills, appSkills] = await Promise.all([
    listPrismMemorySkills().catch(() => [] as SkillRecord[]),
    listAppHostedSkills().catch(() => [] as SkillRecord[]),
  ]);

  const skillsByName = new Map<string, SkillRecord>();
  for (const skill of prismSkills) skillsByName.set(skill.name, skill);
  for (const skill of appSkills) skillsByName.set(skill.name, skill);
  const skills = Array.from(skillsByName.values()).sort((left, right) => left.name.localeCompare(right.name));
  skillIndexCache = { skills, fetchedAt: Date.now() };
  return skills;
}

export function extractSkillBundleFromArchive(archive: Uint8Array, skillName: string) {
  const extract = tar.extract();

  return new Promise<{ content: string; files: SkillBundleFile[] }>((resolve, reject) => {
    const files: SkillBundleFile[] = [];
    let archiveRoot: string | null = null;
    let skillMarkdown: string | null = null;
    let totalBytes = 0;
    let failed = false;

    const fail = (error: Error) => {
      if (failed) return;
      failed = true;
      reject(error);
    };

    extract.on('entry', (header: { name: string; type?: string; mode?: number }, stream: NodeJS.ReadableStream, next: () => void) => {
      const normalized = header.name.replaceAll('\\', '/').replace(/^\.\//, '');
      const segments = normalized.split('/').filter(Boolean);
      if (!segments.length || normalized.startsWith('/') || segments.includes('..')) {
        stream.resume();
        fail(new Error(`PRISM_SKILL_ARCHIVE_UNSAFE:${skillName}`));
        return;
      }

      const entryType = header.type || 'file';
      archiveRoot ??= entryType === 'directory' || segments.length > 1 ? segments[0]! : '';
      if (archiveRoot && segments[0] !== archiveRoot) {
        stream.resume();
        fail(new Error(`PRISM_SKILL_ARCHIVE_INVALID:${skillName}`));
        return;
      }
      const relativeSegments = archiveRoot ? segments.slice(1) : segments;
      const relativePath = relativeSegments.join('/');
      if (entryType === 'directory') {
        stream.on('end', next);
        stream.resume();
        return;
      }
      if (entryType !== 'file' || !relativePath) {
        stream.resume();
        fail(new Error(`PRISM_SKILL_ARCHIVE_UNSAFE:${skillName}`));
        return;
      }

      const chunks: Buffer[] = [];
      stream.on('data', (chunk: Buffer | Uint8Array | string) => {
        const buffer = Buffer.from(chunk);
        totalBytes += buffer.length;
        if (totalBytes > 25 * 1024 * 1024) {
          fail(new Error(`PRISM_SKILL_ARCHIVE_TOO_LARGE:${skillName}`));
          return;
        }
        chunks.push(buffer);
      });
      stream.on('end', () => {
        if (failed) return;
        const content = Buffer.concat(chunks);
        files.push({
          path: relativePath,
          content,
          mode: (header.mode ?? 0o644) & 0o777,
        });
        if (relativePath === 'SKILL.md') skillMarkdown = content.toString('utf8');
        next();
      });
      stream.on('error', (error) => fail(error));
    });

    extract.on('finish', () => {
      if (failed) return;
      if (!skillMarkdown) {
        reject(new Error(`PRISM_SKILL_ARCHIVE_INVALID:${skillName}`));
        return;
      }
      resolve({ content: skillMarkdown, files });
    });

    extract.on('error', (error) => fail(error));
    try {
      extract.end(Buffer.from(gunzipSync(archive)));
    } catch (error) {
      fail(error instanceof Error ? error : new Error(`PRISM_SKILL_ARCHIVE_INVALID:${skillName}`));
    }
  });
}

export async function downloadPrismSkill(skillName: string) {
  const cached = skillContentCache.get(skillName);
  if (cached && hasValidCache(cached.fetchedAt)) {
    return cached.content;
  }

  const availableSkills = await listPrismSkills();
  const skill = availableSkills.find((entry) => entry.name === skillName);
  if (!skill) {
    throw new Error(`SKILL_NOT_FOUND:${skillName}`);
  }

  let response: Response;
  if (skill.source === 'app-api') {
    const downloadPath = skill.downloadPath || `/agent/skills/${encodeURIComponent(skillName)}/download`;
    response = await appApiRequest(downloadPath);
  } else {
    response = await prismRequest(`/skills/${encodeURIComponent(skillName)}/download`);
  }

  const archive = new Uint8Array(await response.arrayBuffer());
  const bundle = await extractSkillBundleFromArchive(archive, skillName);
  skillContentCache.set(skillName, {
    ...bundle,
    fetchedAt: Date.now(),
  });
  return bundle.content;
}

function skillDirectoryName(skillName: string) {
  const slug = skillName.toLowerCase().replace(/[^a-z0-9_-]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 72) || 'skill';
  const suffix = createHash('sha256').update(skillName).digest('hex').slice(0, 10);
  return `prism-${slug}-${suffix}`;
}

async function mirrorDirectoryEntries(source: string, destination: string, excludedNames: Set<string>) {
  const entries = await fs.readdir(source, { withFileTypes: true }).catch(() => []);
  await fs.mkdir(destination, { recursive: true });
  for (const entry of entries) {
    if (excludedNames.has(entry.name)) continue;
    await fs.symlink(path.join(source, entry.name), path.join(destination, entry.name), entry.isDirectory() ? 'dir' : 'file');
  }
}

/**
 * Build an isolated HOME for one Codex process. Existing user files remain
 * visible through symlinks, while Site-hosted skills are installed in the
 * native $HOME/.agents/skills location for progressive disclosure.
 */
export async function createNativePrismSkillHome(
  originalHome: string,
  prismSkills: Awaited<ReturnType<typeof loadRelevantPrismSkills>>,
  metadata?: Record<string, unknown>,
) {
  const runtimeHome = await fs.mkdtemp(path.join(os.tmpdir(), 'prism-codex-home-'));
  try {
    await mirrorDirectoryEntries(originalHome, runtimeHome, new Set(['.agents']));

    const originalAgents = path.join(originalHome, '.agents');
    const runtimeAgents = path.join(runtimeHome, '.agents');
    await mirrorDirectoryEntries(originalAgents, runtimeAgents, new Set(['skills']));

    const originalSkills = path.join(originalAgents, 'skills');
    const runtimeSkills = path.join(runtimeAgents, 'skills');
    await mirrorDirectoryEntries(originalSkills, runtimeSkills, new Set());

    const exactSelection = metadata?.skillSelectionMode === 'exact';
    const selectedNames = new Set(prismSkills.selectedSkills.map((skill) => skill.name));
    const nativeSkills = exactSelection
      ? prismSkills.availableSkills.filter((skill) => selectedNames.has(skill.name))
      : prismSkills.availableSkills;
    let installedSkillCount = 0;
    const failedSkillNames: string[] = [];

    for (const skill of nativeSkills) {
      try {
        await downloadPrismSkill(skill.name);
        const bundle = skillContentCache.get(skill.name);
        if (!bundle) continue;
        const skillRoot = path.join(runtimeSkills, skillDirectoryName(skill.name));
        await fs.mkdir(skillRoot, { recursive: true });
        for (const file of bundle.files) {
          const destination = path.resolve(skillRoot, file.path);
          if (destination !== skillRoot && !destination.startsWith(`${skillRoot}${path.sep}`)) {
            throw new Error(`PRISM_SKILL_ARCHIVE_UNSAFE:${skill.name}`);
          }
          await fs.mkdir(path.dirname(destination), { recursive: true });
          await fs.writeFile(destination, file.content, { mode: file.mode });
        }
        installedSkillCount += 1;
      } catch (error) {
        if (exactSelection) throw error;
        failedSkillNames.push(skill.name);
      }
    }

    return {
      path: runtimeHome,
      skillCount: installedSkillCount,
      failedSkillNames,
      cleanup: async () => await fs.rm(runtimeHome, { recursive: true, force: true }),
    };
  } catch (error) {
    await fs.rm(runtimeHome, { recursive: true, force: true });
    throw error;
  }
}

export function requestedSkillNames(prompt: string, metadata?: Record<string, unknown>) {
  const requested = new Set<string>();
  const normalized = prompt.toLowerCase();
  const explicit = metadata?.requestedSkills;

  if (Array.isArray(explicit)) {
    for (const entry of explicit) {
      if (typeof entry === 'string' && entry.trim()) {
        requested.add(entry.trim());
      }
    }
  }

  // Deterministic callers such as request workflows own their skill scope.
  // Do not expand it from incidental words in the composed prompt.
  if (metadata?.skillSelectionMode === 'exact') {
    return Array.from(requested);
  }

  if (
    normalized.includes('remember')
    || normalized.includes('what do we know')
    || normalized.includes('what do you know')
    || normalized.includes('search')
    || normalized.includes('knowledge')
    || normalized.includes('memory')
    || normalized.includes('context')
  ) {
    requested.add('prism-api-reader');
  }

  if (
    normalized.includes('write')
    || normalized.includes('save')
    || normalized.includes('store')
    || normalized.includes('record')
    || normalized.includes('add to memory')
    || normalized.includes('create doc')
    || normalized.includes('inbox')
  ) {
    requested.add('prism-api-writer');
  }

  if (
    normalized.includes('run ')
    || normalized.includes('trigger')
    || normalized.includes('backfill')
    || normalized.includes('promote')
    || normalized.includes('validate')
    || normalized.includes('index')
    || normalized.includes('recompute')
    || normalized.includes('ops')
  ) {
    requested.add('prism-api-ops');
  }

  if (
    normalized.includes('create skill')
    || normalized.includes('custom skill')
    || normalized.includes('update skill')
    || normalized.includes('install skill')
    || normalized.includes('skill author')
    || normalized.includes('skill file')
    || normalized.includes('skill.md')
  ) {
    requested.add('prism-skill-author');
  }

  if (
    normalized.includes('config')
    || normalized.includes('configure')
    || normalized.includes('space config')
    || normalized.includes('space.json')
    || normalized.includes('agentic ingest')
    || normalized.includes('memory policy')
    || normalized.includes('priority channel')
    || normalized.includes('priority topic')
    || normalized.includes('scoped bucket')
    || normalized.includes('scoped source')
    || normalized.includes('turn on bot_only')
    || normalized.includes('turn off agentic')
    || normalized.includes('backfill')
  ) {
    requested.add('prism-config-admin');
  }

  if (
    normalized.includes('brand')
    || normalized.includes('branding')
    || normalized.includes('logo')
    || normalized.includes('workspace label')
    || normalized.includes('site title')
    || normalized.includes('instance settings')
    || normalized.includes('source adapter')
    || normalized.includes('access policy')
    || normalized.includes('bot access')
    || normalized.includes('bot permission')
    || normalized.includes('discord access')
    || normalized.includes('discord bucket')
    || normalized.includes('discord category')
    || normalized.includes('category_to_bucket')
    || normalized.includes('memory bucket')
    || normalized.includes('repair-discord-buckets')
    || normalized.includes('repair discord')
  ) {
    requested.add('prism-instance-settings');
  }

  if (
    normalized.includes('change request')
    || normalized.includes('change-request')
    || normalized.includes('next request')
    || normalized.includes('current request')
    || normalized.includes('agent run')
    || normalized.includes('deploy plan')
  ) {
    requested.add('change-request-ops');
  }

  if (
    normalized.includes('create workflow')
    || normalized.includes('update workflow')
    || normalized.includes('workflow author')
    || normalized.includes('workflow step')
    || normalized.includes('workflow manifest')
    || normalized.includes('workflow.md')
    || normalized.includes('request workflow')
    || normalized.includes('human gate')
    || normalized.includes('gate step')
    || normalized.includes('status map')
    || normalized.includes('statusmap')
  ) {
    requested.add('prism-workflow-author');
  }

  if (
    normalized.includes('deploy')
    || normalized.includes('redeploy')
    || normalized.includes('staging')
    || normalized.includes('build')
    || normalized.includes('restart')
    || normalized.includes('target app')
  ) {
    requested.add('target-deploy-ops');
  }

  const buzzContext = metadata?.transport === 'buzz' || metadata?.source === 'buzz';
  const buzzChannelSubject = normalized.includes('buzz channel')
    || normalized.includes('buzz room')
    || (buzzContext && (normalized.includes('channel') || normalized.includes('room')));
  const buzzChannelAction = [
    'create', 'new', 'manage', 'list', 'rename', 'update', 'topic', 'purpose',
    'archive', 'unarchive', 'member', 'owner', 'admin', 'access',
  ].some((term) => normalized.includes(term));
  if (buzzChannelSubject && buzzChannelAction) {
    requested.add('prism-buzz-channel-admin');
  }

  return Array.from(requested);
}

export async function loadRelevantPrismSkills(prompt: string, metadata?: Record<string, unknown>) {
  const availableSkills = await listPrismSkills().catch(() => [] as SkillRecord[]);
  if (!availableSkills.length) {
    return {
      availableSkills: [] as SkillRecord[],
      selectedSkills: [] as Array<{ name: string; content: string; requiredCredentials: string[] }>,
    };
  }

  const requested = new Set(requestedSkillNames(prompt, metadata));
  const selectedSkills: Array<{ name: string; content: string; requiredCredentials: string[] }> = [];

  for (const skill of availableSkills) {
    if (!requested.has(skill.name)) {
      continue;
    }

    const content = await downloadPrismSkill(skill.name);
    selectedSkills.push({
      name: skill.name,
      content,
      requiredCredentials: Array.from(new Set([
        ...skill.requiredCredentials,
        ...credentialRequirementsFromSkillMarkdown(content),
      ])),
    });
  }

  return { availableSkills, selectedSkills };
}
