import assert from 'node:assert/strict';
import test from 'node:test';
import Database from 'better-sqlite3';

import { agentProfilesMigration } from './migrations/040_agent_profiles';
import { agentProfileAvatarMigration } from './migrations/041_agent_profile_avatar';
import { agentProfileAccentColorMigration } from './migrations/042_agent_profile_accent_color';
import { agentProfileModelTierMigration } from './migrations/049_agent_profile_model_tier';
import { codeReviewConsoleMigration } from './migrations/050_code_review_console';
import { activeAgentExecutorFallbackMigration } from './migrations/043_active_agent_executor_fallback';
import { codeReviewAgentMigration } from './migrations/044_code_review_agent';
import { codeReviewAgentV2Migration } from './migrations/045_code_review_agent_v2';
import { codegenAgentMigration } from './migrations/046_codegen_agent';
import { verificationAgentMigration } from './migrations/047_verification_agent';
import { taskAgentExecutor, taskUsesAgentExecutor, workflowAgentExecutor } from './agent-executors';
import {
  adminAgentProfileId,
  assignAgentProfileToSession,
  getAgentProfile,
  getAgentProfileSessionDetail,
  getAgentProfileVersion,
  getAgentSessionProfileAssignment,
  listAgentProfiles,
  listAgentProfileSessions,
  listAgentProfileQueueStates,
  resolveAgentProfileBinding,
  resolveAgentProfileInteraction,
  upsertAgentProfile,
  upsertAgentProfileBinding,
} from './agent-profiles';

function testDb() {
  const db = new Database(':memory:');
  db.pragma('foreign_keys = ON');
  db.exec(`
    CREATE TABLE users (id TEXT PRIMARY KEY);
    CREATE TABLE profiles (user_id TEXT PRIMARY KEY, display_name TEXT);
    CREATE TABLE roles (id INTEGER PRIMARY KEY, slug TEXT);
    CREATE TABLE user_roles (user_id TEXT, role_id INTEGER);
    CREATE TABLE runtime_profiles (key TEXT PRIMARY KEY);
    CREATE TABLE change_requests (id TEXT PRIMARY KEY, request_number INTEGER, title TEXT);
    CREATE TABLE agent_sessions (
      id TEXT PRIMARY KEY, source TEXT NOT NULL, status TEXT NOT NULL, title TEXT,
      linked_change_request_id TEXT, created_by_user_id TEXT, last_message_at TEXT,
      created_at TEXT NOT NULL, updated_at TEXT NOT NULL
    );
    CREATE TABLE agent_messages (
      id TEXT PRIMARY KEY, session_id TEXT, role TEXT, source TEXT,
      source_message_id TEXT, content TEXT, meta_json TEXT, created_at TEXT
    );
    CREATE TABLE agent_response_jobs (
      id TEXT PRIMARY KEY, session_id TEXT, status TEXT, input_json TEXT, response_json TEXT,
      trace_json TEXT, created_at TEXT, updated_at TEXT
    );
    CREATE TABLE agent_runs (
      id TEXT PRIMARY KEY, kind TEXT, status TEXT, request_id TEXT, workflow_step_key TEXT,
      session_id TEXT, input_json TEXT NOT NULL DEFAULT '{}', error_message TEXT,
      created_at TEXT, started_at TEXT, finished_at TEXT
    );
    INSERT INTO users VALUES ('admin-user'), ('owner-user');
    INSERT INTO profiles VALUES ('admin-user', 'Ada Admin'), ('owner-user', 'Omar Owner');
    INSERT INTO roles VALUES (1, 'admin');
    INSERT INTO user_roles VALUES ('admin-user', 1);
  `);
  db.exec(agentProfilesMigration.sql);
  db.exec(agentProfileAvatarMigration.sql);
  db.exec(agentProfileAccentColorMigration.sql);
  db.exec(agentProfileModelTierMigration.sql);
  db.exec(codeReviewConsoleMigration.sql);
  return db;
}

