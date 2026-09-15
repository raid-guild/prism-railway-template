import assert from 'node:assert/strict';
import test from 'node:test';
import Database from 'better-sqlite3';

import { requestOriginsMigration } from './migrations/039_request_origins';
import { getRequestOrigin, insertRequestOrigin, resolveRequestOriginSnapshot } from './request-origin';

function testDb() {
  const db = new Database(':memory:');
  db.pragma('foreign_keys = ON');
  db.exec(`
    CREATE TABLE profiles (user_id TEXT PRIMARY KEY, display_name TEXT);
    CREATE TABLE change_requests (id TEXT PRIMARY KEY, requested_by_user_id TEXT, source TEXT, created_at TEXT NOT NULL);
    CREATE TABLE agent_sessions (
      id TEXT PRIMARY KEY, source TEXT NOT NULL, title TEXT, discord_channel_id TEXT, discord_thread_id TEXT,
      linked_change_request_id TEXT, meta_json TEXT NOT NULL DEFAULT '{}', created_by_user_id TEXT, created_at TEXT NOT NULL
    );
    CREATE TABLE agent_messages (
      id TEXT PRIMARY KEY, session_id TEXT NOT NULL, role TEXT NOT NULL, source_message_id TEXT,
      meta_json TEXT NOT NULL DEFAULT '{}', created_at TEXT NOT NULL
    );
  `);
  db.exec(requestOriginsMigration.sql);
  return db;
}

test('trusted Discord session resolves an immutable request origin', () => {
  const db = testDb();
  db.prepare('INSERT INTO change_requests VALUES (?, ?, ?, ?)').run('request-1', null, 'discord-source-adapter', '2026-01-01T00:00:00.000Z');
  db.prepare('INSERT INTO agent_sessions VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)').run(
    'session-1', 'discord', 'Conversation', 'channel-1', 'thread-1', null,
    JSON.stringify({ channelName: 'product', interactionProfileKey: 'dev-agent', interactionProfileVersion: 3 }),
    null,
    '2026-01-01T00:00:01.000Z',
  );
  db.prepare('INSERT INTO agent_messages VALUES (?, ?, ?, ?, ?, ?)').run(
    'message-1', 'session-1', 'user', 'discord-message-1',
    JSON.stringify({ authorId: 'discord-user-1', authorName: 'Ada' }), '2026-01-01T00:00:02.000Z',
  );
  const origin = resolveRequestOriginSnapshot({
    sourceSessionId: 'session-1', sourceMessageId: 'discord-message-1',
    rawSource: 'caller-label-is-not-identity', capturedAt: '2026-01-01T00:00:03.000Z',
  }, db);
  assert.equal(origin.platform, 'discord');
  assert.equal(origin.targetId, 'channel-1');
  assert.equal(origin.threadId, 'thread-1');
  assert.equal(origin.interactionProfileKey, 'dev-agent');
  assert.equal(origin.actorId, 'discord-user-1');
  assert.equal(origin.actorDisplayName, 'Ada');
  assert.equal(origin.backfillStatus, 'complete');
  insertRequestOrigin('request-1', origin, db);
  insertRequestOrigin('request-1', { ...origin, targetName: 'renamed-channel' }, db);
  assert.equal(getRequestOrigin('request-1', db)?.targetName, 'product');
  db.prepare('DELETE FROM agent_messages WHERE session_id = ?').run('session-1');
  db.prepare('DELETE FROM agent_sessions WHERE id = ?').run('session-1');
  assert.equal(getRequestOrigin('request-1', db)?.interactionProfileKey, 'dev-agent');
  db.close();
});

