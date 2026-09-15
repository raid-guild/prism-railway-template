import fs from 'node:fs';
import path from 'node:path';
import type { AppConfig } from './config';

export type SourceAdapterAccessMode = 'off' | 'readonly' | 'run-approved' | 'full';
export type SourceAdapterPlatform = 'discord' | 'telegram' | 'buzz';

const sourceAdapterPlatforms = new Set<SourceAdapterPlatform>(['discord', 'telegram', 'buzz']);

export function isSourceAdapterPlatform(value: string): value is SourceAdapterPlatform {
  return sourceAdapterPlatforms.has(value as SourceAdapterPlatform);
}

export interface SourceAdapterRateLimit {
  windowSeconds: number;
  maxRequests: number;
}

export interface SourceAdapterPolicyRule {
  mode?: SourceAdapterAccessMode;
  interactionProfileKey?: string;
  capabilities?: string[];
  skills?: string[];
  historyScopes?: string[];
  rateLimit?: Partial<SourceAdapterRateLimit>;
}

export interface SourceAdapterPlatformPolicy {
  defaultMode: SourceAdapterAccessMode;
  defaultRateLimit: SourceAdapterRateLimit;
  targets: Record<string, SourceAdapterPolicyRule>;
  groups: Record<string, SourceAdapterPolicyRule>;
  users: Record<string, SourceAdapterPolicyRule>;
}

export interface SourceAdapterPolicySettings {
  platforms: Record<string, SourceAdapterPlatformPolicy>;
}

export interface SourceAdapterIdentityContext {
  platform: string;
  targetId: string;
  threadId?: string | null;
  groupIds?: string[];
  userId: string;
}

export interface ResolvedSourceAdapterPolicy {
  mode: SourceAdapterAccessMode;
  interactionProfileKey: string | null;
  capabilities: string[];
  skills: string[];
  historyScopes: string[];
  rateLimit: SourceAdapterRateLimit;
  matchedRules: string[];
}

const accessModes = new Set<SourceAdapterAccessMode>(['off', 'readonly', 'run-approved', 'full']);
const policyCacheTtlMs = 1_000;
const policyCache = new Map<string, { value: SourceAdapterPolicySettings; expiresAt: number }>();
const disabledPlatformPolicy: SourceAdapterPlatformPolicy = {
  defaultMode: 'off',
  defaultRateLimit: { windowSeconds: 60, maxRequests: 1 },
  targets: {},
  groups: {},
  users: {},
};

export function sourceAdapterCapabilitiesForMode(mode: SourceAdapterAccessMode): string[] {
  switch (mode) {
    case 'off':
      return [];
    case 'readonly':
      return ['chat.read', 'memory.read', 'requests.read', 'artifacts.read'];
    case 'run-approved':
      return [
        'chat.read',
        'memory.read',
        'requests.read',
        'artifacts.read',
        'tasks.run_existing',
        'workflows.run_existing',
        'requests.create',
      ];
    case 'full':
      return [
        'chat.read',
        'memory.read',
        'requests.read',
        'artifacts.read',
        'tasks.run_existing',
        'workflows.run_existing',
        'requests.create',
        'adapter.send_message',
        'memory.write',
        'knowledge.write',
        'memory.promote_doc',
        'skills.author',
        'tasks.author',
        'workflows.author',
      ];
  }
}

export const defaultSourceAdapterPolicy: SourceAdapterPolicySettings = {
  platforms: {
    discord: {
      defaultMode: 'readonly',
      defaultRateLimit: {
        windowSeconds: 60,
        maxRequests: 6,
      },
      targets: {},
      groups: {},
      users: {},
    },
    telegram: {
      defaultMode: 'off',
      defaultRateLimit: {
        windowSeconds: 60,
        maxRequests: 6,
      },
      targets: {},
      groups: {},
      users: {},
    },
    buzz: {
      defaultMode: 'off',
      defaultRateLimit: {
        windowSeconds: 60,
        maxRequests: 6,
      },
      targets: {},
      groups: {},
      users: {},
    },
  },
};

function parseRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

function parseAccessMode(value: unknown, fallback: SourceAdapterAccessMode): SourceAdapterAccessMode {
  return typeof value === 'string' && accessModes.has(value as SourceAdapterAccessMode)
    ? value as SourceAdapterAccessMode
    : fallback;
}

function parseOptionalAccessMode(value: unknown): SourceAdapterAccessMode | undefined {
  return typeof value === 'string' && accessModes.has(value as SourceAdapterAccessMode)
    ? value as SourceAdapterAccessMode
    : undefined;
}

function parseInteger(value: unknown, fallback: number, min: number, max: number): number {
  const parsed = typeof value === 'number'
    ? value
    : typeof value === 'string'
      ? Number.parseInt(value, 10)
      : fallback;
  if (!Number.isFinite(parsed)) {
    return fallback;
  }
  return Math.min(max, Math.max(min, Math.trunc(parsed)));
}

function parseCapabilities(value: unknown): string[] | undefined {
  if (!Array.isArray(value)) {
    return undefined;
  }
  const capabilities = value
    .filter((item): item is string => typeof item === 'string')
    .map((item) => item.trim())
    .filter(Boolean);
  return capabilities.length ? Array.from(new Set(capabilities)) : undefined;
}

