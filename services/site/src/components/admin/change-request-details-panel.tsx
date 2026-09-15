"use client";

import { type ChangeEvent, useEffect, useMemo, useRef, useState, useTransition } from "react";
import {
  CheckCircle2,
  Circle,
  ExternalLink,
  FileText,
  ImageIcon,
  LoaderCircle,
  PlayCircle,
  RotateCcw,
  Upload,
  X,
} from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Textarea } from "@/components/ui/textarea";
import { describeFetchError, readApiError } from "@/lib/client-api-errors";
import type {
  AgentRunRecord,
  ChangeRequestExecutionRecord,
  ChangeRequestRecord,
  RequestExternalRefRecord,
  RequestArtifactRecord,
  TargetAppRecord,
  TargetEnvironmentRecord,
  WorkflowEventRecord,
  WorkflowRecord,
} from "@/lib/admin";

import {
  describeExecutionStage,
  executionBranchUrl,
  executionDeployUrl,
  formatDurationFrom,
  githubCompareUrl,
  humanHoursLabel,
  isoLabel,
  priorityVariant,
  workflowStepForKey,
  workflowSteps,
  type WorkflowStep,
  type AgentThreadMessage,
  type AgentThreadSession,
} from "./change-request-utils";

function CommandCenter({
  currentWorkflowStepKey,
  workflowRunStatus,
  steps,
  isPending,
  isCancelPending,
  isStepRunning,
  isClosed,
  canRunWorkflowActions,
  onContinue,
  onCancel,
}: {
  currentWorkflowStepKey: string | null;
  workflowRunStatus: string | null;
  steps: WorkflowStep[];
  isPending: boolean;
  isCancelPending: boolean;
  isStepRunning: boolean;
  isClosed: boolean;
  canRunWorkflowActions: boolean;
  onContinue: () => void;
  onCancel: () => void;
}) {
  const currentWorkflowPosition = workflowStepForKey(currentWorkflowStepKey, steps);
  const currentStepIndex = currentWorkflowPosition.index;
  const currentStep = currentWorkflowPosition.step;
  const isRunning = isStepRunning;
  const isCanceled = workflowRunStatus === "canceled";
  const isTerminal = currentStep.type === "terminal" || isClosed;
  const canContinue = canRunWorkflowActions && !isRunning && !isTerminal;
  const canCancel = canRunWorkflowActions && !isTerminal;
  const actionLabel =
    currentStep.type === "checkpoint"
      ? currentStep.resumeLabel ?? `Check ${currentStep.label}`
      : currentStep.type === "loop"
        ? currentStep.resumeLabel ?? `Evaluate ${currentStep.label}`
      : "Continue";

  return (
    <Card className="rounded-none border-border/70 bg-background shadow-none">
      <CardHeader className="space-y-4">
        <div
          className="relative flex flex-col gap-3 md:grid"
          style={{
            gridTemplateColumns:
              steps.length > 1
                ? `repeat(${steps.length}, minmax(0, 1fr))`
                : "minmax(0, 1fr)",
          }}
        >
          <div
            className="absolute top-4 hidden h-px bg-border md:block"
            style={{
              left: `calc(100% / ${steps.length * 2})`,
              right: `calc(100% / ${steps.length * 2})`,
            }}
          />
          <div
            className={`absolute top-4 hidden h-px md:block ${
              isRunning ? "animate-pulse" : ""
            } ${isCanceled ? "bg-destructive" : "bg-primary"}`}
            style={{
              left: `calc(100% / ${steps.length * 2})`,
              width:
                currentStepIndex >= steps.length
                  ? `calc(100% - (100% / ${steps.length}))`
                  : `calc((100% - (100% / ${steps.length})) * ${
                      currentStepIndex / Math.max(1, steps.length - 1)
                    })`,
            }}
          />
          {steps.map((step, index) => {
            const isComplete = !isCanceled && (currentStep.type === "terminal" || currentStepIndex > index);
            const isCurrent = currentStepIndex === index;
            const isCurrentRunning = isCurrent && isRunning;
            const isCurrentCanceled = isCurrent && isCanceled;

            return (
              <div key={step.key} className="relative flex gap-3 md:block">
                {index < steps.length - 1 ? (
                  <div
                    className={`absolute left-4 top-8 h-[calc(100%+0.75rem)] w-px md:hidden ${
                      isCurrentCanceled || (isCanceled && index < currentStepIndex)
                        ? "bg-destructive"
                        : isComplete
                          ? "bg-primary"
                          : "bg-border"
                    }`}
                  />
                ) : null}
                <div className="relative z-10 h-8 w-8 shrink-0 md:mx-auto">
                  {isCurrentRunning ? (
                    <span className="absolute inset-0 rounded-full bg-primary/30 animate-ping" />
                  ) : null}
                  <div
                    className={`relative flex h-8 w-8 items-center justify-center rounded-full border ${
                      isCurrentCanceled
                        ? "border-destructive bg-destructive text-destructive-foreground shadow-[0_0_0_4px_hsl(var(--destructive)/0.18)]"
                        : isComplete
                        ? "border-primary bg-primary text-primary-foreground"
                        : isCurrentRunning
                          ? "border-primary bg-primary text-primary-foreground shadow-[0_0_0_4px_hsl(var(--primary)/0.18)]"
                          : isCurrent
                            ? "border-primary bg-primary/10 text-primary"
                            : "border-border bg-background text-muted-foreground"
                    }`}
                  >
                    {isCurrentCanceled ? (
                      <X className="h-4 w-4" />
                    ) : isComplete ? (
                      <CheckCircle2 className="h-4 w-4" />
                    ) : isCurrentRunning ? (
                      <LoaderCircle className="h-4 w-4 animate-spin" />
                    ) : isCurrent ? (
                      <PlayCircle className="h-4 w-4" />
                    ) : (
                      <Circle className="h-3 w-3" />
                    )}
                  </div>
                </div>
                <div className="min-w-0 md:mt-3 md:text-center">
                  <p
                    className={`text-sm font-medium ${
                      isCurrent ? "text-foreground" : "text-muted-foreground"
                    }`}
                  >
                    {step.label}
                  </p>
                  <p className="text-xs text-muted-foreground">{step.type}</p>
                </div>
              </div>
            );
          })}
        </div>
      </CardHeader>

      <CardContent className="space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <p className="font-medium">{currentStep.label}</p>
              <Badge variant="outline">{currentStep.type}</Badge>
              {isCanceled ? <Badge variant="destructive">canceled</Badge> : null}
            </div>
            <p className="mt-1 text-sm leading-6 text-muted-foreground">
              {isClosed
                ? isCanceled
                  ? "This request was canceled and moved to a terminal step."
                  : "This request is closed."
                : currentStep.type === "agent" && isRunning
                ? "The agent is running this workflow step."
                : currentStep.type === "agent"
                  ? "This workflow step is ready for an agent run."
                  : currentStep.type === "checkpoint"
                    ? "This workflow is paused until an operator checks external state."
                  : currentStep.type === "loop"
                    ? "This workflow is evaluating structured loop state."
                  : currentStep.type === "gate"
                    ? "This workflow step is waiting for a human decision."
                    : currentStep.type === "terminal"
                      ? "This workflow has reached a terminal step."
                      : "This workflow step is active."}
            </p>
            {currentStep.instructionPath ? (
              <p className="mt-1 truncate text-xs text-muted-foreground">
                {currentStep.instructionPath}
              </p>
            ) : null}
          </div>
          {canContinue || canCancel ? (
            <div className="flex flex-wrap justify-end gap-2">
              {canContinue ? (
                <Button type="button" onClick={onContinue} disabled={isPending}>
                  {isPending ? <LoaderCircle className="h-4 w-4 animate-spin" /> : null}
                  {actionLabel}
                </Button>
              ) : null}
              {canCancel ? (
                <Button type="button" variant="destructive" onClick={onCancel} disabled={isCancelPending}>
                  <X className="h-4 w-4" />
                  Cancel workflow
                </Button>
              ) : null}
            </div>
          ) : null}
        </div>

        {isRunning ? (
          <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_auto]">
            <div>
              <p className="font-medium">Step running</p>
              <p className="mt-1 text-sm leading-6 text-muted-foreground">
                Prism is working through the current workflow step. The request
                will move forward when the run completes. Canceling the workflow
                closes the request and marks active runs canceled.
              </p>
            </div>
          </div>
        ) : null}

        {isClosed ? (
          <div>
            <p className="font-medium">Closed</p>
            <p className="mt-1 text-sm leading-6 text-muted-foreground">
              This request is complete.
            </p>
          </div>
        ) : null}

        {!canContinue && !isRunning && !isClosed ? (
          <div>
            <p className="font-medium">{currentStep.label}</p>
            <p className="mt-1 text-sm leading-6 text-muted-foreground">
              {canRunWorkflowActions
                ? currentStep.type === "checkpoint"
                  ? "Add a comment if needed, then check this workflow checkpoint."
                  : "Add a comment if needed, then continue the workflow."
                : "You can view this workflow step, but your role cannot run or approve it."}
            </p>
          </div>
        ) : null}
      </CardContent>
    </Card>
  );
}

function formatBytes(value: number) {
  if (!Number.isFinite(value) || value <= 0) return "0 B";
  const units = ["B", "KB", "MB", "GB"];
  let size = value;
  let index = 0;
  while (size >= 1024 && index < units.length - 1) {
    size /= 1024;
    index += 1;
  }
  return `${size >= 10 || index === 0 ? Math.round(size) : size.toFixed(1)} ${units[index]}`;
}

function artifactPreviewKind(artifact: RequestArtifactRecord) {
  if (artifact.mimeType.startsWith("image/")) return "image";
  if (
    artifact.mimeType.startsWith("text/") ||
    artifact.mimeType.includes("json") ||
    artifact.name.endsWith(".md") ||
    artifact.name.endsWith(".json")
  ) {
    return "text";
  }
  return "raw";
}

function defaultReopenStepKey(steps: WorkflowStep[], currentStepKey: string | null | undefined) {
  const nonTerminalSteps = steps.filter((step) => step.type !== "terminal");
  if (!nonTerminalSteps.length) return "";

  const currentIndex = currentStepKey ? steps.findIndex((step) => step.key === currentStepKey) : -1;
  for (let index = currentIndex - 1; index >= 0; index -= 1) {
    if (steps[index]?.type !== "terminal") {
      return steps[index].key;
    }
  }

  return nonTerminalSteps[0].key;
}

function hasAutoContinuedFlag(value: { meta?: Record<string, unknown>; payload?: Record<string, unknown> }) {
  return value.meta?.autoContinued === true || value.payload?.autoContinued === true;
}

function executionAgentRunId(execution: ChangeRequestExecutionRecord) {
  return stringValue(execution.meta?.agentRunId);
}