test('seeds the protected Admin Agent with workspace stewardship', () => {
  const db = testDb();
  const profiles = listAgentProfiles({}, db);
  assert.equal(profiles[0]?.id, adminAgentProfileId);
  assert.equal(profiles[0]?.systemKey, 'admin-agent');
  assert.deepEqual(profiles[0]?.stewards.map((steward) => steward.displayName), ['Ada Admin']);
  assert.throws(() => upsertAgentProfile({ key: 'admin-agent', name: 'Replacement' }, db), /ADMIN_AGENT_PROFILE_PROTECTED/);
  const editedAdmin = upsertAgentProfile({ key: 'admin-agent', name: 'Admin Agent', avatarUrl: '/avatars/admin.png', allowSystemProfileUpdate: true }, db);
  assert.equal(editedAdmin.avatarUrl, '/avatars/admin.png');
  assert.equal(getAgentProfileVersion(adminAgentProfileId, 1, db)?.avatarUrl, null);
  db.close();
});

test('stores model tier defaults in profile versions', () => {
  const db = testDb();
  const profile = upsertAgentProfile({
    key: 'economy-agent',
    name: 'Economy Agent',
    ownerType: 'workspace',
    modelTier: 'economy',
  }, db);
  assert.equal(profile.modelTier, 'economy');
  assert.equal(getAgentProfileVersion(profile.id, profile.version, db)?.modelTier, 'economy');
  db.close();
});

