import { randomUUID } from 'node:crypto';
import type Database from 'better-sqlite3';

import { getDb } from './db';
import { loadConfig } from './config';
import { agentAccentColorForKey, normalizeAgentAccentColor } from '../agent-profile-colors';
import { normalizeModelTier, type ModelTier } from '../model-tier';
import { listExternalInterfaces, listInteractionProfiles } from './external-interactions';
import {
  readSourceAdapterPolicy,
  sourceAdapterCapabilitiesForMode,
  type SourceAdapterAccessMode,
  type SourceAdapterRateLimit,
} from './source-adapter-policy';

export const adminAgentProfileId = 'agent-profile-admin';
export const adminAgentProfileKey = 'admin-agent';
export const agentExecutionModes = ['worker', 'orchestrator', 'verifier', 'reviewer', 'judge', 'repair'] as const;

export type AgentExecutionMode = (typeof agentExecutionModes)[number];
export type AgentProfileOwnerType = 'workspace' | 'user' | 'agent';
export type AgentProfileStatus = 'draft' | 'active' | 'disabled' | 'archived';
export type AgentConversationScope = 'individual' | 'channel' | 'thread' | 'automated';

export type AgentProfileOwner = {
  type: AgentProfileOwnerType;
  userId: string | null;
  agentProfileId: string | null;
};

export type AgentProfileSteward = {
  userId: string;
  displayName: string | null;
  role: 'owner' | 'steward';
};

export type AgentProfileBinding = {
  id: string;
  profileId: string;
  surfaceType: 'buzz' | 'discord' | 'telegram' | 'external' | 'user';
  surfaceKey: string;
  label: string | null;
  enabled: boolean;
  configuration: Record<string, unknown>;
  createdByUserId: string | null;
  createdAt: string;
  updatedAt: string;
};

export type AgentProfileBindingPolicy = {
  accessMode: SourceAdapterAccessMode;
  capabilities: string[];
  rateLimit: SourceAdapterRateLimit;
  allowedWorkflows: string[];
  overrides: {
    threads: Record<string, Partial<AgentProfileBindingPolicy>>;
    groups: Record<string, Partial<AgentProfileBindingPolicy>>;
    users: Record<string, Partial<AgentProfileBindingPolicy>>;
  };
  legacyInteractionProfileKey: string | null;
};

export type ResolvedAgentProfileInteraction = {
  profile: AgentProfileRecord;
  binding: AgentProfileBinding;
  policy: Omit<AgentProfileBindingPolicy, 'overrides'> & { matchedRules: string[] };
};

export type LegacyAgentProfileMigrationCandidate = {
  interactionProfileKey: string;
  name: string;
  description: string | null;
  alreadyMigrated: boolean;
  surfaces: Array<{
    surfaceType: AgentProfileBinding['surfaceType'];
    surfaceKey: string;
    label: string | null;
    accessMode: SourceAdapterAccessMode;
  }>;
};

export type AgentProfileRecord = {
  id: string;
  key: string;
  name: string;
  description: string | null;
  avatarUrl: string | null;
  accentColor: string;
  status: AgentProfileStatus;
  systemKey: string | null;
  owner: AgentProfileOwner;
  stewards: AgentProfileSteward[];
  persona: Record<string, unknown>;
  runtimeProfileKey: string | null;
  modelTier: ModelTier | null;
  skills: string[];
  memoryScope: Record<string, unknown>;
  authority: Record<string, unknown>;
  contextPolicy: Record<string, unknown>;
  version: number;
  createdByUserId: string | null;
  bindings: AgentProfileBinding[];
  createdAt: string;
  updatedAt: string;
};

export type UpsertAgentProfileInput = {
  key: string;
  name: string;
  description?: string | null;
  avatarUrl?: string | null;
  accentColor?: string | null;
  status?: AgentProfileStatus;
  ownerType?: AgentProfileOwnerType;
  ownerUserId?: string | null;
  ownerAgentProfileId?: string | null;
  stewardUserIds?: string[];
  persona?: Record<string, unknown>;
  runtimeProfileKey?: string | null;
  modelTier?: ModelTier | null;
  skills?: string[];
  memoryScope?: Record<string, unknown>;
  authority?: Record<string, unknown>;
  contextPolicy?: Record<string, unknown>;
  createdByUserId?: string | null;
  allowSystemProfileUpdate?: boolean;
};

export type AgentProfileSessionSummary = {
  id: string;
  source: string;
  status: string;
  title: string | null;
  conversationScope: AgentConversationScope;
  createdByUserId: string | null;
  createdByDisplayName: string | null;
  linkedChangeRequestId: string | null;
  linkedRequestNumber: number | null;
  linkedRequestTitle: string | null;
  messageCount: number;
  lastMessageAt: string | null;
  createdAt: string;
  updatedAt: string;
};

export type AgentProfileActivityItem = {
  id: string;
  kind: 'session' | 'run';
  occurredAt: string;
  title: string;
  description: string;
  status: string;
  sessionId: string | null;
  requestId: string | null;
  requestNumber: number | null;
  requestTitle: string | null;
  workflowStepKey: string | null;
  executionMode: string | null;
  actorDisplayName: string | null;
};

export type AgentProfileQueueState = {
  profileId: string;
  queued: number;
  claimed: number;
  running: number;
};

export type AgentProfileSessionDetail = AgentProfileSessionSummary & {
  profileId: string;
  profileVersion: number | null;
  messages: Array<{
    id: string;
    role: string;
    source: string;
    sourceMessageId: string | null;
    content: string;
    authorId: string | null;
    authorName: string | null;
    createdAt: string;
  }>;
  runs: Array<{
    id: string;
    kind: string;
    status: string;
    requestId: string | null;
    requestNumber: number | null;
    workflowStepKey: string | null;
    executionMode: string | null;
    errorMessage: string | null;
    createdAt: string;
    startedAt: string | null;
    finishedAt: string | null;
  }>;
};

