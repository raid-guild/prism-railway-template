import assert from 'node:assert/strict';
import test from 'node:test';
import { inspectWorkflowHealth } from './dreamer-workflow-health-inspector.mjs';

const observedAt = '2026-09-29T12:00:00.000Z';
const target = (extra = {}) => ({
  number: 42, coverage: 'observed', workflowKey: 'example', requestStep: 'closed',
  closedAt: observedAt, workflowRun: { id: 'workflow-42', status: 'completed', stepKey: 'closed' },
  agentRuns: [], scriptRuns: [], artifacts: [], requiredArtifacts: [], commandReceipts: [],
  ...extra,
});
const snapshot = (targets, extra = {}) => ({
  observedAt, reportScopeKey: 'pilot', coverage: { requested: targets.length, selected: targets.length, partial: false },
  targets, ...extra,
});
const check = (result, key) => result.result.checks.find((item) => item.key === key);

test('clean selected request closes quietly; prior delivered fingerprint suppresses repeat', () => {
  const clean = snapshot([target()]);
  const first = inspectWorkflowHealth(clean);
  assert.equal(first.outcome, 'no_op');
  const repeated = inspectWorkflowHealth({ ...clean, observedAt: '2026-09-30T12:00:00.000Z', previousDeliveredFingerprint: first.result.fingerprint });
  assert.equal(repeated.outcome, 'no_op');
  assert.equal(repeated.result.fingerprint, first.result.fingerprint);
});

test('completed missing artifact and projection drift are findings with a stable fingerprint', () => {
  const input = snapshot([target({ requestStep: 'verify', requiredArtifacts: ['report.md'] })]);
  const first = inspectWorkflowHealth(input);
  assert.equal(first.outcome, 'completed');
  assert.equal(check(first, 'terminal-projection').status, 'finding');
  assert.equal(check(first, 'required-artifact:report.md').status, 'finding');
  assert.equal(inspectWorkflowHealth({ ...input, observedAt: '2026-09-30T00:00:00.000Z' }).result.fingerprint, first.result.fingerprint);
});

test('active or queued work does not falsely classify an absent artifact as failure', () => {
  const input = snapshot([target({ requestStep: 'work', closedAt: null,
    workflowRun: { id: 'workflow-42', status: 'active', stepKey: 'work' }, requiredArtifacts: ['result.json'],
    scriptRuns: [{ id: 'script-1', status: 'running', leaseExpiresAt: '2026-09-29T12:01:00.000Z' }],
  })]);
  const result = inspectWorkflowHealth(input);
  assert.equal(check(result, 'required-artifact:result.json').status, 'unknown');
  assert.equal(check(result, 'ownership:script-1').status, 'pass');
  assert.equal(result.outcome, 'escalate');
});

test('expired ownership is a finding, but credential and wrong-attempt receipts remain unknown', () => {
  const input = snapshot([target({
    agentRuns: [{ id: 'agent-1', status: 'running', leaseExpiresAt: '2026-09-29T11:00:00.000Z', errorCode: 'WALLET_KEY_UNAVAILABLE' }],
    commandReceipts: [{ id: 'receipt-other', runId: 'agent-2', status: 'completed', exitCode: 0 }],
    credentialLeaseAudit: { status: 'not_available', references: [] },
  })]);
  const result = inspectWorkflowHealth(input);
  assert.equal(check(result, 'ownership:agent-1').status, 'finding');
  assert.equal(check(result, 'command-receipt:agent-1').status, 'unknown');
  assert.equal(check(result, 'credential-diagnosis:agent-1').status, 'unknown');
  assert.equal(result.outcome, 'escalate');
});

test('partial coverage and unavailable request remain explicit unknowns', () => {
  const input = snapshot([{ number: 77, coverage: 'api_denied' }],
    { coverage: { requested: 30, selected: 25, partial: true } });
  const result = inspectWorkflowHealth(input);
  assert.equal(check(result, 'coverage').status, 'unknown');
  assert.equal(result.result.coverage.partial, true);
  assert.equal(result.outcome, 'escalate');
});

test('truncated history is partial coverage even when all retained checks pass', () => {
  const result = inspectWorkflowHealth(snapshot([target({ historyTruncated: true })],
    { coverage: { requested: 1, selected: 1, partial: true } }));
  assert.equal(result.outcome, 'escalate');
  assert.equal(check(result, 'history-coverage').status, 'unknown');
  assert.equal(result.result.coverage.partial, true);
});

test('complete command receipt requires same attempt, successful exit, and no truncation', () => {
  const input = snapshot([target({
    agentRuns: [{ id: 'agent-1', status: 'completed' }],
    commandReceipts: [{ id: 'receipt-1', runId: 'agent-1', status: 'completed', exitCode: 0, truncated: false }],
  })]);
  assert.equal(check(inspectWorkflowHealth(input), 'command-receipt:agent-1').status, 'pass');
  input.targets[0].commandReceipts[0].truncated = true;
  assert.equal(check(inspectWorkflowHealth(input), 'command-receipt:agent-1').status, 'unknown');
});