test('seeds a protected Code Review Agent and assigns it to the review workflow steps', () => {
  const db = testDb();
  db.exec(`
    CREATE TABLE workflows (
      key TEXT PRIMARY KEY, version INTEGER NOT NULL, definition_json TEXT NOT NULL,
      system_default INTEGER NOT NULL DEFAULT 0, updated_at TEXT NOT NULL
    );
    INSERT INTO workflows (key, version, definition_json, system_default, updated_at)
    VALUES ('change-request-default', 5, '{}', 0, '2026-01-01');
  `);
  db.exec(codeReviewAgentMigration.sql);

  const reviewer = getAgentProfile('code-review-agent', db);
  assert.equal(reviewer?.systemKey, 'code-review-agent');
  assert.equal(reviewer?.owner.agentProfileId, adminAgentProfileId);
  assert.deepEqual(reviewer?.skills, ['prism-code-review']);
  assert.deepEqual(reviewer?.authority.gatewayCredentials, ['github']);
  assert.deepEqual(reviewer?.contextPolicy, { continuation: 'step', handoff: 'artifacts' });
  assert.throws(
    () => upsertAgentProfile({ key: 'code-review-agent', name: 'Replacement' }, db),
    /SYSTEM_AGENT_PROFILE_PROTECTED/,
  );

  const workflowRow = db.prepare('SELECT version, definition_json FROM workflows WHERE key = ?')
    .get('change-request-default') as { version: number; definition_json: string };
  const definition = JSON.parse(workflowRow.definition_json) as { steps: Array<Record<string, unknown>> };
  assert.equal(workflowRow.version, 6);
  assert.equal(definition.steps.find((step) => step.key === 'local-code-review')?.executorAgent, 'code-review-agent');
  assert.equal(definition.steps.find((step) => step.key === 'pr-review')?.executionMode, 'reviewer');

  db.prepare(`UPDATE agent_profiles SET name = ?, avatar_url = ? WHERE id = ?`)
    .run('Instance Review Agent', '/avatars/reviewer.png', 'agent-profile-code-review');
  db.exec(codeReviewAgentV2Migration.sql);

  const upgradedReviewer = getAgentProfile('code-review-agent', db);
  assert.equal(upgradedReviewer?.version, 2);
  assert.equal(upgradedReviewer?.name, 'Instance Review Agent');
  assert.equal(upgradedReviewer?.avatarUrl, '/avatars/reviewer.png');
  assert.deepEqual(upgradedReviewer?.authority.allowedMutations, [
    'github.pr_comment',
    'github.pr_review_comment',
    'prism.request_artifact',
  ]);
  assert.equal((upgradedReviewer?.authority.forbiddenMutations as string[]).includes('github.review_decision'), true);
  assert.equal(getAgentProfileVersion('agent-profile-code-review', 1, db)?.authority.allowedMutations instanceof Array, true);
  assert.equal(
    (getAgentProfileVersion('agent-profile-code-review', 1, db)?.authority.allowedMutations as string[]).includes('github.pr_review_comment'),
    false,
  );
  assert.equal(
    (getAgentProfileVersion('agent-profile-code-review', 2, db)?.authority.allowedMutations as string[]).includes('github.pr_review_comment'),
    true,
  );

  db.exec(codeReviewConsoleMigration.sql);
  const consoleReviewer = getAgentProfile('code-review-agent', db);
  assert.equal(consoleReviewer?.authority.consoleAccessMode, 'full');
  assert.equal(consoleReviewer?.memoryScope.scope, 'review-target-only');
  assert.match(String(consoleReviewer?.persona.instructions), /explicit GitHub pull-request URL/);

  const upgradedWorkflowRow = db.prepare('SELECT version, definition_json FROM workflows WHERE key = ?')
    .get('change-request-default') as { version: number; definition_json: string };
  const upgradedDefinition = JSON.parse(upgradedWorkflowRow.definition_json) as {
    version: number;
    description: string;
    steps: Array<Record<string, unknown>>;
  };
  assert.equal(upgradedWorkflowRow.version, 7);
  assert.equal(upgradedDefinition.version, 7);
  assert.match(upgradedDefinition.description, /bounded autonomous/);
  assert.equal(upgradedDefinition.steps.some((step) => step.type === 'checkpoint'), false);
  const reviewLoop = upgradedDefinition.steps.find((step) => step.key === 'review-cycle');
  assert.equal(reviewLoop?.type, 'loop');
  assert.deepEqual(reviewLoop?.loop, {
    artifactName: 'code-review.json',
    condition: 'review_approved',
    target: 'implement',
    maxIterations: 3,
    onMaxIterations: 'review-loop-attention',
    onError: 'review-loop-attention',
  });
  assert.equal(reviewLoop?.next, 'review');
  assert.equal(upgradedDefinition.steps.find((step) => step.key === 'review-loop-attention')?.type, 'gate');

  db.exec(codegenAgentMigration.sql);
  const codegen = getAgentProfile('codegen-agent', db);
  assert.equal(codegen?.systemKey, 'codegen-agent');
  assert.equal(codegen?.owner.agentProfileId, adminAgentProfileId);
  assert.deepEqual(codegen?.skills, ['prism-codegen']);
  assert.deepEqual(codegen?.contextPolicy, { continuation: 'step', handoff: 'artifacts' });
  assert.equal(codegen?.authority.credentialPolicy, 'job-scoped');
  assert.equal((codegen?.authority.forbiddenMutations as string[]).includes('github.merge'), true);
  assert.equal(getAgentProfileVersion('agent-profile-codegen', 1, db)?.name, 'Codegen Agent');
  assert.throws(
    () => upsertAgentProfile({ key: 'codegen-agent', name: 'Replacement' }, db),
    /SYSTEM_AGENT_PROFILE_PROTECTED/,
  );

  const codegenWorkflowRow = db.prepare('SELECT version, definition_json FROM workflows WHERE key = ?')
    .get('change-request-default') as { version: number; definition_json: string };
  const codegenDefinition = JSON.parse(codegenWorkflowRow.definition_json) as {
    version: number;
    steps: Array<Record<string, unknown>>;
  };
  const implementation = codegenDefinition.steps.find((step) => step.key === 'implement');
  assert.equal(codegenWorkflowRow.version, 8);
  assert.equal(codegenDefinition.version, 8);
  assert.equal(implementation?.executorAgent, 'codegen-agent');
  assert.equal(implementation?.executionMode, 'orchestrator');
  assert.deepEqual(implementation?.agentConfig, {
    skills: ['prism-codegen', 'change-request-ops', 'target-deploy-ops'],
    delegation: { allowed: true, maxAgents: 3 },
  });
  assert.equal(codegenDefinition.steps.find((step) => step.key === 'local-code-review')?.executorAgent, 'code-review-agent');

  db.prepare(`UPDATE agent_profiles SET name = ?, avatar_url = ? WHERE id = ?`)
    .run('Instance Codegen', '/avatars/codegen.png', 'agent-profile-codegen');
  db.exec(verificationAgentMigration.sql);

  const upgradedCodegen = getAgentProfile('codegen-agent', db);
  assert.equal(upgradedCodegen?.version, 2);
  assert.equal(upgradedCodegen?.name, 'Instance Codegen');
  assert.equal(upgradedCodegen?.avatarUrl, '/avatars/codegen.png');
  assert.match(upgradedCodegen?.description ?? '', /runtime-native/);
  assert.doesNotMatch(String(upgradedCodegen?.persona.instructions), /Codex/i);
  assert.match(String(upgradedCodegen?.persona.instructions), /runtime choose the checkout mechanism/);

  const verification = getAgentProfile('verification-agent', db);
  assert.equal(verification?.systemKey, 'verification-agent');
  assert.equal(verification?.owner.agentProfileId, adminAgentProfileId);
  assert.equal(verification?.runtimeProfileKey, null);
  assert.deepEqual(verification?.skills, ['prism-code-verification']);
  assert.equal(verification?.authority.credentialPolicy, 'none');
  assert.deepEqual(verification?.authority.allowedMutations, ['prism.request_artifact']);
  assert.throws(
    () => upsertAgentProfile({ key: 'verification-agent', name: 'Replacement' }, db),
    /SYSTEM_AGENT_PROFILE_PROTECTED/,
  );

  const verificationWorkflowRow = db.prepare('SELECT version, definition_json FROM workflows WHERE key = ?')
    .get('change-request-default') as { version: number; definition_json: string };
  const verificationDefinition = JSON.parse(verificationWorkflowRow.definition_json) as {
    version: number;
    steps: Array<Record<string, unknown>>;
  };
  assert.equal(verificationWorkflowRow.version, 9);
  assert.equal(verificationDefinition.version, 9);
  assert.deepEqual(verificationDefinition.steps.map((step) => step.key), [
    'triage',
    'approve-for-work',
    'implement',
    'verify',
    'local-code-review',
    'review-cycle',
    'review',
    'closed',
    'review-loop-attention',
  ]);
  const upgradedImplementation = verificationDefinition.steps[2];
  assert.equal(upgradedImplementation?.next, 'verify');
  assert.deepEqual((upgradedImplementation?.agentConfig as Record<string, unknown>)?.requiredRuntimeFeatures, ['repository', 'shell']);
  const verify = verificationDefinition.steps[3];
  assert.equal(verify?.executorAgent, 'verification-agent');
  assert.equal(verify?.next, 'local-code-review');
  assert.deepEqual((verify?.agentConfig as Record<string, unknown>)?.requiredRuntimeFeatures, [
    'repository',
    'shell',
    'browser-automation',
  ]);
  assert.equal(verificationDefinition.steps[5]?.key, 'review-cycle');
  db.close();
});

