import type { AdminBoardData, ChangeRequestRecord, WorkflowRecord } from "@/lib/admin";
import type { Capability } from "@/lib/role-access";

import type {
  LabActionDecision,
  LabRequestAllowedActions,
  LabRequestAttentionIndicator,
  LabRequestListItem,
  LabRequestSource,
  LabWorkflowPhase,
} from "./contracts";

function humanize(value: string) {
  return value
    .split(/[-_:]+/)
    .filter(Boolean)
    .map((part) => part.charAt(0).toLocaleUpperCase() + part.slice(1))
    .join(" ");
}

export function labRequestSource(value: string | null | undefined): LabRequestSource {
  const raw = value?.trim() || null;
  if (!raw) return { key: "unknown", label: "Unknown source", raw: null, known: false };

  const normalized = raw.toLocaleLowerCase();
  const knownSources: Array<[predicate: boolean, key: string, label: string]> = [
    [normalized === "manual" || normalized === "admin" || normalized === "site", "site", "Site"],
    [normalized === "chat" || normalized === "admin-console", "chat", "Prism chat"],
    [normalized === "discord" || normalized.startsWith("discord-"), "discord", "Discord"],
    [normalized === "telegram" || normalized.startsWith("telegram-"), "telegram", "Telegram"],
    [normalized === "buzz" || normalized.startsWith("buzz-"), "buzz", "Buzz"],
    [normalized === "external" || normalized.startsWith("external-"), "external", "External interface"],
    [normalized === "task-runner" || normalized.startsWith("task:"), "task", "Task"],
    [normalized === "hook" || normalized.startsWith("hook:"), "hook", "Hook"],
    [normalized === "system", "system", "System"],
  ];
  const match = knownSources.find(([predicate]) => predicate);
  if (match) return { key: match[1], label: match[2], raw, known: true };

  return {
    key: "unknown",
    label: `Unknown source · ${humanize(raw)}`,
    raw,
    known: false,
  };
}

function workflowSteps(workflow: WorkflowRecord | null | undefined) {
  const raw = Array.isArray(workflow?.definition.steps) ? workflow.definition.steps : [];
  return raw.flatMap((value) => {
    if (!value || typeof value !== "object" || Array.isArray(value)) return [];
    const step = value as Record<string, unknown>;
    const key = typeof step.key === "string" ? step.key.trim() : "";
    if (!key) return [];
    const labelValue = typeof step.label === "string" ? step.label : step.name;
    const label = typeof labelValue === "string" && labelValue.trim() ? labelValue.trim() : humanize(key);
    const type = typeof step.type === "string" && step.type.trim() ? step.type.trim() : "agent";
    return [{ key, label, type }];
  });
}

export function labWorkflowPhase(
  request: ChangeRequestRecord,
  workflow: WorkflowRecord | null | undefined,
): LabWorkflowPhase {
  const steps = workflowSteps(workflow);
  const configuredEntrypoint =
    typeof workflow?.definition.entrypoint === "string"
      ? workflow.definition.entrypoint.trim()
      : "";
  const key =
    request.currentWorkflowStepKey?.trim() ||
    configuredEntrypoint ||
    steps[0]?.key ||
    null;
  const step = key ? steps.find((candidate) => candidate.key === key) : undefined;
  if (step) return { ...step, known: true };
  if (key) return { key, label: humanize(key), type: "unknown", known: false };
  return { key: null, label: "Unknown phase", type: "unknown", known: false };
}

function hasCapability(capabilities: readonly Capability[], capability: Capability) {
  return capabilities.includes(capability);
}

function decision(
  capabilities: readonly Capability[],
  capability: Capability,
  stateAllowed = true,
  stateReason: string | null = null,
): LabActionDecision {
  if (!hasCapability(capabilities, capability)) {
    return { allowed: false, reason: `Requires ${capability}`, requiredCapability: capability };
  }
  return {
    allowed: stateAllowed,
    reason: stateAllowed ? null : stateReason ?? "Unavailable in the current request state",
    requiredCapability: capability,
  };
}

export function labRequestAllowedActions(input: {
  capabilities: readonly Capability[];
  phase: LabWorkflowPhase;
  active: boolean;
  completed: boolean;
  attention: LabRequestAttentionIndicator;
}): LabRequestAllowedActions {
  const { capabilities, phase, active, completed, attention } = input;
  const runnable = !active && !completed && !attention.required;
  const unavailableReason = completed
    ? "Request is completed"
    : active
      ? "A workflow run is active"
      : attention.required
        ? "Resolve the attention state before continuing"
        : null;

  return {
    view: decision(capabilities, "canViewRequests"),
    comment: decision(capabilities, "canComment"),
    uploadArtifact: decision(capabilities, "canComment"),
    continueHumanGate: decision(
      capabilities,
      "canRunAgent",
      runnable && phase.type === "gate",
      phase.type !== "gate" ? "Current step is not a human gate" : unavailableReason,
    ),
    invokeCurrentStep: decision(
      capabilities,
      "canRunAgent",
      runnable && ["agent", "checkpoint", "loop"].includes(phase.type),
      !["agent", "checkpoint", "loop"].includes(phase.type)
        ? "Current step is not agent-runnable"
        : unavailableReason,
    ),
  };
}

