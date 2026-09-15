import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { getDb } from './db';
import { loadConfig } from './config';

export interface SkillSourceRecord {
  key: string;
  name: string;
  provider: 'github';
  repoUrl: string;
  branch: string;
  sourcePath: string;
  enabled: boolean;
  lastSyncedAt: string | null;
  lastCommitSha: string | null;
  lastError: string | null;
  lastSkillCount: number;
  createdAt: string;
  updatedAt: string;
}

export interface UpsertSkillSourceInput {
  key: string;
  name?: string | null;
  repoUrl: string;
  branch?: string | null;
  sourcePath?: string | null;
  enabled?: boolean;
}

export interface SyncedSkillSourceRoot {
  source: SkillSourceRecord;
  rootPath: string;
}

const SKILL_SOURCE_KEY_PATTERN = /^[a-z0-9][a-z0-9-]{1,80}[a-z0-9]$/;
const SKILL_NAME_PATTERN = /^[a-z0-9][a-z0-9-]*$/;
const MAX_SKILL_MARKDOWN_BYTES = 500_000;

type SkillSourceRow = {
  key: string;
  name: string;
  provider: string;
  repo_url: string;
  branch: string;
  source_path: string;
  enabled: number;
  last_synced_at: string | null;
  last_commit_sha: string | null;
  last_error: string | null;
  last_skill_count: number;
  created_at: string;
  updated_at: string;
};

function normalizeText(value: unknown) {
  return typeof value === 'string' ? value.trim() : '';
}

function normalizeSkillSourceKey(value: unknown) {
  return normalizeText(value).toLowerCase();
}

function normalizeSourcePath(value: unknown) {
  const raw = normalizeText(value) || 'skills';
  const normalized = raw.replace(/^\/+|\/+$/g, '');
  if (!normalized || normalized.includes('..') || path.isAbsolute(normalized)) {
    throw new Error('Invalid source path');
  }
  return normalized;
}

function normalizeBranch(value: unknown) {
  const branch = normalizeText(value) || 'main';
  if (branch.includes('..') || branch.startsWith('-') || branch.includes('\0')) {
    throw new Error('Invalid branch');
  }
  return branch;
}

function normalizeGithubRepoUrl(value: unknown) {
  const repoUrl = normalizeText(value);
  let parsed: URL;
  try {
    parsed = new URL(repoUrl);
  } catch {
    throw new Error('Invalid GitHub repository URL');
  }
  if (parsed.protocol !== 'https:' || parsed.hostname !== 'github.com') {
    throw new Error('Skill sources currently require an https://github.com repository URL');
  }
  const parts = parsed.pathname.replace(/^\/+|\/+$/g, '').split('/');
  if (parts.length !== 2 || !parts[0] || !parts[1]) {
    throw new Error('GitHub repository URL must point to owner/repo');
  }
  const repo = parts[1].replace(/\.git$/, '');
  return `https://github.com/${parts[0]}/${repo}.git`;
}