type AgentProfileRow = {
  id: string;
  key: string;
  name: string;
  description: string | null;
  avatar_url?: string | null;
  accent_color?: string | null;
  status: AgentProfileStatus;
  system_key: string | null;
  owner_type: AgentProfileOwnerType;
  owner_user_id: string | null;
  owner_agent_profile_id: string | null;
  persona_json: string;
  runtime_profile_key: string | null;
  model_tier?: string | null;
  skills_json: string;
  memory_scope_json: string;
  authority_json: string;
  context_policy_json: string;
  version: number;
  created_by_user_id: string | null;
  created_at: string;
  updated_at: string;
};

function text(value: unknown, maxLength = 500) {
  return typeof value === 'string' ? value.trim().slice(0, maxLength) : '';
}

function normalizedAvatarUrl(value: unknown) {
  const candidate = text(value, 2000);
  if (!candidate) return null;
  if (candidate.startsWith('/') && !candidate.startsWith('//')) return candidate;
  try {
    const parsed = new URL(candidate);
    if (parsed.protocol === 'https:') return parsed.toString();
  } catch {
    // Return the stable validation error below.
  }
  throw new Error('AGENT_PROFILE_AVATAR_URL_INVALID');
}

function key(value: unknown) {
  const normalized = text(value, 120).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
  if (!normalized || normalized.length < 2) throw new Error('AGENT_PROFILE_KEY_INVALID');
  return normalized;
}

function jsonRecord(value: string): Record<string, unknown> {
  try {
    const parsed = JSON.parse(value) as unknown;
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed as Record<string, unknown> : {};
  } catch {
    return {};
  }
}

function unknownRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

const accessModes = ['off', 'readonly', 'run-approved', 'full'] as const;
const accessModeRank = new Map(accessModes.map((mode, index) => [mode, index]));

function accessMode(value: unknown, fallback: SourceAdapterAccessMode): SourceAdapterAccessMode {
  return typeof value === 'string' && accessModes.includes(value as SourceAdapterAccessMode)
    ? value as SourceAdapterAccessMode
    : fallback;
}

function positiveInteger(value: unknown, fallback: number, max: number) {
  const parsed = typeof value === 'number' ? value : typeof value === 'string' ? Number.parseInt(value, 10) : fallback;
  return Number.isFinite(parsed) ? Math.max(1, Math.min(max, Math.trunc(parsed))) : fallback;
}

function stringList(value: unknown, maxLength = 160) {
  return Array.isArray(value)
    ? Array.from(new Set(value.map((item) => text(item, maxLength)).filter(Boolean)))
    : [];
}

function policyOverride(value: unknown): Partial<AgentProfileBindingPolicy> {
  const input = unknownRecord(value);
  const mode = typeof input.accessMode === 'string' || typeof input.mode === 'string'
    ? accessMode(input.accessMode ?? input.mode, 'off')
    : undefined;
  const rateInput = unknownRecord(input.rateLimit ?? input.rate_limit);
  return {
    ...(mode ? { accessMode: mode } : {}),
    ...(Array.isArray(input.capabilities) ? { capabilities: stringList(input.capabilities, 120) } : {}),
    ...(Array.isArray(input.allowedWorkflows ?? input.allowed_workflows)
      ? { allowedWorkflows: stringList(input.allowedWorkflows ?? input.allowed_workflows, 120) }
      : {}),
    ...(Object.keys(rateInput).length ? { rateLimit: {
      windowSeconds: positiveInteger(rateInput.windowSeconds ?? rateInput.window_seconds, 60, 86_400),
      maxRequests: positiveInteger(rateInput.maxRequests ?? rateInput.max_requests, 6, 10_000),
    } } : {}),
  };
}

function overrideMap(value: unknown) {
  return Object.fromEntries(Object.entries(unknownRecord(value)).map(([key, rule]) => [key, policyOverride(rule)]));
}

export function normalizeAgentProfileBindingPolicy(value: unknown): AgentProfileBindingPolicy {
  const input = unknownRecord(value);
  const mode = accessMode(input.accessMode ?? input.mode, 'readonly');
  const rateInput = unknownRecord(input.rateLimit ?? input.rate_limit);
  const overrides = unknownRecord(input.overrides);
  return {
    accessMode: mode,
    capabilities: Array.isArray(input.capabilities)
      ? stringList(input.capabilities, 120).filter((capability) => sourceAdapterCapabilitiesForMode(mode).includes(capability))
      : sourceAdapterCapabilitiesForMode(mode),
    rateLimit: {
      windowSeconds: positiveInteger(rateInput.windowSeconds ?? rateInput.window_seconds, 60, 86_400),
      maxRequests: positiveInteger(rateInput.maxRequests ?? rateInput.max_requests, 6, 10_000),
    },
    allowedWorkflows: stringList(input.allowedWorkflows ?? input.allowed_workflows, 120),
    overrides: {
      threads: overrideMap(overrides.threads ?? input.threads),
      groups: overrideMap(overrides.groups ?? input.groups),
      users: overrideMap(overrides.users ?? input.users),
    },
    legacyInteractionProfileKey: text(input.legacyInteractionProfileKey ?? input.legacy_interaction_profile_key, 120) || null,
  };
}

function capMode(requested: SourceAdapterAccessMode, maximum: SourceAdapterAccessMode) {
  return (accessModeRank.get(requested) ?? 0) <= (accessModeRank.get(maximum) ?? 0) ? requested : maximum;
}

