type RecordValue = Record<string, unknown>;

export type WorkflowContextFinding = {
  check: string;
  status: "warning";
  subjectType: "workflow";
  subjectKey: string;
  stepKey?: string | null;
  expected: string;
  observed: string;
  recommendation: string;
  evidence: Record<string, unknown>;
};

function isRecord(value: unknown): value is RecordValue {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function stringList(value: unknown) {
  return Array.isArray(value)
    ? Array.from(new Set(value
      .filter((entry): entry is string => typeof entry === "string")
      .map((entry) => entry.trim())
      .filter(Boolean)))
    : [];
}

function skillsFromAgentConfig(value: unknown) {
  return isRecord(value) ? stringList(value.skills) : [];
}

function effectiveAgentConfig(shared: unknown, step: unknown) {
  return {
    ...(isRecord(shared) ? shared : {}),
    ...(isRecord(step) ? step : {}),
  };
}

function hasStepArtifactBoundary(config: RecordValue) {
  const policy = isRecord(config.contextPolicy ?? config.context_policy)
    ? config.contextPolicy ?? config.context_policy as RecordValue
    : {};
  return isRecord(policy) && policy.continuation === "step" && policy.handoff === "artifacts";
}

function sameStrings(left: string[], right: string[]) {
  return left.length === right.length && left.every((value) => right.includes(value));
}

export function workflowContextFindings(workflow: RecordValue): WorkflowContextFinding[] {
  const subjectKey = typeof workflow.key === "string" && workflow.key.trim()
    ? workflow.key.trim()
    : "unknown-workflow";
  const definition = isRecord(workflow.definition) ? workflow.definition : {};
  const steps = Array.isArray(definition.steps) ? definition.steps.filter(isRecord) : [];
  const agentSteps = steps.filter((step) => (typeof step.type === "string" ? step.type : "agent") === "agent");
  const sharedAgentConfig = definition.agentConfig ?? definition.agent_config;
  const sharedSkills = skillsFromAgentConfig(sharedAgentConfig);
  const findings: WorkflowContextFinding[] = [];

  if (sharedSkills.length && agentSteps.length > 1) {
    findings.push({
      check: "workflow-shared-skills-require-review",
      status: "warning",
      subjectType: "workflow",
      subjectKey,
      expected: "Shared workflow skills are required by every agent step.",
      observed: `${sharedSkills.length} shared skill(s) expand the context of ${agentSteps.length} agent steps.`,
      recommendation: "Move skills to step-level agentConfig unless every agent step needs them, then verify the effective skill union before enabling the workflow.",
      evidence: { sharedSkills, agentStepKeys: agentSteps.map((step) => step.key) },
    });
  }

  const stepsByKey = new Map(steps.flatMap((step) => (
    typeof step.key === "string" && step.key.trim() ? [[step.key.trim(), step] as const] : []
  )));

  for (const step of agentSteps) {
    const stepKey = typeof step.key === "string" && step.key.trim() ? step.key.trim() : "unknown-step";
    const nextKey = typeof step.next === "string" && step.next.trim() ? step.next.trim() : null;
    const nextStep = nextKey ? stepsByKey.get(nextKey) : null;
    if (!nextStep || (typeof nextStep.type === "string" ? nextStep.type : "agent") !== "agent") continue;

    const currentConfig = effectiveAgentConfig(sharedAgentConfig, step.agentConfig ?? step.agent_config);
    const nextConfig = effectiveAgentConfig(sharedAgentConfig, nextStep.agentConfig ?? nextStep.agent_config);
    const currentSkills = skillsFromAgentConfig(currentConfig).sort();
    const nextSkills = skillsFromAgentConfig(nextConfig).sort();
    if (sameStrings(currentSkills, nextSkills)) continue;
    if (hasStepArtifactBoundary(nextConfig)) continue;

    findings.push({
      check: "workflow-agent-skill-change-has-context-boundary",
      status: "warning",
      subjectType: "workflow",
      subjectKey,
      stepKey,
      expected: "Adjacent agent steps with different skill sets use an explicit artifact handoff and a context boundary.",
      observed: `${stepKey} auto-continues to ${nextKey} with a different effective skill set.`,
      recommendation: "Name the handoff artifacts in both step instructions and set contextPolicy to { continuation: \"step\", handoff: \"artifacts\" }, or use a gate/checkpoint when a human or external-state decision is required.",
      evidence: { nextStepKey: nextKey, currentSkills, nextSkills },
    });
  }

  return findings;
}
