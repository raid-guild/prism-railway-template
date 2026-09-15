import { createHash, randomBytes, randomUUID, timingSafeEqual } from 'node:crypto';
import type Database from 'better-sqlite3';
import { getDb } from './db';

export type InteractionAccessMode = 'off' | 'readonly' | 'run-approved' | 'full';

export interface InteractionProfileRecord {
  key: string;
  name: string;
  description: string | null;
  mode: InteractionAccessMode;
  runtimeProfileKey: string | null;
  persona: { name: string | null; instructions: string };
  memoryScope: {
    knowledgeSourceIds: string[];
    buckets: string[];
    instructions: string;
    enforcement: 'instructions-only';
  };
  allowedWorkflows: string[];
  rateLimit: { windowSeconds: number; maxRequests: number };
  version: number;
  createdAt: string;
  updatedAt: string;
}

export interface ExternalInterfaceRecord {
  key: string;
  name: string;
  description: string | null;
  enabled: boolean;
  authMode: 'api-key';
  interactionProfileKey: string;
  allowedOrigins: string[];
  credential: {
    configured: boolean;
    prefix: string | null;
    createdAt: string | null;
    lastUsedAt: string | null;
  };
  createdAt: string;
  updatedAt: string;
}

export interface ResolvedExternalInterface {
  interface: ExternalInterfaceRecord;
  profile: InteractionProfileRecord;
}

export interface UpsertInteractionProfileInput {
  key: string;
  name?: string | null;
  description?: string | null;
  mode?: InteractionAccessMode;
  runtimeProfileKey?: string | null;
  persona?: { name?: string | null; instructions?: string | null };
  memoryScope?: { knowledgeSourceIds?: string[]; buckets?: string[]; instructions?: string | null };
  allowedWorkflows?: string[];
  rateLimit?: { windowSeconds?: number; maxRequests?: number };
}

export interface UpsertExternalInterfaceInput {
  key: string;
  name?: string | null;
  description?: string | null;
  enabled?: boolean;
  authMode?: 'api-key';
  interactionProfileKey: string;
  allowedOrigins?: string[];
}

type InteractionProfileRow = {
  key: string;
  name: string;
  description: string | null;
  mode: string;
  runtime_profile_key: string | null;
  persona_name: string | null;
  persona_instructions: string;
  memory_source_ids_json: string;
  memory_buckets_json: string;
  memory_instructions: string;
  allowed_workflows_json: string;
  rate_limit_window_seconds: number;
  rate_limit_max_requests: number;
  version: number;
  created_at: string;
  updated_at: string;
};

type ExternalInterfaceRow = {
  key: string;
  name: string;
  description: string | null;
  enabled: number;
  auth_mode: string;
  interaction_profile_key: string;
  allowed_origins_json: string;
  credential_hash: string | null;
  credential_prefix: string | null;
  credential_created_at: string | null;
  credential_last_used_at: string | null;
  created_at: string;
  updated_at: string;
};

const keyPattern = /^[a-z][a-z0-9_.-]{1,79}$/;
const accessModes = new Set<InteractionAccessMode>(['off', 'readonly', 'run-approved', 'full']);

function normalizeKey(value: unknown, code: string) {
  const key = typeof value === 'string' ? value.trim().toLowerCase() : '';
  if (!keyPattern.test(key)) throw new Error(code);
  return key;
}

function normalizeText(value: unknown, maxLength: number) {
  return typeof value === 'string' ? value.trim().slice(0, maxLength) : '';
}

function parseStringArray(value: string) {
  try {
    const parsed = JSON.parse(value) as unknown;
    return Array.isArray(parsed) ? parsed.filter((item): item is string => typeof item === 'string') : [];
  } catch {
    return [];
  }
}

function normalizeWorkflowKeys(value: unknown) {
  if (!Array.isArray(value)) return [];
  return Array.from(new Set(value.map((item) => normalizeText(item, 80)).filter((item) => keyPattern.test(item)))).sort();
}