function applyBindingOverride(
  current: Omit<AgentProfileBindingPolicy, 'overrides'> & { matchedRules: string[] },
  override: Partial<AgentProfileBindingPolicy> | undefined,
  label: string,
) {
  if (!override) return current;
  const mode = override.accessMode ?? current.accessMode;
  return {
    ...current,
    accessMode: mode,
    capabilities: override.capabilities
      ? override.capabilities.filter((capability) => sourceAdapterCapabilitiesForMode(mode).includes(capability))
      : override.accessMode ? sourceAdapterCapabilitiesForMode(mode) : current.capabilities,
    rateLimit: override.rateLimit ?? current.rateLimit,
    allowedWorkflows: override.allowedWorkflows ?? current.allowedWorkflows,
    matchedRules: [...current.matchedRules, label],
  };
}

function jsonStrings(value: string): string[] {
  try {
    const parsed = JSON.parse(value) as unknown;
    return Array.isArray(parsed) ? parsed.filter((item): item is string => typeof item === 'string') : [];
  } catch {
    return [];
  }
}

function bindingRows(profileId: string, db: Database.Database): AgentProfileBinding[] {
  return (db.prepare(`
    SELECT id, profile_id, surface_type, surface_key, label, enabled,
           configuration_json, created_by_user_id, created_at, updated_at
    FROM agent_profile_bindings WHERE profile_id = ?
    ORDER BY enabled DESC, surface_type, COALESCE(label, surface_key), surface_key
  `).all(profileId) as Array<{
    id: string; profile_id: string; surface_type: AgentProfileBinding['surfaceType']; surface_key: string;
    label: string | null; enabled: number; configuration_json: string; created_by_user_id: string | null;
    created_at: string; updated_at: string;
  }>).map((row) => ({
    id: row.id, profileId: row.profile_id, surfaceType: row.surface_type, surfaceKey: row.surface_key,
    label: row.label, enabled: row.enabled === 1, configuration: jsonRecord(row.configuration_json),
    createdByUserId: row.created_by_user_id, createdAt: row.created_at, updatedAt: row.updated_at,
  }));
}

function stewardRows(profileId: string, db: Database.Database): AgentProfileSteward[] {
  return (db.prepare(`
    SELECT aps.user_id, aps.role, p.display_name
    FROM agent_profile_stewards aps
    LEFT JOIN profiles p ON p.user_id = aps.user_id
    WHERE aps.profile_id = ? ORDER BY aps.role, COALESCE(p.display_name, aps.user_id)
  `).all(profileId) as Array<{ user_id: string; role: 'owner' | 'steward'; display_name: string | null }>).map((row) => ({
    userId: row.user_id, displayName: row.display_name, role: row.role,
  }));
}

function mapRow(row: AgentProfileRow, db: Database.Database): AgentProfileRecord {
  return {
    id: row.id, key: row.key, name: row.name, description: row.description, avatarUrl: row.avatar_url ?? null,
    accentColor: normalizeAgentAccentColor(row.accent_color) ?? agentAccentColorForKey(row.key), status: row.status,
    systemKey: row.system_key,
    owner: { type: row.owner_type, userId: row.owner_user_id, agentProfileId: row.owner_agent_profile_id },
    stewards: stewardRows(row.id, db), persona: jsonRecord(row.persona_json), runtimeProfileKey: row.runtime_profile_key,
    modelTier: normalizeModelTier(row.model_tier),
    skills: jsonStrings(row.skills_json), memoryScope: jsonRecord(row.memory_scope_json),
    authority: jsonRecord(row.authority_json), contextPolicy: jsonRecord(row.context_policy_json),
    version: row.version, createdByUserId: row.created_by_user_id, bindings: bindingRows(row.id, db),
    createdAt: row.created_at, updatedAt: row.updated_at,
  };
}

function profileRowByKey(profileKey: string, db: Database.Database) {
  return db.prepare('SELECT * FROM agent_profiles WHERE key = ?').get(profileKey) as AgentProfileRow | undefined;
}

function profileRowById(profileId: string, db: Database.Database) {
  return db.prepare('SELECT * FROM agent_profiles WHERE id = ?').get(profileId) as AgentProfileRow | undefined;
}

function snapshot(record: AgentProfileRecord) {
  return {
    key: record.key, name: record.name, description: record.description, avatarUrl: record.avatarUrl,
    accentColor: record.accentColor, status: record.status,
    systemKey: record.systemKey, owner: record.owner,
    stewards: record.stewards.map(({ userId, role }) => ({ userId, role })),
    persona: record.persona, runtimeProfileKey: record.runtimeProfileKey, modelTier: record.modelTier, skills: record.skills,
    memoryScope: record.memoryScope, authority: record.authority, contextPolicy: record.contextPolicy,
    version: record.version,
  };
}

function assertOwner(input: { ownerType: AgentProfileOwnerType; ownerUserId: string | null; ownerAgentProfileId: string | null; profileId?: string }, db: Database.Database) {
  if (input.ownerType === 'workspace') return;
  if (input.ownerType === 'user') {
    if (!input.ownerUserId || !db.prepare('SELECT 1 FROM users WHERE id = ?').get(input.ownerUserId)) throw new Error('AGENT_PROFILE_OWNER_USER_NOT_FOUND');
    return;
  }
  if (!input.ownerAgentProfileId || !profileRowById(input.ownerAgentProfileId, db)) throw new Error('AGENT_PROFILE_OWNER_AGENT_NOT_FOUND');
  if (input.ownerAgentProfileId === input.profileId) throw new Error('AGENT_PROFILE_OWNERSHIP_CYCLE');
  const seen = new Set([input.profileId].filter(Boolean));
  let cursor: string | null = input.ownerAgentProfileId;
  while (cursor) {
    if (seen.has(cursor)) throw new Error('AGENT_PROFILE_OWNERSHIP_CYCLE');
    seen.add(cursor);
    cursor = profileRowById(cursor, db)?.owner_agent_profile_id ?? null;
  }
}

