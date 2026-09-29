import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { closeDb, getDb, runMigrations } from './db';
import { createChangeRequest, createRequestArtifact, ensureWorkflowRunForRequest, getChangeRequest, getWorkflowByKey, getWorkflowRunForRequest,
  upsertTaskScript, upsertWorkflow } from './repository';
import { activeWorkflowScriptRun, beginWorkflowScriptCompletion, cancelWorkflowScriptRuns,
  checksumScriptSource, claimWorkflowScriptAttempt, createScriptRevision, enqueueWorkflowScriptAttempt,
  expireWorkflowScriptLeases, getWorkflowScriptRun, renewWorkflowScriptLease,
  acknowledgeWorkflowScriptCancellation, requestWorkflowScriptCancellation } from './workflow-script-store';
import { finalizeWorkflowScriptAttempt } from '../workflow-script-completion';
import { workflowScriptSnapshot } from '../workflow-health-snapshot';

const root = mkdtempSync(path.join(os.tmpdir(), 'prism-script-store-test-'));
process.env.PRISM_AGENT_DATA_ROOT = root;
test.after(() => { closeDb(); rmSync(root, { recursive: true, force: true }); });

function fixture(label: string) {
  const source = `process.stdout.write(JSON.stringify({outcome:'no_op',result:{label:'${label}'}}));\n`;
  const key = `test-script-${label}`;
  upsertTaskScript({ key, name: key, runtime: 'node-esm', enabled: true,
    storagePath: `${key}/current.mjs`, checksum: checksumScriptSource(source), timeoutMs: 30_000 });
  const revision = createScriptRevision({ scriptKey: key, source, runtime: 'node-esm',
    inputBinding: 'request-snapshot-v1', timeoutMs: 30_000, outputMaxBytes: 262_144, createdBy: 'test' });
  const workflowKey = `test-script-workflow-${label}`;
  const config = { scriptKey: key, revisionId: revision.id, checksum: revision.checksum,
    contractVersion: 1, inputBinding: 'request-snapshot-v1', effectClass: 'pure', timeoutMs: 30_000,
    outputMaxBytes: 262_144, fallbackStepKey: 'fallback', noOpNextStepKey: 'closed' };
  upsertWorkflow({ key: workflowKey, name: workflowKey, definition: { key: workflowKey, entrypoint: 'inspect',
    defaultAgent: 'dreamer-agent', steps: [
      { key: 'inspect', type: 'script', next: 'closed', scriptConfig: config },
      { key: 'fallback', type: 'agent', next: 'closed' }, { key: 'closed', type: 'terminal' },
    ] } });
  const request = createChangeRequest({ title: label, description: label, workflowKey, requestType: 'ops' });
  assert.ok(request);
  const workflowRun = ensureWorkflowRunForRequest({ requestId: request.id, workflowKey });
  const enqueue = () => enqueueWorkflowScriptAttempt({ requestId: request.id, workflowRunId: workflowRun.id,
    stepKey: 'inspect', iterationKey: 'initial', revisionId: revision.id, checksum: revision.checksum,
    config, snapshot: { version: 1, requestNumber: request.requestNumber }, profileId: 'agent-profile-dreamer',
    policy: { workflowVersion: getWorkflowByKey(workflowKey)?.version, nextStepKey: 'closed' } });
  return { request, workflowRun, revision, enqueue };
}