test('creates owned agents, prevents cycles, and assigns a surface to one primary agent', () => {
  const db = testDb();
  const owned = upsertAgentProfile({
    key: 'veydrift-agent', name: 'Veydrift Agent', status: 'active', ownerType: 'user',
    ownerUserId: 'owner-user', stewardUserIds: ['admin-user'], skills: ['veydrift', 'veydrift'], avatarUrl: 'https://example.com/agent.png', accentColor: '#FF4FD8',
  }, db);
  assert.equal(owned.owner.userId, 'owner-user');
  assert.deepEqual(owned.stewards.map((steward) => steward.userId).sort(), ['admin-user', 'owner-user']);
  assert.deepEqual(owned.skills, ['veydrift']);
  assert.equal(owned.avatarUrl, 'https://example.com/agent.png');
  assert.equal(owned.accentColor, '#FF4FD8');
  assert.throws(() => upsertAgentProfile({ key: owned.key, name: owned.name, accentColor: '#000000' }, db), /AGENT_PROFILE_ACCENT_COLOR_INVALID/);
  assert.throws(() => upsertAgentProfile({ key: owned.key, name: owned.name, avatarUrl: 'javascript:alert(1)' }, db), /AGENT_PROFILE_AVATAR_URL_INVALID/);
  const child = upsertAgentProfile({
    key: 'channel-agent', name: 'Channel Agent', status: 'active', ownerType: 'agent',
    ownerAgentProfileId: owned.id, stewardUserIds: ['owner-user'],
  }, db);
  assert.throws(() => upsertAgentProfile({
    key: owned.key, name: owned.name, ownerType: 'agent', ownerAgentProfileId: child.id,
  }, db), /AGENT_PROFILE_OWNERSHIP_CYCLE/);
  upsertAgentProfileBinding({ profileId: owned.id, surfaceType: 'buzz', surfaceKey: 'veydrift', label: 'Veydrift' }, db);
  assert.throws(() => upsertAgentProfileBinding({
    profileId: child.id, surfaceType: 'buzz', surfaceKey: 'veydrift', label: 'Veydrift handoff',
  }, db), /AGENT_PROFILE_BINDING_DESTINATION_IN_USE:veydrift-agent/);
  upsertAgentProfileBinding({
    profileId: owned.id, surfaceType: 'buzz', surfaceKey: 'veydrift', label: 'Veydrift', enabled: false,
  }, db);
  upsertAgentProfileBinding({
    profileId: child.id,
    surfaceType: 'buzz',
    surfaceKey: 'veydrift',
    label: 'Veydrift handoff',
    configuration: {
      accessMode: 'full',
      rateLimit: { windowSeconds: 30, maxRequests: 8 },
      allowedWorkflows: ['publish'],
      overrides: { users: { 'readonly-user': { mode: 'readonly' } } },
    },
  }, db);
  assert.equal(resolveAgentProfileBinding('buzz', 'veydrift', db)?.id, child.id);
  assert.equal(getAgentProfile(owned.key, db)?.bindings.length, 0);
  const full = resolveAgentProfileInteraction({ surfaceType: 'buzz', surfaceKey: 'veydrift', userId: 'operator' }, db);
  assert.equal(full?.policy.accessMode, 'full');
  assert.equal(full?.policy.rateLimit.maxRequests, 8);
  assert.deepEqual(full?.policy.allowedWorkflows, ['publish']);
  const readonly = resolveAgentProfileInteraction({ surfaceType: 'buzz', surfaceKey: 'veydrift', userId: 'readonly-user' }, db);
  assert.equal(readonly?.policy.accessMode, 'readonly');
  assert.equal(readonly?.policy.capabilities.includes('workflows.author'), false);
  upsertAgentProfileBinding({
    profileId: child.id,
    surfaceType: 'discord',
    surfaceKey: 'public-channel',
    configuration: { accessMode: 'readonly', overrides: { users: { admin: { mode: 'full' } } } },
  }, db);
  assert.equal(
    resolveAgentProfileInteraction({ surfaceType: 'discord', surfaceKey: 'public-channel', userId: 'admin' }, db)?.policy.accessMode,
    'readonly',
  );
  db.close();
});

