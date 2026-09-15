import type Database from 'better-sqlite3';

import { getDb } from './db';

export const requestOriginPlatforms = [
  'site',
  'discord',
  'telegram',
  'buzz',
  'external',
  'task',
  'hook',
  'system',
  'unknown',
] as const;

export type RequestOriginPlatform = (typeof requestOriginPlatforms)[number];
export type RequestOriginActorType = 'user' | 'external-subject' | 'task' | 'hook' | 'system' | null;
export type RequestOriginBackfillStatus = 'complete' | 'partial' | 'unknown';

export type RequestOriginSnapshot = {
  sourceSessionId: string | null;
  platform: RequestOriginPlatform;
  targetId: string | null;
  targetName: string | null;
  threadId: string | null;
  interfaceKey: string | null;
  interactionProfileKey: string | null;
  interactionProfileVersion: number | null;
  actorType: RequestOriginActorType;
  actorId: string | null;
  actorDisplayName: string | null;
  sourceMessageId: string | null;
  rawSource: string | null;
  backfillStatus: RequestOriginBackfillStatus;
  capturedAt: string;
};

type RequestOriginRow = {
  request_id: string;
  source_session_id: string | null;
  platform: string;
  target_id: string | null;
  target_name: string | null;
  thread_id: string | null;
  interface_key: string | null;
  interaction_profile_key: string | null;
  interaction_profile_version: number | null;
  actor_type: string | null;
  actor_id: string | null;
  actor_display_name: string | null;
  source_message_id: string | null;
  raw_source: string | null;
  backfill_status: string;
  captured_at: string;
};

function text(value: unknown, maxLength = 500) {
  return typeof value === 'string' && value.trim() ? value.trim().slice(0, maxLength) : null;
}

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}

function jsonRecord(value: string) {
  try {
    return record(JSON.parse(value));
  } catch {
    return {};
  }
}

function integer(value: unknown) {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0
    ? Math.trunc(value)
    : null;
}

export function normalizeRequestOriginPlatform(value: unknown): RequestOriginPlatform {
  const normalized = text(value)?.toLowerCase() ?? '';
  if (['manual', 'admin', 'site', 'admin-console', 'chat'].includes(normalized)) return 'site';
  if (normalized === 'discord' || normalized.startsWith('discord-')) return 'discord';
  if (normalized === 'telegram' || normalized.startsWith('telegram-')) return 'telegram';
  if (normalized === 'buzz' || normalized.startsWith('buzz-')) return 'buzz';
  if (normalized === 'external' || normalized.startsWith('external-')) return 'external';
  if (normalized === 'task-runner' || normalized === 'scheduled-task' || normalized === 'task' || normalized.startsWith('task:')) return 'task';
  if (normalized === 'hook' || normalized.startsWith('hook:')) return 'hook';
  if (normalized === 'system' || normalized.startsWith('system:') || normalized.startsWith('prism-doctor')) {
    return 'system';
  }
  return 'unknown';
}

function platformActorType(platform: RequestOriginPlatform): RequestOriginActorType {
  if (platform === 'external') return 'external-subject';
  if (platform === 'task') return 'task';
  if (platform === 'hook') return 'hook';
  if (platform === 'system') return 'system';
  if (platform === 'unknown') return null;
  return 'user';
}

function parseRow(row: RequestOriginRow): RequestOriginSnapshot {
  return {
    sourceSessionId: row.source_session_id,
    platform: requestOriginPlatforms.includes(row.platform as RequestOriginPlatform)
      ? row.platform as RequestOriginPlatform
      : 'unknown',
    targetId: row.target_id,
    targetName: row.target_name,
    threadId: row.thread_id,
    interfaceKey: row.interface_key,
    interactionProfileKey: row.interaction_profile_key,
    interactionProfileVersion: row.interaction_profile_version,
    actorType: ['user', 'external-subject', 'task', 'hook', 'system'].includes(row.actor_type ?? '')
      ? row.actor_type as Exclude<RequestOriginActorType, null>
      : null,
    actorId: row.actor_id,
    actorDisplayName: row.actor_display_name,
    sourceMessageId: row.source_message_id,
    rawSource: row.raw_source,
    backfillStatus: ['complete', 'partial', 'unknown'].includes(row.backfill_status)
      ? row.backfill_status as RequestOriginBackfillStatus
      : 'unknown',
    capturedAt: row.captured_at,
  };
}

export function getRequestOrigin(requestId: string, db: Database.Database = getDb()) {
  const row = db.prepare('SELECT * FROM request_origins WHERE request_id = ?').get(requestId) as RequestOriginRow | undefined;
  return row ? parseRow(row) : null;
}

export function listRequestOrigins(requestIds: readonly string[], db: Database.Database = getDb()) {
  const ids = Array.from(new Set(requestIds.map((id) => id.trim()).filter(Boolean)));
  if (!ids.length) return new Map<string, RequestOriginSnapshot>();
  const rows = db.prepare(
    `SELECT * FROM request_origins WHERE request_id IN (${ids.map(() => '?').join(', ')})`,
  ).all(...ids) as RequestOriginRow[];
  return new Map(rows.map((row) => [row.request_id, parseRow(row)]));
}