test('pinned attempt claims once, fences stale completion, persists artifacts, and closes request', async () => {
  runMigrations();
  const f = fixture('complete');
  const queued = f.enqueue();
  assert.equal(f.enqueue().id, queued.id);
  const claimed = claimWorkflowScriptAttempt(60);
  assert.equal(claimed?.id, queued.id);
  assert.equal(claimWorkflowScriptAttempt(60), null);
  assert.equal(renewWorkflowScriptLease(queued.id, 'wrong-token'), false);
  assert.equal(beginWorkflowScriptCompletion({ id: queued.id, token: 'wrong-token', outcome: 'no_op', result: {}, exitCode: 0 }), null);
  const ready = beginWorkflowScriptCompletion({ id: queued.id, token: claimed!.leaseToken!, outcome: 'no_op',
    result: { checks: [] }, exitCode: 0 });
  assert.equal(ready?.status, 'completing');
  assert.equal((await finalizeWorkflowScriptAttempt(queued.id)).ok, true);
  assert.equal(getWorkflowScriptRun(queued.id)?.status, 'no_op');
  assert.equal(getWorkflowScriptRun(queued.id)?.advancementAt !== null, true);
  assert.equal(getWorkflowRunForRequest(f.request.id)?.status, 'completed');
  assert.equal(getChangeRequest(f.request.id)?.closedAt !== null, true);
  assert.equal((await finalizeWorkflowScriptAttempt(queued.id)).ok, true);
  const artifacts = getDb().prepare('SELECT name FROM request_artifacts WHERE request_id=?').all(f.request.id) as Array<{ name: string }>;
  assert.deepEqual(artifacts.map((row) => row.name).sort(), ['script-execution-receipt.json','script-input.json','script-result.json']);
});

test('same reviewed source can have distinct immutable input-contract revisions', () => {
  const source = "process.stdout.write('{}');\n";
  const key = 'test-multi-binding';
  const a = createScriptRevision({ scriptKey: key, source, runtime: 'node-esm', inputBinding: 'request-snapshot-v1',
    timeoutMs: 30_000, outputMaxBytes: 262_144, createdBy: 'test' });
  const b = createScriptRevision({ scriptKey: key, source, runtime: 'node-esm', inputBinding: 'workflow-health-snapshot-v1',
    timeoutMs: 30_000, outputMaxBytes: 262_144, createdBy: 'test' });
  assert.notEqual(a.id, b.id);
  assert.equal(a.checksum, b.checksum);
  assert.equal(createScriptRevision({ scriptKey: key, source, runtime: 'node-esm', inputBinding: 'request-snapshot-v1',
    timeoutMs: 30_000, outputMaxBytes: 262_144, createdBy: 'test' }).id, a.id);
});

test('health snapshot finds old required artifact in the same run without copying large metadata', () => {
  const f = fixture('artifact-history');
  const other = fixture('artifact-other-run');
  const artifact = createRequestArtifact({ requestId: f.request.id, workflowRunId: f.workflowRun.id,
    kind: 'json', name: 'report.json', mimeType: 'application/json', storagePath: '/tmp/report.json',
    sizeBytes: 1, metadata: { arbitrarySecret: 'never-copy-this', padding: 'x'.repeat(100_000) } });
  getDb().prepare('UPDATE request_artifacts SET created_at=? WHERE id=?').run('2020-01-01T00:00:00.000Z', artifact.id);
  // A same-named artifact for another workflow run is not used as proof.
  createRequestArtifact({ requestId: other.request.id, workflowRunId: other.workflowRun.id,
    kind: 'json', name: 'report.json', mimeType: 'application/json', storagePath: '/tmp/other-report.json', sizeBytes: 1 });
  const inspection = createChangeRequest({ title: 'Inspect', description: 'Inspect', workflowKey: f.request.workflowKey,
    requestType: 'ops', constraints: { workflowHealth: { requestNumbers: [f.request.requestNumber] } } });
  assert.ok(inspection);
  const snapshot = workflowScriptSnapshot({ request: inspection, binding: 'workflow-health-snapshot-v1',
    config: { eligibleWorkflowKeys: [f.request.workflowKey], requiredArtifacts: { [f.request.workflowKey]: ['report.json'] },
      reportScopeKey: 'test-scope', windowHours: 24 } });
  const serialized = JSON.stringify(snapshot);
  assert.ok(serialized.includes(artifact.id));
  assert.ok(!serialized.includes('never-copy-this'));
  assert.ok(Buffer.byteLength(serialized) < 120_000);
});

