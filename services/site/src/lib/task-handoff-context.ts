import type { AgentProfileRecord, AgentRunRecord, HostedSkillSummary, TaskRecord, TaskRunRecord } from '@/lib/app-core'
import { filterGatewayCredentialKeysForProfile, resolveAgentProfileRuntimeScope } from '@/lib/agent-profile-runtime-scope'

function stringList(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string' && item.trim().length > 0).map((item) => item.trim()) : []
}

function selectedSkills(config: Record<string, unknown>): string[] {
  return stringList(config.requestedSkills ?? config.requested_skills ?? config.skills)
}

function explicitCredentialKeys(config: Record<string, unknown>): string[] {
  const value = config.gatewayCredentials ?? config.gateway_credentials
  return Array.isArray(value) ? value.flatMap((item) => typeof item === 'string' ? [item.trim()] : item && typeof item === 'object' && typeof item.key === 'string' ? [item.key.trim()] : []) : []
}

export class TaskHandoffContextError extends Error {
  constructor(readonly code: string) { super(`TASK_HANDOFF_CONTEXT_${code}`) }
}

// All inputs are persisted Site records; the caller may only supply a task-run ID.
export function resolveTaskHandoffContext(input: {
  taskRun: TaskRunRecord | null
  task: TaskRecord | null
  agentRun: AgentRunRecord | null
  profile: AgentProfileRecord | null
  hostedSkills: HostedSkillSummary[]
  expectedTaskUpdatedAt: string
}) {
  const { taskRun, task, agentRun, profile } = input
  if (!taskRun || !task || !agentRun || !profile) throw new TaskHandoffContextError('LINKAGE_MISSING')
  if (taskRun.status !== 'running' || !['running', 'queued'].includes(agentRun.status)
    || taskRun.taskId !== task.id || taskRun.taskKey !== task.key || taskRun.agentRunId !== agentRun.id
    || agentRun.kind !== 'task' || agentRun.taskKey !== task.key || agentRun.input.taskRunId !== taskRun.id
    || agentRun.agentProfileId !== profile.id || agentRun.agentProfileVersion !== profile.version
    || profile.status !== 'active' || task.taskType !== 'script-runner') {
    throw new TaskHandoffContextError('LINKAGE_INVALID')
  }
  if (!taskRun.createdAt || !task.updatedAt || task.updatedAt > taskRun.createdAt) {
    throw new TaskHandoffContextError('TASK_DEFINITION_CHANGED')
  }
  if (!input.expectedTaskUpdatedAt || input.expectedTaskUpdatedAt !== task.updatedAt) {
    throw new TaskHandoffContextError('TASK_DEFINITION_CHANGED')
  }
  const handoff = task.agentConfig.handoff ?? task.agentConfig.agentHandoff ?? task.agentConfig.agent_handoff
  if (!handoff || typeof handoff !== 'object' || Array.isArray(handoff) || !('enabled' in handoff) || handoff.enabled !== true) {
    throw new TaskHandoffContextError('HANDOFF_DISABLED')
  }
  const requestSkills = [...selectedSkills(task.instructionConfig), ...selectedSkills(task.agentConfig)]
  const scope = resolveAgentProfileRuntimeScope({ profile, assignedVersion: agentRun.agentProfileVersion, executionMode: agentRun.executionMode ?? 'worker', requestSkills })
  const skills = Array.from(new Set(scope.skills))
  const hostedByName = new Map(input.hostedSkills.map((skill) => [skill.name, skill]))
  const requiredKeys = Array.from(new Set(skills.flatMap((name) => {
    const skill = hostedByName.get(name)
    if (!skill) throw new TaskHandoffContextError('SKILL_NOT_FOUND')
    return skill.requiredCredentials
  })))
  const credentialKeys = Array.from(new Set([...requiredKeys, ...explicitCredentialKeys(task.agentConfig)]))
  const allowed = filterGatewayCredentialKeysForProfile(profile, credentialKeys)
  if (requiredKeys.some((key) => !allowed.includes(key))) throw new TaskHandoffContextError('REQUIRED_CREDENTIAL_DENIED')
  return {
    taskRunId: taskRun.id, agentRunId: agentRun.id, taskKey: task.key,
    skills, credentialKeys: allowed, runtimeProfileKey: scope.runtimeProfileKey, modelTier: scope.modelTier,
    policyInstructions: scope.policyInstructions, profile: scope.metadata,
  }
}