function estimate(value: number | null) {
  if (typeof value !== "number" || !Number.isFinite(value) || value < 0) return null;
  return value;
}

function estimateLabel(value: number | null) {
  if (value === null) return null;
  const formatted = Number.isInteger(value) ? String(value) : value.toFixed(2).replace(/0+$/, "").replace(/\.$/, "");
  return `${formatted}h human`;
}

function attentionIndicator(request: ChangeRequestRecord): LabRequestAttentionIndicator {
  if (request.workflowAttention) {
    return {
      required: true,
      blocked: request.workflowAttention.status === "blocked",
      status: request.workflowAttention.status,
      summary: request.workflowAttention.summary,
      suggestedFix: request.workflowAttention.suggestedFix,
      blockerCount: request.workflowAttention.blockers.length,
    };
  }
  if (request.workflowRunStatus?.toLocaleLowerCase() === "failed") {
    return {
      required: true,
      blocked: false,
      status: "failed",
      summary: "Workflow run failed",
      suggestedFix: null,
      blockerCount: 0,
    };
  }
  return {
    required: false,
    blocked: false,
    status: null,
    summary: null,
    suggestedFix: null,
    blockerCount: 0,
  };
}

export function buildLabRequestListItems(
  data: AdminBoardData,
  capabilities: readonly Capability[],
): LabRequestListItem[] {
  const workflows = new Map((data.workflows ?? []).map((workflow) => [workflow.key, workflow]));
  const activeRunsByRequestId = new Map<string, NonNullable<AdminBoardData["activeRequestAgentRuns"]>>();
  for (const run of data.activeRequestAgentRuns ?? []) {
    if (!run.requestId || !["queued", "claimed", "running"].includes(run.status.toLocaleLowerCase())) continue;
    const runs = activeRunsByRequestId.get(run.requestId) ?? [];
    runs.push(run);
    activeRunsByRequestId.set(run.requestId, runs);
  }

  return data.changeRequests.map((request) => {
    const phase = labWorkflowPhase(request, workflows.get(request.workflowKey));
    const status = request.workflowRunStatus?.trim().toLocaleLowerCase() || null;
    const workflowActive = status === "active" || status === "queued" || status === "running";
    const activeRuns = activeRunsByRequestId.get(request.id) ?? [];
    const activeStatus = ["running", "claimed", "queued"].find((candidate) =>
      activeRuns.some((run) => run.status.toLocaleLowerCase() === candidate),
    ) ?? null;
    const active = activeRuns.length > 0;
    const failed = status === "failed";
    const completed =
      phase.type === "terminal" ||
      status === "completed" ||
      status === "canceled" ||
      Boolean(request.closedAt);
    const attention = attentionIndicator(request);
    const lifecycle = completed
      ? "completed"
      : active
        ? "running"
        : attention.required
          ? "attention"
          : "open";
    const origin = request.origin ?? null;
    const source = labRequestSource(origin?.platform ?? request.source);
    const requestedByDisplayName = origin?.actorDisplayName
      ?? request.requestedByDisplayName
      ?? (origin?.actorType === "external-subject" ? "External subject" : null);
    const estimatedHumanHours = estimate(request.estimatedHumanHours);
    const allowedActions = labRequestAllowedActions({
      capabilities,
      phase,
      active,
      completed,
      attention,
    });
    const searchText = [
      request.requestNumber,
      request.title,
      request.description,
      request.requestType,
      request.priority,
      request.workflowKey,
      phase.key,
      phase.label,
      source.raw,
      source.label,
      origin?.targetId,
      origin?.targetName,
      origin?.interactionProfileKey,
      origin?.actorId,
      requestedByDisplayName,
    ]
      .filter((value) => value !== null && value !== undefined)
      .join(" ")
      .toLocaleLowerCase();

    return {
      id: request.id,
      requestNumber: request.requestNumber,
      title: request.title,
      description: request.description,
      requestType: request.requestType,
      priority: request.priority,
      workflowKey: request.workflowKey,
      lifecycle,
      phase,
      source,
      run: {
        status: activeStatus,
        active,
        activeCount: activeRuns.length,
        failed,
        workflowStatus: status,
        workflowActive,
      },
      attention,
      hasHumanGate: !completed && phase.type === "gate",
      estimatedHumanHours,
      estimatedHumanHoursLabel: estimateLabel(estimatedHumanHours),
      requestedByDisplayName,
      origin,
      createdAt: request.createdAt,
      updatedAt: request.updatedAt,
      allowedActions,
      searchText,
    };
  });
}