function normalizeMemorySourceIds(value: unknown) {
  if (!Array.isArray(value)) return [];
  return Array.from(new Set(value.map((item) => normalizeText(item, 160)).filter((item) => /^[a-zA-Z0-9][a-zA-Z0-9_.:-]{0,159}$/.test(item)))).sort();
}

function normalizeMemoryBuckets(value: unknown) {
  if (!Array.isArray(value)) return [];
  return Array.from(new Set(value.map((item) => normalizeText(item, 80).toLowerCase()).filter((item) => /^[a-z0-9][a-z0-9_-]{0,79}$/.test(item)))).sort();
}

function normalizeOrigins(value: unknown) {
  if (!Array.isArray(value)) return [];
  return Array.from(new Set(value.flatMap((item) => {
    if (typeof item !== 'string') return [];
    try {
      const parsed = new URL(item.trim());
      if (!['http:', 'https:'].includes(parsed.protocol) || parsed.username || parsed.password || parsed.pathname !== '/') return [];
      return [parsed.origin.toLowerCase()];
    } catch {
      return [];
    }
  }))).sort();
}

function boundedInteger(value: unknown, fallback: number, min: number, max: number) {
  return typeof value === 'number' && Number.isFinite(value)
    ? Math.min(max, Math.max(min, Math.trunc(value)))
    : fallback;
}

