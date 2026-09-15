function stringList(value: unknown) {
  return Array.isArray(value)
    ? value.filter((entry): entry is string => typeof entry === "string").map((entry) => entry.trim()).filter(Boolean)
    : [];
}

export function workflowStepSkills(agentConfig: unknown) {
  if (!agentConfig || typeof agentConfig !== "object" || Array.isArray(agentConfig)) return [];
  return Array.from(new Set(stringList((agentConfig as Record<string, unknown>).skills)));
}

export function initialWorkflowRunSkills(input: {
  requestedSkills: unknown;
  agentConfig: unknown;
  linkedWorkflow: boolean;
  isEntrypoint: boolean;
}) {
  return Array.from(new Set([
    ...(!input.linkedWorkflow || input.isEntrypoint ? stringList(input.requestedSkills) : []),
    ...workflowStepSkills(input.agentConfig),
  ]));
}

export function continuationWorkflowRunSkills(agentConfig: unknown) {
  return workflowStepSkills(agentConfig);
}