export function ensureAdminAgentStewards(db: Database.Database = getDb()) {
  const now = new Date().toISOString();
  db.prepare(`
    INSERT OR IGNORE INTO agent_profile_stewards (profile_id, user_id, role, created_at)
    SELECT ?, ur.user_id, 'steward', ? FROM user_roles ur
    JOIN roles r ON r.id = ur.role_id WHERE r.slug = 'admin'
  `).run(adminAgentProfileId, now);
}

export function listAgentProfiles(input: { includeArchived?: boolean } = {}, db: Database.Database = getDb()) {
  ensureAdminAgentStewards(db);
  const rows = db.prepare(`SELECT * FROM agent_profiles ${input.includeArchived ? '' : "WHERE status <> 'archived'"} ORDER BY CASE WHEN system_key = 'admin-agent' THEN 0 ELSE 1 END, name, key`).all() as AgentProfileRow[];
  return rows.map((row) => mapRow(row, db));
}

export function getAgentProfile(profileKey: string, db: Database.Database = getDb()) {
  ensureAdminAgentStewards(db);
  const row = profileRowByKey(key(profileKey), db);
  return row ? mapRow(row, db) : null;
}

export function getAgentProfileById(profileId: string, db: Database.Database = getDb()) {
  ensureAdminAgentStewards(db);
  const row = profileRowById(text(profileId, 200), db);
  return row ? mapRow(row, db) : null;
}

export function getAgentProfileVersion(profileId: string, version: number | null | undefined, db: Database.Database = getDb()) {
  const current = getAgentProfileById(profileId, db);
  if (!current || !version) return current;
  const row = db.prepare('SELECT snapshot_json FROM agent_profile_versions WHERE profile_id = ? AND version = ?')
    .get(profileId, Math.trunc(version)) as { snapshot_json: string } | undefined;
  if (!row) return current;
  const stored = jsonRecord(row.snapshot_json);
  return {
    ...current,
    name: text(stored.name, 160) || current.name,
    description: stored.description === null ? null : text(stored.description, 2000) || current.description,
    avatarUrl: stored.avatarUrl === null ? null : text(stored.avatarUrl, 2000) || null,
    accentColor: normalizeAgentAccentColor(stored.accentColor) ?? agentAccentColorForKey(current.key),
    persona: unknownRecord(stored.persona),
    runtimeProfileKey: text(stored.runtimeProfileKey, 120) || null,
    modelTier: normalizeModelTier(stored.modelTier),
    skills: stringList(stored.skills),
    memoryScope: unknownRecord(stored.memoryScope),
    authority: unknownRecord(stored.authority),
    contextPolicy: unknownRecord(stored.contextPolicy),
    version: Math.trunc(version),
  };
}

export function upsertAgentProfile(input: UpsertAgentProfileInput, db: Database.Database = getDb()) {
  const profileKey = key(input.key);
  const existing = profileRowByKey(profileKey, db);
  if (existing?.system_key && input.allowSystemProfileUpdate !== true) {
    if (profileKey === adminAgentProfileKey) throw new Error('ADMIN_AGENT_PROFILE_PROTECTED');
    throw new Error('SYSTEM_AGENT_PROFILE_PROTECTED');
  }
  const name = text(input.name, 160);
  if (!name) throw new Error('AGENT_PROFILE_NAME_REQUIRED');
  const ownerType = input.ownerType ?? existing?.owner_type ?? 'user';
  const ownerUserId = ownerType === 'user' ? text(input.ownerUserId ?? existing?.owner_user_id, 200) || null : null;
  const ownerAgentProfileId = ownerType === 'agent' ? text(input.ownerAgentProfileId ?? existing?.owner_agent_profile_id, 200) || null : null;
  assertOwner({ ownerType, ownerUserId, ownerAgentProfileId, profileId: existing?.id }, db);
  const now = new Date().toISOString();
  const id = existing?.id ?? randomUUID();
  const nextVersion = existing ? existing.version + 1 : 1;
  const avatarUrl = input.avatarUrl === undefined
    ? existing?.avatar_url ?? null
    : normalizedAvatarUrl(input.avatarUrl);
  const accentColor = input.accentColor === undefined
    ? normalizeAgentAccentColor(existing?.accent_color) ?? agentAccentColorForKey(profileKey)
    : normalizeAgentAccentColor(input.accentColor);
  if (!accentColor) throw new Error('AGENT_PROFILE_ACCENT_COLOR_INVALID');
  const status = input.status ?? existing?.status ?? 'draft';
  const persona = input.persona ?? (existing ? jsonRecord(existing.persona_json) : { name, instructions: '' });
  const skills = Array.from(new Set((input.skills ?? (existing ? jsonStrings(existing.skills_json) : [])).map((item) => text(item, 160)).filter(Boolean)));
  const memoryScope = input.memoryScope ?? (existing ? jsonRecord(existing.memory_scope_json) : {});
  const authority = input.authority ?? (existing ? jsonRecord(existing.authority_json) : {
    mode: 'policy-controlled', maximumAccessMode: 'full', consoleAccessMode: 'full',
  });
  const contextPolicy = input.contextPolicy ?? (existing ? jsonRecord(existing.context_policy_json) : { continuation: 'session', handoff: null });
  const runtimeProfileKey = input.runtimeProfileKey === undefined
    ? existing?.runtime_profile_key ?? null
    : text(input.runtimeProfileKey, 120) || null;
  if (runtimeProfileKey && !db.prepare('SELECT 1 FROM runtime_profiles WHERE key = ?').get(runtimeProfileKey)) throw new Error('RUNTIME_PROFILE_NOT_FOUND');
  const modelTier = input.modelTier === undefined
    ? normalizeModelTier(existing?.model_tier)
    : normalizeModelTier(input.modelTier);
  const createdByUserId = text(input.createdByUserId ?? existing?.created_by_user_id, 200) || null;
  const stewardUserIds = Array.from(new Set((input.stewardUserIds ?? []).map((item) => text(item, 200)).filter(Boolean)));
  if (ownerType === 'user' && ownerUserId && !stewardUserIds.includes(ownerUserId)) stewardUserIds.unshift(ownerUserId);

  db.transaction(() => {
    db.prepare(`
      INSERT INTO agent_profiles (id, key, name, description, avatar_url, accent_color, status, system_key, owner_type, owner_user_id,
        owner_agent_profile_id, persona_json, runtime_profile_key, model_tier, skills_json, memory_scope_json, authority_json,
        context_policy_json, version, created_by_user_id, created_at, updated_at)
      VALUES (@id, @key, @name, @description, @avatarUrl, @accentColor, @status, NULL, @ownerType, @ownerUserId, @ownerAgentProfileId,
        @persona, @runtimeProfileKey, @modelTier, @skills, @memoryScope, @authority, @contextPolicy, @version,
        @createdByUserId, @createdAt, @updatedAt)
      ON CONFLICT(key) DO UPDATE SET name=excluded.name, description=excluded.description, avatar_url=excluded.avatar_url,
        accent_color=excluded.accent_color, status=excluded.status,
        owner_type=excluded.owner_type, owner_user_id=excluded.owner_user_id,
        owner_agent_profile_id=excluded.owner_agent_profile_id, persona_json=excluded.persona_json,
        runtime_profile_key=excluded.runtime_profile_key, model_tier=excluded.model_tier, skills_json=excluded.skills_json,
        memory_scope_json=excluded.memory_scope_json, authority_json=excluded.authority_json,
        context_policy_json=excluded.context_policy_json, version=excluded.version, updated_at=excluded.updated_at
    `).run({ id, key: profileKey, name, description: input.description === undefined
      ? existing?.description ?? null
      : text(input.description, 2000) || null, avatarUrl, accentColor,
      status, ownerType, ownerUserId, ownerAgentProfileId, persona: JSON.stringify(persona), runtimeProfileKey, modelTier,
      skills: JSON.stringify(skills), memoryScope: JSON.stringify(memoryScope), authority: JSON.stringify(authority),
      contextPolicy: JSON.stringify(contextPolicy), version: nextVersion, createdByUserId,
      createdAt: existing?.created_at ?? now, updatedAt: now });
    db.prepare('DELETE FROM agent_profile_stewards WHERE profile_id = ?').run(id);
    const insertSteward = db.prepare('INSERT INTO agent_profile_stewards (profile_id, user_id, role, created_at) VALUES (?, ?, ?, ?)');
    for (const userId of stewardUserIds) {
      if (!db.prepare('SELECT 1 FROM users WHERE id = ?').get(userId)) throw new Error('AGENT_PROFILE_STEWARD_NOT_FOUND');
      insertSteward.run(id, userId, ownerType === 'user' && userId === ownerUserId ? 'owner' : 'steward', now);
    }
    const record = mapRow(profileRowById(id, db)!, db);
    db.prepare('INSERT INTO agent_profile_versions (profile_id, version, snapshot_json, created_by_user_id, created_at) VALUES (?, ?, ?, ?, ?)')
      .run(id, nextVersion, JSON.stringify(snapshot(record)), createdByUserId, now);
  })();
  return getAgentProfile(profileKey, db)!;
}