function stringValue(value: unknown) {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function agentRunResultString(run: AgentRunRecord | null, key: string) {
  return stringValue(run?.result?.[key]);
}

type WorkflowOutcome = {
  status: "blocked" | "needs_attention" | "completed";
  summary: string | null;
  suggestedFix: string | null;
  blockers: Array<Record<string, unknown>>;
};

function workflowOutcomeFromRun(run: AgentRunRecord | null): WorkflowOutcome | null {
  const value = run?.result?.workflowOutcome;
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const record = value as Record<string, unknown>;
  const rawStatus = stringValue(record.status)?.replace(/-/g, "_");
  if (
    rawStatus !== "blocked" &&
    rawStatus !== "needs_attention" &&
    rawStatus !== "completed"
  ) {
    return null;
  }
  return {
    status: rawStatus,
    summary: stringValue(record.summary),
    suggestedFix:
      stringValue(record.suggestedFix) ?? stringValue(record.suggested_fix),
    blockers: Array.isArray(record.blockers)
      ? record.blockers.filter(
          (blocker): blocker is Record<string, unknown> =>
            Boolean(blocker) && typeof blocker === "object" && !Array.isArray(blocker),
        )
      : [],
  };
}

function workflowOutcomeNeedsAttention(outcome: WorkflowOutcome | null) {
  return outcome?.status === "blocked" || outcome?.status === "needs_attention";
}

function workflowOutcomeLabel(outcome: WorkflowOutcome) {
  return outcome.status === "blocked" ? "Blocked" : "Needs attention";
}

function blockerText(blocker: Record<string, unknown>, key: string) {
  return stringValue(blocker[key]);
}

function agentRunBranchUrl(run: AgentRunRecord | null) {
  return agentRunResultString(run, "branchUrl");
}

function agentRunDeployUrl(
  run: AgentRunRecord | null,
  targetEnvironment?: TargetEnvironmentRecord | null,
) {
  const direct = agentRunResultString(run, "deployUrl");
  if (direct) return direct;

  const staticUrl = agentRunResultString(run, "deployStaticUrl");
  if (staticUrl) return staticUrl.startsWith("http") ? staticUrl : `https://${staticUrl}`;

  const fallback = targetEnvironment?.baseUrl;
  return stringValue(fallback);
}

function latestAgentRunTraceEntry(run: AgentRunRecord | null) {
  const trace = Array.isArray(run?.trace) ? run.trace : [];
  for (let index = trace.length - 1; index >= 0; index -= 1) {
    const entry = trace[index];
    const message = stringValue(entry?.message);
    if (message) {
      return {
        kind: stringValue(entry?.kind) ?? "runtime",
        message,
      };
    }
  }

  return null;
}

function describeAgentRunStage(run: AgentRunRecord | null) {
  if (!run) return "No active agent run";

  if (run.status === "queued") {
    const parts = [`Queued in ${run.lane} lane`];
    if (typeof run.queuePosition === "number" && run.queuePosition > 0) {
      parts.push(`position ${run.queuePosition}`);
    }
    if (run.queueReason) {
      parts.push(run.queueReason);
    }
    return parts.join(" · ");
  }

  const traceEntry = latestAgentRunTraceEntry(run);
  if (traceEntry) {
    return `${traceEntry.kind}: ${traceEntry.message}`;
  }

  const branchName = agentRunResultString(run, "branchName");
  if (branchName) {
    return `Working on branch ${branchName}`;
  }

  return "Agent run started and waiting for runtime updates";
}

type ResponseJobTraceEntry = {
  at?: string;
  kind?: string;
  message?: string;
};

type ResponseJobPollError = Error & {
  transient?: boolean;
};

const transientJobPollStatuses = new Set([408, 429, 502, 503, 504]);

function workflowJobStorageKey(requestId: string) {
  return `prism-change-request-workflow-job-${requestId}`;
}

function createTransientJobPollError(message: string) {
  const error = new Error(message) as ResponseJobPollError;
  error.transient = true;
  return error;
}

function isTransientJobPollError(error: unknown) {
  return (
    error instanceof TypeError && /fetch/i.test(error.message)
  ) || (
    error instanceof Error && Boolean((error as ResponseJobPollError).transient)
  );
}

function safeExternalHref(value: string) {
  try {
    const parsed = new URL(value);
    return ["http:", "https:"].includes(parsed.protocol) ? parsed.toString() : null;
  } catch {
    return null;
  }
}

export function RequestDetailsPanel({
  request,
  targetApp,
  targetEnvironment,
  workflow,
  isPending,
  error,
  canComment = true,
  canRunWorkflowActions = true,
  onSave,
}: {
  request: ChangeRequestRecord;
  targetApp: TargetAppRecord | null;
  targetEnvironment: TargetEnvironmentRecord | null;
  workflow: WorkflowRecord | null;
  isPending: boolean;
  error: string | null;
  canComment?: boolean;
  canRunWorkflowActions?: boolean;
  onSave: (payload: {
    currentWorkflowStepKey?: string | null;
    triageSummary: string;
    agentRecommendation: string;
  }) => void;
}) {
  const configuredBaseBranch =
    targetEnvironment?.branch ?? targetApp?.defaultBranch ?? null;
  const currentWorkflowSteps = useMemo(() => workflowSteps(workflow), [workflow]);
  const [currentWorkflowStepKey, setCurrentWorkflowStepKey] = useState(request.currentWorkflowStepKey);
  const [workflowRunStatus, setWorkflowRunStatus] = useState(request.workflowRunStatus);
  const [workflowAttention, setWorkflowAttention] = useState(request.workflowAttention);
  const currentWorkflowStep = useMemo(
    () => workflowStepForKey(currentWorkflowStepKey, currentWorkflowSteps).step,
    [currentWorkflowStepKey, currentWorkflowSteps],
  );
  const isWorkflowClosed =
    currentWorkflowStep.type === "terminal" ||
    workflowRunStatus === "completed" ||
    workflowRunStatus === "canceled";
  const reopenableWorkflowSteps = useMemo(
    () => currentWorkflowSteps.filter((step) => step.type !== "terminal"),
    [currentWorkflowSteps],
  );
  const defaultReopenTargetStepKey = useMemo(
    () => defaultReopenStepKey(currentWorkflowSteps, currentWorkflowStepKey),
    [currentWorkflowStepKey, currentWorkflowSteps],
  );
  const [triageSummary, setTriageSummary] = useState(
    request.triageSummary ?? "",
  );
  const [agentRecommendation, setAgentRecommendation] = useState(
    request.agentRecommendation ?? "",
  );
  const [manualWorkflowStepKey, setManualWorkflowStepKey] = useState(request.currentWorkflowStepKey ?? "");
  const [threadSession, setThreadSession] = useState<AgentThreadSession | null>(
    null,
  );
  const [threadMessages, setThreadMessages] = useState<AgentThreadMessage[]>(
    [],
  );
  const [commentDraft, setCommentDraft] = useState("");
  const threadScrollAreaRef = useRef<HTMLDivElement>(null);
  const artifactUploadInputRef = useRef<HTMLInputElement>(null);
  const [latestUploadedArtifactName, setLatestUploadedArtifactName] = useState<string | null>(null);
  const [isReopenDialogOpen, setIsReopenDialogOpen] = useState(false);
  const [isCancelDialogOpen, setIsCancelDialogOpen] = useState(false);
  const [reopenStepKey, setReopenStepKey] = useState("");
  const [reopenComment, setReopenComment] = useState("");
  const [cancelComment, setCancelComment] = useState("Cancel this workflow and close the request.");
  const [overrideComment, setOverrideComment] = useState("");
  const [threadError, setThreadError] = useState<string | null>(null);
  const [executions, setExecutions] = useState<ChangeRequestExecutionRecord[]>(
    [],
  );
  const [agentRuns, setAgentRuns] = useState<AgentRunRecord[]>([]);
  const [workflowEvents, setWorkflowEvents] = useState<WorkflowEventRecord[]>(
    [],
  );
  const [artifacts, setArtifacts] = useState<RequestArtifactRecord[]>([]);
  const [externalRefs, setExternalRefs] = useState<RequestExternalRefRecord[]>([]);
  const [selectedArtifact, setSelectedArtifact] = useState<RequestArtifactRecord | null>(null);
  const [artifactPreviewText, setArtifactPreviewText] = useState<string | null>(null);
  const [artifactPreviewError, setArtifactPreviewError] = useState<string | null>(null);
  const [isArtifactPreviewLoading, setIsArtifactPreviewLoading] = useState(false);
  const artifactPreviewRequestRef = useRef(0);
  const [isDraftDirty, setIsDraftDirty] = useState(false);
  const [isCommentPending, startCommentTransition] = useTransition();
  const [isCommandPending, startCommandTransition] = useTransition();
  const [isReopenPending, startReopenTransition] = useTransition();
  const [isOverridePending, startOverrideTransition] = useTransition();
  const [isArtifactUploadPending, startArtifactUploadTransition] = useTransition();
  const [liveNowMs, setLiveNowMs] = useState(() => Date.now());
  const [activeWorkflowJobId, setActiveWorkflowJobId] = useState<string | null>(null);
  const [workflowJobNotice, setWorkflowJobNotice] = useState<string | null>(null);
  const [workflowJobTrace, setWorkflowJobTrace] = useState<ResponseJobTraceEntry[]>([]);

  useEffect(() => {
    setCurrentWorkflowStepKey(request.currentWorkflowStepKey);
    setWorkflowRunStatus(request.workflowRunStatus);
    setWorkflowAttention(request.workflowAttention);
    setTriageSummary(request.triageSummary ?? "");
    setAgentRecommendation(request.agentRecommendation ?? "");
    setManualWorkflowStepKey(request.currentWorkflowStepKey ?? "");
    setIsDraftDirty(false);
  }, [
    request.agentRecommendation,
    request.currentWorkflowStepKey,
    request.id,
    request.triageSummary,
    request.workflowAttention,
    request.workflowRunStatus,
  ]);

  useEffect(() => {
    setReopenStepKey(defaultReopenStepKey(currentWorkflowSteps, request.currentWorkflowStepKey));
    setReopenComment("");
    setIsReopenDialogOpen(false);
    setLatestUploadedArtifactName(null);
    setActiveWorkflowJobId(window.localStorage.getItem(workflowJobStorageKey(request.id)));
    setWorkflowJobNotice(null);
    setWorkflowJobTrace([]);
  }, [request.id]);

  useEffect(() => {
    let cancelled = false;

    async function loadThread() {
      try {
        const response = await fetch(
          `/admin/change-requests/${request.id}/agent-thread`,
          { cache: "no-store" },
        );
        if (!response.ok) {
          throw new Error("Could not load request thread");
        }

        const payload = (await response.json()) as {
          ok?: boolean;
          session?: AgentThreadSession | null;
          messages?: AgentThreadMessage[];
          error?: string;
        };

        if (cancelled) return;
        if (payload.ok === false) {
          throw new Error(payload.error || "Could not load request thread");
        }

        setThreadSession(payload.session ?? null);
        setThreadMessages(
          Array.isArray(payload.messages) ? payload.messages : [],
        );
        setThreadError(null);
      } catch (error) {
        if (!cancelled) {
          setThreadError(
            error instanceof Error
              ? error.message
              : "Could not load request thread",
          );
        }
      }
    }

    loadThread();
    return () => {
      cancelled = true;
    };
  }, [request.id]);

  useEffect(() => {
    const intervalId = window.setInterval(() => {
      setLiveNowMs(Date.now());
    }, 1000);

    return () => {
      window.clearInterval(intervalId);
    };
  }, []);

  useEffect(() => {
    const shouldPollLiveState =
      agentRuns.some((run) => run.status === "queued" || run.status === "running") ||
      executions.some((execution) => execution.status === "running") ||
      isCommandPending ||
      Boolean(activeWorkflowJobId);

    if (!shouldPollLiveState) {
      return;
    }

    let cancelled = false;

    async function pollLiveState() {
      try {
        const [requestResponse, threadResponse, executionResponse, workflowEventResponse, artifactResponse, externalRefResponse] = await Promise.all([
          fetch(`/admin/change-requests/${request.id}`, {
            cache: "no-store",
          }),
          fetch(`/admin/change-requests/${request.id}/agent-thread`, {
            cache: "no-store",
          }),
          fetch(`/admin/change-requests/${request.id}/executions`, {
            cache: "no-store",
          }),
          fetch(`/admin/change-requests/${request.id}/workflow-events`, {
            cache: "no-store",
          }),
          fetch(`/admin/change-requests/${request.id}/artifacts`, {
            cache: "no-store",
          }),
          fetch(`/admin/change-requests/${request.id}/external-refs`, {
            cache: "no-store",
          }),
        ]);

        if (
          !requestResponse.ok ||
          !threadResponse.ok ||
          !executionResponse.ok ||
          !workflowEventResponse.ok ||
          !artifactResponse.ok ||
          !externalRefResponse.ok ||
          cancelled
        ) {
          return;
        }

        const requestPayload = (await requestResponse.json()) as {
          changeRequest?: ChangeRequestRecord;
        };
        const threadPayload = (await threadResponse.json()) as {
          session?: AgentThreadSession | null;
          messages?: AgentThreadMessage[];
        };
        const executionPayload = (await executionResponse.json()) as {
          legacyExecutions?: ChangeRequestExecutionRecord[];
          executions?: ChangeRequestExecutionRecord[];
          agentRuns?: AgentRunRecord[];
        };
        const workflowEventPayload = (await workflowEventResponse.json()) as {
          events?: WorkflowEventRecord[];
        };
        const artifactPayload = (await artifactResponse.json()) as {
          artifacts?: RequestArtifactRecord[];
        };
        const externalRefPayload = (await externalRefResponse.json()) as {
          externalRefs?: RequestExternalRefRecord[];
        };

        if (cancelled) return;

        if (requestPayload.changeRequest) {
          setCurrentWorkflowStepKey(requestPayload.changeRequest.currentWorkflowStepKey);
          setWorkflowRunStatus(requestPayload.changeRequest.workflowRunStatus);
          setWorkflowAttention(requestPayload.changeRequest.workflowAttention);
          setTriageSummary(requestPayload.changeRequest.triageSummary ?? "");
          setAgentRecommendation(requestPayload.changeRequest.agentRecommendation ?? "");
          setManualWorkflowStepKey(requestPayload.changeRequest.currentWorkflowStepKey ?? "");
        }
        setThreadSession(threadPayload.session ?? null);
        setThreadMessages(
          Array.isArray(threadPayload.messages) ? threadPayload.messages : [],
        );
        setExecutions(
          Array.isArray(executionPayload.legacyExecutions)
            ? executionPayload.legacyExecutions
            : Array.isArray(executionPayload.executions)
              ? executionPayload.executions
              : [],
        );
        setAgentRuns(
          Array.isArray(executionPayload.agentRuns)
            ? executionPayload.agentRuns
            : [],
        );
        setWorkflowEvents(
          Array.isArray(workflowEventPayload.events)
            ? workflowEventPayload.events
            : [],
        );
        setArtifacts(
          Array.isArray(artifactPayload.artifacts)
            ? artifactPayload.artifacts
            : [],
        );
        setExternalRefs(
          Array.isArray(externalRefPayload.externalRefs)
            ? externalRefPayload.externalRefs
            : [],
        );
      } catch {
        // Keep the current panel state and try again on the next interval.
      }
    }

    pollLiveState();
    const intervalId = window.setInterval(pollLiveState, 2500);
    return () => {
      cancelled = true;
      window.clearInterval(intervalId);
    };
  }, [activeWorkflowJobId, agentRuns, executions, isCommandPending, request.id]);

  useEffect(() => {
    const scrollArea = threadScrollAreaRef.current;
    if (!scrollArea) return;
    const frameId = window.requestAnimationFrame(() => {
      const viewport = scrollArea.querySelector<HTMLDivElement>(
        "[data-slot='scroll-area-viewport']",
      );
      if (!viewport) return;
      viewport.scrollTo({ top: viewport.scrollHeight, behavior: "smooth" });
    });
    return () => window.cancelAnimationFrame(frameId);
  }, [request.id, threadMessages.length]);

  const activeExecution = useMemo(
    () =>
      executions.find((execution) => execution.status === "running") ?? null,
    [executions],
  );
  const activeAgentRun = useMemo(
    () =>
      agentRuns.find((run) => run.status === "queued" || run.status === "running") ?? null,
    [agentRuns],
  );
  const latestAttentionOutcome = workflowAttention;
  const legacyOnlyExecutions = useMemo(
    () => executions.filter((execution) => !executionAgentRunId(execution)),
    [executions],
  );
  const activeRunElapsed = formatDurationFrom(
    activeAgentRun?.startedAt ?? activeAgentRun?.claimedAt ?? activeAgentRun?.queuedAt ?? activeAgentRun?.createdAt ?? null,
    liveNowMs,
  );
  const activeAgentRunStage = describeAgentRunStage(activeAgentRun);
  const activeAgentRunBranchName = agentRunResultString(activeAgentRun, "branchName");
  const activeAgentRunBranchUrl = agentRunBranchUrl(activeAgentRun);
  const activeAgentRunDeployUrl = agentRunDeployUrl(activeAgentRun, targetEnvironment);
  const activeAgentRunPrUrl = githubCompareUrl(
    targetApp,
    agentRunResultString(activeAgentRun, "baseBranch") ?? configuredBaseBranch,
    activeAgentRunBranchName,
  );
  const activeExecutionElapsed = formatDurationFrom(
    activeExecution?.startedAt ?? null,
    liveNowMs,
  );
  const activeExecutionStage = describeExecutionStage(activeExecution);
  const activeExecutionBranchUrl = executionBranchUrl(activeExecution);
  const activeExecutionDeployUrl = executionDeployUrl(
    activeExecution,
    targetEnvironment,
  );
  const activeExecutionPrUrl = githubCompareUrl(
    targetApp,
    (typeof activeExecution?.meta?.baseBranch === "string"
      ? activeExecution.meta.baseBranch
      : null) ?? configuredBaseBranch,
    activeExecution?.branchName ?? null,
  );
  const visibleWorkflowJobTrace = workflowJobTrace
    .filter((entry) => entry.message?.trim())
    .slice(-5);
  const lifecycleEvents = useMemo(
    () =>
      [
        { label: "Last Updated", value: request.updatedAt },
        { label: "Closed", value: request.closedAt },
        { label: "Completed", value: request.completedAt },
        { label: "Approved For Work", value: request.approvedForWorkAt },
        { label: "Triaged", value: request.triagedAt },
        { label: "Created", value: request.createdAt },
      ].sort((left, right) => {
        const leftTime = left.value ? new Date(left.value).getTime() : 0;
        const rightTime = right.value ? new Date(right.value).getTime() : 0;
        return (
          (Number.isNaN(rightTime) ? 0 : rightTime) -
          (Number.isNaN(leftTime) ? 0 : leftTime)
        );
      }),
    [
      request.approvedForWorkAt,
      request.closedAt,
      request.completedAt,
      request.createdAt,
      request.triagedAt,
      request.updatedAt,
    ],
  );

  useEffect(() => {
    let cancelled = false;

    async function loadExecutions() {
      try {
        const response = await fetch(
          `/admin/change-requests/${request.id}/executions`,
          { cache: "no-store" },
        );
        if (!response.ok) {
          throw new Error("Could not load execution log");
        }

        const payload = (await response.json()) as {
          ok?: boolean;
          legacyExecutions?: ChangeRequestExecutionRecord[];
          executions?: ChangeRequestExecutionRecord[];
          agentRuns?: AgentRunRecord[];
          error?: string;
        };

        if (cancelled) return;
        if (payload.ok === false) {
          throw new Error(payload.error || "Could not load execution log");
        }

        setExecutions(
          Array.isArray(payload.legacyExecutions)
            ? payload.legacyExecutions
            : Array.isArray(payload.executions)
              ? payload.executions
              : [],
        );
        setAgentRuns(Array.isArray(payload.agentRuns) ? payload.agentRuns : []);
      } catch (error) {
        if (!cancelled) {
          setThreadError(
            (current) =>
              current ??
              (error instanceof Error
                ? error.message
                : "Could not load execution log"),
          );
        }
      }
    }

    loadExecutions();
    return () => {
      cancelled = true;
    };
  }, [request.id]);

  useEffect(() => {
    let cancelled = false;

    async function loadWorkflowEvents() {
      try {
        const response = await fetch(
          `/admin/change-requests/${request.id}/workflow-events`,
          { cache: "no-store" },
        );
        if (!response.ok) {
          throw new Error("Could not load workflow events");
        }

        const payload = (await response.json()) as {
          ok?: boolean;
          events?: WorkflowEventRecord[];
          error?: string;
        };

        if (cancelled) return;
        if (payload.ok === false) {
          throw new Error(payload.error || "Could not load workflow events");
        }

        setWorkflowEvents(Array.isArray(payload.events) ? payload.events : []);
      } catch (error) {
        if (!cancelled) {
          setThreadError(
            (current) =>
              current ??
              (error instanceof Error
                ? error.message
                : "Could not load workflow events"),
          );
        }
      }
    }

    loadWorkflowEvents();
    return () => {
      cancelled = true;
    };
  }, [request.id]);

  useEffect(() => {
    let cancelled = false;

    async function loadArtifacts() {
      try {
        const response = await fetch(
          `/admin/change-requests/${request.id}/artifacts`,
          { cache: "no-store" },
        );
        if (!response.ok) {
          throw new Error("Could not load request artifacts");
        }

        const payload = (await response.json()) as {
          ok?: boolean;
          artifacts?: RequestArtifactRecord[];
          error?: string;
        };

        if (cancelled) return;
        if (payload.ok === false) {
          throw new Error(payload.error || "Could not load request artifacts");
        }

        setArtifacts(Array.isArray(payload.artifacts) ? payload.artifacts : []);
      } catch (error) {
        if (!cancelled) {
          setThreadError(
            (current) =>
              current ??
              (error instanceof Error
                ? error.message
                : "Could not load request artifacts"),
          );
        }
      }
    }

    loadArtifacts();
    return () => {
      cancelled = true;
    };
  }, [request.id]);

  useEffect(() => {
    let cancelled = false;

    async function loadExternalRefs() {
      try {
        const response = await fetch(
          `/admin/change-requests/${request.id}/external-refs`,
          { cache: "no-store" },
        );
        if (!response.ok) {
          throw new Error("Could not load linked records");
        }
        const payload = (await response.json()) as {
          ok?: boolean;
          externalRefs?: RequestExternalRefRecord[];
          error?: string;
        };
        if (cancelled) return;
        if (payload.ok === false) {
          throw new Error(payload.error || "Could not load linked records");
        }
        setExternalRefs(Array.isArray(payload.externalRefs) ? payload.externalRefs : []);
      } catch {
        if (!cancelled) {
          setThreadError((current) => current ?? "Could not load linked records");
        }
      }
    }

    loadExternalRefs();
    return () => {
      cancelled = true;
    };
  }, [request.id]);

  async function refreshThread() {
    const response = await fetch(
      `/admin/change-requests/${request.id}/agent-thread`,
      { cache: "no-store" },
    );
    if (!response.ok) {
      throw new Error("Could not refresh request thread");
    }

    const payload = (await response.json()) as {
      session?: AgentThreadSession | null;
      messages?: AgentThreadMessage[];
    };
    setThreadSession(payload.session ?? null);
    setThreadMessages(Array.isArray(payload.messages) ? payload.messages : []);
  }

  async function refreshExecutions() {
    const response = await fetch(
      `/admin/change-requests/${request.id}/executions`,
      { cache: "no-store" },
    );
    if (!response.ok) {
      throw new Error("Could not refresh execution log");
    }

    const payload = (await response.json()) as {
      legacyExecutions?: ChangeRequestExecutionRecord[];
      executions?: ChangeRequestExecutionRecord[];
      agentRuns?: AgentRunRecord[];
    };
    setExecutions(
      Array.isArray(payload.legacyExecutions)
        ? payload.legacyExecutions
        : Array.isArray(payload.executions)
          ? payload.executions
          : [],
    );
    setAgentRuns(Array.isArray(payload.agentRuns) ? payload.agentRuns : []);
  }

  async function refreshWorkflowEvents() {
    const response = await fetch(
      `/admin/change-requests/${request.id}/workflow-events`,
      { cache: "no-store" },
    );
    if (!response.ok) {
      throw new Error("Could not refresh workflow events");
    }

    const payload = (await response.json()) as {
      events?: WorkflowEventRecord[];
    };
    setWorkflowEvents(Array.isArray(payload.events) ? payload.events : []);
  }

  async function refreshArtifacts() {
    const response = await fetch(
      `/admin/change-requests/${request.id}/artifacts`,
      { cache: "no-store" },
    );
    if (!response.ok) {
      throw new Error("Could not refresh request artifacts");
    }

    const payload = (await response.json()) as {
      artifacts?: RequestArtifactRecord[];
    };
    setArtifacts(Array.isArray(payload.artifacts) ? payload.artifacts : []);
  }

  async function refreshPanelState() {
    await Promise.all([
      refreshThread(),
      refreshExecutions(),
      refreshWorkflowEvents(),
      refreshArtifacts(),
    ]);
  }

  useEffect(() => {
    if (!activeWorkflowJobId) return;

    let cancelled = false;
    let timeoutId: number | null = null;
    let transientFailureCount = 0;

    async function pollWorkflowJob() {
      try {
        const response = await fetch(`/admin/console/jobs/${encodeURIComponent(activeWorkflowJobId!)}`, {
          cache: "no-store",
        });
        if (!response.ok) {
          if (transientJobPollStatuses.has(response.status)) {
            throw createTransientJobPollError(`Workflow job poll returned HTTP ${response.status}`);
          }
          throw new Error(await readApiError(response, "Could not load workflow job"));
        }

        const payload = (await response.json()) as {
          ok?: boolean;
          job?: {
            id: string;
            status: string;
            sessionId?: string | null;
            errorMessage?: string | null;
            trace?: ResponseJobTraceEntry[];
          };
        };
        if (cancelled) return;

        const job = payload.job;
        if (!job) {
          throw new Error("Workflow job response did not include a job");
        }

        transientFailureCount = 0;
        setWorkflowJobNotice("Workflow step is running. This page can stay open while Prism works.");
        setWorkflowJobTrace(Array.isArray(job.trace) ? job.trace.slice(-8) : []);
        if (job.sessionId) {
          setThreadSession({ id: job.sessionId });
        }

        if (job.status === "succeeded") {
          window.localStorage.removeItem(workflowJobStorageKey(request.id));
          setActiveWorkflowJobId(null);
          setWorkflowJobTrace([]);
          setWorkflowJobNotice(null);
          setThreadError(null);
          await refreshPanelState();
          return;
        }

        if (job.status === "failed" || job.status === "canceled") {
          window.localStorage.removeItem(workflowJobStorageKey(request.id));
          setActiveWorkflowJobId(null);
          setWorkflowJobTrace([]);
          setWorkflowJobNotice(null);
          setThreadError(job.errorMessage || `Workflow job ${job.status}`);
          await refreshPanelState().catch(() => undefined);
          return;
        }
      } catch (pollError) {
        if (cancelled) return;
        if (isTransientJobPollError(pollError)) {
          transientFailureCount += 1;
          const retryDelayMs = Math.min(15_000, 1500 + transientFailureCount * 1000);
          setWorkflowJobNotice(
            transientFailureCount === 1
              ? "Workflow status connection was interrupted. Prism may still be working; retrying status..."
              : `Workflow status is still retrying. Next check in ${Math.ceil(retryDelayMs / 1000)} seconds.`,
          );
          timeoutId = window.setTimeout(pollWorkflowJob, retryDelayMs);
          return;
        }

        window.localStorage.removeItem(workflowJobStorageKey(request.id));
        setActiveWorkflowJobId(null);
        setWorkflowJobNotice(null);
        setThreadError(describeFetchError(pollError, "Could not continue agent"));
        return;
      }

      if (!cancelled) {
        timeoutId = window.setTimeout(pollWorkflowJob, 1500);
      }
    }

    void pollWorkflowJob();
    return () => {
      cancelled = true;
      if (timeoutId) {
        window.clearTimeout(timeoutId);
      }
    };
  }, [activeWorkflowJobId, request.id]);

  async function openArtifactPreview(artifact: RequestArtifactRecord) {
    const requestToken = artifactPreviewRequestRef.current + 1;
    artifactPreviewRequestRef.current = requestToken;
    setSelectedArtifact(artifact);
    setArtifactPreviewText(null);
    setArtifactPreviewError(null);
    const kind = artifactPreviewKind(artifact);
    if (kind !== "text") {
      setIsArtifactPreviewLoading(false);
      return;
    }

    setIsArtifactPreviewLoading(true);
    try {
      const response = await fetch(
        `/admin/change-requests/${request.id}/artifacts/${artifact.id}/content`,
        { cache: "no-store" },
      );
      if (!response.ok) {
        throw new Error("Could not load artifact preview");
      }
      const text = await response.text();
      if (artifactPreviewRequestRef.current !== requestToken) return;
      setArtifactPreviewText(text);
    } catch (error) {
      if (artifactPreviewRequestRef.current !== requestToken) return;
      setArtifactPreviewError(
        error instanceof Error ? error.message : "Could not load artifact preview",
      );
    } finally {
      if (artifactPreviewRequestRef.current === requestToken) {
        setIsArtifactPreviewLoading(false);
      }
    }
  }

  async function addRequestComment(content: string) {
    const response = await fetch(
      `/admin/change-requests/${request.id}/comments`,
      {
        method: "POST",
        headers: {
          "content-type": "application/json",
        },
        body: JSON.stringify({ content }),
      },
    );

    const payload = (await response.json()) as {
      ok?: boolean;
      error?: string;
      session?: AgentThreadSession | null;
      messages?: AgentThreadMessage[];
    };

    if (!response.ok || payload.ok === false) {
      throw new Error(payload.error || "Could not add comment");
    }

    setThreadSession(payload.session ?? threadSession);
    setThreadMessages(Array.isArray(payload.messages) ? payload.messages : []);
    return payload.session ?? threadSession;
  }

  async function runAgent(
    prompt: string,
    session?: AgentThreadSession | null,
    workflowAction?: string,
  ) {
    const response = await fetch("/admin/console/jobs", {
      method: "POST",
      headers: {
        "content-type": "application/json",
      },
      body: JSON.stringify({
        input: [{ role: "user", content: prompt }],
        session_id: session?.id ?? threadSession?.id ?? null,
        linked_change_request_id: request.id,
        linked_target_environment_id: request.targetEnvironmentId,
        workflow_action: workflowAction ?? null,
      }),
    });

    if (!response.ok) {
      throw new Error(await readApiError(response, "Could not continue agent"));
    }

    const payload = (await response.json().catch(() => null)) as {
      error?: string;
      jobId?: string;
      session_id?: string;
    } | null;

    if (!payload?.jobId) {
      throw new Error("Workflow job endpoint did not return jobId");
    }
    if (payload?.session_id) {
      setThreadSession({ id: payload.session_id });
    }
    window.localStorage.setItem(workflowJobStorageKey(request.id), payload.jobId);
    setWorkflowJobTrace([]);
    setWorkflowJobNotice("Workflow step started. Prism will keep working even if the browser connection drops.");
    setActiveWorkflowJobId(payload.jobId);
    await refreshPanelState();
  }

  function handleAddComment() {
    const content = commentDraft.trim();
    if (!content) return;

    setThreadError(null);
    startCommentTransition(async () => {
      try {
        await addRequestComment(content);
        setCommentDraft("");
      } catch (error) {
        setThreadError(
          error instanceof Error ? error.message : "Could not add comment",
        );
      }
    });
  }

  function handleArtifactUploadChange(event: ChangeEvent<HTMLInputElement>) {
    const input = event.currentTarget;
    const file = input.files?.[0];
    if (!file) return;

    setThreadError(null);
    startArtifactUploadTransition(async () => {
      try {
        const formData = new FormData();
        formData.append("file", file);
        formData.append("kind", "upload");

        const response = await fetch(`/admin/change-requests/${request.id}/artifacts/upload`, {
          method: "POST",
          body: formData,
        });
        const payload = (await response.json()) as {
          ok?: boolean;
          error?: string;
        };
        if (!response.ok || payload.ok === false) {
          throw new Error(payload.error || "Could not upload artifact");
        }

        setLatestUploadedArtifactName(file.name);
        await refreshArtifacts();
      } catch (error) {
        setThreadError(error instanceof Error ? error.message : "Could not upload artifact");
      } finally {
        input.value = "";
      }
    });
  }

  function handleContinueWorkflow() {
    const latestComment =
      [...threadMessages]
        .reverse()
        .find(
          (message) =>
            message.source === "site-comment" && message.content.trim(),
        )
        ?.content.trim() ?? null;

    const prompt = [
      `Continue workflow step ${currentWorkflowStep.key} for request #${request.requestNumber}: ${request.title}.`,
      `Workflow step label: ${currentWorkflowStep.label}.`,
      latestComment
        ? `Most recent comment to consider: ${latestComment}`
        : "No new admin comment was provided; continue from the existing request context and thread history.",
      currentWorkflowStep.type === "gate"
        ? "This step is a human gate. Treat comments as operator context, record the continue event, and move to the normal next workflow step if one exists."
        : currentWorkflowStep.type === "checkpoint"
          ? "This step is a checkpoint. Reconcile existing external state and durable artifacts before doing anything new. Do not start duplicate jobs. If the external state is still waiting, leave the request on this checkpoint and summarize what is pending. If it is ready for the next step, say which step should run next and why."
          : "Use the latest request context and comments, run the current workflow step, update the request state if appropriate, and leave a concise summary comment.",
    ].join("\n");

    setThreadError(null);
    startCommandTransition(async () => {
      try {
        await runAgent(prompt, null, undefined);
      } catch (error) {
        setThreadError(
          describeFetchError(error, "Could not continue agent"),
        );
      }
    });
  }

  function handleOverrideAttention() {
    if (!workflowAttention || !overrideComment.trim()) return;
    setThreadError(null);
    startOverrideTransition(async () => {
      try {
        const response = await fetch(
          `/admin/change-requests/${request.id}/workflow/blockers/override`,
          {
            method: "POST",
            headers: {
              "content-type": "application/json",
            },
            body: JSON.stringify({
              comment: overrideComment.trim(),
              blockerKeys: workflowAttention.blockers
                .map((blocker) => blockerText(blocker, "key"))
                .filter((key): key is string => Boolean(key)),
            }),
          },
        );
        const payload = (await response.json()) as {
          ok?: boolean;
          error?: string;
          changeRequest?: ChangeRequestRecord;
        };
        if (!response.ok || payload.ok === false) {
          throw new Error(payload.error || "Could not override blocker");
        }
        setOverrideComment("");
        setWorkflowAttention(payload.changeRequest?.workflowAttention ?? null);
        if (payload.changeRequest) {
          setCurrentWorkflowStepKey(payload.changeRequest.currentWorkflowStepKey);
          setWorkflowRunStatus(payload.changeRequest.workflowRunStatus);
        }
        await refreshExecutions();
        await refreshWorkflowEvents();
      } catch (error) {
        setThreadError(error instanceof Error ? error.message : "Could not override blocker");
      }
    });
  }

  function handleOpenCancelWorkflowDialog() {
    setCancelComment((current) => current || "Cancel this workflow and close the request.");
    setIsCancelDialogOpen(true);
  }

  function handleCancelWorkflow() {
    setThreadError(null);
    startCommandTransition(async () => {
      try {
        const response = await fetch(
          `/admin/change-requests/${request.id}/workflow/cancel`,
          {
            method: "POST",
            headers: {
              "content-type": "application/json",
            },
            body: JSON.stringify({
              comment: cancelComment.trim(),
            }),
          },
        );
        const payload = (await response.json().catch(() => null)) as {
          ok?: boolean;
          error?: string;
          changeRequest?: ChangeRequestRecord;
        } | null;
        if (!response.ok || payload?.ok === false) {
          throw new Error(payload?.error || "Could not cancel workflow");
        }
        if (payload?.changeRequest) {
          setCurrentWorkflowStepKey(payload.changeRequest.currentWorkflowStepKey);
          setWorkflowRunStatus(payload.changeRequest.workflowRunStatus);
          setManualWorkflowStepKey(payload.changeRequest.currentWorkflowStepKey ?? "");
        }
        setIsCancelDialogOpen(false);
        setCancelComment("Cancel this workflow and close the request.");
        await refreshPanelState();
      } catch (error) {
        setThreadError(error instanceof Error ? error.message : "Could not cancel workflow");
      }
    });
  }

  function handleSaveManualStatus() {
    const nextStep = currentWorkflowSteps.find((step) => step.key === manualWorkflowStepKey);
    if (!nextStep) return;
    if (activeAgentRun) {
      setThreadError("Cancel the active agent run before changing workflow steps.");
      return;
    }
    setCurrentWorkflowStepKey(manualWorkflowStepKey || null);
    setIsDraftDirty(false);
    onSave({
      currentWorkflowStepKey: manualWorkflowStepKey || null,
      triageSummary,
      agentRecommendation,
    });
  }

  function handleManualWorkflowStepChange(nextStepKey: string) {
    setManualWorkflowStepKey(nextStepKey);
  }

  function handleOpenReopenDialog() {
    setReopenStepKey(defaultReopenTargetStepKey);
    setIsReopenDialogOpen(true);
  }

  function handleReopenRequest() {
    const targetStep = reopenableWorkflowSteps.find((step) => step.key === reopenStepKey);
    if (!targetStep) return;

    setThreadError(null);
    startReopenTransition(async () => {
      try {
        const response = await fetch(`/admin/change-requests/${request.id}/reopen`, {
          method: "POST",
          headers: {
            "content-type": "application/json",
          },
          body: JSON.stringify({
            targetStepKey: reopenStepKey,
            comment: reopenComment.trim(),
          }),
        });
        const payload = (await response.json()) as {
          ok?: boolean;
          error?: string;
          changeRequest?: ChangeRequestRecord;
        };
        if (!response.ok || payload.ok === false) {
          throw new Error(payload.error || "Could not reopen request");
        }
        if (payload.changeRequest) {
          setCurrentWorkflowStepKey(payload.changeRequest.currentWorkflowStepKey);
          setWorkflowRunStatus(payload.changeRequest.workflowRunStatus);
          setManualWorkflowStepKey(payload.changeRequest.currentWorkflowStepKey ?? "");
        }
        setReopenComment("");
        setIsReopenDialogOpen(false);
        await refreshThread();
        await refreshExecutions();
        await refreshWorkflowEvents();
        await refreshArtifacts();
      } catch (error) {
        setThreadError(error instanceof Error ? error.message : "Could not reopen request");
      }
    });
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex-1 p-5 md:p-6">
        <div className="space-y-6">
          <CommandCenter
            currentWorkflowStepKey={currentWorkflowStepKey}
            workflowRunStatus={workflowRunStatus}
            steps={currentWorkflowSteps}
            isPending={isPending || isCommandPending || Boolean(activeWorkflowJobId)}
            isCancelPending={isCommandPending}
            isStepRunning={Boolean(activeAgentRun)}
            isClosed={isWorkflowClosed}
            canRunWorkflowActions={canRunWorkflowActions}
            onContinue={handleContinueWorkflow}
            onCancel={handleOpenCancelWorkflowDialog}
          />
          {workflowJobNotice ? (
            <div className="rounded-none border border-border/70 bg-muted/30 px-4 py-3 text-sm text-muted-foreground">
              <div>{workflowJobNotice}</div>
              {visibleWorkflowJobTrace.length > 0 ? (
                <div className="mt-2 space-y-1 font-mono text-xs">
                  {visibleWorkflowJobTrace.map((entry, index) => (
                    <div key={`${entry.at ?? "trace"}-${index}`}>
                      {entry.message}
                    </div>
                  ))}
                </div>
              ) : null}
            </div>
          ) : null}
          {latestAttentionOutcome ? (
            <div className="rounded-none border border-amber-400/70 bg-amber-50/90 px-4 py-3 text-sm text-amber-950">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div className="flex items-center gap-2">
                  <Badge variant="outline" className="border-amber-500/70 text-amber-950">
                    {workflowOutcomeLabel(latestAttentionOutcome)}
                  </Badge>
                  {latestAttentionOutcome.workflowStepKey ? (
                    <span className="font-medium">
                      {latestAttentionOutcome.workflowStepKey}
                    </span>
                  ) : null}
                </div>
                <span className="text-xs text-amber-900/75">
                  Run {latestAttentionOutcome.agentRunId}
                </span>
              </div>
              {latestAttentionOutcome.summary ? (
                <p className="mt-3 leading-6">{latestAttentionOutcome.summary}</p>
              ) : null}
              {latestAttentionOutcome.suggestedFix ? (
                <p className="mt-2 leading-6">
                  <span className="font-medium">Suggested fix:</span>{" "}
                  {latestAttentionOutcome.suggestedFix}
                </p>
              ) : null}
              {latestAttentionOutcome.blockers.length ? (
                <div className="mt-3 space-y-2">
                  {latestAttentionOutcome.blockers.map((blocker, index) => {
                    const key = blockerText(blocker, "key") ?? `blocker-${index + 1}`;
                    const severity = blockerText(blocker, "severity");
                    const reason = blockerText(blocker, "reason");
                    const suggestedFix =
                      blockerText(blocker, "suggestedFix") ?? blockerText(blocker, "suggested_fix");
                    return (
                      <div
                        key={`${key}-${index}`}
                        className="rounded-none border border-amber-300/70 bg-amber-100/60 px-3 py-2"
                      >
                        <div className="flex flex-wrap items-center gap-2">
                          <span className="font-medium">{key}</span>
                          {severity ? (
                            <Badge variant="outline" className="border-amber-500/70 text-amber-950">
                              {severity}
                            </Badge>
                          ) : null}
                        </div>
                        {reason ? <p className="mt-1 leading-6">{reason}</p> : null}
                        {suggestedFix ? (
                          <p className="mt-1 leading-6">
                            <span className="font-medium">Fix:</span> {suggestedFix}
                          </p>
                        ) : null}
                      </div>
                    );
                  })}
                </div>
              ) : null}
              {canRunWorkflowActions ? (
                <div className="mt-3 space-y-2">
                  <Label htmlFor="workflow-attention-override">
                    Override comment
                  </Label>
                  <Textarea
                    id="workflow-attention-override"
                    value={overrideComment}
                    onChange={(event) => setOverrideComment(event.target.value)}
                    placeholder="Explain why it is safe to continue or how you resolved this blocker."
                    className="min-h-[76px] border-amber-300 bg-amber-50/40"
                  />
                  <div className="flex flex-wrap items-center gap-2">
                    <Button
                      type="button"
                      variant="outline"
                      onClick={handleOverrideAttention}
                      disabled={isOverridePending || !overrideComment.trim()}
                      className="border-amber-500/70 text-amber-950 hover:bg-amber-100"
                    >
                      Continue anyway
                    </Button>
                    <span className="text-xs text-amber-900/75">
                      This records an audit event and clears the current attention state.
                    </span>
                  </div>
                </div>
              ) : null}
            </div>
          ) : null}
          {error || threadError ? (
            <div className="rounded-none border border-destructive/30 bg-destructive/5 px-4 py-3 text-sm text-destructive">
              {error ?? threadError}
            </div>
          ) : isDraftDirty ? (
            <div className="rounded-none border border-border/70 bg-muted/30 px-4 py-3 text-sm text-muted-foreground">
              Unsaved changes
            </div>
          ) : null}
          <Card className="border-border/60 bg-card/90 rounded-none">
            <CardHeader>
              <CardTitle>Comment</CardTitle>
              <CardDescription>
                Add context for the next continue run. The agent reads the request thread and latest comments.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              {canComment ? (
                <div className="space-y-2">
                  <Label htmlFor="request-comment-primary">Comment</Label>
                  <Textarea
                    id="request-comment-primary"
                    value={commentDraft}
                    onChange={(event) => setCommentDraft(event.target.value)}
                    placeholder="Leave review feedback, approval context, or a clarification before continuing."
                    className="min-h-24"
                  />
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <input
                      ref={artifactUploadInputRef}
                      type="file"
                      className="hidden"
                      onChange={handleArtifactUploadChange}
                    />
                    <div className="flex min-w-0 flex-wrap items-center gap-2">
                      <Button
                        type="button"
                        variant="outline"
                        onClick={() => artifactUploadInputRef.current?.click()}
                        disabled={isArtifactUploadPending}
                      >
                        {isArtifactUploadPending ? (
                          <LoaderCircle className="h-4 w-4 animate-spin" />
                        ) : (
                          <Upload className="h-4 w-4" />
                        )}
                        {isArtifactUploadPending ? "Uploading" : "Upload artifact"}
                      </Button>
                      {latestUploadedArtifactName ? (
                        <span className="max-w-full truncate text-xs text-muted-foreground sm:max-w-64">
                          Uploaded: {latestUploadedArtifactName}
                        </span>
                      ) : null}
                    </div>
                    <Button
                      type="button"
                      variant="outline"
                      onClick={handleAddComment}
                      disabled={isCommentPending || !commentDraft.trim()}
                    >
                      {isCommentPending ? (
                        <LoaderCircle className="h-4 w-4 animate-spin" />
                      ) : null}
                      {isCommentPending ? "Saving" : "Add comment"}
                    </Button>
                  </div>
                </div>
              ) : (
                <p className="text-sm text-muted-foreground">
                  Your role can view comments but cannot add new ones.
                </p>
              )}
              {canRunWorkflowActions ? (
                <div className="border-t border-border/70 pt-4">
                  {isWorkflowClosed ? (
                    <div className="flex flex-wrap items-center justify-between gap-3">
                      <div>
                        <p className="text-sm font-medium">Closed request</p>
                        <p className="mt-1 text-sm text-muted-foreground">
                          Reopen explicitly to move this request back into a workflow step.
                        </p>
                      </div>
                      <Button
                        type="button"
                        variant="outline"
                        onClick={handleOpenReopenDialog}
                        disabled={isReopenPending || !reopenableWorkflowSteps.length}
                      >
                        {isReopenPending ? (
                          <LoaderCircle className="h-4 w-4 animate-spin" />
                        ) : (
                          <RotateCcw className="h-4 w-4" />
                        )}
                        Reopen
                      </Button>
                    </div>
                  ) : (
                    <>
                      <Label htmlFor="manual-workflow-step">Move to workflow step</Label>
                      <div className="mt-2 flex flex-wrap items-center gap-3">
                        <Select value={manualWorkflowStepKey} onValueChange={handleManualWorkflowStepChange}>
                          <SelectTrigger
                            id="manual-workflow-step"
                            className="w-full border border-input shadow-sm sm:w-[360px]"
                          >
                            <SelectValue placeholder="Select workflow step" />
                          </SelectTrigger>
                          <SelectContent>
                            {currentWorkflowSteps.map((step) => (
                              <SelectItem key={step.key} value={step.key}>
                                {step.label}
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                        <Button
                          type="button"
                          size="icon"
                          onClick={handleSaveManualStatus}
                          disabled={
                            isPending ||
                            (manualWorkflowStepKey || null) === currentWorkflowStepKey
                          }
                          aria-label="Save workflow step"
                          title="Save workflow step"
                        >
                          {isPending ? (
                            <LoaderCircle className="h-4 w-4 animate-spin" />
                          ) : (
                            <CheckCircle2 className="h-4 w-4" />
                          )}
                        </Button>
                      </div>
                    </>
                  )}
                </div>
              ) : null}
            </CardContent>
          </Card>
          <Dialog open={isReopenDialogOpen} onOpenChange={setIsReopenDialogOpen}>
            <DialogContent>
              <DialogHeader>
                <DialogTitle>Reopen request</DialogTitle>
                <DialogDescription>
                  Choose the workflow step to resume from. Agent steps will start automatically after reopening.
                </DialogDescription>
              </DialogHeader>
              <div className="space-y-4">
                <div className="space-y-2">
                  <Label htmlFor="reopen-workflow-step">Workflow step</Label>
                  <Select value={reopenStepKey} onValueChange={setReopenStepKey}>
                    <SelectTrigger id="reopen-workflow-step" className="border border-input shadow-sm">
                      <SelectValue placeholder="Select workflow step" />
                    </SelectTrigger>
                    <SelectContent>
                      {reopenableWorkflowSteps.map((step) => (
                        <SelectItem key={step.key} value={step.key}>
                          {step.label}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-2">
                  <Label htmlFor="reopen-comment">Comment</Label>
                  <Textarea
                    id="reopen-comment"
                    value={reopenComment}
                    onChange={(event) => setReopenComment(event.target.value)}
                    placeholder="Explain why this request is being reopened and what the next step should consider."
                    className="min-h-24"
                  />
                </div>
              </div>
              <DialogFooter>
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => setIsReopenDialogOpen(false)}
                  disabled={isReopenPending}
                >
                  Cancel
                </Button>
                <Button
                  type="button"
                  onClick={handleReopenRequest}
                  disabled={isReopenPending || !reopenStepKey}
                >
                  {isReopenPending ? <LoaderCircle className="h-4 w-4 animate-spin" /> : null}
                  Reopen request
                </Button>
              </DialogFooter>
            </DialogContent>
          </Dialog>
          <Dialog open={isCancelDialogOpen} onOpenChange={setIsCancelDialogOpen}>
            <DialogContent>
              <DialogHeader>
                <DialogTitle>Cancel workflow</DialogTitle>
                <DialogDescription>
                  This closes the request and cancels any active agent run. Add a note so reviewers know why it was canceled.
                </DialogDescription>
              </DialogHeader>
              <div className="space-y-2">
                <Label htmlFor="cancel-workflow-comment">Cancel note</Label>
                <Textarea
                  id="cancel-workflow-comment"
                  value={cancelComment}
                  onChange={(event) => setCancelComment(event.target.value)}
                  placeholder="Explain why this workflow should be canceled."
                  className="min-h-24"
                />
              </div>
              <DialogFooter>
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => setIsCancelDialogOpen(false)}
                  disabled={isCommandPending}
                >
                  Keep workflow
                </Button>
                <Button
                  type="button"
                  variant="destructive"
                  onClick={handleCancelWorkflow}
                  disabled={isCommandPending || !cancelComment.trim()}
                >
                  {isCommandPending ? <LoaderCircle className="h-4 w-4 animate-spin" /> : null}
                  Cancel workflow
                </Button>
              </DialogFooter>
            </DialogContent>
          </Dialog>
          <Tabs defaultValue="details" className="space-y-4">
            <TabsList className="h-auto flex-wrap rounded-none bg-muted/50 p-1">
              <TabsTrigger value="details">Details</TabsTrigger>
              <TabsTrigger value="artifacts">Artifacts</TabsTrigger>
              <TabsTrigger value="comments">Comments</TabsTrigger>
              <TabsTrigger value="history">History</TabsTrigger>
              <TabsTrigger value="log">Log</TabsTrigger>
            </TabsList>

            <TabsContent value="details" className="mt-0 space-y-4">
              <Card className="border-border/60 bg-card/90 rounded-none">
            <CardHeader>
              <CardTitle>Request Details</CardTitle>
              <CardDescription>
                Original request plus the target context currently assigned to
                it.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4 text-sm">
              <div className="rounded-none border border-border/70 bg-background/70 p-4 leading-7">
                {request.description}
              </div>
              <div className="grid gap-3 sm:grid-cols-2">
                <div className="rounded-none border border-border/70 p-4">
                  <p className="text-xs uppercase tracking-[0.18em] text-muted-foreground">
                    Type
                  </p>
                  <p className="mt-2 font-medium">{request.requestType}</p>
                </div>
                <div className="rounded-none border border-border/70 p-4">
                  <p className="text-xs uppercase tracking-[0.18em] text-muted-foreground">
                    Priority
                  </p>
                  <p className="mt-2 font-medium">{request.priority}</p>
                </div>
                <div className="rounded-none border border-border/70 p-4">
                  <p className="text-xs uppercase tracking-[0.18em] text-muted-foreground">
                    Human Estimate
                  </p>
                  <p className="mt-2 font-medium">
                    {humanHoursLabel(request.estimatedHumanHours) ?? "Not estimated"}
                  </p>
                </div>
                <div className="rounded-none border border-border/70 p-4">
                  <p className="text-xs uppercase tracking-[0.18em] text-muted-foreground">
                    Repository
                  </p>
                  <p className="mt-2 font-medium">
                    {targetApp?.name ?? request.targetAppSlug ?? "Unknown"}
                  </p>
                </div>
                <div className="rounded-none border border-border/70 p-4">
                  <p className="text-xs uppercase tracking-[0.18em] text-muted-foreground">
                    Environment
                  </p>
                  <p className="mt-2 font-medium">
                    {targetEnvironment?.name ?? "Not assigned"}
                  </p>
                </div>
                <div className="rounded-none border border-border/70 p-4">
                  <p className="text-xs uppercase tracking-[0.18em] text-muted-foreground">
                    Target Branch
                  </p>
                  <p className="mt-2 font-medium">
                    {configuredBaseBranch ?? "Not configured"}
                  </p>
                </div>
              </div>
            </CardContent>
          </Card>

          <Card className="border-border/60 bg-card/90 rounded-none">
            <CardHeader>
              <CardTitle>Linked Records</CardTitle>
              <CardDescription>
                Live records outside Prism attached to this request.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-3">
              {externalRefs.length ? (
                externalRefs.map((externalRef) => {
                  const safeHref = safeExternalHref(externalRef.url);
                  return (
                    <div
                      key={externalRef.id}
                      className="rounded-none border border-border/70 bg-background/70 p-4 text-sm"
                    >
                      <div className="flex flex-wrap items-start justify-between gap-3">
                        <div className="min-w-0">
                          <div className="flex flex-wrap items-center gap-2">
                            <ExternalLink className="h-4 w-4 text-muted-foreground" />
                            {safeHref ? (
                              <a
                                href={safeHref}
                                target="_blank"
                                rel="noreferrer"
                                className="break-all font-medium underline underline-offset-2"
                              >
                                {externalRef.title ?? externalRef.url}
                              </a>
                            ) : (
                              <span className="break-all font-medium">
                                {externalRef.title ?? externalRef.url}
                              </span>
                            )}
                            <Badge variant="outline">{externalRef.provider}</Badge>
                            <Badge variant="outline">{externalRef.kind}</Badge>
                            {externalRef.state ? (
                              <Badge variant="secondary">{externalRef.state}</Badge>
                            ) : null}
                          </div>
                          {externalRef.externalId ? (
                            <p className="mt-2 text-xs text-muted-foreground">
                              External ID: {externalRef.externalId}
                            </p>
                          ) : null}
                        </div>
                        <span className="text-xs text-muted-foreground">
                          {isoLabel(externalRef.updatedAt) ?? ""}
                        </span>
                      </div>
                      {Object.keys(externalRef.metadata).length ? (
                        <pre className="mt-3 max-h-40 overflow-auto rounded-none border border-border/60 bg-muted/30 p-3 text-xs leading-5 text-muted-foreground">
                          {JSON.stringify(externalRef.metadata, null, 2)}
                        </pre>
                      ) : null}
                    </div>
                  );
                })
              ) : (
                <div className="rounded-none border border-dashed border-border px-4 py-8 text-center text-sm text-muted-foreground">
                  No linked external records yet.
                </div>
              )}
            </CardContent>
          </Card>

            </TabsContent>

            <TabsContent value="artifacts" className="mt-0">
              <Card className="border-border/60 bg-card/90 rounded-none">
                <CardHeader>
                  <CardTitle>Artifacts</CardTitle>
                  <CardDescription>
                    Durable files produced by workflow steps for this request.
                  </CardDescription>
                </CardHeader>
                <CardContent className="space-y-3">
                  {artifacts.length ? (
                    artifacts.map((artifact) => {
                      const href = `/admin/change-requests/${request.id}/artifacts/${artifact.id}/content`;
                      const isImage = artifact.mimeType.startsWith("image/");

                      return (
                        <div
                          key={artifact.id}
                          className="rounded-none border border-border/70 bg-background/70 p-4 text-sm"
                        >
                          <div className="flex flex-wrap items-start justify-between gap-3">
                            <div className="min-w-0">
                              <div className="flex flex-wrap items-center gap-2">
                                {isImage ? (
                                  <ImageIcon className="h-4 w-4 text-muted-foreground" />
                                ) : (
                                  <FileText className="h-4 w-4 text-muted-foreground" />
                                )}
                                <button
                                  type="button"
                                  onClick={() => openArtifactPreview(artifact)}
                                  className="break-all font-medium underline underline-offset-2"
                                >
                                  {artifact.name}
                                </button>
                                <Badge variant="outline">{artifact.kind}</Badge>
                              </div>
                              {artifact.description ? (
                                <p className="mt-2 whitespace-pre-wrap leading-6 text-muted-foreground">
                                  {artifact.description}
                                </p>
                              ) : null}
                            </div>
                            <span className="text-xs text-muted-foreground">
                              {isoLabel(artifact.createdAt) ?? ""}
                            </span>
                          </div>
                          <div className="mt-3 flex flex-wrap gap-3 text-xs text-muted-foreground">
                            <span>{artifact.mimeType}</span>
                            <span>{formatBytes(artifact.sizeBytes)}</span>
                            <span>by {artifact.createdBy}</span>
                          </div>
                          {Object.keys(artifact.metadata).length ? (
                            <pre className="mt-3 max-h-40 overflow-auto rounded-none border border-border/60 bg-muted/30 p-3 text-xs leading-5 text-muted-foreground">
                              {JSON.stringify(artifact.metadata, null, 2)}
                            </pre>
                          ) : null}
                          <div className="mt-3 flex flex-wrap gap-2">
                            <Button
                              type="button"
                              variant="outline"
                              size="sm"
                              onClick={() => openArtifactPreview(artifact)}
                            >
                              View
                            </Button>
                            <Button type="button" variant="ghost" size="sm" asChild>
                              <a href={href} target="_blank" rel="noreferrer">
                                <ExternalLink className="h-4 w-4" />
                                Raw
                              </a>
                            </Button>
                          </div>
                        </div>
                      );
                    })
                  ) : (
                    <div className="rounded-none border border-dashed border-border px-4 py-8 text-center text-sm text-muted-foreground">
                      No artifacts have been saved for this request yet.
                    </div>
                  )}
                </CardContent>
              </Card>
            </TabsContent>

            <TabsContent value="comments" className="mt-0">
              <Card className="border-border/60 bg-card/90 rounded-none">
            <CardHeader>
              <CardTitle>Request Thread</CardTitle>
              <CardDescription>
                Comments and agent replies linked to this change request.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              {activeAgentRun ? (
                <div className="rounded-none border border-sky-200/70 bg-sky-50/80 p-4 text-sm text-sky-950">
                  <div className="flex items-center justify-between gap-3">
                    <div className="flex items-center gap-2">
                      <LoaderCircle className="h-4 w-4 animate-spin" />
                      <span className="font-medium">Agent run {activeAgentRun.status}</span>
                    </div>
                    <div className="flex flex-wrap items-center justify-end gap-2">
                      <Badge variant="outline">{activeAgentRun.kind}</Badge>
                      <Badge variant="secondary">{activeAgentRun.lane}</Badge>
                      {activeAgentRun.status === "queued" && activeAgentRun.queuePosition ? (
                        <Badge variant="outline">position {activeAgentRun.queuePosition}</Badge>
                      ) : null}
                    </div>
                  </div>
                  <div className="mt-3 space-y-2">
                    <p className="leading-6">{activeAgentRunStage}</p>
                    <div className="grid gap-1 text-xs text-sky-900/75">
                      {activeAgentRun.workflowStepKey ? (
                        <div>Step: {activeAgentRun.workflowStepKey}</div>
                      ) : null}
                      <div>Lane: {activeAgentRun.lane}</div>
                      <div>Priority: {activeAgentRun.priority}</div>
                      {activeAgentRun.queueReason ? <div>Reason: {activeAgentRun.queueReason}</div> : null}
                      {activeAgentRun.queuedAt ? <div>Queued: {isoLabel(activeAgentRun.queuedAt)}</div> : null}
                      {activeAgentRun.claimedAt ? <div>Claimed: {isoLabel(activeAgentRun.claimedAt)}</div> : null}
                      {activeRunElapsed ? <div>Elapsed: {activeRunElapsed}</div> : null}
                      <div>Run: {activeAgentRun.id}</div>
                      {activeAgentRunBranchName ? (
                        <div>
                          Branch:{" "}
                          {activeAgentRunBranchUrl ? (
                            <a
                              href={activeAgentRunBranchUrl}
                              target="_blank"
                              rel="noreferrer"
                              className="font-medium underline underline-offset-2"
                            >
                              {activeAgentRunBranchName}
                            </a>
                          ) : (
                            activeAgentRunBranchName
                          )}
                        </div>
                      ) : null}
                      {activeAgentRunPrUrl ? (
                        <div>
                          PR:{" "}
                          <a
                            href={activeAgentRunPrUrl}
                            target="_blank"
                            rel="noreferrer"
                            className="font-medium underline underline-offset-2"
                          >
                            Open compare / PR
                          </a>
                        </div>
                      ) : null}
                      {activeAgentRunDeployUrl ? (
                        <div>
                          Preview:{" "}
                          <a
                            href={activeAgentRunDeployUrl}
                            target="_blank"
                            rel="noreferrer"
                            className="font-medium underline underline-offset-2"
                          >
                            {activeAgentRunDeployUrl}
                          </a>
                        </div>
                      ) : null}
                    </div>
                  </div>
                </div>
              ) : null}
              {!activeAgentRun && activeExecution ? (
                <div className="rounded-none border border-sky-200/70 bg-sky-50/80 p-4 text-sm text-sky-950">
                  <div className="flex items-center justify-between gap-3">
                    <div className="flex items-center gap-2">
                      <LoaderCircle className="h-4 w-4 animate-spin" />
                      <span className="font-medium">Legacy Execution Record</span>
                    </div>
                    <Badge variant="outline">{activeExecution.status}</Badge>
                  </div>
                  <div className="mt-3 space-y-2">
                    <p className="leading-6">{activeExecutionStage}</p>
                    <div className="grid gap-1 text-xs text-sky-900/75">
                      {activeExecutionElapsed ? (
                        <div>Elapsed: {activeExecutionElapsed}</div>
                      ) : null}
                      {activeExecution.startedAt ? (
                        <div>
                          Started: {isoLabel(activeExecution.startedAt)}
                        </div>
                      ) : null}
                      {configuredBaseBranch ? (
                        <div>Base branch: {configuredBaseBranch}</div>
                      ) : null}
                      {activeExecution.branchName ? (
                        <div>
                          Branch:{" "}
                          {activeExecutionBranchUrl ? (
                            <a
                              href={activeExecutionBranchUrl}
                              target="_blank"
                              rel="noreferrer"
                              className="font-medium underline underline-offset-2"
                            >
                              {activeExecution.branchName}
                            </a>
                          ) : (
                            activeExecution.branchName
                          )}
                        </div>
                      ) : null}
                      {activeExecutionPrUrl ? (
                        <div>
                          PR:{" "}
                          <a
                            href={activeExecutionPrUrl}
                            target="_blank"
                            rel="noreferrer"
                            className="font-medium underline underline-offset-2"
                          >
                            Open compare / PR
                          </a>
                        </div>
                      ) : null}
                      {activeExecutionDeployUrl ? (
                        <div>
                          Preview:{" "}
                          <a
                            href={activeExecutionDeployUrl}
                            target="_blank"
                            rel="noreferrer"
                            className="font-medium underline underline-offset-2"
                          >
                            {activeExecutionDeployUrl}
                          </a>
                        </div>
                      ) : null}
                    </div>
                  </div>
                </div>
              ) : null}

              <ScrollArea
                ref={threadScrollAreaRef}
                className="h-[320px] min-h-0 rounded-none border border-border/70 bg-background/70 p-4"
              >
                <div className="space-y-3">
                  {threadMessages.length ? (
                    threadMessages.map((message) => (
                      <div
                        key={message.id}
                        className={`rounded-none px-4 py-3 text-sm leading-6 ${
                          message.role === "assistant"
                            ? "border border-border/70 bg-card text-foreground"
                            : "border border-primary/30 bg-primary/12 text-foreground"
                        }`}
                      >
                        <div className="mb-2 flex items-center justify-between gap-3 text-xs uppercase tracking-[0.16em]">
                          <Badge
                            variant={
                              message.role === "assistant"
                                ? "outline"
                                : "secondary"
                            }
                          >
                            {message.source === "site-comment"
                              ? "comment"
                              : message.role}
                          </Badge>
                          <span
                            className={
                              message.role === "assistant"
                                ? "text-muted-foreground"
                                : "text-foreground/70"
                            }
                          >
                            {isoLabel(message.createdAt) ?? ""}
                          </span>
                        </div>
                        <p className="whitespace-pre-wrap">{message.content}</p>
                      </div>
                    ))
                  ) : (
                    <div className="rounded-none border border-dashed border-border px-4 py-8 text-center text-sm text-muted-foreground">
                      No comments or agent replies yet for this request.
                    </div>
                  )}
                </div>
              </ScrollArea>

            </CardContent>
          </Card>
            </TabsContent>

            <TabsContent value="history" className="mt-0">
              <Card className="border-border/60 bg-card/90 rounded-none">
            <CardHeader>
              <CardTitle>History</CardTitle>
              <CardDescription>
                Workflow events and lifecycle timestamps.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-3 text-sm">
              <div className="space-y-3">
                <p className="text-xs uppercase tracking-[0.18em] text-muted-foreground">
                  Workflow Events
                </p>
                {workflowEvents.length ? (
                  workflowEvents.map((event) => (
                    <div
                      key={event.id}
                      className="rounded-none border border-border/70 bg-background/70 p-4"
                    >
                      <div className="flex flex-wrap items-center justify-between gap-3">
                        <div className="flex flex-wrap items-center gap-2">
                          <Badge variant="outline">{event.eventType}</Badge>
                          {event.stepKey ? (
                            <Badge variant="secondary">{event.stepKey}</Badge>
                          ) : null}
                          {hasAutoContinuedFlag(event) ? (
                            <Badge variant="outline">auto</Badge>
                          ) : null}
                          <span className="text-xs uppercase tracking-[0.16em] text-muted-foreground">
                            {event.actorType}
                          </span>
                        </div>
                        <span className="text-xs text-muted-foreground">
                          {isoLabel(event.createdAt) ?? ""}
                        </span>
                      </div>
                      {event.note ? (
                        <p className="mt-3 whitespace-pre-wrap leading-6">
                          {event.note}
                        </p>
                      ) : null}
                      {Object.keys(event.payload).length ? (
                        <pre className="mt-3 max-h-40 overflow-auto rounded-none border border-border/60 bg-muted/30 p-3 text-xs leading-5 text-muted-foreground">
                          {JSON.stringify(event.payload, null, 2)}
                        </pre>
                      ) : null}
                    </div>
                  ))
                ) : (
                  <div className="rounded-none border border-dashed border-border px-4 py-8 text-center text-sm text-muted-foreground">
                    No workflow events recorded yet.
                  </div>
                )}
              </div>

              <div className="space-y-3 pt-3">
                <p className="text-xs uppercase tracking-[0.18em] text-muted-foreground">
                  Lifecycle
                </p>
              {lifecycleEvents.map((event) => (
                <div
                  key={event.label}
                  className="rounded-none border border-border/70 p-4"
                >
                  <p className="text-xs uppercase tracking-[0.18em] text-muted-foreground">
                    {event.label}
                  </p>
                  <p className="mt-2">{isoLabel(event.value) ?? "Not yet"}</p>
                </div>
              ))}
              </div>
            </CardContent>
          </Card>
            </TabsContent>

            <TabsContent value="log" className="mt-0">
              <Card className="border-border/60 bg-card/90 rounded-none">
            <CardHeader>
              <CardTitle>Execution Log</CardTitle>
              <CardDescription>
                Recent agent runs, status changes, and failure details for this
                request.
              </CardDescription>
            </CardHeader>
            <CardContent>
              <ScrollArea className="h-[420px] max-h-[calc(100vh-430px)] min-h-[240px]">
                <div className="space-y-3">
                  {agentRuns.length ? (
                    agentRuns.map((run) => {
                      const branchName = agentRunResultString(run, "branchName");
                      const branchUrl = agentRunBranchUrl(run);
                      const baseBranch =
                        agentRunResultString(run, "baseBranch") ?? configuredBaseBranch;
                      const compareUrl = githubCompareUrl(targetApp, baseBranch, branchName);
                      const commitSha =
                        agentRunResultString(run, "commitSha") ??
                        agentRunResultString(run, "headCommitSha");
                      const deployUrl = agentRunDeployUrl(run, targetEnvironment);
                      const workflowOutcome = workflowOutcomeFromRun(run);

                      return (
                        <div
                          key={run.id}
                          className="rounded-none border border-primary/25 bg-primary/5 p-4 text-sm"
                        >
                        <div className="flex items-center justify-between gap-3">
                          <div className="flex flex-wrap items-center gap-2">
                            <Badge
                              variant={
                                run.status === "succeeded"
                                  ? "secondary"
                                  : run.status === "running" || run.status === "queued"
                                    ? "default"
                                    : "outline"
                              }
                            >
                              {run.status}
                            </Badge>
                            <Badge variant="outline">{run.kind}</Badge>
                            <Badge variant="secondary">{run.lane}</Badge>
                            {run.workflowStepKey ? (
                              <Badge variant="secondary">{run.workflowStepKey}</Badge>
                            ) : null}
                            {run.status === "queued" && run.queuePosition ? (
                              <Badge variant="outline">position {run.queuePosition}</Badge>
                            ) : null}
                            {workflowOutcomeNeedsAttention(workflowOutcome) && workflowOutcome ? (
                              <Badge variant="outline" className="border-amber-500/70 text-amber-700">
                                {workflowOutcomeLabel(workflowOutcome)}
                              </Badge>
                            ) : null}
                            <span className="text-xs uppercase tracking-[0.16em] text-muted-foreground">
                              agent run
                            </span>
                          </div>
                          <span className="text-xs text-muted-foreground">
                            {isoLabel(run.updatedAt) ?? ""}
                          </span>
                        </div>
                        {run.errorMessage ? (
                          <div className="mt-3 rounded-none border border-destructive/30 bg-destructive/5 px-3 py-2 text-destructive">
                            {run.errorMessage}
                          </div>
                        ) : null}
                        {workflowOutcomeNeedsAttention(workflowOutcome) && workflowOutcome ? (
                          <div className="mt-3 rounded-none border border-amber-400/70 bg-amber-50/80 px-3 py-2 text-amber-950">
                            <div className="font-medium">{workflowOutcomeLabel(workflowOutcome)}</div>
                            {workflowOutcome.summary ? (
                              <p className="mt-1 whitespace-pre-wrap leading-6">{workflowOutcome.summary}</p>
                            ) : null}
                            {workflowOutcome.suggestedFix ? (
                              <p className="mt-1 whitespace-pre-wrap leading-6">
                                <span className="font-medium">Suggested fix:</span>{" "}
                                {workflowOutcome.suggestedFix}
                              </p>
                            ) : null}
                          </div>
                        ) : null}
                        <div className="mt-3 grid gap-2 text-xs text-muted-foreground">
                          <div>Run: {run.id}</div>
                          <div>Lane: {run.lane}</div>
                          <div>Priority: {run.priority}</div>
                          {run.queueReason ? <div>Queue reason: {run.queueReason}</div> : null}
                          {run.idempotencyKey ? <div>Key: {run.idempotencyKey}</div> : null}
                          {branchName ? (
                            <div>
                              Branch:{" "}
                              {branchUrl ? (
                                <a
                                  href={branchUrl}
                                  target="_blank"
                                  rel="noreferrer"
                                  className="font-medium underline underline-offset-2"
                                >
                                  {branchName}
                                </a>
                              ) : (
                                branchName
                              )}
                            </div>
                          ) : null}
                          {compareUrl ? (
                            <div>
                              PR:{" "}
                              <a
                                href={compareUrl}
                                target="_blank"
                                rel="noreferrer"
                                className="font-medium underline underline-offset-2"
                              >
                                Open compare / PR
                              </a>
                            </div>
                          ) : null}
                          {commitSha ? <div>Commit: {commitSha}</div> : null}
                          {deployUrl ? (
                            <div>
                              Preview:{" "}
                              <a
                                href={deployUrl}
                                target="_blank"
                                rel="noreferrer"
                                className="font-medium underline underline-offset-2"
                              >
                                {deployUrl}
                              </a>
                            </div>
                          ) : null}
                          {run.queuedAt ? <div>Queued: {isoLabel(run.queuedAt)}</div> : null}
                          {run.claimedAt ? <div>Claimed: {isoLabel(run.claimedAt)}</div> : null}
                          {run.leaseExpiresAt ? <div>Lease expires: {isoLabel(run.leaseExpiresAt)}</div> : null}
                          {run.startedAt ? <div>Started: {isoLabel(run.startedAt)}</div> : null}
                          {run.finishedAt ? <div>Finished: {isoLabel(run.finishedAt)}</div> : null}
                        </div>
                        {run.trace.length ? (
                          <pre className="mt-3 max-h-32 overflow-auto rounded-none border border-border/60 bg-muted/30 p-3 text-xs leading-5 text-muted-foreground">
                            {JSON.stringify(run.trace.slice(-5), null, 2)}
                          </pre>
                        ) : null}
                        </div>
                      );
                    })
                  ) : null}
                  {legacyOnlyExecutions.length ? (
                    legacyOnlyExecutions.map((execution) => (
                      <div
                        key={execution.id}
                        className="rounded-none border border-border/70 bg-background/70 p-4 text-sm"
                      >
                        <div className="flex items-center justify-between gap-3">
                          <div className="flex items-center gap-2">
                            <Badge
                              variant={
                                execution.status === "completed"
                                  ? "secondary"
                                  : execution.status === "running"
                                    ? "default"
                                    : "outline"
                              }
                            >
                              {execution.status}
                            </Badge>
                            {hasAutoContinuedFlag(execution) ? (
                              <Badge variant="outline">auto</Badge>
                            ) : null}
                            <span className="text-xs uppercase tracking-[0.16em] text-muted-foreground">
                              legacy execution · {execution.actorType}
                            </span>
                          </div>
                          <span className="text-xs text-muted-foreground">
                            {isoLabel(execution.updatedAt) ?? ""}
                          </span>
                        </div>
                        {execution.summary ? (
                          <p className="mt-3 whitespace-pre-wrap leading-6">
                            {execution.summary}
                          </p>
                        ) : null}
                        {execution.errorMessage ? (
                          <div className="mt-3 rounded-none border border-destructive/30 bg-destructive/5 px-3 py-2 text-destructive">
                            {execution.errorMessage}
                          </div>
                        ) : null}
                        <div className="mt-3 grid gap-2 text-xs text-muted-foreground">
                          {execution.branchName ? (
                            <div>
                              Branch:{" "}
                              {executionBranchUrl(execution) ? (
                                <a
                                  href={executionBranchUrl(execution) ?? "#"}
                                  target="_blank"
                                  rel="noreferrer"
                                  className="font-medium underline underline-offset-2"
                                >
                                  {execution.branchName}
                                </a>
                              ) : (
                                execution.branchName
                              )}
                            </div>
                          ) : null}
                          {githubCompareUrl(
                            targetApp,
                            (typeof execution.meta?.baseBranch === "string"
                              ? execution.meta.baseBranch
                              : null) ?? configuredBaseBranch,
                            execution.branchName,
                          ) ? (
                            <div>
                              PR:{" "}
                              <a
                                href={
                                  githubCompareUrl(
                                    targetApp,
                                    (typeof execution.meta?.baseBranch ===
                                    "string"
                                      ? execution.meta.baseBranch
                                      : null) ?? configuredBaseBranch,
                                    execution.branchName,
                                  ) ?? "#"
                                }
                                target="_blank"
                                rel="noreferrer"
                                className="font-medium underline underline-offset-2"
                              >
                                Open compare / PR
                              </a>
                            </div>
                          ) : null}
                          {execution.commitSha ? (
                            <div>Commit: {execution.commitSha}</div>
                          ) : null}
                          {executionDeployUrl(execution, targetEnvironment) ? (
                            <div>
                              Preview:{" "}
                              <a
                                href={
                                  executionDeployUrl(
                                    execution,
                                    targetEnvironment,
                                  ) ?? "#"
                                }
                                target="_blank"
                                rel="noreferrer"
                                className="font-medium underline underline-offset-2"
                              >
                                {executionDeployUrl(
                                  execution,
                                  targetEnvironment,
                                )}
                              </a>
                            </div>
                          ) : null}
                          {execution.startedAt ? (
                            <div>Started: {isoLabel(execution.startedAt)}</div>
                          ) : null}
                          {execution.finishedAt ? (
                            <div>
                              Finished: {isoLabel(execution.finishedAt)}
                            </div>
                          ) : null}
                        </div>
                        {Array.isArray(execution.meta?.runtimeTrace) &&
                        execution.meta.runtimeTrace.length ? (
                          <div className="mt-3 rounded-none border border-border/60 bg-muted/30 p-3">
                            <div className="text-[11px] font-semibold uppercase tracking-[0.16em] text-muted-foreground">
                              Execution Trace
                            </div>
                            <div className="mt-2 max-h-40 space-y-2 overflow-y-auto font-mono text-[11px] leading-5 text-muted-foreground">
                              {execution.meta.runtimeTrace.map(
                                (entry, index) => {
                                  if (!entry || typeof entry !== "object") {
                                    return null;
                                  }

                                  const at =
                                    typeof entry.at === "string"
                                      ? entry.at
                                      : null;
                                  const kind =
                                    typeof entry.kind === "string"
                                      ? entry.kind
                                      : "runtime";
                                  const message =
                                    typeof entry.message === "string"
                                      ? entry.message
                                      : "";

                                  if (!message.trim()) {
                                    return null;
                                  }

                                  return (
                                    <div
                                      key={`${execution.id}-trace-${index}`}
                                      className="whitespace-pre-wrap"
                                    >
                                      [{at ?? "unknown"}] {kind}: {message}
                                    </div>
                                  );
                                },
                              )}
                            </div>
                          </div>
                        ) : null}
                      </div>
                    ))
                  ) : !agentRuns.length ? (
                    <div className="rounded-none border border-dashed border-border px-4 py-8 text-center text-sm text-muted-foreground">
                      No agent runs or legacy execution records yet for this request.
                    </div>
                  ) : null}
                </div>
              </ScrollArea>
            </CardContent>
          </Card>
            </TabsContent>
          </Tabs>
        </div>
      </div>

      <Dialog
        open={Boolean(selectedArtifact)}
        onOpenChange={(open) => {
          if (!open) {
            artifactPreviewRequestRef.current += 1;
            setSelectedArtifact(null);
            setArtifactPreviewText(null);
            setArtifactPreviewError(null);
            setIsArtifactPreviewLoading(false);
          }
        }}
      >
        <DialogContent className="flex max-h-[90vh] max-w-5xl flex-col overflow-hidden">
          <DialogHeader>
            <DialogTitle className="min-w-0 pr-8">
              <span className="truncate">{selectedArtifact?.name ?? "Artifact"}</span>
            </DialogTitle>
          </DialogHeader>
          {selectedArtifact ? (
            <div className="flex min-h-0 flex-1 flex-col gap-3">
              <div className="flex flex-wrap items-center justify-between gap-3 text-xs text-muted-foreground">
                <div className="flex flex-wrap gap-3">
                  <span>{selectedArtifact.mimeType}</span>
                  <span>{formatBytes(selectedArtifact.sizeBytes)}</span>
                  <span>{selectedArtifact.kind}</span>
                </div>
                <Button type="button" variant="outline" size="sm" asChild>
                  <a
                    href={`/admin/change-requests/${request.id}/artifacts/${selectedArtifact.id}/content`}
                    target="_blank"
                    rel="noreferrer"
                  >
                    <ExternalLink className="h-4 w-4" />
                    Raw
                  </a>
                </Button>
              </div>
              {artifactPreviewError ? (
                <div className="border border-destructive/40 bg-destructive/10 px-4 py-3 text-sm text-destructive">
                  {artifactPreviewError}
                </div>
              ) : null}
              {artifactPreviewKind(selectedArtifact) === "image" ? (
                <ScrollArea className="h-[calc(90vh-180px)] border border-border/70 bg-muted/20">
                  <div className="flex min-h-[320px] items-center justify-center p-4">
                    <img
                      src={`/admin/change-requests/${request.id}/artifacts/${selectedArtifact.id}/content`}
                      alt={selectedArtifact.name}
                      className="max-h-[calc(90vh-220px)] max-w-full object-contain"
                    />
                  </div>
                </ScrollArea>
              ) : artifactPreviewKind(selectedArtifact) === "text" ? (
                <ScrollArea className="h-[calc(90vh-180px)] border border-border/70 bg-muted/20">
                  {isArtifactPreviewLoading ? (
                    <div className="flex h-full items-center justify-center text-sm text-muted-foreground">
                      Loading preview...
                    </div>
                  ) : (
                    <pre className="whitespace-pre-wrap break-words p-4 text-sm leading-6">
                      {artifactPreviewText ?? ""}
                    </pre>
                  )}
                </ScrollArea>
              ) : (
                <div className="border border-dashed border-border px-4 py-8 text-center text-sm text-muted-foreground">
                  No inline preview is available for this artifact type. Open the raw file instead.
                </div>
              )}
            </div>
          ) : null}
        </DialogContent>
      </Dialog>
    </div>
  );
}