test('external subject is never copied into request provenance', () => {
  const db = testDb();
  db.prepare('INSERT INTO change_requests VALUES (?, ?, ?, ?)').run('request-2', null, 'external-interface', '2026-01-01T00:00:00.000Z');
  db.prepare('INSERT INTO agent_sessions VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)').run(
    'session-2', 'external', 'Partner API', null, null, null,
    JSON.stringify({ externalInterfaceKey: 'partner-api', externalSubject: 'secret-customer@example.org', interactionProfileKey: 'partner-readonly', interactionProfileVersion: 7 }),
    null,
    '2026-01-01T00:00:01.000Z',
  );
  db.prepare('INSERT INTO agent_messages VALUES (?, ?, ?, ?, ?, ?)').run(
    'message-2', 'session-2', 'user', 'event-9', JSON.stringify({ externalSubject: 'secret-customer@example.org', authorName: 'Untrusted' }),
    '2026-01-01T00:00:02.000Z',
  );
  const origin = resolveRequestOriginSnapshot({ sourceSessionId: 'session-2', rawSource: 'external', capturedAt: '2026-01-01T00:00:03.000Z' }, db);
  assert.equal(origin.actorType, 'external-subject');
  assert.equal(origin.actorId, null);
  assert.equal(origin.actorDisplayName, null);
  assert.equal(JSON.stringify(origin).includes('secret-customer'), false);
  db.close();
});

test('authenticated Console ownership and scheduled-task identity are resolved prospectively', () => {
  const db = testDb();
  db.prepare('INSERT INTO profiles VALUES (?, ?)').run('site-user', 'Site Operator');
  db.prepare('INSERT INTO agent_sessions VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)').run(
    'console-session', 'admin-console', 'Console', null, null, null, '{}', 'site-user', '2026-01-01T00:00:01.000Z',
  );
  const siteOrigin = resolveRequestOriginSnapshot({ sourceSessionId: 'console-session', rawSource: 'admin-console', capturedAt: '2026-01-01T00:00:02.000Z' }, db);
  assert.equal(siteOrigin.actorId, 'site-user');
  assert.equal(siteOrigin.actorDisplayName, 'Site Operator');
  const taskOrigin = resolveRequestOriginSnapshot({ rawSource: 'task:veydrift-autopilot', capturedAt: '2026-01-01T00:00:03.000Z' }, db);
  assert.equal(taskOrigin.platform, 'task');
  assert.equal(taskOrigin.actorType, 'task');
  assert.equal(taskOrigin.actorId, 'veydrift-autopilot');
  db.close();
});

test('migration backfills recoverable fields as partial and preserves raw source', () => {
  const db = new Database(':memory:');
  db.exec(`
    CREATE TABLE profiles (user_id TEXT PRIMARY KEY, display_name TEXT);
    CREATE TABLE change_requests (id TEXT PRIMARY KEY, requested_by_user_id TEXT, source TEXT, created_at TEXT NOT NULL);
    CREATE TABLE agent_sessions (id TEXT PRIMARY KEY, source TEXT, title TEXT, discord_channel_id TEXT, discord_thread_id TEXT, linked_change_request_id TEXT, meta_json TEXT NOT NULL, created_at TEXT NOT NULL);
    CREATE TABLE agent_messages (id TEXT PRIMARY KEY, session_id TEXT, role TEXT, source_message_id TEXT, meta_json TEXT NOT NULL, created_at TEXT NOT NULL);
    INSERT INTO change_requests VALUES ('legacy-1', NULL, 'telegram-bot-v1', '2025-01-01T00:00:00.000Z');
    INSERT INTO agent_sessions VALUES ('legacy-session', 'telegram', 'Old chat', NULL, NULL, 'legacy-1', '{"chatId":"-100","chatTitle":"Ops","interactionProfileKey":"ops"}', '2025-01-01T00:00:01.000Z');
    INSERT INTO agent_messages VALUES ('legacy-message', 'legacy-session', 'user', '42', '{"authorId":"telegram-user","authorName":"Lin"}', '2025-01-01T00:00:02.000Z');
  `);
  db.exec(requestOriginsMigration.sql);
  const origin = getRequestOrigin('legacy-1', db);
  assert.equal(origin?.platform, 'telegram');
  assert.equal(origin?.targetId, '-100');
  assert.equal(origin?.interactionProfileKey, 'ops');
  assert.equal(origin?.actorId, 'telegram-user');
  assert.equal(origin?.rawSource, 'telegram-bot-v1');
  assert.equal(origin?.backfillStatus, 'partial');
  db.close();
});
