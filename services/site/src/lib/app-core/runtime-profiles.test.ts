import assert from 'node:assert/strict';
import test from 'node:test';
import Database from 'better-sqlite3';
import { runtimeProfilesMigration } from './migrations/031_runtime_profiles';
import {
  deleteRuntimeProfile,
  listRuntimeProfiles,
  resolveRuntimeProfile,
  upsertRuntimeProfile,
} from './runtime-profiles';

function testDb() {
  const db = new Database(':memory:');
  db.exec(runtimeProfilesMigration.sql);
  return db;
}

test('runtime profiles preserve one durable default and support explicit routing', () => {
  const db = testDb();
  const codex = upsertRuntimeProfile({
    key: 'codex-default',
    name: 'Codex',
    adapter: 'codex-cli',
    baseUrl: 'http://127.0.0.1:3030/',
    enabled: true,
  }, db);
  assert.equal(codex.isDefault, true);
  assert.equal(codex.baseUrl, 'http://127.0.0.1:3030');

  upsertRuntimeProfile({
    key: 'grok-local',
    name: 'Grok Build',
    adapter: 'grok-build',
    baseUrl: 'http://127.0.0.1:3031',
    enabled: true,
    isDefault: false,
    features: ['shell', 'continuations'],
  }, db);
  assert.equal(resolveRuntimeProfile(null, db).key, 'codex-default');
  assert.equal(resolveRuntimeProfile('grok-local', db).adapter, 'grok-build');

  upsertRuntimeProfile({
    key: 'grok-local',
    name: 'Grok Build',
    adapter: 'grok-build',
    baseUrl: 'http://127.0.0.1:3031',
    enabled: true,
    isDefault: true,
    features: ['shell', 'continuations'],
  }, db);
  const profiles = listRuntimeProfiles(db);
  assert.equal(profiles.filter((profile) => profile.isDefault).length, 1);
  assert.equal(resolveRuntimeProfile(null, db).key, 'grok-local');

  upsertRuntimeProfile({
    key: 'grok-local',
    name: 'Grok Build',
    adapter: 'grok-build',
    baseUrl: 'http://127.0.0.1:3031',
    enabled: false,
    isDefault: false,
  }, db);
  assert.equal(resolveRuntimeProfile(null, db).key, 'codex-default');

  assert.equal(deleteRuntimeProfile('grok-local', db), true);
  assert.equal(resolveRuntimeProfile(null, db).key, 'codex-default');
  db.close();
});

test('runtime profiles reject embedded credentials and disabled explicit routes', () => {
  const db = testDb();
  assert.throws(() => upsertRuntimeProfile({
    key: 'unsafe-runtime',
    adapter: 'custom-runtime',
    baseUrl: 'https://user:password@example.com',
  }, db), /RUNTIME_PROFILE_BASE_URL_INVALID/);

  upsertRuntimeProfile({
    key: 'disabled-runtime',
    adapter: 'custom-runtime',
    baseUrl: 'https://runtime.example.com',
    enabled: false,
  }, db);
  assert.throws(() => resolveRuntimeProfile('disabled-runtime', db), /RUNTIME_PROFILE_DISABLED/);
  db.close();
});

test('runtime profiles route unpinned work by required features and fail pinned mismatches', () => {
  const db = testDb();
  upsertRuntimeProfile({
    key: 'grok-default',
    adapter: 'grok-build',
    baseUrl: 'http://127.0.0.1:3031',
    enabled: true,
    isDefault: true,
    features: ['repository', 'shell'],
  }, db);
  upsertRuntimeProfile({
    key: 'browser-runtime',
    adapter: 'codex-cli',
    baseUrl: 'http://127.0.0.1:3030',
    enabled: true,
    isDefault: false,
    features: ['repository', 'shell', 'browser-automation'],
  }, db);

  assert.equal(resolveRuntimeProfile(null, db, ['repository', 'shell']).key, 'grok-default');
  assert.equal(resolveRuntimeProfile(null, db, ['browser-automation']).key, 'browser-runtime');
  assert.throws(
    () => resolveRuntimeProfile('grok-default', db, ['browser-automation']),
    /RUNTIME_PROFILE_FEATURES_MISSING:browser-automation/,
  );
  assert.throws(
    () => resolveRuntimeProfile(null, db, ['mobile-simulator']),
    /RUNTIME_PROFILE_CAPABILITIES_UNAVAILABLE:mobile-simulator/,
  );
  db.close();
});