function parseSkills(value: unknown): string[] | undefined {
  if (!Array.isArray(value)) return undefined;
  const skills = value
    .filter((item): item is string => typeof item === 'string')
    .map((item) => item.trim())
    .filter((item) => /^[a-zA-Z][a-zA-Z0-9_.-]{0,119}$/.test(item));
  return skills.length ? Array.from(new Set(skills)) : undefined;
}

function parseHistoryScopes(value: unknown): string[] | undefined {
  if (!Array.isArray(value)) return undefined;
  const scopes = value
    .filter((item): item is string => typeof item === 'string')
    .map((item) => item.trim())
    .filter((item) => /^\d{1,30}$/.test(item));
  return scopes.length ? Array.from(new Set(scopes)) : undefined;
}

function parseInteractionProfileKey(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined;
  const key = value.trim().toLowerCase();
  return /^[a-z0-9][a-z0-9._-]{0,119}$/.test(key) ? key : undefined;
}

function normalizeRateLimit(value: unknown, fallback: SourceAdapterRateLimit): SourceAdapterRateLimit {
  const record = parseRecord(value);
  return {
    windowSeconds: parseInteger(record.windowSeconds ?? record.window_seconds, fallback.windowSeconds, 1, 86_400),
    maxRequests: parseInteger(record.maxRequests ?? record.max_requests, fallback.maxRequests, 1, 10_000),
  };
}

function normalizePartialRateLimit(value: unknown): Partial<SourceAdapterRateLimit> | undefined {
  const record = parseRecord(value);
  const rateLimit: Partial<SourceAdapterRateLimit> = {};
  if (record.windowSeconds !== undefined || record.window_seconds !== undefined) {
    rateLimit.windowSeconds = parseInteger(record.windowSeconds ?? record.window_seconds, 60, 1, 86_400);
  }
  if (record.maxRequests !== undefined || record.max_requests !== undefined) {
    rateLimit.maxRequests = parseInteger(record.maxRequests ?? record.max_requests, 6, 1, 10_000);
  }
  return Object.keys(rateLimit).length ? rateLimit : undefined;
}

function normalizeRule(value: unknown): SourceAdapterPolicyRule {
  const record = parseRecord(value);
  const mode = parseOptionalAccessMode(record.mode);
  const interactionProfileKey = parseInteractionProfileKey(
    record.interactionProfileKey ?? record.interaction_profile_key,
  );
  const capabilities = parseCapabilities(record.capabilities);
  const skills = parseSkills(record.skills ?? record.requestedSkills ?? record.requested_skills);
  const historyScopes = parseHistoryScopes(record.historyScopes ?? record.history_scopes);
  const rateLimit = normalizePartialRateLimit(record.rateLimit ?? record.rate_limit);

  return {
    ...(mode ? { mode } : {}),
    ...(interactionProfileKey ? { interactionProfileKey } : {}),
    ...(capabilities ? { capabilities } : {}),
    ...(skills ? { skills } : {}),
    ...(historyScopes ? { historyScopes } : {}),
    ...(rateLimit ? { rateLimit } : {}),
  };
}

function normalizeRuleMap(value: unknown): Record<string, SourceAdapterPolicyRule> {
  return Object.fromEntries(
    Object.entries(parseRecord(value))
      .filter(([key]) => key.trim())
      .map(([key, rule]) => [key.trim(), normalizeRule(rule)]),
  );
}

function normalizePlatformPolicy(value: unknown, fallback: SourceAdapterPlatformPolicy): SourceAdapterPlatformPolicy {
  const record = parseRecord(value);
  const defaultMode = parseAccessMode(record.defaultMode ?? record.default_mode, fallback.defaultMode);
  const defaultRateLimit = normalizeRateLimit(record.defaultRateLimit ?? record.default_rate_limit, fallback.defaultRateLimit);

  return {
    defaultMode,
    defaultRateLimit,
    targets: normalizeRuleMap(record.targets ?? record.channels ?? fallback.targets),
    groups: normalizeRuleMap(record.groups ?? record.roles ?? fallback.groups),
    users: normalizeRuleMap(record.users ?? fallback.users),
  };
}

export function normalizeSourceAdapterPolicy(value: unknown): SourceAdapterPolicySettings {
  const record = parseRecord(value);
  const platformsInput = parseRecord(record.platforms);
  const platformKeys = new Set([
    ...Object.keys(defaultSourceAdapterPolicy.platforms),
    ...Object.keys(platformsInput),
  ]);

  return {
    platforms: Object.fromEntries(
      Array.from(platformKeys)
        .filter((key) => key.trim())
        .map((key) => {
          const fallback = defaultSourceAdapterPolicy.platforms[key] ?? defaultSourceAdapterPolicy.platforms.discord;
          return [key, normalizePlatformPolicy(platformsInput[key], fallback)];
        }),
    ),
  };
}