function mapProfile(row: InteractionProfileRow): InteractionProfileRecord {
  return {
    key: row.key,
    name: row.name,
    description: row.description,
    mode: accessModes.has(row.mode as InteractionAccessMode) ? row.mode as InteractionAccessMode : 'off',
    runtimeProfileKey: row.runtime_profile_key,
    persona: { name: row.persona_name, instructions: row.persona_instructions },
    memoryScope: {
      knowledgeSourceIds: normalizeMemorySourceIds(parseStringArray(row.memory_source_ids_json)),
      buckets: normalizeMemoryBuckets(parseStringArray(row.memory_buckets_json)),
      instructions: row.memory_instructions,
      enforcement: 'instructions-only',
    },
    allowedWorkflows: normalizeWorkflowKeys(parseStringArray(row.allowed_workflows_json)),
    rateLimit: {
      windowSeconds: row.rate_limit_window_seconds,
      maxRequests: row.rate_limit_max_requests,
    },
    version: row.version,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function mapInterface(row: ExternalInterfaceRow): ExternalInterfaceRecord {
  return {
    key: row.key,
    name: row.name,
    description: row.description,
    enabled: row.enabled === 1,
    authMode: 'api-key',
    interactionProfileKey: row.interaction_profile_key,
    allowedOrigins: normalizeOrigins(parseStringArray(row.allowed_origins_json)),
    credential: {
      configured: Boolean(row.credential_hash),
      prefix: row.credential_prefix,
      createdAt: row.credential_created_at,
      lastUsedAt: row.credential_last_used_at,
    },
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function profileRow(key: string, db: Database.Database) {
  return db.prepare('SELECT * FROM interaction_profiles WHERE key = ?').get(key) as InteractionProfileRow | undefined;
}

function interfaceRow(key: string, db: Database.Database) {
  return db.prepare('SELECT * FROM external_interfaces WHERE key = ?').get(key) as ExternalInterfaceRow | undefined;
}

export function listInteractionProfiles(db: Database.Database = getDb()) {
  return (db.prepare('SELECT * FROM interaction_profiles ORDER BY name, key').all() as InteractionProfileRow[]).map(mapProfile);
}

export function getInteractionProfile(key: string, db: Database.Database = getDb()) {
  const row = profileRow(normalizeKey(key, 'INTERACTION_PROFILE_KEY_INVALID'), db);
  return row ? mapProfile(row) : null;
}

export function upsertInteractionProfile(input: UpsertInteractionProfileInput, db: Database.Database = getDb()) {
  const key = normalizeKey(input.key, 'INTERACTION_PROFILE_KEY_INVALID');
  const existing = profileRow(key, db);
  const now = new Date().toISOString();
  const mode = input.mode ?? (existing?.mode as InteractionAccessMode | undefined) ?? 'off';
  if (!accessModes.has(mode)) throw new Error('INTERACTION_PROFILE_MODE_INVALID');
  const runtimeProfileKey = input.runtimeProfileKey === undefined
    ? existing?.runtime_profile_key ?? null
    : input.runtimeProfileKey
      ? normalizeKey(input.runtimeProfileKey, 'INTERACTION_RUNTIME_PROFILE_KEY_INVALID')
      : null;
  if (runtimeProfileKey) {
    const runtimeExists = db.prepare('SELECT 1 FROM runtime_profiles WHERE key = ?').get(runtimeProfileKey);
    if (!runtimeExists) throw new Error('INTERACTION_RUNTIME_PROFILE_NOT_FOUND');
  }
  const currentPersona = existing
    ? { name: existing.persona_name, instructions: existing.persona_instructions }
    : { name: null, instructions: '' };
  const persona = {
    name: input.persona?.name === undefined ? currentPersona.name : normalizeText(input.persona.name, 120) || null,
    instructions: input.persona?.instructions === undefined
      ? currentPersona.instructions
      : normalizeText(input.persona.instructions, 20_000),
  };
  const memoryScope = {
    knowledgeSourceIds: input.memoryScope?.knowledgeSourceIds === undefined
      ? normalizeMemorySourceIds(existing ? parseStringArray(existing.memory_source_ids_json) : [])
      : normalizeMemorySourceIds(input.memoryScope.knowledgeSourceIds),
    buckets: input.memoryScope?.buckets === undefined
      ? normalizeMemoryBuckets(existing ? parseStringArray(existing.memory_buckets_json) : [])
      : normalizeMemoryBuckets(input.memoryScope.buckets),
    instructions: input.memoryScope?.instructions === undefined
      ? existing?.memory_instructions ?? ''
      : normalizeText(input.memoryScope.instructions, 10_000),
  };
  const rateLimit = {
    windowSeconds: boundedInteger(input.rateLimit?.windowSeconds, existing?.rate_limit_window_seconds ?? 60, 1, 86_400),
    maxRequests: boundedInteger(input.rateLimit?.maxRequests, existing?.rate_limit_max_requests ?? 6, 1, 10_000),
  };

  db.prepare(`
    INSERT INTO interaction_profiles (
      key, name, description, mode, runtime_profile_key, persona_name,
      persona_instructions, memory_source_ids_json, memory_buckets_json,
      memory_instructions, allowed_workflows_json, rate_limit_window_seconds,
      rate_limit_max_requests, version, created_at, updated_at
    ) VALUES (
      @key, @name, @description, @mode, @runtimeProfileKey, @personaName,
      @personaInstructions, @memorySourceIdsJson, @memoryBucketsJson,
      @memoryInstructions, @allowedWorkflowsJson, @windowSeconds,
      @maxRequests, @version, @createdAt, @updatedAt
    )
    ON CONFLICT(key) DO UPDATE SET
      name = excluded.name,
      description = excluded.description,
      mode = excluded.mode,
      runtime_profile_key = excluded.runtime_profile_key,
      persona_name = excluded.persona_name,
      persona_instructions = excluded.persona_instructions,
      memory_source_ids_json = excluded.memory_source_ids_json,
      memory_buckets_json = excluded.memory_buckets_json,
      memory_instructions = excluded.memory_instructions,
      allowed_workflows_json = excluded.allowed_workflows_json,
      rate_limit_window_seconds = excluded.rate_limit_window_seconds,
      rate_limit_max_requests = excluded.rate_limit_max_requests,
      version = excluded.version,
      updated_at = excluded.updated_at
  `).run({
    key,
    name: normalizeText(input.name, 120) || existing?.name || key,
    description: input.description === undefined ? existing?.description ?? null : normalizeText(input.description, 1_000) || null,
    mode,
    runtimeProfileKey,
    personaName: persona.name,
    personaInstructions: persona.instructions,
    memorySourceIdsJson: JSON.stringify(memoryScope.knowledgeSourceIds),
    memoryBucketsJson: JSON.stringify(memoryScope.buckets),
    memoryInstructions: memoryScope.instructions,
    allowedWorkflowsJson: JSON.stringify(input.allowedWorkflows === undefined
      ? normalizeWorkflowKeys(existing ? parseStringArray(existing.allowed_workflows_json) : [])
      : normalizeWorkflowKeys(input.allowedWorkflows)),
    windowSeconds: rateLimit.windowSeconds,
    maxRequests: rateLimit.maxRequests,
    version: (existing?.version ?? 0) + 1,
    createdAt: existing?.created_at ?? now,
    updatedAt: now,
  });

  return mapProfile(profileRow(key, db)!);
}

export function deleteInteractionProfile(key: string, db: Database.Database = getDb()) {
  const normalized = normalizeKey(key, 'INTERACTION_PROFILE_KEY_INVALID');
  try {
    return db.prepare('DELETE FROM interaction_profiles WHERE key = ?').run(normalized).changes > 0;
  } catch (error) {
    if (error instanceof Error && error.message.includes('FOREIGN KEY')) throw new Error('INTERACTION_PROFILE_IN_USE');
    throw error;
  }
}

export function listExternalInterfaces(db: Database.Database = getDb()) {
  return (db.prepare('SELECT * FROM external_interfaces ORDER BY enabled DESC, name, key').all() as ExternalInterfaceRow[]).map(mapInterface);
}

export function getExternalInterface(key: string, db: Database.Database = getDb()) {
  const row = interfaceRow(normalizeKey(key, 'EXTERNAL_INTERFACE_KEY_INVALID'), db);
  return row ? mapInterface(row) : null;
}

export function resolveExternalInterface(key: string, db: Database.Database = getDb()): ResolvedExternalInterface | null {
  const interfaceRecord = getExternalInterface(key, db);
  if (!interfaceRecord) return null;
  const profile = getInteractionProfile(interfaceRecord.interactionProfileKey, db);
  if (!profile) throw new Error('INTERACTION_PROFILE_NOT_FOUND');
  return { interface: interfaceRecord, profile };
}

export function upsertExternalInterface(input: UpsertExternalInterfaceInput, db: Database.Database = getDb()) {
  const key = normalizeKey(input.key, 'EXTERNAL_INTERFACE_KEY_INVALID');
  const profileKey = normalizeKey(input.interactionProfileKey, 'INTERACTION_PROFILE_KEY_INVALID');
  const profile = profileRow(profileKey, db);
  if (!profile) throw new Error('INTERACTION_PROFILE_NOT_FOUND');
  const existing = interfaceRow(key, db);
  const now = new Date().toISOString();
  const enabled = input.enabled ?? (existing?.enabled === 1);
  if (enabled && !existing?.credential_hash) throw new Error('EXTERNAL_INTERFACE_CREDENTIAL_REQUIRED');

  db.prepare(`
    INSERT INTO external_interfaces (
      key, name, description, enabled, auth_mode, interaction_profile_key,
      allowed_origins_json, credential_hash, credential_prefix,
      credential_created_at, credential_last_used_at, created_at, updated_at
    ) VALUES (
      @key, @name, @description, @enabled, 'api-key', @profileKey,
      @allowedOriginsJson, @credentialHash, @credentialPrefix,
      @credentialCreatedAt, @credentialLastUsedAt, @createdAt, @updatedAt
    )
    ON CONFLICT(key) DO UPDATE SET
      name = excluded.name,
      description = excluded.description,
      enabled = excluded.enabled,
      auth_mode = excluded.auth_mode,
      interaction_profile_key = excluded.interaction_profile_key,
      allowed_origins_json = excluded.allowed_origins_json,
      updated_at = excluded.updated_at
  `).run({
    key,
    name: normalizeText(input.name, 120) || existing?.name || key,
    description: input.description === undefined ? existing?.description ?? null : normalizeText(input.description, 1_000) || null,
    enabled: enabled ? 1 : 0,
    profileKey,
    allowedOriginsJson: JSON.stringify(input.allowedOrigins === undefined
      ? normalizeOrigins(existing ? parseStringArray(existing.allowed_origins_json) : [])
      : normalizeOrigins(input.allowedOrigins)),
    credentialHash: existing?.credential_hash ?? null,
    credentialPrefix: existing?.credential_prefix ?? null,
    credentialCreatedAt: existing?.credential_created_at ?? null,
    credentialLastUsedAt: existing?.credential_last_used_at ?? null,
    createdAt: existing?.created_at ?? now,
    updatedAt: now,
  });
  return mapInterface(interfaceRow(key, db)!);
}

export function deleteExternalInterface(key: string, db: Database.Database = getDb()) {
  return db.prepare('DELETE FROM external_interfaces WHERE key = ?')
    .run(normalizeKey(key, 'EXTERNAL_INTERFACE_KEY_INVALID')).changes > 0;
}

function hashCredential(value: string) {
  return createHash('sha256').update(value).digest('hex');
}

export function rotateExternalInterfaceCredential(key: string, db: Database.Database = getDb()) {
  const normalized = normalizeKey(key, 'EXTERNAL_INTERFACE_KEY_INVALID');
  if (!interfaceRow(normalized, db)) throw new Error('EXTERNAL_INTERFACE_NOT_FOUND');
  const credential = `prism_int_${randomBytes(32).toString('base64url')}`;
  const prefix = credential.slice(0, 18);
  const now = new Date().toISOString();
  db.prepare(`
    UPDATE external_interfaces
    SET credential_hash = ?, credential_prefix = ?, credential_created_at = ?,
        credential_last_used_at = NULL, updated_at = ?
    WHERE key = ?
  `).run(hashCredential(credential), prefix, now, now, normalized);
  return { interface: mapInterface(interfaceRow(normalized, db)!), credential };
}

export function revokeExternalInterfaceCredential(key: string, db: Database.Database = getDb()) {
  const normalized = normalizeKey(key, 'EXTERNAL_INTERFACE_KEY_INVALID');
  const now = new Date().toISOString();
  return db.prepare(`
    UPDATE external_interfaces
    SET credential_hash = NULL, credential_prefix = NULL, credential_created_at = NULL,
        credential_last_used_at = NULL, updated_at = ?
    WHERE key = ?
  `).run(now, normalized).changes > 0;
}

function subjectHash(value: string | null | undefined) {
  return value ? createHash('sha256').update(value).digest('hex') : null;
}

export function recordInteractionAccessEvent(input: {
  interfaceKey?: string | null;
  outcome: string;
  reason: string;
  requestId?: string | null;
  subject?: string | null;
  metadata?: Record<string, unknown>;
}, db: Database.Database = getDb()) {
  const createdAt = new Date().toISOString();
  const id = randomUUID();
  db.prepare(`
    INSERT INTO interaction_access_events (
      id, interface_key, outcome, reason, request_id, subject_hash, metadata_json, created_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    id,
    normalizeText(input.interfaceKey, 80) || null,
    normalizeText(input.outcome, 40) || 'unknown',
    normalizeText(input.reason, 120) || 'unknown',
    normalizeText(input.requestId, 120) || null,
    subjectHash(normalizeText(input.subject, 300) || null),
    JSON.stringify(input.metadata ?? {}),
    createdAt,
  );
  return { id, createdAt };
}

export function authorizeExternalInterface(input: {
  key: string;
  credential: string;
  origin?: string | null;
  requestId?: string | null;
  subject?: string | null;
}, db: Database.Database = getDb()) {
  const attemptedKey = normalizeText(input.key, 80).toLowerCase();
  let row: ExternalInterfaceRow | undefined;
  try {
    row = interfaceRow(normalizeKey(attemptedKey, 'EXTERNAL_INTERFACE_KEY_INVALID'), db);
  } catch {
    recordInteractionAccessEvent({ interfaceKey: attemptedKey, outcome: 'rejected', reason: 'invalid-interface', requestId: input.requestId, subject: input.subject }, db);
    return { ok: false as const, code: 'EXTERNAL_INTERFACE_NOT_FOUND' };
  }
  if (!row) {
    recordInteractionAccessEvent({ interfaceKey: attemptedKey, outcome: 'rejected', reason: 'unknown-interface', requestId: input.requestId, subject: input.subject }, db);
    return { ok: false as const, code: 'EXTERNAL_INTERFACE_NOT_FOUND' };
  }
  if (row.enabled !== 1) {
    recordInteractionAccessEvent({ interfaceKey: row.key, outcome: 'rejected', reason: 'disabled', requestId: input.requestId, subject: input.subject }, db);
    return { ok: false as const, code: 'EXTERNAL_INTERFACE_DISABLED' };
  }
  if (!row.credential_hash || !input.credential) {
    recordInteractionAccessEvent({ interfaceKey: row.key, outcome: 'rejected', reason: 'credential-missing', requestId: input.requestId, subject: input.subject }, db);
    return { ok: false as const, code: 'EXTERNAL_INTERFACE_UNAUTHORIZED' };
  }
  const actual = Buffer.from(hashCredential(input.credential), 'utf8');
  const expected = Buffer.from(row.credential_hash, 'utf8');
  if (actual.length !== expected.length || !timingSafeEqual(actual, expected)) {
    recordInteractionAccessEvent({ interfaceKey: row.key, outcome: 'rejected', reason: 'credential-invalid', requestId: input.requestId, subject: input.subject }, db);
    return { ok: false as const, code: 'EXTERNAL_INTERFACE_UNAUTHORIZED' };
  }
  const allowedOrigins = normalizeOrigins(parseStringArray(row.allowed_origins_json));
  const origin = normalizeText(input.origin, 500);
  if (origin && !allowedOrigins.includes(origin.toLowerCase())) {
    recordInteractionAccessEvent({ interfaceKey: row.key, outcome: 'rejected', reason: 'origin-denied', requestId: input.requestId, subject: input.subject }, db);
    return { ok: false as const, code: 'EXTERNAL_INTERFACE_ORIGIN_DENIED' };
  }
  const profile = profileRow(row.interaction_profile_key, db);
  if (!profile || profile.mode === 'off') {
    recordInteractionAccessEvent({ interfaceKey: row.key, outcome: 'rejected', reason: 'profile-off', requestId: input.requestId, subject: input.subject }, db);
    return { ok: false as const, code: 'EXTERNAL_INTERFACE_DISABLED' };
  }
  const now = new Date().toISOString();
  db.prepare('UPDATE external_interfaces SET credential_last_used_at = ? WHERE key = ?').run(now, row.key);
  recordInteractionAccessEvent({ interfaceKey: row.key, outcome: 'accepted', reason: 'authorized', requestId: input.requestId, subject: input.subject }, db);
  return {
    ok: true as const,
    resolved: {
      interface: mapInterface({ ...row, credential_last_used_at: now }),
      profile: mapProfile(profile),
    },
  };
}

export function listInteractionAccessEvents(interfaceKey?: string | null, limit = 100, db: Database.Database = getDb()) {
  const safeLimit = Math.max(1, Math.min(500, Math.trunc(limit)));
  const rows = interfaceKey
    ? db.prepare('SELECT * FROM interaction_access_events WHERE interface_key = ? ORDER BY created_at DESC, rowid DESC LIMIT ?')
      .all(normalizeText(interfaceKey, 80), safeLimit)
    : db.prepare('SELECT * FROM interaction_access_events ORDER BY created_at DESC, rowid DESC LIMIT ?').all(safeLimit);
  return (rows as Array<{
    id: string; interface_key: string | null; outcome: string; reason: string;
    request_id: string | null; subject_hash: string | null; metadata_json: string; created_at: string;
  }>).map((row) => ({
    id: row.id,
    interfaceKey: row.interface_key,
    outcome: row.outcome,
    reason: row.reason,
    requestId: row.request_id,
    subjectHash: row.subject_hash,
    metadata: (() => { try { return JSON.parse(row.metadata_json) as Record<string, unknown>; } catch { return {}; } })(),
    createdAt: row.created_at,
  }));
}
