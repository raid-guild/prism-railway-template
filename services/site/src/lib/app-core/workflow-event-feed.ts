import type Database from 'better-sqlite3';
import { getDb } from './db';
import type { WorkflowEventRecord } from './repository';

type WorkflowEventRow = {
  id: string;
  workflow_run_id: string;
  request_id: string;
  step_key: string | null;
  event_type: string;
  actor_type: string;
  actor_id: string | null;
  note: string | null;
  payload_json: string;
  created_at: string;
  event_sequence: number;
};

type WorkflowEventCursor = { sequence: number };

function parsePayload(value: string) {
  try {
    const parsed = JSON.parse(value) as unknown;
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed)
      ? parsed as Record<string, unknown>
      : {};
  } catch {
    return {};
  }
}

function mapRow(row: WorkflowEventRow): WorkflowEventRecord {
  return {
    id: row.id,
    workflowRunId: row.workflow_run_id,
    requestId: row.request_id,
    stepKey: row.step_key,
    eventType: row.event_type,
    actorType: row.actor_type,
    actorId: row.actor_id,
    note: row.note,
    payload: parsePayload(row.payload_json),
    createdAt: row.created_at,
  };
}

export function encodeWorkflowEventCursor(cursor: WorkflowEventCursor) {
  return Buffer.from(JSON.stringify(cursor), 'utf8').toString('base64url');
}

export function decodeWorkflowEventCursor(value: string | null | undefined): WorkflowEventCursor | null {
  if (!value?.trim()) return null;
  try {
    const parsed = JSON.parse(Buffer.from(value, 'base64url').toString('utf8')) as unknown;
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error();
    const cursor = parsed as Record<string, unknown>;
    if (!Number.isSafeInteger(cursor.sequence) || Number(cursor.sequence) < 0) throw new Error();
    return { sequence: Number(cursor.sequence) };
  } catch {
    throw new Error('WORKFLOW_EVENT_CURSOR_INVALID');
  }
}

export function listWorkflowEventFeed(input: {
  cursor?: string | null;
  eventTypes?: string[];
  limit?: number;
}, db: Database.Database = getDb()): {
  events: WorkflowEventRecord[];
  nextCursor: string | null;
  hasMore: boolean;
} {
  const cursor = decodeWorkflowEventCursor(input.cursor);
  const eventTypes = [...new Set((input.eventTypes ?? []).map((value) => value.trim()).filter(Boolean))].slice(0, 50);
  const limit = input.limit === undefined ? 100 : input.limit;
  if (!Number.isInteger(limit) || limit < 1 || limit > 500) throw new Error('WORKFLOW_EVENT_LIMIT_INVALID');

  const clauses: string[] = [];
  const params: Array<string | number> = [];
  if (cursor) {
    clauses.push('event_sequence > ?');
    params.push(cursor.sequence);
  }
  if (eventTypes.length) {
    clauses.push(`event_type IN (${eventTypes.map(() => '?').join(', ')})`);
    params.push(...eventTypes);
  }
  const where = clauses.length ? `WHERE ${clauses.join(' AND ')}` : '';
  const rows = db.prepare(
    `SELECT id, workflow_run_id, request_id, step_key, event_type, actor_type,
            actor_id, note, payload_json, created_at, event_sequence
     FROM workflow_events
     ${where}
     ORDER BY event_sequence ASC
     LIMIT ?`,
  ).all(...params, limit + 1) as WorkflowEventRow[];
  const hasMore = rows.length > limit;
  const page = hasMore ? rows.slice(0, limit) : rows;
  const events = page.map(mapRow);
  const last = page.at(-1);
  return {
    events,
    nextCursor: last ? encodeWorkflowEventCursor({ sequence: last.event_sequence }) : input.cursor?.trim() || null,
    hasMore,
  };
}