test('oversize target becomes partial unknown coverage rather than a false clean scan', () => {
  const f = fixture('snapshot-bound');
  const insert = getDb().prepare(`INSERT INTO agent_runs
    (id,kind,status,source,input_json,result_json,trace_json,created_at,updated_at,request_id,workflow_run_id,workflow_step_key)
    VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`);
  const now = new Date().toISOString();
  for (let index = 0; index < 20; index++) {
    insert.run(`large-${index}`, 'workflow_step', 'succeeded', 'site', '{}', '{}', '[]', now, now,
      f.request.id, f.workflowRun.id, 'x'.repeat(1_000));
  }
  const inspection = createChangeRequest({ title: 'Inspect', description: 'Inspect', workflowKey: f.request.workflowKey,
    requestType: 'ops', constraints: { workflowHealth: { requestNumbers: [f.request.requestNumber] } } });
  assert.ok(inspection);
  const snapshot = workflowScriptSnapshot({ request: inspection, binding: 'workflow-health-snapshot-v1',
    config: { eligibleWorkflowKeys: [f.request.workflowKey], requiredArtifacts: {}, reportScopeKey: 'bound-scope' } });
  assert.ok(snapshot.targets && snapshot.coverage);
  assert.equal(snapshot.targets[0].coverage, 'snapshot_budget_exceeded');
  assert.equal(snapshot.coverage.partial, true);
});

test('more than 30 recent attempts marks otherwise observed target as partial', () => {
  const f = fixture('history-truncated');
  const insert = getDb().prepare(`INSERT INTO agent_runs
    (id,kind,status,source,input_json,result_json,trace_json,created_at,updated_at,request_id,workflow_run_id,workflow_step_key)
    VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`);
  const now = new Date().toISOString();
  for (let index = 0; index < 31; index++) {
    insert.run(`short-${index}`, 'workflow_step', 'succeeded', 'site', '{}', '{}', '[]', now, now,
      f.request.id, f.workflowRun.id, 'inspect');
  }
  const inspection = createChangeRequest({ title: 'Inspect', description: 'Inspect', workflowKey: f.request.workflowKey,
    requestType: 'ops', constraints: { workflowHealth: { requestNumbers: [f.request.requestNumber] } } });
  assert.ok(inspection);
  const snapshot = workflowScriptSnapshot({ request: inspection, binding: 'workflow-health-snapshot-v1',
    config: { eligibleWorkflowKeys: [f.request.workflowKey], requiredArtifacts: {}, reportScopeKey: 'history-scope' } });
  assert.ok(snapshot.targets && snapshot.coverage);
  assert.equal(snapshot.targets[0].coverage, 'observed');
  assert.equal('historyTruncated' in snapshot.targets[0] && snapshot.targets[0].historyTruncated, true);
  assert.equal(snapshot.coverage.partial, true);
});

test('completion retains evidence but cannot route using a changed workflow manifest', async () => {
  const f = fixture('manifest-edit');
  const queued = f.enqueue();
  const workflow = getWorkflowByKey(f.request.workflowKey)!;
  const edited = structuredClone(workflow.definition);
  (edited.steps as Array<Record<string, unknown>>)[0].next = 'fallback';
  upsertWorkflow({ key: workflow.key, name: workflow.name, version: workflow.version + 1, definition: edited });
  const claim = claimWorkflowScriptAttempt(60)!;
  beginWorkflowScriptCompletion({ id: queued.id, token: claim.leaseToken!, outcome: 'completed', result: { checks: [] }, exitCode: 0 });
  const result = await finalizeWorkflowScriptAttempt(queued.id);
  assert.equal(result.ok, true);
  assert.equal(getWorkflowScriptRun(queued.id)?.status, 'superseded');
  assert.ok(getWorkflowScriptRun(queued.id)?.receiptArtifactId);
  assert.equal(getWorkflowRunForRequest(f.request.id)?.currentStepKey, 'inspect');
  assert.equal((getDb().prepare('SELECT COUNT(*) AS count FROM agent_runs WHERE workflow_run_id=?').get(f.workflowRun.id) as { count: number }).count, 0);
});