export function mergeSourceAdapterPolicy(
  current: SourceAdapterPolicySettings,
  patch: unknown,
): SourceAdapterPolicySettings {
  const patchRecord = parseRecord(patch);
  const patchPlatforms = parseRecord(patchRecord.platforms);
  const platforms = { ...current.platforms };

  for (const [platformKey, platformPatch] of Object.entries(patchPlatforms)) {
    const currentPlatform = platforms[platformKey] ?? defaultSourceAdapterPolicy.platforms.discord;
    const platformRecord = parseRecord(platformPatch);

    platforms[platformKey] = normalizePlatformPolicy(
      {
        defaultMode: platformRecord.defaultMode ?? platformRecord.default_mode ?? currentPlatform.defaultMode,
        defaultRateLimit: platformRecord.defaultRateLimit ?? platformRecord.default_rate_limit ?? currentPlatform.defaultRateLimit,
        targets: platformRecord.targets ?? platformRecord.channels ?? currentPlatform.targets,
        groups: platformRecord.groups ?? platformRecord.roles ?? currentPlatform.groups,
        users: platformRecord.users ?? currentPlatform.users,
      },
      currentPlatform,
    );
  }

  return normalizeSourceAdapterPolicy({ platforms });
}

function applySourceAdapterPolicyRule(
  current: ResolvedSourceAdapterPolicy,
  rule: SourceAdapterPolicyRule | undefined,
  matchedRule: string,
): ResolvedSourceAdapterPolicy {
  if (!rule) return current;
  const mode = rule.mode ?? current.mode;
  const modeChanged = Boolean(rule.mode && rule.mode !== current.mode);
  return {
    mode,
    interactionProfileKey: rule.interactionProfileKey ?? (modeChanged ? null : current.interactionProfileKey),
    capabilities: rule.capabilities ?? (modeChanged ? sourceAdapterCapabilitiesForMode(mode) : current.capabilities),
    skills: rule.skills ?? current.skills,
    historyScopes: rule.historyScopes ?? current.historyScopes,
    rateLimit: {
      windowSeconds: rule.rateLimit?.windowSeconds ?? current.rateLimit.windowSeconds,
      maxRequests: rule.rateLimit?.maxRequests ?? current.rateLimit.maxRequests,
    },
    matchedRules: [...current.matchedRules, matchedRule],
  };
}

export function resolveSourceAdapterPolicy(
  settings: SourceAdapterPolicySettings,
  context: SourceAdapterIdentityContext,
): ResolvedSourceAdapterPolicy {
  const platform = settings.platforms[context.platform]
    ?? defaultSourceAdapterPolicy.platforms[context.platform]
    ?? disabledPlatformPolicy;
  let resolved: ResolvedSourceAdapterPolicy = {
    mode: platform.defaultMode,
    interactionProfileKey: null,
    capabilities: sourceAdapterCapabilitiesForMode(platform.defaultMode),
    skills: [],
    historyScopes: [],
    rateLimit: platform.defaultRateLimit,
    matchedRules: ['default'],
  };

  resolved = applySourceAdapterPolicyRule(resolved, platform.targets[context.targetId], `target:${context.targetId}`);
  if (context.threadId) {
    resolved = applySourceAdapterPolicyRule(resolved, platform.targets[context.threadId], `target:${context.threadId}`);
  }
  for (const groupId of context.groupIds ?? []) {
    resolved = applySourceAdapterPolicyRule(resolved, platform.groups[groupId], `group:${groupId}`);
  }
  resolved = applySourceAdapterPolicyRule(resolved, platform.users[context.userId], `user:${context.userId}`);
  return resolved;
}

export function getSourceAdapterPolicyPath(config: AppConfig) {
  return path.resolve(config.dataRoot, 'source-adapter-policy.json');
}

export function ensureSourceAdapterPolicyFile(config: AppConfig) {
  const filePath = getSourceAdapterPolicyPath(config);
  if (fs.existsSync(filePath)) {
    return;
  }
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, `${JSON.stringify(defaultSourceAdapterPolicy, null, 2)}\n`, 'utf8');
}

export function readSourceAdapterPolicy(config: AppConfig): SourceAdapterPolicySettings {
  const filePath = getSourceAdapterPolicyPath(config);
  const cached = policyCache.get(filePath);
  if (cached && cached.expiresAt > Date.now()) {
    return cached.value;
  }
  ensureSourceAdapterPolicyFile(config);
  let value: SourceAdapterPolicySettings;
  try {
    const fileContents = fs.readFileSync(filePath, 'utf8');
    value = normalizeSourceAdapterPolicy(JSON.parse(fileContents));
  } catch {
    value = defaultSourceAdapterPolicy;
  }
  policyCache.set(filePath, { value, expiresAt: Date.now() + policyCacheTtlMs });
  return value;
}

export function writeSourceAdapterPolicy(config: AppConfig, value: unknown): SourceAdapterPolicySettings {
  const normalized = mergeSourceAdapterPolicy(readSourceAdapterPolicy(config), value);
  const filePath = getSourceAdapterPolicyPath(config);
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, `${JSON.stringify(normalized, null, 2)}\n`, 'utf8');
  policyCache.set(filePath, { value: normalized, expiresAt: Date.now() + policyCacheTtlMs });
  return normalized;
}