test('pins session and new job/run records to an immutable agent profile version', () => {
  const db = testDb();
  const profile = upsertAgentProfile({
    key: 'recording-agent', name: 'Recording Agent', status: 'active', ownerType: 'user', ownerUserId: 'owner-user',
  }, db);
  db.prepare(`INSERT INTO agent_sessions (id, source, status, created_at, updated_at) VALUES ('session-1', 'admin-console', 'active', '2026-01-01', '2026-01-01')`).run();
  assignAgentProfileToSession({ sessionId: 'session-1', profileId: profile.id, conversationScope: 'individual' }, db);
  assert.deepEqual(getAgentSessionProfileAssignment('session-1', db), {
    profileId: profile.id, profileVersion: 1, conversationScope: 'individual',
  });
  db.prepare(`INSERT INTO agent_response_jobs (id, session_id, status, input_json, response_json, trace_json, created_at, updated_at) VALUES ('job-1', 'session-1', 'queued', '{"execution_mode":"orchestrator"}', '{}', '[]', '2026-01-01', '2026-01-01')`).run();
  db.prepare(`INSERT INTO agent_runs (id, kind, status, session_id, input_json, created_at) VALUES ('run-1', 'console', 'queued', 'session-1', '{"execution_mode":"orchestrator"}', '2026-01-01')`).run();
  assert.deepEqual(db.prepare('SELECT agent_profile_id, agent_profile_version, execution_mode FROM agent_response_jobs WHERE id = ?').get('job-1'), {
    agent_profile_id: profile.id, agent_profile_version: 1, execution_mode: 'orchestrator',
  });
  assert.deepEqual(db.prepare('SELECT agent_profile_id, agent_profile_version, execution_mode FROM agent_runs WHERE id = ?').get('run-1'), {
    agent_profile_id: profile.id, agent_profile_version: 1, execution_mode: 'orchestrator',
  });
  db.prepare(`INSERT INTO agent_runs (id, kind, status, session_id, input_json, created_at) VALUES ('run-2', 'console', 'running', 'session-1', '{}', '2026-01-02')`).run();
  db.prepare(`INSERT INTO agent_runs (id, kind, status, session_id, input_json, created_at) VALUES ('run-3', 'console', 'completed', 'session-1', '{}', '2026-01-03')`).run();
  assert.deepEqual(listAgentProfileQueueStates(db), [{ profileId: profile.id, queued: 1, claimed: 0, running: 1 }]);
  db.close();
});