test('cross-executor SQL guard rejects concurrent agent insert and cancellation fences completion', () => {
  const f = fixture('canceled');
  const queued = f.enqueue();
  const claimed = claimWorkflowScriptAttempt(60)!;
  assert.equal(activeWorkflowScriptRun(f.workflowRun.id)?.id, queued.id);
  assert.throws(() => getDb().prepare(`INSERT INTO agent_runs
    (id,kind,status,source,input_json,result_json,trace_json,created_at,updated_at,workflow_run_id)
    VALUES ('race','workflow_step','queued','site','{}','{}','[]','now','now',?)`).run(f.workflowRun.id), /WORKFLOW_SCRIPT_ACTIVE/);
  assert.equal(cancelWorkflowScriptRuns(f.workflowRun.id), 1);
  assert.equal(getWorkflowScriptRun(queued.id)?.status, 'canceling');
  assert.equal(beginWorkflowScriptCompletion({ id: queued.id, token: claimed.leaseToken!, outcome: 'completed', result: {}, exitCode: 0 }), null);
  assert.equal(activeWorkflowScriptRun(f.workflowRun.id)?.status, 'canceling');
  assert.equal(acknowledgeWorkflowScriptCancellation(queued.id, 'wrong-token'), false);
  assert.equal(acknowledgeWorkflowScriptCancellation(queued.id, claimed.leaseToken!), true);
  assert.equal(activeWorkflowScriptRun(f.workflowRun.id), null);
});

test('expired first claim records failure evidence and retries with a new fenced attempt', async () => {
  const f = fixture('expired');
  const queued = f.enqueue();
  const claimed = claimWorkflowScriptAttempt(60)!;
  getDb().prepare('UPDATE workflow_script_runs SET lease_expires_at=? WHERE id=?')
    .run('2000-01-01T00:00:00.000Z', queued.id);
  assert.equal(expireWorkflowScriptLeases(), 1);
  assert.equal(beginWorkflowScriptCompletion({ id: queued.id, token: claimed.leaseToken!, outcome: 'completed', result: {}, exitCode: 0 }), null);
  const advanced = await finalizeWorkflowScriptAttempt(queued.id);
  assert.equal(advanced.ok, true);
  const first = getWorkflowScriptRun(queued.id)!;
  assert.equal(first.status, 'failed');
  assert.ok(first.receiptArtifactId);
  assert.ok(first.resultArtifactId);
  assert.ok(first.advancementAt);
  const retry = activeWorkflowScriptRun(f.workflowRun.id)!;
  assert.notEqual(retry.id, first.id);
  assert.equal(retry.attempt, 2);
  assert.equal(retry.revisionId, first.revisionId);
  assert.equal(retry.inputChecksum, first.inputChecksum);
  assert.equal(getWorkflowRunForRequest(f.request.id)?.currentStepKey, 'inspect');
  requestWorkflowScriptCancellation(retry.id);
});

test('active agent attempt prevents script enqueue transactionally', () => {
  const f = fixture('agent-active');
  getDb().prepare(`INSERT INTO agent_runs
    (id,kind,status,source,input_json,result_json,trace_json,created_at,updated_at,workflow_run_id)
    VALUES ('active-agent','workflow_step','queued','site','{}','{}','[]','now','now',?)`).run(f.workflowRun.id);
  assert.throws(() => f.enqueue(), /WORKFLOW_EXECUTOR_ACTIVE/);
  assert.equal(activeWorkflowScriptRun(f.workflowRun.id), null);
});

