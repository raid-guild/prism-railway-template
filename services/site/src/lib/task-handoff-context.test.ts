import assert from 'node:assert/strict'
import test from 'node:test'
import type { AgentProfileRecord, AgentRunRecord, HostedSkillSummary, TaskRecord, TaskRunRecord } from './app-core'
import { resolveTaskHandoffContext, TaskHandoffContextError } from './task-handoff-context'

const task = { id: 'task-1', key: 'threat-watch', taskType: 'script-runner', updatedAt: '2026-09-01T00:00:00.000Z', instructionConfig: { requestedSkills: ['veydrift-threat-review'] }, agentConfig: { handoff: { enabled: true } } } as unknown as TaskRecord
const taskRun = { id: 'run-1', taskId: 'task-1', taskKey: 'threat-watch', agentRunId: 'agent-1', status: 'running', createdAt: '2026-09-02T00:00:00.000Z' } as TaskRunRecord
const agentRun = { id: 'agent-1', kind: 'task', taskKey: 'threat-watch', agentProfileId: 'profile-1', agentProfileVersion: 2, status: 'running', input: { taskRunId: 'run-1' }, executionMode: 'worker' } as unknown as AgentRunRecord
const profile = { id: 'profile-1', key: 'threat-agent', name: 'Threat agent', status: 'active', version: 2, skills: [], authority: {}, persona: {}, memoryScope: {}, runtimeProfileKey: null, modelTier: null } as unknown as AgentProfileRecord
const hostedSkills = [
  { name: 'veydrift-threat-review', requiredCredentials: ['evm-wallet'] },
  { name: 'unrelated-wallet-skill', requiredCredentials: ['other-secret'] },
] as HostedSkillSummary[]
const fixture = () => ({ task, taskRun, agentRun, profile, hostedSkills, expectedTaskUpdatedAt: task.updatedAt })

test('persisted selected skill yields just its required key, never unrelated skills', () => {
  const context = resolveTaskHandoffContext(fixture())
  assert.deepEqual(context.skills, ['veydrift-threat-review'])
  assert.deepEqual(context.credentialKeys, ['evm-wallet'])
  assert.equal(context.agentRunId, 'agent-1')
})

test('assigned profile model tier is returned for the Runtime top-level invocation', () => {
  assert.equal(resolveTaskHandoffContext({ ...fixture(), profile: { ...profile, modelTier: 'economy' } }).modelTier, 'economy')
  assert.equal(resolveTaskHandoffContext({ ...fixture(), profile: { ...profile, modelTier: 'deep' } }).modelTier, 'deep')
})

test('profile selected skills also contribute requirements and policy denies required keys', () => {
  assert.deepEqual(resolveTaskHandoffContext({ ...fixture(), profile: { ...profile, skills: ['unrelated-wallet-skill'] } }).credentialKeys, ['other-secret', 'evm-wallet'])
  for (const authority of [{ credentialPolicy: 'none' }, { credentialPolicy: 'allowlist', gatewayCredentials: ['other-secret'] }]) {
    assert.throws(() => resolveTaskHandoffContext({ ...fixture(), profile: { ...profile, authority } }), /REQUIRED_CREDENTIAL_DENIED/)
  }
})

test('rejects stale, mismatched, disabled or missing persisted links', () => {
  for (const bad of [
    { taskRun: { ...taskRun, status: 'failed' } },
    { taskRun: { ...taskRun, agentRunId: 'wrong' } },
    { agentRun: { ...agentRun, input: { taskRunId: 'wrong' } } },
    { agentRun: { ...agentRun, status: 'succeeded' } },
    { profile: { ...profile, version: 3 } },
    { task: { ...task, agentConfig: { handoff: { enabled: false } } } },
    { task: { ...task, taskType: 'http-post' } },
    { taskRun: null },
  ]) {
    assert.throws(() => resolveTaskHandoffContext({ ...fixture(), ...bad } as ReturnType<typeof fixture>), TaskHandoffContextError)
  }
})

test('missing selected hosted skill fails rather than silently omitting required credential', () => {
  assert.throws(() => resolveTaskHandoffContext({ ...fixture(), hostedSkills: [] }), /SKILL_NOT_FOUND/)
})

test('changed task definition after dispatch cannot widen the current handoff', () => {
  assert.throws(() => resolveTaskHandoffContext({ ...fixture(), task: { ...task, updatedAt: '2026-09-03T00:00:00.000Z' } }), /TASK_DEFINITION_CHANGED/)
  assert.throws(() => resolveTaskHandoffContext({ ...fixture(), expectedTaskUpdatedAt: '2026-08-31T00:00:00.000Z' }), /TASK_DEFINITION_CHANGED/)
  assert.throws(() => resolveTaskHandoffContext({ ...fixture(), expectedTaskUpdatedAt: '' }), /TASK_DEFINITION_CHANGED/)
})
