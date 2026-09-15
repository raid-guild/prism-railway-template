import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import matter from 'gray-matter';

export interface HostedSkillSummary {
  name: string;
  path: string;
  description: string | null;
  requiredCredentials: string[];
  source: 'site' | 'source' | 'custom';
  kind: 'built-in' | 'source' | 'custom';
  readOnly: boolean;
  sourceKey?: string | null;
  sourceName?: string | null;
  repoUrl?: string | null;
  branch?: string | null;
  commitSha?: string | null;
}

const SKILL_NAME_PATTERN = /^[a-z0-9][a-z0-9-]*$/;
const CREDENTIAL_KEY_PATTERN = /^[a-zA-Z][a-zA-Z0-9_.:-]{0,119}$/;

export function readSkillCredentialRequirements(content: string) {
  try {
    const data = matter(content).data as Record<string, unknown>;
    const metadata = data.metadata && typeof data.metadata === 'object' && !Array.isArray(data.metadata)
      ? data.metadata as Record<string, unknown>
      : {};
    const value = metadata['gateway-credentials']
      ?? metadata.gatewayCredentials
      ?? data['gateway-credentials']
      ?? data.gatewayCredentials;
    const entries = Array.isArray(value) ? value : typeof value === 'string' ? value.split(',') : [];
    return Array.from(new Set(entries
      .filter((entry): entry is string => typeof entry === 'string')
      .map((entry) => entry.trim())
      .filter((entry) => CREDENTIAL_KEY_PATTERN.test(entry))));
  } catch {
    return [];
  }
}