test('exhausted script retry releases ownership before queuing Dreamer fallback once', async () => {
  const f = fixture('fallback');
  const first = f.enqueue();
  const firstClaim = claimWorkflowScriptAttempt(60)!;
  beginWorkflowScriptCompletion({ id: first.id, token: firstClaim.leaseToken!, outcome: 'failed',
    result: { reason: 'invalid output' }, exitCode: -1, errorCode: 'SCRIPT_RESULT_INVALID' });
  await finalizeWorkflowScriptAttempt(first.id);
  const retry = activeWorkflowScriptRun(f.workflowRun.id)!;
  assert.equal(retry.attempt, 2);
  const secondClaim = claimWorkflowScriptAttempt(60)!;
  beginWorkflowScriptCompletion({ id: retry.id, token: secondClaim.leaseToken!, outcome: 'failed',
    result: { reason: 'invalid output again' }, exitCode: -1, errorCode: 'SCRIPT_RESULT_INVALID' });
  const advanced = await finalizeWorkflowScriptAttempt(retry.id);
  assert.equal(advanced.ok, true);
  assert.equal(activeWorkflowScriptRun(f.workflowRun.id), null);
  assert.equal(getWorkflowRunForRequest(f.request.id)?.currentStepKey, 'fallback');
  const agents = getDb().prepare("SELECT id,status FROM agent_runs WHERE workflow_run_id=? AND status='queued'")
    .all(f.workflowRun.id) as Array<{ id: string; status: string }>;
  assert.equal(agents.length, 1);
  await finalizeWorkflowScriptAttempt(retry.id);
  assert.equal((getDb().prepare("SELECT COUNT(*) AS count FROM agent_runs WHERE workflow_run_id=?").get(f.workflowRun.id) as { count: number }).count, 1);
  // The existing agent dispatcher is scheduled asynchronously by queue insertion.
  await new Promise((resolve) => setTimeout(resolve, 100));
});

test('disabled successor rolls back projection and remains recoverable without duplicate fallback', async () => {
  const f = fixture('disabled-successor');
  const first = f.enqueue();
  const firstClaim = claimWorkflowScriptAttempt(60)!;
  beginWorkflowScriptCompletion({ id: first.id, token: firstClaim.leaseToken!, outcome: 'failed', result: {}, exitCode: -1 });
  await finalizeWorkflowScriptAttempt(first.id);
  const retry = activeWorkflowScriptRun(f.workflowRun.id)!;
  const claim = claimWorkflowScriptAttempt(60)!;
  beginWorkflowScriptCompletion({ id: retry.id, token: claim.leaseToken!, outcome: 'failed', result: {}, exitCode: -1 });
  getDb().prepare("UPDATE agent_profiles SET status='archived' WHERE key='dreamer-agent'").run();
  const blocked = await finalizeWorkflowScriptAttempt(retry.id);
  assert.equal(blocked.ok, false);
  assert.equal(getWorkflowRunForRequest(f.request.id)?.currentStepKey, 'inspect');
  assert.equal(getWorkflowScriptRun(retry.id)?.advancementAt, null);
  assert.equal((getDb().prepare('SELECT COUNT(*) AS count FROM agent_runs WHERE workflow_run_id=?').get(f.workflowRun.id) as { count: number }).count, 0);
  getDb().prepare("UPDATE agent_profiles SET status='active' WHERE key='dreamer-agent'").run();
  const recovered = await finalizeWorkflowScriptAttempt(retry.id);
  assert.equal(recovered.ok, true);
  assert.equal(getWorkflowRunForRequest(f.request.id)?.currentStepKey, 'fallback');
  assert.equal((getDb().prepare('SELECT COUNT(*) AS count FROM agent_runs WHERE workflow_run_id=?').get(f.workflowRun.id) as { count: number }).count, 1);
  await new Promise((resolve) => setTimeout(resolve, 100));
});
