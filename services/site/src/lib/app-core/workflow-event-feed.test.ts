import assert from 'node:assert/strict';
import test from 'node:test';
import Database from 'better-sqlite3';
import { workflowEventSequenceMigration } from './migrations/033_workflow_event_sequence';
import { listWorkflowEventFeed } from './workflow-event-feed';
import { workflowAttentionResolved, type WorkflowAttentionRecord, type WorkflowEventRecord } from './repository';

const attention: WorkflowAttentionRecord = {
  status: 'blocked',
  summary: 'Render failed',
  suggestedFix: 'Prepare a new render',
  blockers: [{ key: 'render-failed' }],
  agentRunId: 'run-blocked',
  workflowRunId: 'workflow-run-1',
  workflowStepKey: 'render-status-check',
  createdAt: '2026-07-15T12:00:00.000Z',
};

function workflowEvent(overrides: Partial<WorkflowEventRecord>): WorkflowEventRecord {
  return {
    id: 'event-1',
    workflowRunId: 'workflow-run-1',
    requestId: 'request-1',
    stepKey: null,
    eventType: 'workflow.step_changed',
    actorType: 'admin',
    actorId: null,
    note: null,
    payload: {},
    createdAt: '2026-07-15T12:01:00.000Z',
    ...overrides,
  };
}

test('leaving an attention step retires its blocker before a later return', () => {
  assert.equal(workflowAttentionResolved(attention, [workflowEvent({
    stepKey: 'remotion-prep',
    payload: { previousStepKey: 'render-status-check', nextStepKey: 'remotion-prep' },
  })]), true);
  assert.equal(workflowAttentionResolved(attention, [workflowEvent({
    stepKey: 'render-status-check',
    payload: { previousStepKey: 'video-render', nextStepKey: 'render-status-check' },
  })]), false);
});

function testDb() {
  const db = new Database(':memory:');
  db.exec(`
    CREATE TABLE workflow_events (
      id TEXT PRIMARY KEY,
      workflow_run_id TEXT NOT NULL,
      request_id TEXT NOT NULL,
      step_key TEXT,
      event_type TEXT NOT NULL,
      actor_type TEXT NOT NULL,
      actor_id TEXT,
      note TEXT,
      payload_json TEXT NOT NULL,
      created_at TEXT NOT NULL
    );
  `);
  db.exec(workflowEventSequenceMigration.sql);
  const insert = db.prepare(
    `INSERT INTO workflow_events (
       id, workflow_run_id, request_id, step_key, event_type, actor_type,
       actor_id, note, payload_json, created_at
     ) VALUES (?, 'run-1', 'request-1', NULL, ?, 'system', NULL, NULL, ?, ?)`,
  );
  insert.run('event-a', 'agent.completed', '{"sequence":1}', '2026-07-15T12:00:00.000Z');
  insert.run('event-b', 'agent.blocked', '{"sequence":2}', '2026-07-15T12:00:00.000Z');
  insert.run('event-c', 'external_ref.upserted', '{"sequence":3}', '2026-07-15T12:01:00.000Z');
  return db;
}

test('workflow event feed uses an insertion sequence so same-timestamp events cannot be skipped', () => {
  const db = testDb();
  const first = listWorkflowEventFeed({ limit: 1 }, db);
  db.prepare(
    `INSERT INTO workflow_events (
       id, workflow_run_id, request_id, step_key, event_type, actor_type,
       actor_id, note, payload_json, created_at
     ) VALUES (?, 'run-1', 'request-1', NULL, ?, 'system', NULL, NULL, ?, ?)`,
  ).run('event-0', 'agent.needs_attention', '{"sequence":4}', '2026-07-15T12:00:00.000Z');
  const second = listWorkflowEventFeed({ cursor: first.nextCursor, limit: 1 }, db);
  const remaining = listWorkflowEventFeed({ cursor: second.nextCursor, limit: 10 }, db);

  assert.deepEqual(first.events.map((event) => event.id), ['event-a']);
  assert.equal(first.hasMore, true);
  assert.deepEqual(second.events.map((event) => event.id), ['event-b']);
  assert.deepEqual(second.events[0].payload, { sequence: 2 });
  assert.deepEqual(remaining.events.map((event) => event.id), ['event-c', 'event-0']);
  db.close();
});

test('workflow event feed filters operator-selected event types', () => {
  const db = testDb();
  const page = listWorkflowEventFeed({
    eventTypes: ['agent.blocked', 'external_ref.upserted'],
    limit: 10,
  }, db);

  assert.deepEqual(page.events.map((event) => event.id), ['event-b', 'event-c']);
  assert.equal(page.hasMore, false);
  db.close();
});

test('workflow event feed rejects malformed cursors', () => {
  const db = testDb();
  assert.throws(() => listWorkflowEventFeed({ cursor: 'not-a-cursor' }, db), /WORKFLOW_EVENT_CURSOR_INVALID/);
  db.close();
});

test('workflow event sequence migration backfills existing rows and continues monotonically', () => {
  const db = new Database(':memory:');
  db.exec(`
    CREATE TABLE workflow_events (
      id TEXT PRIMARY KEY,
      workflow_run_id TEXT NOT NULL,
      request_id TEXT NOT NULL,
      step_key TEXT,
      event_type TEXT NOT NULL,
      actor_type TEXT NOT NULL,
      actor_id TEXT,
      note TEXT,
      payload_json TEXT NOT NULL,
      created_at TEXT NOT NULL
    );
    INSERT INTO workflow_events VALUES
      ('event-b', 'run-1', 'request-1', NULL, 'second', 'system', NULL, NULL, '{}', '2026-07-15T12:00:00.000Z'),
      ('event-a', 'run-1', 'request-1', NULL, 'first', 'system', NULL, NULL, '{}', '2026-07-15T12:00:00.000Z');
  `);
  db.exec(workflowEventSequenceMigration.sql);
  db.prepare(
    `INSERT INTO workflow_events (
       id, workflow_run_id, request_id, event_type, actor_type, payload_json, created_at
     ) VALUES ('event-c', 'run-1', 'request-1', 'third', 'system', '{}', '2026-07-15T11:00:00.000Z')`,
  ).run();

  const rows = db.prepare(
    'SELECT id, event_sequence FROM workflow_events ORDER BY event_sequence',
  ).all() as Array<{ id: string; event_sequence: number }>;
  assert.deepEqual(rows, [
    { id: 'event-a', event_sequence: 1 },
    { id: 'event-b', event_sequence: 2 },
    { id: 'event-c', event_sequence: 3 },
  ]);
  db.close();
});