export function resolveRequestOriginSnapshot(input: {
  sourceSessionId?: string | null;
  sourceMessageId?: string | null;
  rawSource?: string | null;
  requestedByUserId?: string | null;
  capturedAt: string;
}, db: Database.Database = getDb()): RequestOriginSnapshot {
  const sourceSessionId = text(input.sourceSessionId, 200);
  const rawSource = text(input.rawSource, 200);
  const session = sourceSessionId
    ? db.prepare(`
        SELECT id, source, title, discord_channel_id, discord_thread_id, meta_json, created_by_user_id
        FROM agent_sessions WHERE id = ?
      `).get(sourceSessionId) as {
        id: string;
        source: string;
        title: string | null;
        discord_channel_id: string | null;
        discord_thread_id: string | null;
        meta_json: string;
        created_by_user_id: string | null;
      } | undefined
    : undefined;
  if (sourceSessionId && !session) throw new Error('SOURCE_SESSION_NOT_FOUND');

  const sessionMeta = session ? jsonRecord(session.meta_json) : {};
  const accessPolicy = record(sessionMeta.accessPolicy);
  const platform = normalizeRequestOriginPlatform(session?.source ?? rawSource);
  const requestedMessageId = text(input.sourceMessageId, 200);
  if (requestedMessageId && !sourceSessionId) throw new Error('SOURCE_SESSION_REQUIRED');
  const message = session
    ? db.prepare(`
        SELECT source_message_id, meta_json
        FROM agent_messages
        WHERE session_id = ? AND role = 'user'
          AND (? IS NULL OR source_message_id = ?)
        ORDER BY created_at DESC, id DESC
        LIMIT 1
      `).get(session.id, requestedMessageId, requestedMessageId) as {
        source_message_id: string | null;
        meta_json: string;
      } | undefined
    : undefined;
  if (requestedMessageId && !message) throw new Error('SOURCE_MESSAGE_NOT_FOUND');
  const messageMeta = message ? jsonRecord(message.meta_json) : {};

  const targetId = platform === 'discord'
    ? session?.discord_channel_id ?? null
    : platform === 'telegram'
      ? text(sessionMeta.chatId, 200)
      : platform === 'buzz'
        ? text(sessionMeta.channelId, 200)
        : platform === 'external'
          ? text(sessionMeta.externalInterfaceKey, 120)
          : null;
  const targetName = platform === 'discord'
    ? text(sessionMeta.channelName, 300)
    : platform === 'telegram'
      ? text(sessionMeta.chatTitle, 300)
      : platform === 'buzz'
        ? text(sessionMeta.channelName, 300)
        : platform === 'external'
          ? text(sessionMeta.externalInterfaceKey, 120)
          : null;
  const interactionProfileKey = text(
    sessionMeta.interactionProfileKey ?? accessPolicy.interactionProfileKey,
    120,
  );
  const interactionProfileVersion = integer(sessionMeta.interactionProfileVersion);
  const actorType = platformActorType(platform);
  const trustedSiteUserId = text(input.requestedByUserId ?? session?.created_by_user_id, 300);
  const profile = trustedSiteUserId
    ? db.prepare('SELECT display_name FROM profiles WHERE user_id = ?').get(trustedSiteUserId) as {
        display_name: string | null;
      } | undefined
    : undefined;

  // External subjects may be secrets, emails, or tenant identifiers. The
  // immutable request snapshot records that a subject existed without copying
  // the caller-provided value into request state or browser payloads.
  const actorId = platform === 'external'
    ? null
    : text(
        trustedSiteUserId
          ?? messageMeta.authorId
          ?? messageMeta.authorPubkey
          ?? (actorType === 'task' || actorType === 'hook' || actorType === 'system'
            ? rawSource?.split(':').slice(1).join(':')
            : null),
        300,
      );
  const actorDisplayName = platform === 'external'
    ? null
    : text(profile?.display_name ?? messageMeta.authorName, 300);
  const hasTarget = !['discord', 'telegram', 'buzz', 'external'].includes(platform) || Boolean(targetId);
  const backfillStatus: RequestOriginBackfillStatus = platform === 'unknown'
    ? 'unknown'
    : sourceSessionId && hasTarget && actorType && (actorId || actorType !== 'user')
      ? 'complete'
      : 'partial';

  return {
    sourceSessionId: session?.id ?? null,
    platform,
    targetId,
    targetName,
    threadId: platform === 'discord' ? session?.discord_thread_id ?? null : null,
    interfaceKey: platform === 'external' ? text(sessionMeta.externalInterfaceKey, 120) : null,
    interactionProfileKey,
    interactionProfileVersion,
    actorType,
    actorId,
    actorDisplayName,
    sourceMessageId: message?.source_message_id ?? requestedMessageId,
    rawSource,
    backfillStatus,
    capturedAt: input.capturedAt,
  };
}

export function insertRequestOrigin(
  requestId: string,
  origin: RequestOriginSnapshot,
  db: Database.Database = getDb(),
) {
  db.prepare(`
    INSERT OR IGNORE INTO request_origins (
      request_id, source_session_id, platform, target_id, target_name, thread_id,
      interface_key, interaction_profile_key, interaction_profile_version,
      actor_type, actor_id, actor_display_name, source_message_id, raw_source,
      backfill_status, captured_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    requestId,
    origin.sourceSessionId,
    origin.platform,
    origin.targetId,
    origin.targetName,
    origin.threadId,
    origin.interfaceKey,
    origin.interactionProfileKey,
    origin.interactionProfileVersion,
    origin.actorType,
    origin.actorId,
    origin.actorDisplayName,
    origin.sourceMessageId,
    origin.rawSource,
    origin.backfillStatus,
    origin.capturedAt,
  );
  return getRequestOrigin(requestId, db);
}