test('uses durable source-message attribution for external session participant summaries', () => {
  const db = testDb();
  const profile = upsertAgentProfile({
    key: 'sync-steward', name: 'Sync Steward', status: 'active', ownerType: 'agent', ownerAgentProfileId: adminAgentProfileId,
  }, db);
  db.prepare(`
    INSERT INTO agent_sessions (id, source, status, title, last_message_at, created_at, updated_at)
    VALUES ('telegram-session', 'telegram', 'active', 'Telegram chat: Sync Steward', '2026-08-21T21:12:54Z', '2026-08-21T21:12:42Z', '2026-08-21T21:12:54Z')
  `).run();
  assignAgentProfileToSession({ sessionId: 'telegram-session', profileId: profile.id, conversationScope: 'channel' }, db);
  db.prepare(`
    INSERT INTO agent_messages (id, session_id, role, source, source_message_id, content, meta_json, created_at)
    VALUES ('telegram-user-message', 'telegram-session', 'user', 'telegram', '1', 'who are you', ?, '2026-08-21T21:12:42Z')
  `).run(JSON.stringify({ authorId: '1234', authorName: 'Dekan Brown' }));
  db.prepare(`
    INSERT INTO agent_messages (id, session_id, role, source, source_message_id, content, meta_json, created_at)
    VALUES ('telegram-assistant-message', 'telegram-session', 'assistant', 'telegram', '2', 'I am Sync Steward.', '{}', '2026-08-21T21:12:54Z')
  `).run();

  assert.equal(listAgentProfileSessions(profile.id, 10, db)[0]?.createdByDisplayName, 'Dekan Brown');
  assert.equal(getAgentProfileSessionDetail(profile.id, 'telegram-session', db)?.createdByDisplayName, 'Dekan Brown');
  db.close();
});

