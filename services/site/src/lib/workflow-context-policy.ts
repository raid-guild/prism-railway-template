type RecordValue = Record<string, unknown>;

function record(value: unknown): RecordValue {
  return value && typeof value === "object" && !Array.isArray(value) ? value as RecordValue : {};
}

export type WorkflowContinuationPolicy = "session" | "step";

export function workflowContinuationPolicy(agentConfig: unknown): WorkflowContinuationPolicy {
  const config = record(agentConfig);
  const policy = record(config.contextPolicy ?? config.context_policy);
  return policy.continuation === "step" ? "step" : "session";
}

export function validateWorkflowContextPolicies(definition: RecordValue): string | null {
  const configs: Array<{ label: string; value: unknown }> = [
    { label: "agentConfig", value: definition.agentConfig ?? definition.agent_config },
  ];
  const steps = Array.isArray(definition.steps) ? definition.steps.filter((step) => record(step).key) : [];
  for (const step of steps) {
    const stepRecord = record(step);
    configs.push({
      label: `steps.${String(stepRecord.key)}.agentConfig`,
      value: stepRecord.agentConfig ?? stepRecord.agent_config,
    });
  }

  for (const configEntry of configs) {
    const config = record(configEntry.value);
    const rawPolicy = config.contextPolicy ?? config.context_policy;
    if (rawPolicy == null) continue;
    if (!rawPolicy || typeof rawPolicy !== "object" || Array.isArray(rawPolicy)) {
      return `${configEntry.label}.contextPolicy must be an object`;
    }
    const policy = record(rawPolicy);
    if (policy.continuation !== undefined && policy.continuation !== "session" && policy.continuation !== "step") {
      return `${configEntry.label}.contextPolicy.continuation must be session or step`;
    }
    if (policy.handoff !== undefined && policy.handoff !== "artifacts") {
      return `${configEntry.label}.contextPolicy.handoff must be artifacts`;
    }
  }
  return null;
}