export function upsertAgentProfileBinding(input: {
  profileId: string; surfaceType: AgentProfileBinding['surfaceType']; surfaceKey: string; label?: string | null;
  enabled?: boolean; configuration?: Record<string, unknown>; createdByUserId?: string | null;
}, db: Database.Database = getDb()) {
  if (!profileRowById(input.profileId, db)) throw new Error('AGENT_PROFILE_NOT_FOUND');
  const surfaceKey = text(input.surfaceKey, 300);
  if (!surfaceKey) throw new Error('AGENT_PROFILE_BINDING_KEY_REQUIRED');
  const now = new Date().toISOString();
  const current = db.prepare(`
    SELECT apb.id, apb.profile_id, apb.enabled, apb.created_at, ap.key AS profile_key
    FROM agent_profile_bindings apb
    JOIN agent_profiles ap ON ap.id = apb.profile_id
    WHERE apb.surface_type = ? AND apb.surface_key = ?
  `).get(input.surfaceType, surfaceKey) as {
    id: string; profile_id: string; enabled: number; created_at: string; profile_key: string;
  } | undefined;
  if (current && current.profile_id !== input.profileId && current.enabled === 1) {
    throw new Error(`AGENT_PROFILE_BINDING_DESTINATION_IN_USE:${current.profile_key}`);
  }
  const id = current?.id ?? randomUUID();
  db.prepare(`
    INSERT INTO agent_profile_bindings (id, profile_id, surface_type, surface_key, label, enabled, configuration_json,
      created_by_user_id, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(surface_type, surface_key) DO UPDATE SET profile_id=excluded.profile_id, label=excluded.label,
      enabled=excluded.enabled, configuration_json=excluded.configuration_json, updated_at=excluded.updated_at
  `).run(id, input.profileId, input.surfaceType, surfaceKey, text(input.label, 300) || null, input.enabled === false ? 0 : 1,
    JSON.stringify(normalizeAgentProfileBindingPolicy(input.configuration)), input.createdByUserId ?? null, current?.created_at ?? now, now);
  return bindingRows(input.profileId, db).find((binding) => binding.id === id)!;
}

export function resolveAgentProfileBinding(surfaceType: AgentProfileBinding['surfaceType'], surfaceKey: string, db: Database.Database = getDb()) {
  const row = db.prepare('SELECT profile_id FROM agent_profile_bindings WHERE surface_type = ? AND surface_key = ? AND enabled = 1').get(surfaceType, text(surfaceKey, 300)) as { profile_id: string } | undefined;
  return row ? getAgentProfileById(row.profile_id, db) : null;
}