test('resolves workflow and task executors with an Admin Agent legacy fallback', () => {
  const db = testDb();
  const veydrift = upsertAgentProfile({
    key: 'veydrift-agent', name: 'Veydrift Agent', status: 'active', ownerType: 'user', ownerUserId: 'owner-user',
  }, db);
  const inherited = workflowAgentExecutor({ defaultAgent: 'veydrift-agent' }, { key: 'operate' }, db);
  assert.deepEqual(inherited, {
    profileId: veydrift.id, profileKey: veydrift.key, profileVersion: 1, executionMode: 'worker',
    resolution: 'workflow-default',
  });
  const verifier = workflowAgentExecutor(
    { defaultAgent: 'veydrift-agent' },
    { key: 'verify', executorAgent: 'admin-agent', executionMode: 'verifier' },
    db,
  );
  assert.equal(verifier.profileId, adminAgentProfileId);
  assert.equal(verifier.executionMode, 'verifier');
  assert.equal(verifier.resolution, 'step-explicit');
  assert.equal(workflowAgentExecutor({}, {}, db).profileId, adminAgentProfileId);
  assert.equal(workflowAgentExecutor({}, {}, db).resolution, 'admin-fallback');
  assert.equal(taskAgentExecutor({}, db).profileId, adminAgentProfileId);
  assert.equal(taskAgentExecutor({}, db).resolution, 'admin-fallback');
  assert.equal(taskAgentExecutor({ executorAgent: 'veydrift-agent', executionMode: 'repair' }, db).executionMode, 'repair');
  assert.equal(taskAgentExecutor({ executorAgent: 'veydrift-agent' }, db).resolution, 'task-explicit');
  assert.equal(taskUsesAgentExecutor('codex-prompt', {}), true);
  assert.equal(taskUsesAgentExecutor('workflow-runner', {}), true);
  assert.equal(taskUsesAgentExecutor('script-runner', { handoff: { enabled: true } }), true);
  assert.equal(taskUsesAgentExecutor('script-runner', { handoff: { enabled: false } }), false);
  assert.equal(taskUsesAgentExecutor('builtin', {}), false);
  assert.equal(taskUsesAgentExecutor('http-post', {}), false);
  assert.throws(
    () => workflowAgentExecutor({ defaultAgent: 'missing-agent' }, {}, db),
    /AGENT_EXECUTOR_NOT_FOUND:missing-agent/,
  );
  db.close();
});

test('migration attributes only currently active unassigned runs to the Admin Agent', () => {
  const db = testDb();
  db.prepare(`INSERT INTO agent_runs (id, kind, status, input_json, created_at) VALUES (?, 'workflow_step', ?, '{}', '2026-01-01')`).run('active-unassigned', 'running');
  db.prepare(`INSERT INTO agent_runs (id, kind, status, input_json, created_at) VALUES (?, 'workflow_step', ?, '{}', '2025-01-01')`).run('historical-unassigned', 'completed');
  db.exec(activeAgentExecutorFallbackMigration.sql);
  assert.deepEqual(
    db.prepare('SELECT agent_profile_id, agent_profile_version, execution_mode FROM agent_runs WHERE id = ?').get('active-unassigned'),
    { agent_profile_id: adminAgentProfileId, agent_profile_version: 1, execution_mode: 'worker' },
  );
  assert.deepEqual(
    db.prepare('SELECT agent_profile_id, agent_profile_version, execution_mode FROM agent_runs WHERE id = ?').get('historical-unassigned'),
    { agent_profile_id: null, agent_profile_version: null, execution_mode: null },
  );
  db.close();
});
