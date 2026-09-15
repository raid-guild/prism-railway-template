import type {
  ChangeRequestExecutionRecord,
  ChangeRequestRecord,
  TargetAppRecord,
  TargetEnvironmentRecord,
  WorkflowRecord,
} from "@/lib/admin";

export type RequestSortValue =
  | "updated-desc"
  | "updated-asc"
  | "number-desc"
  | "number-asc";

export type AgentThreadMessage = {
  id: string;
  role: string;
  source: string;
  content: string;
  createdAt: string;
};

export type AgentThreadSession = {
  id: string;
};

export type WorkflowStep = {
  key: string;
  label: string;
  type: string;
  instructionPath: string | null;
  next: string | null;
  routes: Record<string, string>;
  resumeLabel: string | null;
};

export const fallbackRequestWorkflowSteps: WorkflowStep[] = [
  {
    key: "triage",
    label: "Triage",
    type: "agent",
    instructionPath: "workflows/change-request-default/steps/triage.md",
    next: "approve-for-work",
    routes: {},
    resumeLabel: null,
  },
  {
    key: "approve-for-work",
    label: "Approve",
    type: "gate",
    instructionPath: null,
    next: "implement",
    routes: {},
    resumeLabel: null,
  },
  {
    key: "implement",
    label: "Work",
    type: "agent",
    instructionPath: "workflows/change-request-default/steps/implement.md",
    next: "verify",
    routes: {},
    resumeLabel: null,
  },
  {
    key: "verify",
    label: "Verify",
    type: "agent",
    instructionPath: "workflows/change-request-default/steps/verify.md",
    next: "local-code-review",
    routes: {},
    resumeLabel: null,
  },
  {
    key: "local-code-review",
    label: "Local Code Review",
    type: "agent",
    instructionPath: "workflows/change-request-default/steps/local-code-review.md",
    next: "review-cycle",
    routes: {},
    resumeLabel: null,
  },
  {
    key: "review-cycle",
    label: "Review Decision",
    type: "loop",
    instructionPath: null,
    next: "review",
    routes: {},
    resumeLabel: null,
  },
  {
    key: "review",
    label: "Review",
    type: "gate",
    instructionPath: "workflows/change-request-default/steps/review.md",
    next: "closed",
    routes: {},
    resumeLabel: null,
  },
  {
    key: "closed",
    label: "Closed",
    type: "terminal",
    instructionPath: null,
    next: null,
    routes: {},
    resumeLabel: null,
  },
  {
    key: "review-loop-attention",
    label: "Review Loop Attention",
    type: "gate",
    instructionPath: null,
    next: "review",
    routes: { revise: "implement" },
    resumeLabel: null,
  },
];

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

export function workflowSteps(workflow: WorkflowRecord | null | undefined): WorkflowStep[] {
  const rawSteps = Array.isArray(workflow?.definition?.steps) ? workflow.definition.steps : [];
  const steps = rawSteps
    .filter(isRecord)
    .map((step): WorkflowStep | null => {
      const key = typeof step.key === "string" && step.key.trim() ? step.key.trim() : "";
      if (!key) return null;
      const label =
        typeof step.label === "string" && step.label.trim()
          ? step.label.trim()
          : typeof step.name === "string" && step.name.trim()
            ? step.name.trim()
            : key;
      const type = typeof step.type === "string" && step.type.trim() ? step.type.trim() : "agent";
      const instructionPath =
        typeof step.instructionPath === "string" && step.instructionPath.trim()
          ? step.instructionPath.trim()
          : null;
      const next = typeof step.next === "string" && step.next.trim() ? step.next.trim() : null;
      const resumeLabel =
        typeof step.resumeLabel === "string" && step.resumeLabel.trim()
          ? step.resumeLabel.trim()
          : typeof step.resume_label === "string" && step.resume_label.trim()
            ? step.resume_label.trim()
            : null;
      const routes = isRecord(step.routes)
        ? Object.fromEntries(
            Object.entries(step.routes).filter(
              (entry): entry is [string, string] =>
                typeof entry[0] === "string" &&
                entry[0].trim().length > 0 &&
                typeof entry[1] === "string" &&
                entry[1].trim().length > 0,
            ),
          )
        : {};
      return { key, label, type, instructionPath, next, routes, resumeLabel };
    })
    .filter((step): step is WorkflowStep => Boolean(step));

  return steps.length ? steps : fallbackRequestWorkflowSteps;
}

export function workflowStepForKey(
  stepKey: string | null | undefined,
  steps: WorkflowStep[],
): { step: WorkflowStep; index: number } {
  if (stepKey) {
    const index = steps.findIndex((step) => step.key === stepKey);
    if (index >= 0) {
      return { step: steps[index], index };
    }
  }

  const safeIndex = 0;
  return { step: steps[safeIndex] ?? fallbackRequestWorkflowSteps[0], index: safeIndex };
}

export function priorityVariant(priority: string) {
  if (priority === "urgent") return "default";
  if (priority === "high") return "secondary";
  return "muted";
}