export function resolveAgentProfileInteraction(input: {
  surfaceType: AgentProfileBinding['surfaceType'];
  surfaceKey: string;
  threadId?: string | null;
  groupIds?: string[];
  userId?: string | null;
}, db: Database.Database = getDb()): ResolvedAgentProfileInteraction | null {
  const profile = (input.threadId ? resolveAgentProfileBinding(input.surfaceType, input.threadId, db) : null)
    ?? resolveAgentProfileBinding(input.surfaceType, input.surfaceKey, db);
  if (!profile) return null;
  const binding = profile.bindings.find((candidate) => candidate.enabled && (
    candidate.surfaceKey === input.threadId || candidate.surfaceKey === input.surfaceKey
  ));
  if (!binding) return null;
  const configured = normalizeAgentProfileBindingPolicy(binding.configuration);
  const profileMaximum = accessMode(profile.authority.maximumAccessMode, 'full');
  const bindingMaximum = capMode(configured.accessMode, profileMaximum);
  const baseMode = bindingMaximum;
  let policy: ResolvedAgentProfileInteraction['policy'] = {
    accessMode: baseMode,
    capabilities: configured.capabilities.filter((capability) => sourceAdapterCapabilitiesForMode(baseMode).includes(capability)),
    rateLimit: configured.rateLimit,
    allowedWorkflows: configured.allowedWorkflows,
    legacyInteractionProfileKey: configured.legacyInteractionProfileKey,
    matchedRules: [`binding:${binding.id}`],
  };
  if (input.threadId) policy = applyBindingOverride(policy, configured.overrides.threads[input.threadId], `thread:${input.threadId}`);
  for (const groupId of input.groupIds ?? []) {
    policy = applyBindingOverride(policy, configured.overrides.groups[groupId], `group:${groupId}`);
  }
  if (input.userId) policy = applyBindingOverride(policy, configured.overrides.users[input.userId], `user:${input.userId}`);
  const cappedMode = capMode(policy.accessMode, bindingMaximum);
  if (cappedMode !== policy.accessMode) {
    policy = {
      ...policy,
      accessMode: cappedMode,
      capabilities: policy.capabilities.filter((capability) => sourceAdapterCapabilitiesForMode(cappedMode).includes(capability)),
      matchedRules: [...policy.matchedRules, 'binding-maximum'],
    };
  }
  return { profile, binding, policy };
}

export function listLegacyAgentProfileMigrationCandidates(
  db: Database.Database = getDb(),
): LegacyAgentProfileMigrationCandidate[] {
  const sourcePolicy = readSourceAdapterPolicy(loadConfig());
  const externalInterfaces = listExternalInterfaces(db);
  return listInteractionProfiles(db).map((legacy) => {
    const surfaces: LegacyAgentProfileMigrationCandidate['surfaces'] = [];
    for (const [platform, policy] of Object.entries(sourcePolicy.platforms)) {
      if (!['discord', 'telegram', 'buzz'].includes(platform)) continue;
      for (const [surfaceKey, rule] of Object.entries(policy.targets)) {
        if (rule.interactionProfileKey !== legacy.key) continue;
        surfaces.push({
          surfaceType: platform as AgentProfileBinding['surfaceType'],
          surfaceKey,
          label: null,
          accessMode: rule.mode ?? legacy.mode,
        });
      }
    }
    for (const externalInterface of externalInterfaces) {
      if (externalInterface.interactionProfileKey !== legacy.key) continue;
      surfaces.push({
        surfaceType: 'external',
        surfaceKey: externalInterface.key,
        label: externalInterface.name,
        accessMode: legacy.mode,
      });
    }
    const existing = profileRowByKey(legacy.key, db);
    const existingBindings = existing ? bindingRows(existing.id, db) : [];
    const alreadyMigrated = Boolean(existing) && surfaces.every((surface) => existingBindings.some((binding) => (
      binding.surfaceType === surface.surfaceType && binding.surfaceKey === surface.surfaceKey
    )));
    return {
      interactionProfileKey: legacy.key,
      name: legacy.name,
      description: legacy.description,
      alreadyMigrated,
      surfaces,
    };
  }).filter((candidate) => !candidate.alreadyMigrated);
}

