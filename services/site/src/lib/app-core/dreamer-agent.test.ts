import assert from 'node:assert/strict';
import test from 'node:test';
import Database from 'better-sqlite3';
import { migrations } from './migrations';
import { dreamerAgentMigration } from './migrations/052_dreamer_agent';

test('Dreamer is a protected builtin with conservative credentials and idempotent seed', () => {
  const db = new Database(':memory:');
  try {
    for (const migration of migrations) db.exec(migration.sql);
    db.exec(dreamerAgentMigration.sql);
    const profile = db.prepare("SELECT * FROM agent_profiles WHERE key='dreamer-agent'").get() as any;
    assert.equal(profile.system_key, 'dreamer-agent');
    assert.equal(profile.model_tier, 'standard');
    assert.equal(JSON.parse(profile.authority_json).credentialPolicy, 'none');
    assert.match(JSON.parse(profile.persona_json).instructions, /Memory work is read-only/);
    const workflow = db.prepare("SELECT definition_json FROM workflows WHERE key='prism-maintenance'").get() as any;
    assert.equal(JSON.parse(workflow.definition_json).defaultAgent, 'dreamer-agent');
    db.prepare("UPDATE agent_profiles SET persona_json='{}' WHERE key='dreamer-agent'").run();
    db.exec(dreamerAgentMigration.sql);
    assert.equal((db.prepare("SELECT persona_json FROM agent_profiles WHERE key='dreamer-agent'").get() as any).persona_json, '{}');
  } finally { db.close(); }
});