export function workflowStepVariant(step: WorkflowStep | null | undefined) {
  if (step?.type === "terminal") return "muted";
  if (step?.type === "gate") return "secondary";
  if (step?.type === "loop") return "outline";
  if (step?.type === "checkpoint") return "outline";
  if (step?.type === "agent") return "default";
  return "outline";
}

export function requestTypeLabel(value: string) {
  return value
    .split("-")
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}

export function requestSourceLabel(value: string) {
  if (value.startsWith("hook:")) return `Hook: ${value.slice("hook:".length)}`;
  if (value === "task-runner" || value.startsWith("task:")) return "Task";
  if (value === "chat") return "Agent";
  if (value === "manual") return "Manual";
  if (value === "admin-hook-test") return "Hook test";
  return requestTypeLabel(value || "unknown");
}

export function humanHoursLabel(value: number | null | undefined) {
  if (typeof value !== "number" || !Number.isFinite(value)) return null;
  const formatted = Number.isInteger(value) ? String(value) : value.toFixed(2).replace(/0+$/, "").replace(/\.$/, "");
  return `${formatted}h human`;
}

export function parseTimestamp(value: string | null) {
  if (!value) return 0;
  const timestamp = new Date(value).getTime();
  return Number.isNaN(timestamp) ? 0 : timestamp;
}

export function environmentForRequest(
  request: ChangeRequestRecord,
  targetEnvironments: TargetEnvironmentRecord[],
) {
  return (
    targetEnvironments.find(
      (environment) => environment.id === request.targetEnvironmentId,
    ) ?? null
  );
}

export function targetAppForRequest(
  request: ChangeRequestRecord,
  targetApps: TargetAppRecord[],
) {
  return (
    targetApps.find((targetApp) => targetApp.id === request.targetAppId) ?? null
  );
}

export function isoLabel(value: string | null) {
  if (!value) return null;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleString();
}

export function formatDurationFrom(startedAt: string | null, nowMs: number) {
  if (!startedAt) return null;
  const startedMs = new Date(startedAt).getTime();
  if (Number.isNaN(startedMs)) return null;

  const totalSeconds = Math.max(0, Math.floor((nowMs - startedMs) / 1000));
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;

  if (minutes >= 60) {
    const hours = Math.floor(minutes / 60);
    const remainingMinutes = minutes % 60;
    return `${hours}h ${remainingMinutes}m`;
  }

  if (minutes > 0) {
    return `${minutes}m ${seconds}s`;
  }

  return `${seconds}s`;
}

function latestTraceEntry(execution: ChangeRequestExecutionRecord | null) {
  const trace = Array.isArray(execution?.meta?.runtimeTrace)
    ? execution.meta.runtimeTrace
    : [];
  for (let index = trace.length - 1; index >= 0; index -= 1) {
    const entry = trace[index];
    if (
      entry &&
      typeof entry === "object" &&
      typeof entry.message === "string" &&
      entry.message.trim()
    ) {
      return {
        at: typeof entry.at === "string" ? entry.at : null,
        kind: typeof entry.kind === "string" ? entry.kind : "runtime",
        message: entry.message.trim(),
      };
    }
  }

  return null;
}

export function describeExecutionStage(
  execution: ChangeRequestExecutionRecord | null,
) {
  if (!execution) {
    return "No active legacy execution";
  }

  const traceEntry = latestTraceEntry(execution);
  if (traceEntry) {
    return `${traceEntry.kind}: ${traceEntry.message}`;
  }

  if (execution.branchName) {
    return `Working on branch ${execution.branchName}`;
  }

  return "Execution started and waiting for runtime updates";
}

export function executionBranchUrl(
  execution: ChangeRequestExecutionRecord | null,
) {
  const candidate = execution?.meta?.branchUrl;
  return typeof candidate === "string" && candidate.trim()
    ? candidate.trim()
    : null;
}

export function executionDeployUrl(
  execution: ChangeRequestExecutionRecord | null,
  targetEnvironment?: TargetEnvironmentRecord | null,
) {
  const direct = execution?.deployUrl;
  if (typeof direct === "string" && direct.trim()) {
    return direct.trim();
  }

  const staticUrl = execution?.meta?.deployStaticUrl;
  if (typeof staticUrl === "string" && staticUrl.trim()) {
    return staticUrl.startsWith("http")
      ? staticUrl.trim()
      : `https://${staticUrl.trim()}`;
  }

  const fallback = targetEnvironment?.baseUrl;
  if (typeof fallback === "string" && fallback.trim()) {
    return fallback.trim();
  }

  return null;
}

export function githubCompareUrl(
  targetApp: TargetAppRecord | null,
  baseBranch: string | null | undefined,
  branchName: string | null | undefined,
) {
  if (!targetApp?.repoUrl || !baseBranch || !branchName) {
    return null;
  }

  const match = targetApp.repoUrl.match(
    /^https:\/\/github\.com\/([^/]+)\/([^/.]+)(?:\.git)?$/,
  );
  if (!match) {
    return null;
  }

  const [, owner, repo] = match;
  return `https://github.com/${owner}/${repo}/compare/${encodeURIComponent(baseBranch)}...${encodeURIComponent(branchName)}?expand=1`;
}
