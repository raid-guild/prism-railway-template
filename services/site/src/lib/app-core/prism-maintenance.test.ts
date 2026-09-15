import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import Database from 'better-sqlite3';
import { prismMaintenanceMigration, prismMaintenanceWorkflow } from './migrations/051_prism_maintenance';

test('maintenance keeps full evidence while suppressing clean and already-reported no-ops', () => {
  const instructions = readFileSync(new URL('../../../workflows/prism-maintenance/steps/verify.md', import.meta.url), 'utf8');
  assert.match(instructions, /Quiet no-op notification policy \(takes precedence/);
  assert.match(instructions, /Always save the complete maintenance report/);
  assert.match(instructions, /unchanged-already-reported/);
  assert.match(instructions, /Never suppress a failed or\s+uncertain delivery retry/);
  assert.match(instructions, /provider-accepted message IDs/);
});

test('maintenance workflow is targetless, explicitly owned and has valid transitions', () => {
  const w = prismMaintenanceWorkflow;
  assert.equal(w.target.required, false);
  assert.equal(w.defaultAgent, 'admin-agent');
  const keys = new Set(w.steps.map(step => step.key));
  for (const step of w.steps) {
    assert.notEqual(step.type, 'gate');
    if (step.type !== 'terminal') assert.ok(keys.has(step.next!));
  }
});

test('maintenance seed is idempotent and preserves an existing custom definition', () => {
  const db = new Database(':memory:');
  try {
    db.exec(`CREATE TABLE workflows(id TEXT PRIMARY KEY,key TEXT UNIQUE,name TEXT,description TEXT,version INTEGER,definition_json TEXT,system_default INTEGER,enabled INTEGER,created_at TEXT,updated_at TEXT);
      CREATE TABLE accountability_domain_assignments(target_type TEXT,target_id TEXT,domain_id TEXT,created_at TEXT,updated_at TEXT,UNIQUE(target_type,target_id));`);
    db.exec(prismMaintenanceMigration.sql);
    db.exec(prismMaintenanceMigration.sql);
    assert.equal((db.prepare('SELECT count(*) n FROM workflows').get() as {n:number}).n, 1);
    db.prepare('UPDATE workflows SET definition_json = ?').run('{"custom":true}');
    db.exec(prismMaintenanceMigration.sql);
    assert.equal((db.prepare('SELECT definition_json FROM workflows').get() as {definition_json:string}).definition_json, '{"custom":true}');
  } finally { db.close(); }
});
