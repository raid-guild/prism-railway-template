import type Database from 'better-sqlite3';

import {
  adminAgentProfileKey,
  agentExecutionModes,
  getAgentProfile,
  type AgentExecutionMode,
  type AgentProfileRecord,
} from './agent-profiles';
import { getDb } from './db';

type JsonRecord = Record<string, unknown>;

export type AgentExecutorSnapshot = {
  profileId: string;
  profileKey: string;
  profileVersion: number;
  executionMode: AgentExecutionMode;
  resolution: AgentExecutorResolution;
};

export const agentExecutorResolutions = [
  'step-explicit',
  'workflow-default',
  'task-explicit',
  'hook-workflow-default',
  'admin-fallback',
  'historical-unknown',
  'not-applicable',
] as const;
export type AgentExecutorResolution = (typeof agentExecutorResolutions)[number];

function record(value: unknown): JsonRecord {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as JsonRecord : {};
}

function optionalText(...values: unknown[]) {
  for (const value of values) {
    if (typeof value === 'string' && value.trim()) return value.trim();
  }
  return null;
}

function executionMode(...values: unknown[]): AgentExecutionMode {
  const candidate = optionalText(...values)?.toLowerCase();
  return agentExecutionModes.includes(candidate as AgentExecutionMode)
    ? candidate as AgentExecutionMode
    : 'worker';
}

function snapshot(
  profile: AgentProfileRecord,
  mode: AgentExecutionMode,
  resolution: AgentExecutorResolution,
): AgentExecutorSnapshot {
  return {
    profileId: profile.id,
    profileKey: profile.key,
    profileVersion: profile.version,
    executionMode: mode,
    resolution,
  };
}

export function resolveAgentExecutor(input: {
  profileKey?: string | null;
  executionMode?: string | null;
  resolution?: AgentExecutorResolution;
}, db: Database.Database = getDb()): AgentExecutorSnapshot {
  const explicitProfile = optionalText(input.profileKey);
  const requestedKey = explicitProfile ?? adminAgentProfileKey;
  const profile = getAgentProfile(requestedKey, db);
  if (!profile) throw new Error(`AGENT_EXECUTOR_NOT_FOUND:${requestedKey}`);
  if (profile.status !== 'active') throw new Error(`AGENT_EXECUTOR_NOT_ACTIVE:${requestedKey}`);
  return snapshot(
    profile,
    executionMode(input.executionMode),
    input.resolution ?? (explicitProfile ? 'step-explicit' : 'admin-fallback'),
  );
}

export function workflowAgentExecutor(
  definitionValue: unknown,
  stepValue: unknown,
  db: Database.Database = getDb(),
): AgentExecutorSnapshot {
  const definition = record(definitionValue);
  const definitionAgentConfig = record(definition.agentConfig ?? definition.agent_config);
  const step = record(stepValue);
  const stepAgentConfig = record(step.agentConfig ?? step.agent_config);
  const stepProfileKey = optionalText(
    step.executorAgent,
    step.executor_agent,
    stepAgentConfig.executorAgent,
    stepAgentConfig.executor_agent,
    stepAgentConfig.agentProfileKey,
    stepAgentConfig.agent_profile_key,
  );
  const workflowProfileKey = optionalText(
    definition.defaultAgent,
    definition.default_agent,
    definitionAgentConfig.defaultAgent,
    definitionAgentConfig.default_agent,
    definitionAgentConfig.executorAgent,
    definitionAgentConfig.executor_agent,
    definitionAgentConfig.agentProfileKey,
    definitionAgentConfig.agent_profile_key,
  );
  const mode = optionalText(
    step.executionMode,
    step.execution_mode,
    stepAgentConfig.executionMode,
    stepAgentConfig.execution_mode,
    definition.defaultExecutionMode,
    definition.default_execution_mode,
    definitionAgentConfig.defaultExecutionMode,
    definitionAgentConfig.default_execution_mode,
    definitionAgentConfig.executionMode,
    definitionAgentConfig.execution_mode,
  );
  return resolveAgentExecutor({
    profileKey: stepProfileKey ?? workflowProfileKey,
    executionMode: mode,
    resolution: stepProfileKey ? 'step-explicit' : workflowProfileKey ? 'workflow-default' : 'admin-fallback',
  }, db);
}

export function taskAgentExecutor(agentConfigValue: unknown, db: Database.Database = getDb()) {
  const agentConfig = record(agentConfigValue);
  const profileKey = optionalText(
    agentConfig.executorAgent,
    agentConfig.executor_agent,
    agentConfig.agentProfileKey,
    agentConfig.agent_profile_key,
    agentConfig.defaultAgent,
    agentConfig.default_agent,
  );
  return resolveAgentExecutor({
    profileKey,
    executionMode: optionalText(agentConfig.executionMode, agentConfig.execution_mode),
    resolution: profileKey ? 'task-explicit' : 'admin-fallback',
  }, db);
}

export function taskUsesAgentExecutor(taskTypeValue: unknown, agentConfigValue: unknown) {
  const taskType = optionalText(taskTypeValue)?.toLowerCase();
  if (taskType === 'codex-prompt' || taskType === 'workflow-runner') return true;
  if (taskType !== 'script-runner') return false;
  const agentConfig = record(agentConfigValue);
  const handoff = record(agentConfig.handoff ?? agentConfig.agentHandoff ?? agentConfig.agent_handoff);
  return handoff.enabled === true;
}