function mapSkillSourceRow(row: SkillSourceRow): SkillSourceRecord {
  return {
    key: row.key,
    name: row.name,
    provider: 'github',
    repoUrl: row.repo_url,
    branch: row.branch,
    sourcePath: row.source_path,
    enabled: row.enabled === 1,
    lastSyncedAt: row.last_synced_at,
    lastCommitSha: row.last_commit_sha,
    lastError: row.last_error,
    lastSkillCount: Number(row.last_skill_count ?? 0),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function skillSourceBasePath(key: string) {
  return path.resolve(loadConfig().skillSourcesRoot, key);
}

function checkoutPath(key: string) {
  return path.resolve(skillSourceBasePath(key), 'checkout');
}

function syncedRootPath(key: string) {
  return path.resolve(skillSourceBasePath(key), 'synced');
}

function ensureInsideRoot(root: string, candidate: string) {
  const resolved = path.resolve(candidate);
  if (resolved !== root && !resolved.startsWith(`${root}${path.sep}`)) {
    throw new Error('Path escapes skill source root');
  }
  return resolved;
}

function gitEnv() {
  return {
    ...process.env,
    GIT_TERMINAL_PROMPT: '0',
  };
}

function gitArgsWithOptionalAuth(args: string[]) {
  const token = process.env.GITHUB_TOKEN?.trim() || process.env.GH_TOKEN?.trim() || '';
  if (!token) {
    return args;
  }
  return ['-c', `http.https://github.com/.extraheader=AUTHORIZATION: bearer ${token}`, ...args];
}

function runGit(args: string[], cwd?: string) {
  execFileSync('git', gitArgsWithOptionalAuth(args), {
    cwd,
    env: gitEnv(),
    stdio: ['ignore', 'pipe', 'pipe'],
  });
}

function skillNameFromMarkdown(content: string) {
  const lines = content.split(/\r?\n/);
  let inFrontmatter = false;
  let frontmatterStarted = false;
  for (const line of lines) {
    const trimmed = line.trim();
    if (trimmed === '---') {
      if (inFrontmatter) {
        break;
      }
      if (frontmatterStarted) {
        return null;
      }
      frontmatterStarted = true;
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

function shouldCopySkillPath(sourcePath: string) {
  return !sourcePath.split(path.sep).includes('.git');
}

function validateAndStageSkills(source: SkillSourceRecord, checkoutRoot: string) {
  const rawSourceRoot = path.resolve(checkoutRoot, source.sourcePath);
  const sourceRoot = ensureInsideRoot(checkoutRoot, rawSourceRoot);
  if (!fs.existsSync(sourceRoot)) {
    throw new Error(`Source path not found: ${source.sourcePath}`);
  }

  const stageRoot = path.resolve(skillSourceBasePath(source.key), 'synced-next');
  fs.rmSync(stageRoot, { recursive: true, force: true });
  fs.mkdirSync(stageRoot, { recursive: true });

  const errors: string[] = [];
  let skillCount = 0;
  for (const entry of fs.readdirSync(sourceRoot, { withFileTypes: true })) {
    if (!entry.isDirectory()) {
      continue;
    }
    const skillName = entry.name;
    if (!SKILL_NAME_PATTERN.test(skillName)) {
      errors.push(`${skillName}: invalid skill directory name`);
      continue;
    }
    const skillDir = ensureInsideRoot(sourceRoot, path.join(sourceRoot, skillName));
    const skillFile = path.join(skillDir, 'SKILL.md');
    if (!fs.existsSync(skillFile)) {
      errors.push(`${skillName}: missing SKILL.md`);
      continue;
    }
    const stat = fs.statSync(skillFile);
    if (stat.size > MAX_SKILL_MARKDOWN_BYTES) {
      errors.push(`${skillName}: SKILL.md exceeds ${MAX_SKILL_MARKDOWN_BYTES} bytes`);
      continue;
    }
    const content = fs.readFileSync(skillFile, 'utf8');
    const frontmatterName = skillNameFromMarkdown(content);
    if (!frontmatterName) {
      errors.push(`${skillName}: SKILL.md frontmatter must include name`);
      continue;
    }
    if (frontmatterName !== skillName) {
      errors.push(`${skillName}: frontmatter name must match directory name`);
      continue;
    }

    fs.cpSync(skillDir, path.join(stageRoot, skillName), {
      recursive: true,
      force: true,
      filter: shouldCopySkillPath,
    });
    skillCount += 1;
  }

  if (errors.length) {
    fs.rmSync(stageRoot, { recursive: true, force: true });
    throw new Error(`Skill source validation failed: ${errors.slice(0, 10).join('; ')}`);
  }
  if (skillCount === 0) {
    fs.rmSync(stageRoot, { recursive: true, force: true });
    throw new Error(`No skills found under source path: ${source.sourcePath}`);
  }

  const currentRoot = syncedRootPath(source.key);
  fs.rmSync(currentRoot, { recursive: true, force: true });
  fs.renameSync(stageRoot, currentRoot);
  return skillCount;
}

function updateSkillSourceSyncState(input: {
  key: string;
  lastSyncedAt?: string | null;
  lastCommitSha?: string | null;
  lastError?: string | null;
  lastSkillCount?: number;
}) {
  const now = new Date().toISOString();
  getDb().prepare(
    `UPDATE skill_sources
     SET last_synced_at = COALESCE(@lastSyncedAt, last_synced_at),
         last_commit_sha = COALESCE(@lastCommitSha, last_commit_sha),
         last_error = @lastError,
         last_skill_count = COALESCE(@lastSkillCount, last_skill_count),
         updated_at = @updatedAt
     WHERE key = @key`,
  ).run({
    key: input.key,
    lastSyncedAt: input.lastSyncedAt ?? null,
    lastCommitSha: input.lastCommitSha ?? null,
    lastError: input.lastError ?? null,
    lastSkillCount: input.lastSkillCount ?? null,
    updatedAt: now,
  });
}

export function listSkillSources(input: { enabledOnly?: boolean } = {}) {
  const rows = getDb()
    .prepare(`SELECT * FROM skill_sources${input.enabledOnly ? ' WHERE enabled = 1' : ''} ORDER BY key ASC`)
    .all() as SkillSourceRow[];
  return rows.map(mapSkillSourceRow);
}

export function getSkillSource(key: string) {
  const sourceKey = normalizeSkillSourceKey(key);
  if (!sourceKey) {
    return null;
  }
  const row = getDb().prepare('SELECT * FROM skill_sources WHERE key = ?').get(sourceKey) as SkillSourceRow | undefined;
  return row ? mapSkillSourceRow(row) : null;
}

export function upsertSkillSource(input: UpsertSkillSourceInput) {
  const key = normalizeSkillSourceKey(input.key);
  if (!SKILL_SOURCE_KEY_PATTERN.test(key)) {
    throw new Error('Invalid skill source key');
  }
  const repoUrl = normalizeGithubRepoUrl(input.repoUrl);
  const branch = normalizeBranch(input.branch);
  const sourcePath = normalizeSourcePath(input.sourcePath);
  const now = new Date().toISOString();
  const existing = getSkillSource(key);
  const name = normalizeText(input.name) || existing?.name || key;
  const enabled = input.enabled ?? existing?.enabled ?? true;

  getDb().prepare(
    `INSERT INTO skill_sources (
       key, name, provider, repo_url, branch, source_path, enabled,
       last_synced_at, last_commit_sha, last_error, last_skill_count,
       created_at, updated_at
     ) VALUES (
       @key, @name, 'github', @repoUrl, @branch, @sourcePath, @enabled,
       NULL, NULL, NULL, 0, @createdAt, @updatedAt
     )
     ON CONFLICT(key) DO UPDATE SET
       name = excluded.name,
       repo_url = excluded.repo_url,
       branch = excluded.branch,
       source_path = excluded.source_path,
       enabled = excluded.enabled,
       updated_at = excluded.updated_at`,
  ).run({
    key,
    name,
    repoUrl,
    branch,
    sourcePath,
    enabled: enabled ? 1 : 0,
    createdAt: existing?.createdAt ?? now,
    updatedAt: now,
  });

  return getSkillSource(key);
}

export function deleteSkillSource(key: string) {
  const source = getSkillSource(key);
  if (!source) {
    return null;
  }
  getDb().prepare('DELETE FROM skill_sources WHERE key = ?').run(source.key);
  fs.rmSync(skillSourceBasePath(source.key), { recursive: true, force: true });
  return source;
}

export function listSyncedSkillSourceRoots(): SyncedSkillSourceRoot[] {
  return listSkillSources({ enabledOnly: true })
    .map((source) => ({
      source,
      rootPath: syncedRootPath(source.key),
    }))
    .filter((entry) => fs.existsSync(entry.rootPath));
}

export function listHostedSkillSourceRoots() {
  return listSyncedSkillSourceRoots().map((entry) => ({
    rootPath: entry.rootPath,
    sourceKey: entry.source.key,
    sourceName: entry.source.name,
    repoUrl: entry.source.repoUrl,
    branch: entry.source.branch,
    commitSha: entry.source.lastCommitSha,
  }));
}

export function syncSkillSource(key: string) {
  const source = getSkillSource(key);
  if (!source) {
    throw new Error('Skill source not found');
  }
  if (!source.enabled) {
    throw new Error('Skill source is disabled');
  }

  try {
    const basePath = skillSourceBasePath(source.key);
    const checkout = checkoutPath(source.key);
    fs.mkdirSync(basePath, { recursive: true });
    if (fs.existsSync(path.join(checkout, '.git'))) {
      runGit(['remote', 'set-url', 'origin', source.repoUrl], checkout);
      runGit(['fetch', '--depth', '1', 'origin', source.branch], checkout);
      runGit(['checkout', '--force', 'FETCH_HEAD'], checkout);
    } else {
      fs.rmSync(checkout, { recursive: true, force: true });
      runGit(['clone', '--depth', '1', '--branch', source.branch, source.repoUrl, checkout]);
    }

    const commitSha = execFileSync('git', ['rev-parse', 'HEAD'], {
      cwd: checkout,
      env: gitEnv(),
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
    }).trim();
    const skillCount = validateAndStageSkills(source, checkout);
    const syncedAt = new Date().toISOString();
    updateSkillSourceSyncState({
      key: source.key,
      lastSyncedAt: syncedAt,
      lastCommitSha: commitSha,
      lastError: null,
      lastSkillCount: skillCount,
    });
    return getSkillSource(source.key);
  } catch (error) {
    updateSkillSourceSyncState({
      key: source.key,
      lastError: error instanceof Error ? error.message : 'Skill source sync failed',
    });
    throw error;
  }
}

export function syncSkillSources(input: { enabledOnly?: boolean } = {}) {
  const sources = listSkillSources({ enabledOnly: input.enabledOnly ?? true });
  const results = sources.map((source) => {
    try {
      return {
        key: source.key,
        ok: true,
        source: syncSkillSource(source.key),
      };
    } catch (error) {
      return {
        key: source.key,
        ok: false,
        error: error instanceof Error ? error.message : 'Skill source sync failed',
      };
    }
  });
  return {
    ok: results.every((result) => result.ok),
    results,
  };
}
