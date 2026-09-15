import { Bot, GitBranch, LoaderCircle } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import type {
  ChangeRequestRecord,
  TargetAppRecord,
  TargetEnvironmentRecord,
  WorkflowRecord,
} from "@/lib/admin";

import {
  environmentForRequest,
  humanHoursLabel,
  isoLabel,
  priorityVariant,
  requestSourceLabel,
  targetAppForRequest,
  workflowStepForKey,
  workflowStepVariant,
  workflowSteps,
} from "./change-request-utils";

export function ChangeRequestRow({
  request,
  targetApps,
  targetEnvironments,
  workflow,
  onOpen,
}: {
  request: ChangeRequestRecord;
  targetApps: TargetAppRecord[];
  targetEnvironments: TargetEnvironmentRecord[];
  workflow: WorkflowRecord | null;
  onOpen: (request: ChangeRequestRecord) => void;
}) {
  const targetApp = targetAppForRequest(request, targetApps);
  const targetEnvironment = environmentForRequest(request, targetEnvironments);
  const workflowStep = workflowStepForKey(
    request.currentWorkflowStepKey,
    workflowSteps(workflow),
  ).step;
  const workflowLabel = workflow?.name ?? request.workflowKey;
  const targetBranch =
    targetEnvironment?.branch ?? targetApp?.defaultBranch ?? "No branch";
  const isRunning = request.workflowRunStatus === "running";
  const isCanceled = request.workflowRunStatus === "canceled";
  const workflowAttention = request.workflowAttention;
  const estimatedHumanHoursLabel = humanHoursLabel(request.estimatedHumanHours);

  return (
    <button
      type="button"
      onClick={() => onOpen(request)}
      className="grid w-full gap-4 border border-border/70 bg-background/75 p-4 text-left transition hover:border-foreground/30 hover:bg-background md:grid-cols-[84px_minmax(0,1fr)_180px_150px_140px]"
    >
      <div>
        <p className="text-xs uppercase tracking-[0.18em] text-muted-foreground">
          Request
        </p>
        <p className="mt-1 text-lg font-semibold">#{request.requestNumber}</p>
      </div>

      <div className="min-w-0 space-y-2">
        <div className="flex flex-wrap items-center gap-2">
          <Badge variant="outline">Workflow: {workflowLabel}</Badge>
          <Badge variant={workflowStepVariant(workflowStep)}>
            {workflowStep.label}
          </Badge>
          {isRunning ? (
            <Badge variant="default" className="gap-1">
              <LoaderCircle className="h-3 w-3 animate-spin" />
              running
            </Badge>
          ) : null}
          {isCanceled ? <Badge variant="destructive">canceled</Badge> : null}
          {workflowAttention ? (
            <Badge variant="outline" className="border-amber-500/70 text-amber-700">
              {workflowAttention.status === "blocked" ? "Blocked" : "Needs attention"}
            </Badge>
          ) : null}
          <Badge variant={priorityVariant(request.priority)}>
            {request.priority}
          </Badge>
          <Badge variant="outline">{request.requestType}</Badge>
          <Badge variant="outline">{requestSourceLabel(request.source)}</Badge>
          {estimatedHumanHoursLabel ? (
            <Badge variant="outline">{estimatedHumanHoursLabel}</Badge>
          ) : null}
        </div>
        <h3 className="line-clamp-1 text-base font-semibold">
          {request.title}
        </h3>
        <p className="line-clamp-2 text-sm leading-6 text-muted-foreground">
          {request.description}
        </p>
      </div>

      <div className="space-y-1 text-sm">
        <p className="text-xs uppercase tracking-[0.16em] text-muted-foreground">
          Target
        </p>
        <p className="truncate font-medium">
          {targetApp?.name ?? request.targetAppSlug ?? "No target"}
        </p>
        {targetApp ? (
          <p className="flex items-center gap-1 text-xs text-muted-foreground">
            <GitBranch className="h-3.5 w-3.5" />
            <span className="truncate">{targetBranch}</span>
          </p>
        ) : null}
      </div>

      <div className="space-y-1 text-sm">
        <p className="text-xs uppercase tracking-[0.16em] text-muted-foreground">
          Agent
        </p>
        <p className="flex items-center gap-1 font-medium">
          <Bot className="h-3.5 w-3.5 text-muted-foreground" />
          {targetApp ? (targetEnvironment?.agentWritable ? "Writable" : "Locked") : "Workflow"}
        </p>
        {request.agentRecommendation ? (
          <p className="truncate text-xs text-muted-foreground">Guidance ready</p>
        ) : null}
      </div>

      <div className="space-y-1 text-sm">
        <p className="text-xs uppercase tracking-[0.16em] text-muted-foreground">
          Updated
        </p>
        <p className="font-medium">
          {isoLabel(request.updatedAt) ?? "Unknown"}
        </p>
      </div>
    </button>
  );
}
