type RecordValue = Record<string, unknown>;

export type TaskLifecycleFinding = {
  check: string;
  status: "warning";
  subjectType: "task";
  subjectKey: string;
  expected: string;
  observed: string;
  recommendation: string;
  evidence: Record<string, unknown>;
};

function isRecord(value: unknown): value is RecordValue {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function outputDestinations(task: RecordValue) {
  const outputConfig = isRecord(task.outputConfig ?? task.output_config)
    ? task.outputConfig ?? task.output_config as RecordValue
    : {};
  if (!isRecord(outputConfig)) return [];
  const destinations = outputConfig.outputDestinations ?? outputConfig.output_destinations;
  return Array.isArray(destinations) ? destinations.filter(isRecord) : [];
}

export function taskLifecycleFindings(task: RecordValue): TaskLifecycleFinding[] {
  const taskType = typeof (task.taskType ?? task.task_type) === "string"
    ? String(task.taskType ?? task.task_type).trim().toLowerCase()
    : "";
  const triggerType = typeof (task.triggerType ?? task.trigger_type) === "string"
    ? String(task.triggerType ?? task.trigger_type).trim().toLowerCase()
    : "";
  const destinations = outputDestinations(task);

  if (taskType !== "codex-prompt" || triggerType !== "schedule") {
    return [];
  }

  const subjectKey = typeof task.key === "string" && task.key.trim()
    ? task.key.trim()
    : "unknown-task";

  return [{
    check: "scheduled-codex-prompt-needs-request-lifecycle",
    status: "warning",
    subjectType: "task",
    subjectKey,
    expected: "Scheduled agent work uses a workflow-runner so every scheduled occurrence has a native Prism request lifecycle.",
    observed: `Task is configured as a ${task.enabled ? "enabled" : "disabled"} scheduled codex-prompt${destinations.length ? ` with ${destinations.length} direct external destination(s)` : ""}.`,
    recommendation: "Convert the schedule to a workflow-runner with structured request input. If this is only an ad hoc prompt, keep it out of the recurring scheduler and use an Agent Console or an explicitly invoked disabled utility task.",
    evidence: {
      enabled: task.enabled ?? null,
      destinationCount: destinations.length,
      destinations: destinations.map((destination) => ({
        adapter: destination.adapter ?? null,
        type: destination.type ?? null,
        id: destination.id ?? null,
        label: destination.label ?? null,
      })),
    },
  }];
}