function readSkillDescription(skillFilePath: string) {
  const lines = fs.readFileSync(skillFilePath, 'utf8').split(/\r?\n/);
  let inFrontmatter = false;
  let frontmatterConsumed = false;
  let frontmatterDescription: string | null = null;

  for (const line of lines) {
    const trimmed = line.trim();

    if (!frontmatterConsumed && trimmed === '---') {
      inFrontmatter = !inFrontmatter;
      if (!inFrontmatter) {
        frontmatterConsumed = true;
      }
      continue;
    }

    if (inFrontmatter) {
      const match = trimmed.match(/^description:\s*(.*)$/);
      if (match) {
        frontmatterDescription = match[1].trim().replace(/^['"]|['"]$/g, '') || null;
      }
      continue;
    }

    if (!trimmed || trimmed.startsWith('#')) {
      continue;
    }

    return frontmatterDescription ?? trimmed;
  }

  return frontmatterDescription;
}

function ensureDirectoryPath(candidatePath: string, rootPath: string) {
  const resolved = path.resolve(candidatePath);
  const relative = path.relative(rootPath, resolved);
  if (relative.startsWith('..') || path.isAbsolute(relative)) {
    throw new Error('Resolved skill path escapes hosted skills root');
  }

  return resolved;
}

function isHostedSkillSummary(entry: HostedSkillSummary | null): entry is HostedSkillSummary {
  return entry !== null;
}

export function getHostedSkillsRoot(repoRoot: string) {
  const candidates = [
    path.resolve(repoRoot, 'services/site/skills'),
    path.resolve(repoRoot, 'skills'),
    path.resolve(process.cwd(), 'services/site/skills'),
    path.resolve(process.cwd(), 'skills'),
  ];
  return candidates.find((candidate) => fs.existsSync(candidate)) ?? candidates[0];
}

function listSkillsFromRoot(
  rootPath: string,
  options: {
    repoRoot: string;
    source: HostedSkillSummary['source'];
    kind: HostedSkillSummary['kind'];
    sourceKey?: string | null;
    sourceName?: string | null;
    repoUrl?: string | null;
    branch?: string | null;
    commitSha?: string | null;
  },
) : HostedSkillSummary[] {
  const { repoRoot, source, kind } = options;
  if (!fs.existsSync(rootPath)) {
    return [];
  }

  return fs
    .readdirSync(rootPath, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry): HostedSkillSummary | null => {
      const skillDir = ensureDirectoryPath(path.join(rootPath, entry.name), rootPath);
      const skillFilePath = path.join(skillDir, 'SKILL.md');
      if (!fs.existsSync(skillFilePath)) {
        return null;
      }

      return {
        name: entry.name,
        path: source === 'custom' ? skillDir : path.relative(repoRoot, skillDir),
        description: readSkillDescription(skillFilePath),
        requiredCredentials: readSkillCredentialRequirements(fs.readFileSync(skillFilePath, 'utf8')),
        source,
        kind,
        readOnly: kind !== 'custom',
        sourceKey: options.sourceKey ?? null,
        sourceName: options.sourceName ?? null,
        repoUrl: options.repoUrl ?? null,
        branch: options.branch ?? null,
        commitSha: options.commitSha ?? null,
      } satisfies HostedSkillSummary;
    })
    .filter(isHostedSkillSummary)
    .sort((left, right) => left.name.localeCompare(right.name));
}

export function listHostedSkills(
  repoRoot: string,
  customSkillsRoot?: string,
  sourceSkillRoots: Array<{
    rootPath: string;
    sourceKey: string;
    sourceName: string;
    repoUrl: string;
    branch: string;
    commitSha: string | null;
  }> = [],
) {
  const builtIns = listSkillsFromRoot(getHostedSkillsRoot(repoRoot), {
    repoRoot,
    source: 'site',
    kind: 'built-in',
  });
  const sourceSkills: HostedSkillSummary[] = [];
  const seenSourceNames = new Set<string>();
  for (const sourceRoot of sourceSkillRoots) {
    for (const skill of listSkillsFromRoot(sourceRoot.rootPath, {
      repoRoot,
      source: 'source',
      kind: 'source',
      sourceKey: sourceRoot.sourceKey,
      sourceName: sourceRoot.sourceName,
      repoUrl: sourceRoot.repoUrl,
      branch: sourceRoot.branch,
      commitSha: sourceRoot.commitSha,
    })) {
      if (seenSourceNames.has(skill.name)) {
        continue;
      }
      seenSourceNames.add(skill.name);
      sourceSkills.push(skill);
    }
  }
  const custom = customSkillsRoot
    ? listSkillsFromRoot(customSkillsRoot, {
        repoRoot,
        source: 'custom',
        kind: 'custom',
      })
    : [];

  const byName = new Map<string, HostedSkillSummary>();
  for (const skill of builtIns) byName.set(skill.name, skill);
  for (const skill of sourceSkills) byName.set(skill.name, skill);
  for (const skill of custom) byName.set(skill.name, skill);

  return [...byName.values()].sort((left, right) => left.name.localeCompare(right.name));
}

export function resolveHostedSkillDirectory(
  repoRoot: string,
  skillName: string,
  customSkillsRoot?: string,
  sourceSkillRoots: Array<{ rootPath: string }> = [],
) {
  const normalizedSkillName = skillName.trim();
  if (!SKILL_NAME_PATTERN.test(normalizedSkillName)) {
    return null;
  }

  const roots = [
    ...(customSkillsRoot ? [customSkillsRoot] : []),
    ...sourceSkillRoots.map((entry) => entry.rootPath),
    getHostedSkillsRoot(repoRoot),
  ];
  for (const rootPath of roots) {
    const skillDir = ensureDirectoryPath(path.join(rootPath, normalizedSkillName), rootPath);
    const skillFilePath = path.join(skillDir, 'SKILL.md');

    if (fs.existsSync(skillFilePath)) {
      return skillDir;
    }
  }

  return null;
}

function customSkillDirectory(customSkillsRoot: string, skillName: string) {
  const normalizedSkillName = skillName.trim();
  if (!SKILL_NAME_PATTERN.test(normalizedSkillName)) {
    throw new Error('Invalid skill name');
  }
  return ensureDirectoryPath(path.join(customSkillsRoot, normalizedSkillName), customSkillsRoot);
}

function skillNameFromMarkdown(content: string) {
  const lines = content.split(/\r?\n/);
  let inFrontmatter = false;
  for (const line of lines) {
    const trimmed = line.trim();
    if (trimmed === '---') {
      if (inFrontmatter) {
        return null;
      }
      inFrontmatter = true;
      continue;
    }
    if (!inFrontmatter) {
      continue;
    }
    const match = trimmed.match(/^name:\s*(.*)$/);
    if (match) {
      return match[1].trim().replace(/^['"]|['"]$/g, '') || null;
    }
  }
  return null;
}

export function upsertCustomSkill(customSkillsRoot: string, skillName: string, content: string) {
  const normalizedSkillName = skillName.trim();
  const frontmatterName = skillNameFromMarkdown(content);
  if (frontmatterName && frontmatterName !== normalizedSkillName) {
    throw new Error('Skill frontmatter name must match skill name');
  }
  if (!content.trim().startsWith('---') || !content.includes('name:')) {
    throw new Error('Skill content must include SKILL.md frontmatter with a name');
  }

  const skillDir = customSkillDirectory(customSkillsRoot, normalizedSkillName);
  fs.mkdirSync(skillDir, { recursive: true });
  const skillFilePath = path.join(skillDir, 'SKILL.md');
  fs.writeFileSync(skillFilePath, content.trimEnd() + '\n', 'utf8');

  return {
    name: normalizedSkillName,
    path: skillDir,
    description: readSkillDescription(skillFilePath),
    requiredCredentials: readSkillCredentialRequirements(content),
    source: 'custom',
    kind: 'custom',
    readOnly: false,
  } satisfies HostedSkillSummary;
}

export function deleteCustomSkill(customSkillsRoot: string, skillName: string) {
  const normalizedSkillName = skillName.trim();
  const skillDir = customSkillDirectory(customSkillsRoot, normalizedSkillName);
  const skillFilePath = path.join(skillDir, 'SKILL.md');
  if (!fs.existsSync(skillFilePath)) {
    return null;
  }

  const skill = {
    name: normalizedSkillName,
    path: skillDir,
    description: readSkillDescription(skillFilePath),
    requiredCredentials: readSkillCredentialRequirements(fs.readFileSync(skillFilePath, 'utf8')),
    source: 'custom',
    kind: 'custom',
    readOnly: false,
  } satisfies HostedSkillSummary;

  fs.rmSync(skillDir, { recursive: true, force: true });
  return skill;
}

export function readHostedSkillMarkdown(
  repoRoot: string,
  skillName: string,
  customSkillsRoot?: string,
  sourceSkillRoots: Array<{ rootPath: string }> = [],
) {
  const skillDir = resolveHostedSkillDirectory(repoRoot, skillName, customSkillsRoot, sourceSkillRoots);
  if (!skillDir) {
    return null;
  }
  return fs.readFileSync(path.join(skillDir, 'SKILL.md'), 'utf8');
}

export function buildHostedSkillArchive(
  repoRoot: string,
  skillName: string,
  customSkillsRoot?: string,
  sourceSkillRoots: Array<{ rootPath: string }> = [],
) {
  const skillDir = resolveHostedSkillDirectory(repoRoot, skillName, customSkillsRoot, sourceSkillRoots);
  if (!skillDir) {
    return null;
  }

  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'prism-agent-skill-'));

  try {
    const archivePath = path.join(tempDir, `${skillName}.tar.gz`);
    execFileSync('tar', ['-czf', archivePath, '-C', path.dirname(skillDir), path.basename(skillDir)]);
    return fs.readFileSync(archivePath);
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
}