export function migrateLegacyInteractionProfileToAgent(input: {
  interactionProfileKey: string;
  createdByUserId?: string | null;
  ownerUserId?: string | null;
}, db: Database.Database = getDb()) {
  const legacyKey = text(input.interactionProfileKey, 120).toLowerCase();
  const legacy = listInteractionProfiles(db).find((profile) => profile.key === legacyKey);
  if (!legacy) throw new Error('LEGACY_INTERACTION_PROFILE_NOT_FOUND');
  let profile = getAgentProfile(legacy.key, db);
  if (!profile) {
    profile = upsertAgentProfile({
      key: legacy.key,
      name: legacy.name,
      description: legacy.description,
      status: 'active',
      ownerType: input.ownerUserId ? 'user' : 'agent',
      ownerUserId: input.ownerUserId ?? null,
      ownerAgentProfileId: input.ownerUserId ? null : adminAgentProfileId,
      stewardUserIds: input.createdByUserId ? [input.createdByUserId] : [],
      persona: legacy.persona,
      runtimeProfileKey: legacy.runtimeProfileKey,
      memoryScope: legacy.memoryScope,
      authority: { mode: 'policy-controlled', maximumAccessMode: 'full', consoleAccessMode: 'full' },
      contextPolicy: { continuation: 'session', handoff: null },
      createdByUserId: input.createdByUserId ?? null,
    }, db);
  }
  const sourcePolicy = readSourceAdapterPolicy(loadConfig());
  const migratedBindings: AgentProfileBinding[] = [];
  const compatibleOverrides = (rules: Record<string, { interactionProfileKey?: string }>) => Object.fromEntries(
    Object.entries(rules).filter(([, rule]) => !rule.interactionProfileKey || rule.interactionProfileKey === legacy.key),
  );
  for (const [platform, platformPolicy] of Object.entries(sourcePolicy.platforms)) {
    if (!['discord', 'telegram', 'buzz'].includes(platform)) continue;
    for (const [surfaceKey, rule] of Object.entries(platformPolicy.targets)) {
      if (rule.interactionProfileKey !== legacy.key) continue;
      migratedBindings.push(upsertAgentProfileBinding({
        profileId: profile.id,
        surfaceType: platform as AgentProfileBinding['surfaceType'],
        surfaceKey,
        configuration: {
          accessMode: rule.mode ?? legacy.mode,
          capabilities: rule.capabilities,
          rateLimit: { ...legacy.rateLimit, ...(rule.rateLimit ?? {}) },
          allowedWorkflows: legacy.allowedWorkflows,
          overrides: {
            groups: compatibleOverrides(platformPolicy.groups),
            users: compatibleOverrides(platformPolicy.users),
          },
          legacyInteractionProfileKey: legacy.key,
        },
        createdByUserId: input.createdByUserId ?? null,
      }, db));
    }
  }
  for (const externalInterface of listExternalInterfaces(db)) {
    if (externalInterface.interactionProfileKey !== legacy.key) continue;
    migratedBindings.push(upsertAgentProfileBinding({
      profileId: profile.id,
      surfaceType: 'external',
      surfaceKey: externalInterface.key,
      label: externalInterface.name,
      enabled: externalInterface.enabled,
      configuration: {
        accessMode: legacy.mode,
        rateLimit: legacy.rateLimit,
        allowedWorkflows: legacy.allowedWorkflows,
        legacyInteractionProfileKey: legacy.key,
      },
      createdByUserId: input.createdByUserId ?? null,
    }, db));
  }
  return { profile: getAgentProfileById(profile.id, db)!, bindings: migratedBindings };
}

export function assignAgentProfileToSession(input: {
  sessionId: string;
  profileId: string;
  conversationScope: AgentConversationScope;
}, db: Database.Database = getDb()) {
  const profile = getAgentProfileById(input.profileId, db);
  if (!profile || profile.status !== 'active') throw new Error('AGENT_PROFILE_UNAVAILABLE');
  const result = db.prepare(`
    UPDATE agent_sessions SET agent_profile_id = ?, agent_profile_version = ?, conversation_scope = ?, updated_at = ?
    WHERE id = ? AND (agent_profile_id IS NULL OR agent_profile_id = ?)
  `).run(profile.id, profile.version, input.conversationScope, new Date().toISOString(), input.sessionId, profile.id);
  if (!result.changes) throw new Error('AGENT_SESSION_PROFILE_MISMATCH');
  return { profileId: profile.id, profileVersion: profile.version, conversationScope: input.conversationScope };
}

export function getAgentSessionProfileAssignment(sessionId: string, db: Database.Database = getDb()) {
  const row = db.prepare(`
    SELECT agent_profile_id, agent_profile_version, conversation_scope
    FROM agent_sessions WHERE id = ?
  `).get(text(sessionId, 200)) as {
    agent_profile_id: string | null;
    agent_profile_version: number | null;
    conversation_scope: AgentConversationScope | null;
  } | undefined;
  return row ? {
    profileId: row.agent_profile_id,
    profileVersion: row.agent_profile_version,
    conversationScope: row.conversation_scope,
  } : null;
}

export function listAgentProfileSessions(profileId: string, limit = 100, db: Database.Database = getDb()): AgentProfileSessionSummary[] {
  const boundedLimit = Math.max(1, Math.min(Math.trunc(limit), 200));
  return (db.prepare(`
    SELECT s.id, s.source, s.status, s.title, s.conversation_scope, s.created_by_user_id,
      COALESCE(
        p.display_name,
        (
          SELECT NULLIF(TRIM(json_extract(
            CASE WHEN json_valid(am.meta_json) THEN am.meta_json ELSE '{}' END,
            '$.authorName'
          )), '')
          FROM agent_messages am
          WHERE am.session_id = s.id AND am.role = 'user'
          ORDER BY am.created_at, am.id
          LIMIT 1
        )
      ) AS created_by_display_name,
      s.linked_change_request_id,
      cr.request_number, cr.title AS request_title,
      (SELECT COUNT(*) FROM agent_messages am WHERE am.session_id = s.id) AS message_count,
      s.last_message_at, s.created_at, s.updated_at
    FROM agent_sessions s
    LEFT JOIN profiles p ON p.user_id = s.created_by_user_id
    LEFT JOIN change_requests cr ON cr.id = s.linked_change_request_id
    WHERE s.agent_profile_id = ?
    ORDER BY COALESCE(s.last_message_at, s.updated_at) DESC, s.id DESC LIMIT ?
  `).all(profileId, boundedLimit) as Array<{
    id: string; source: string; status: string; title: string | null; conversation_scope: AgentConversationScope | null;
    created_by_user_id: string | null; created_by_display_name: string | null; linked_change_request_id: string | null;
    request_number: number | null; request_title: string | null; message_count: number;
    last_message_at: string | null; created_at: string; updated_at: string;
  }>).map((row) => ({
    id: row.id, source: row.source, status: row.status, title: row.title,
    conversationScope: row.conversation_scope ?? 'individual', createdByUserId: row.created_by_user_id,
    createdByDisplayName: row.created_by_display_name, linkedChangeRequestId: row.linked_change_request_id,
    linkedRequestNumber: row.request_number, linkedRequestTitle: row.request_title, messageCount: row.message_count,
    lastMessageAt: row.last_message_at, createdAt: row.created_at, updatedAt: row.updated_at,
  }));
}

export function listAgentProfileActivity(profileId: string, limit = 100, db: Database.Database = getDb()): AgentProfileActivityItem[] {
  const boundedLimit = Math.max(1, Math.min(Math.trunc(limit), 200));
  const sessions = listAgentProfileSessions(profileId, boundedLimit, db).map((session) => ({
    id: `session:${session.id}`,
    kind: 'session' as const,
    occurredAt: session.lastMessageAt ?? session.updatedAt,
    title: session.title || `${session.source} session`,
    description: `${session.conversationScope} ${session.source} conversation · ${session.messageCount} message${session.messageCount === 1 ? '' : 's'}`,
    status: session.status,
    sessionId: session.id,
    requestId: session.linkedChangeRequestId,
    requestNumber: session.linkedRequestNumber,
    requestTitle: session.linkedRequestTitle,
    workflowStepKey: null,
    executionMode: null,
    actorDisplayName: session.createdByDisplayName,
  }));
  const runs = (db.prepare(`
    SELECT ar.id, ar.status, ar.kind, ar.session_id, ar.request_id, ar.workflow_step_key,
      ar.execution_mode, COALESCE(ar.finished_at, ar.started_at, ar.created_at) AS occurred_at,
      cr.request_number, cr.title AS request_title, p.display_name AS actor_display_name
    FROM agent_runs ar
    LEFT JOIN change_requests cr ON cr.id = ar.request_id
    LEFT JOIN agent_sessions s ON s.id = ar.session_id
    LEFT JOIN profiles p ON p.user_id = s.created_by_user_id
    WHERE ar.agent_profile_id = ?
    ORDER BY occurred_at DESC, ar.id DESC LIMIT ?
  `).all(profileId, boundedLimit) as Array<{
    id: string; status: string; kind: string; session_id: string | null; request_id: string | null;
    workflow_step_key: string | null; execution_mode: string | null; occurred_at: string;
    request_number: number | null; request_title: string | null; actor_display_name: string | null;
  }>).map((run) => ({
    id: `run:${run.id}`,
    kind: 'run' as const,
    occurredAt: run.occurred_at,
    title: run.workflow_step_key ? `Executed ${run.workflow_step_key}` : `Ran ${run.kind}`,
    description: run.request_number ? `Request #${run.request_number}${run.request_title ? ` · ${run.request_title}` : ''}` : run.kind,
    status: run.status,
    sessionId: run.session_id,
    requestId: run.request_id,
    requestNumber: run.request_number,
    requestTitle: run.request_title,
    workflowStepKey: run.workflow_step_key,
    executionMode: run.execution_mode,
    actorDisplayName: run.actor_display_name,
  }));
  return [...sessions, ...runs]
    .sort((left, right) => right.occurredAt.localeCompare(left.occurredAt) || left.id.localeCompare(right.id))
    .slice(0, boundedLimit);
}

export function listAgentProfileQueueStates(db: Database.Database = getDb()): AgentProfileQueueState[] {
  const rows = db.prepare(`
    SELECT agent_profile_id,
      SUM(CASE WHEN status = 'queued' THEN 1 ELSE 0 END) AS queued,
      SUM(CASE WHEN status = 'claimed' THEN 1 ELSE 0 END) AS claimed,
      SUM(CASE WHEN status = 'running' THEN 1 ELSE 0 END) AS running
    FROM agent_runs
    WHERE agent_profile_id IS NOT NULL AND status IN ('queued', 'claimed', 'running')
    GROUP BY agent_profile_id
  `).all() as Array<{ agent_profile_id: string; queued: number; claimed: number; running: number }>;
  return rows.map((row) => ({
    profileId: row.agent_profile_id,
    queued: Number(row.queued) || 0,
    claimed: Number(row.claimed) || 0,
    running: Number(row.running) || 0,
  }));
}

export function getAgentProfileSessionDetail(profileId: string, sessionId: string, db: Database.Database = getDb()): AgentProfileSessionDetail | null {
  const session = listAgentProfileSessions(profileId, 200, db).find((candidate) => candidate.id === sessionId);
  if (!session) return null;
  const assignment = getAgentSessionProfileAssignment(sessionId, db);
  const messages = (db.prepare(`
    SELECT id, role, source, source_message_id, content, meta_json, created_at
    FROM agent_messages WHERE session_id = ? ORDER BY created_at, id LIMIT 500
  `).all(sessionId) as Array<{
    id: string; role: string; source: string; source_message_id: string | null;
    content: string; meta_json: string; created_at: string;
  }>).map((message) => {
    const meta = jsonRecord(message.meta_json);
    return {
      id: message.id, role: message.role, source: message.source, sourceMessageId: message.source_message_id,
      content: message.content, authorId: text(meta.authorId ?? meta.authorPubkey, 300) || null,
      authorName: text(meta.authorName, 300) || null, createdAt: message.created_at,
    };
  });
  const runs = (db.prepare(`
    SELECT ar.id, ar.kind, ar.status, ar.request_id, cr.request_number, ar.workflow_step_key,
      ar.execution_mode, ar.error_message, ar.created_at, ar.started_at, ar.finished_at
    FROM agent_runs ar LEFT JOIN change_requests cr ON cr.id = ar.request_id
    WHERE ar.session_id = ? AND ar.agent_profile_id = ? ORDER BY ar.created_at, ar.id LIMIT 500
  `).all(sessionId, profileId) as Array<{
    id: string; kind: string; status: string; request_id: string | null; request_number: number | null;
    workflow_step_key: string | null; execution_mode: string | null; error_message: string | null;
    created_at: string; started_at: string | null; finished_at: string | null;
  }>).map((run) => ({
    id: run.id, kind: run.kind, status: run.status, requestId: run.request_id, requestNumber: run.request_number,
    workflowStepKey: run.workflow_step_key, executionMode: run.execution_mode, errorMessage: run.error_message,
    createdAt: run.created_at, startedAt: run.started_at, finishedAt: run.finished_at,
  }));
  return { ...session, profileId, profileVersion: assignment?.profileVersion ?? null, messages, runs };
}
