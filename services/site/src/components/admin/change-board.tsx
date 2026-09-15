"use client";

import { useEffect, useMemo, useState, useTransition } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import {
  ArrowUpCircle,
  BotMessageSquare,
  BookOpen,
  CalendarClock,
  Mic,
  FilePlus,
  LoaderCircle,
  LogOut,
  Search,
  Rows3,
  Settings,
  Webhook,
  Workflow,
  X,
} from "lucide-react";

import { AdminHeader } from "@/components/admin/admin-header";
import { AdminSettingsWorkspace } from "@/components/admin/admin-settings-workspace";
import { ChangeRequestList } from "@/components/admin/change-request-list";
import { RequestDetailsPanel } from "@/components/admin/change-request-details-panel";
import { CaptureWorkspace } from "@/components/admin/capture-workspace";
import { CodexConsole } from "@/components/admin/codex-console";
import { HooksWorkspace } from "@/components/admin/hooks-workspace";
import { NewChangeRequestDialog } from "@/components/admin/new-change-request-dialog";
import { SkillsWorkspace } from "@/components/admin/skills-workspace";
import { TaskRunnerWorkspace } from "@/components/admin/task-runner-workspace";
import { WorkflowsWorkspace } from "@/components/admin/workflows-workspace";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import type {
  AdminBoardData,
  AdminWorkspaceData,
  ChangeRequestRecord,
} from "@/lib/admin";
import type { Capability } from "@/lib/role-access";

import {
  environmentForRequest,
  humanHoursLabel,
  parseTimestamp,
  priorityVariant,
  requestSourceLabel,
  requestTypeLabel,
  targetAppForRequest,
  workflowStepForKey,
  workflowStepVariant,
  workflowSteps,
  type RequestSortValue,
} from "./change-request-utils";

const codexConsoleSessionControlsId = "codex-console-session-controls";

const workspaceTabs = [
  "requests",
  "codex-console",
  "capture",
  "tasks",
  "skills",
  "workflows",
  "hooks",
  "settings",
];

function canUse(capabilities: readonly Capability[], capability: Capability) {
  return capabilities.includes(capability);
}

export function ChangeBoard({
  data: initialData,
  initialTab,
}: {
  data: AdminWorkspaceData;
  initialTab?: string;
}) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [data, setData] = useState(initialData);
  const [selectedRequestId, setSelectedRequestId] = useState<string | null>(
    null,
  );
  const [isNewRequestOpen, setIsNewRequestOpen] = useState(false);
  const [lifecycleFilter, setLifecycleFilter] = useState("open");
  const [typeFilter, setTypeFilter] = useState("all");
  const [repositoryFilter, setRepositoryFilter] = useState("all");
  const [stepFilters, setStepFilters] = useState<string[]>([]);
  const [searchQuery, setSearchQuery] = useState("");
  const [sortValue, setSortValue] = useState<RequestSortValue>("updated-desc");
  const [activeTab, setActiveTab] = useState(() =>
    initialTab && workspaceTabs.includes(initialTab)
      ? initialTab
      : initialTab === "change-requests"
        ? "requests"
        : "requests",
  );
  const [isSaving, startSaving] = useTransition();
  const [modalError, setModalError] = useState<string | null>(null);

  function updateAdminUrl(next: {
    tab?: string;
    request?: ChangeRequestRecord | null;
  }) {
    const params = new URLSearchParams(searchParams.toString());
    if (next.tab) {
      params.set("tab", next.tab);
    }
    if (next.request === null) {
      params.delete("request");
    } else if (next.request) {
      params.set("request", String(next.request.requestNumber));
    }
    const query = params.toString();
    router.replace(query ? `/admin?${query}` : "/admin", { scroll: false });
  }

  useEffect(() => {
    let cancelled = false;

    async function refreshBoard() {
      try {
        const response = await fetch("/admin/board", { cache: "no-store" });
        if (!response.ok) {
          return;
        }

        const payload = (await response.json()) as {
          ok: true;
          data: AdminBoardData;
        };
        if (!cancelled && payload.ok) {
          setData((current) => ({
            ...payload.data,
            setup: current.setup,
            updateStatus: current.updateStatus,
            branding: current.branding,
            session: current.session,
          }));
        }
      } catch {
        // Leave the current board state in place and try again on the next interval.
      }
    }

    refreshBoard();
    const intervalId = window.setInterval(refreshBoard, 2500);

    return () => {
      cancelled = true;
      window.clearInterval(intervalId);
    };
  }, []);

  const workflowByKey = useMemo(
    () =>
      new Map(
        (data.workflows ?? []).map((workflow) => [workflow.key, workflow]),
      ),
    [data.workflows],
  );
  const workflowStepForRequest = (
    request: AdminBoardData["changeRequests"][number],
  ) =>
    workflowStepForKey(
      request.currentWorkflowStepKey,
      workflowSteps(workflowByKey.get(request.workflowKey) ?? null),
    ).step;
  const closedCount = data.changeRequests.filter(
    (request) => workflowStepForRequest(request).type === "terminal",
  ).length;
  const activeCount = data.changeRequests.length - closedCount;
  const estimatedHumanHours = data.changeRequests.reduce(
    (totals, request) => {
      const estimate =
        typeof request.estimatedHumanHours === "number" &&
        Number.isFinite(request.estimatedHumanHours)
          ? request.estimatedHumanHours
          : 0;
      totals.total += estimate;
      if (workflowStepForRequest(request).type !== "terminal") {
        totals.active += estimate;
      }
      return totals;
    },
    { active: 0, total: 0 },
  );
  const estimatedHumanHoursActiveLabel = humanHoursLabel(
    estimatedHumanHours.active,
  );
  const estimatedHumanHoursTotalLabel = humanHoursLabel(
    estimatedHumanHours.total,
  );
  const runningCount = data.changeRequests.filter(
    (request) => request.workflowRunStatus === "running",
  ).length;
  const attentionCount = data.changeRequests.filter(
    (request) => Boolean(request.workflowAttention),
  ).length;

  const selectedRequest = useMemo(
    () =>
      data.changeRequests.find((request) => request.id === selectedRequestId) ??
      null,
    [data.changeRequests, selectedRequestId],
  );
  const selectedTargetApp = selectedRequest
    ? targetAppForRequest(selectedRequest, data.targetApps)
    : null;
  const selectedTargetEnvironment = selectedRequest
    ? environmentForRequest(selectedRequest, data.targetEnvironments)
    : null;
  const selectedWorkflow = selectedRequest
    ? (workflowByKey.get(selectedRequest.workflowKey) ?? null)
    : null;
  const selectedWorkflowStep = selectedRequest
    ? workflowStepForKey(
        selectedRequest.currentWorkflowStepKey,
        workflowSteps(selectedWorkflow),
      ).step
    : null;
  const selectedEstimatedHumanHoursLabel = selectedRequest
    ? humanHoursLabel(selectedRequest.estimatedHumanHours)
    : null;

  const requestTypeOptions = useMemo(
    () =>
      Array.from(
        new Set(data.changeRequests.map((request) => request.requestType)),
      ).sort((left, right) => left.localeCompare(right)),
    [data.changeRequests],
  );

  const workflowStepOptions = useMemo(() => {
    const options = new Map<string, { key: string; label: string }>();
    for (const request of data.changeRequests) {
      const step = workflowStepForRequest(request);
      options.set(step.key, { key: step.key, label: step.label });
    }
    return Array.from(options.values()).sort((left, right) =>
      left.label.localeCompare(right.label),
    );
  }, [data.changeRequests, workflowByKey]);

  useEffect(() => {
    const tabParam = searchParams.get("tab");
    const requestParam = searchParams.get("request");
    const nextTab =
      tabParam && workspaceTabs.includes(tabParam)
        ? tabParam
        : tabParam === "change-requests"
          ? "requests"
          : "requests";

    if (nextTab !== activeTab) {
      setActiveTab(nextTab);
    }

    if (requestParam) {
      const nextRequest =
        data.changeRequests.find(
          (request) =>
            request.id === requestParam ||
            String(request.requestNumber) === requestParam,
        ) ?? null;
      if (nextRequest && nextRequest.id !== selectedRequestId) {
        setSelectedRequestId(nextRequest.id);
      }
    } else if (selectedRequestId) {
      setSelectedRequestId(null);
    }
  }, [activeTab, data.changeRequests, searchParams, selectedRequestId]);

  async function refreshOnce() {
    const response = await fetch("/admin/board", { cache: "no-store" });
    if (!response.ok) {
      throw new Error("Board refresh failed");
    }

    const payload = (await response.json()) as {
      ok: true;
      data: AdminBoardData;
    };
    if (!payload.ok) {
      throw new Error("Board refresh failed");
    }

    setData((current) => ({
      ...payload.data,
      setup: current.setup,
      updateStatus: current.updateStatus,
      branding: current.branding,
      session: current.session,
    }));
  }

  function handleSaveTriage(payload: {
    currentWorkflowStepKey?: string | null;
    triageSummary: string;
    agentRecommendation: string;
  }) {
    if (!selectedRequest) return;

    setModalError(null);
    startSaving(async () => {
      try {
        const response = await fetch(
          `/admin/change-requests/${selectedRequest.id}`,
          {
            method: "PATCH",
            headers: {
              "content-type": "application/json",
            },
            body: JSON.stringify(payload),
          },
        );

        const responsePayload = (await response.json()) as {
          ok?: boolean;
          error?: string;
          changeRequest?: ChangeRequestRecord;
        };
        if (!response.ok || responsePayload.ok === false) {
          throw new Error(responsePayload.error || "Could not save triage");
        }

        if (responsePayload.changeRequest) {
          setData((current) => ({
            ...current,
            changeRequests: current.changeRequests.map((request) =>
              request.id === responsePayload.changeRequest?.id
                ? responsePayload.changeRequest
                : request,
            ),
          }));
        }
        await refreshOnce();
      } catch (error) {
        setModalError(
          error instanceof Error ? error.message : "Could not save triage",
        );
      }
    });
  }

  const taskList = useMemo(() => {
    const normalizedSearch = searchQuery.trim().toLocaleLowerCase();

    return data.changeRequests
      .filter((request) => {
        const workflowStep = workflowStepForRequest(request);
        const isClosed =
          workflowStep.type === "terminal" ||
          request.workflowRunStatus === "completed" ||
          request.workflowRunStatus === "canceled";
        const needsReview = !isClosed && workflowStep.type === "gate";
        if (lifecycleFilter === "open" && isClosed) {
          return false;
        }
        if (lifecycleFilter === "needs-review" && !needsReview) {
          return false;
        }
        if (lifecycleFilter === "closed" && !isClosed) {
          return false;
        }

        if (typeFilter !== "all" && request.requestType !== typeFilter) {
          return false;
        }

        if (stepFilters.length && !stepFilters.includes(workflowStep.key)) {
          return false;
        }

        if (
          repositoryFilter !== "all" &&
          request.targetAppId !== repositoryFilter
        ) {
          return false;
        }

        if (
          normalizedSearch &&
          !request.title.toLocaleLowerCase().includes(normalizedSearch)
        ) {
          return false;
        }

        return true;
      })
      .sort((left, right) => {
        if (sortValue === "number-desc") {
          return right.requestNumber - left.requestNumber;
        }

        if (sortValue === "number-asc") {
          return left.requestNumber - right.requestNumber;
        }

        const leftUpdated = parseTimestamp(left.updatedAt);
        const rightUpdated = parseTimestamp(right.updatedAt);

        if (sortValue === "updated-asc") {
          return leftUpdated - rightUpdated;
        }

        return rightUpdated - leftUpdated;
      });
  }, [
    data.changeRequests,
    repositoryFilter,
    searchQuery,
    sortValue,
    lifecycleFilter,
    stepFilters,
    typeFilter,
    workflowByKey,
  ]);
  const userCapabilities = data.session.capabilities;
  const canCreateRequest = canUse(userCapabilities, "canCreateRequest");
  const canComment = canUse(userCapabilities, "canComment");
  const canRunAgent = canUse(userCapabilities, "canRunAgent");
  const canManageTasks = canUse(userCapabilities, "canManageTasks");
  const canManageSkills = canUse(userCapabilities, "canManageSkills");
  const canManageWorkflows = canUse(userCapabilities, "canManageWorkflows");
  const canManageSettings = canUse(userCapabilities, "canManageSettings");
  const availableTabs = useMemo(
    () =>
      workspaceTabs.filter((tab) => {
        if (tab === "codex-console") return canRunAgent;
        if (tab === "capture") return canRunAgent;
        if (tab === "tasks") return canManageTasks;
        if (tab === "skills") return canManageSkills;
        if (tab === "workflows") return canManageWorkflows;
        if (tab === "hooks") return canManageWorkflows;
        if (tab === "settings") return canManageSettings;
        return true;
      }),
    [
      canManageSettings,
      canManageSkills,
      canManageTasks,
      canManageWorkflows,
      canRunAgent,
    ],
  );

  useEffect(() => {
    if (!availableTabs.includes(activeTab)) {
      setActiveTab("requests");
    }
  }, [activeTab, availableTabs]);

  return (
    <main className="min-h-screen w-full bg-background text-foreground">
      <AdminHeader
        branding={data.branding}
        actions={
          <>
            {data.setup.prismMemory.configured ? (
              <Button asChild variant="outline">
                <Link href="/admin/memory">
                  <Search className="h-4 w-4" />
                  <span className="hidden sm:inline">Memory</span>
                </Link>
              </Button>
            ) : (
              <Button
                type="button"
                variant="outline"
                disabled
                title="Set PRISM_MEMORY_BASE_URL on the site service to enable Memory Explorer."
              >
                <Search className="h-4 w-4" />
                <span className="hidden sm:inline">Memory</span>
              </Button>
            )}
            <form action="/admin/logout" method="post">
              <Button variant="outline" type="submit">
                <LogOut className="h-4 w-4" />
                <span className="hidden sm:inline">Logout</span>
              </Button>
            </form>
          </>
        }
      />

      {data.updateStatus.state === "update_available" ? (
        <div className="border-b border-amber-300 bg-amber-50 px-5 py-3 text-amber-950 dark:border-amber-700 dark:bg-amber-950/40 dark:text-amber-100 md:px-6">
          <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
            <p className="flex items-center gap-2 text-sm font-medium">
              <ArrowUpCircle className="h-4 w-4 shrink-0" />
              {data.updateStatus.updateReason === "version"
                ? `Prism ${data.updateStatus.latestVersion} is available.`
                : "A newer Prism build is available."}{" "}
              This instance is running {data.updateStatus.currentVersion}.
            </p>
            <div className="flex items-center gap-3 text-sm">
              <Link
                href="/admin?tab=settings&settings=status"
                className="font-medium underline underline-offset-4"
              >
                Version details
              </Link>
              <a
                href={data.updateStatus.changesUrl}
                target="_blank"
                rel="noreferrer"
                className="font-medium underline underline-offset-4"
              >
                View changes
              </a>
            </div>
          </div>
        </div>
      ) : null}

      <Tabs
        value={activeTab}
        onValueChange={(nextTab) => {
          setActiveTab(nextTab);
          updateAdminUrl({
            tab: nextTab,
            request: nextTab === "requests" ? selectedRequest : null,
          });
        }}
        className="flex min-h-[calc(100vh-65px)] flex-col"
      >
        <div className="sticky top-16 z-20 border-b border-border/60 bg-background/95 backdrop-blur">
          <div className="px-5 py-3 md:px-6">
            <TabsList className="h-auto flex-wrap rounded-2xl bg-transparent p-0">
              <TabsTrigger
                value="requests"
                className="rounded-xl border border-transparent px-4 py-2.5 data-[state=active]:border-border/70 data-[state=active]:bg-background"
              >
                <Rows3 className="h-4 w-4 md:hidden" />
                <span className="hidden md:inline">Requests</span>
                <Badge variant="outline" className="ml-2 hidden md:inline-flex">
                  {taskList.length}
                </Badge>
              </TabsTrigger>
              {canRunAgent ? (
                <TabsTrigger
                  value="codex-console"
                  className="rounded-xl border border-transparent px-4 py-2.5 data-[state=active]:border-border/70 data-[state=active]:bg-background"
                >
                  <BotMessageSquare className="h-4 w-4 md:hidden" />
                  <span className="hidden md:inline">Prism Console</span>
                </TabsTrigger>
              ) : null}
              {canRunAgent ? (
                <TabsTrigger
                  value="capture"
                  className="rounded-xl border border-transparent px-4 py-2.5 data-[state=active]:border-border/70 data-[state=active]:bg-background"
                >
                  <Mic className="h-4 w-4 md:hidden" />
                  <span className="hidden md:inline">Capture</span>
                </TabsTrigger>
              ) : null}
              {canManageTasks ? (
                <TabsTrigger
                  value="tasks"
                  className="rounded-xl border border-transparent px-4 py-2.5 data-[state=active]:border-border/70 data-[state=active]:bg-background"
                >
                  <CalendarClock className="h-4 w-4 md:hidden" />
                  <span className="hidden md:inline">Tasks</span>
                </TabsTrigger>
              ) : null}
              {canManageSkills ? (
                <TabsTrigger
                  value="skills"
                  className="rounded-xl border border-transparent px-4 py-2.5 data-[state=active]:border-border/70 data-[state=active]:bg-background"
                >
                  <BookOpen className="h-4 w-4 md:hidden" />
                  <span className="hidden md:inline">Skills</span>
                </TabsTrigger>
              ) : null}
              {canManageWorkflows ? (
                <TabsTrigger
                  value="workflows"
                  className="rounded-xl border border-transparent px-4 py-2.5 data-[state=active]:border-border/70 data-[state=active]:bg-background"
                >
                  <Workflow className="h-4 w-4 md:hidden" />
                  <span className="hidden md:inline">Workflows</span>
                </TabsTrigger>
              ) : null}
              {canManageWorkflows ? (
                <TabsTrigger
                  value="hooks"
                  className="rounded-xl border border-transparent px-4 py-2.5 data-[state=active]:border-border/70 data-[state=active]:bg-background"
                >
                  <Webhook className="h-4 w-4 md:hidden" />
                  <span className="hidden md:inline">Hooks</span>
                </TabsTrigger>
              ) : null}
              {canManageSettings ? (
                <TabsTrigger
                  value="settings"
                  className="rounded-xl border border-transparent px-4 py-2.5 data-[state=active]:border-border/70 data-[state=active]:bg-background"
                >
                  <Settings className="h-4 w-4 md:hidden" />
                  <span className="hidden md:inline">Settings</span>
                </TabsTrigger>
              ) : null}
            </TabsList>
            {runningCount ? (
              <div className="mt-3 inline-flex items-center gap-2 border border-primary/40 bg-primary/10 px-3 py-1.5 text-sm text-primary">
                <LoaderCircle className="h-4 w-4 animate-spin" />
                Prism is working on {runningCount} request
                {runningCount === 1 ? "" : "s"}
              </div>
            ) : null}
          </div>
        </div>

        <TabsContent value="requests" className="mt-0 flex-1">
          <section
            className={`grid min-h-full gap-0 ${
              selectedRequest ? "" : "xl:grid-cols-[minmax(0,1fr)_360px]"
            }`}
          >
            <div
              className={`border-b border-border/60 xl:border-b-0 ${
                selectedRequest ? "" : "xl:border-r"
              }`}
            >
              <div className="flex items-center justify-between gap-4 border-b border-border/60 px-5 py-4 md:px-6">
                <div className="min-w-0">
                  <h1 className="text-2xl font-semibold tracking-tight">
                    {selectedRequest
                      ? `#${selectedRequest.requestNumber} ${selectedRequest.title}`
                      : "Requests"}
                  </h1>
                  {selectedRequest ? (
                    <div className="mt-2 flex flex-wrap items-center gap-2">
                      <Badge
                        variant={workflowStepVariant(selectedWorkflowStep)}
                      >
                        {selectedWorkflowStep?.label ?? "Request"}
                      </Badge>
                      <Badge
                        variant={priorityVariant(selectedRequest.priority)}
                      >
                        {selectedRequest.priority}
                      </Badge>
                      <Badge variant="outline">
                        {requestTypeLabel(selectedRequest.requestType)}
                      </Badge>
                      <Badge variant="outline">
                        {requestSourceLabel(selectedRequest.source)}
                      </Badge>
                      {selectedEstimatedHumanHoursLabel ? (
                        <Badge variant="outline">
                          {selectedEstimatedHumanHoursLabel}
                        </Badge>
                      ) : null}
                      <span className="text-sm text-muted-foreground">
                        {selectedTargetApp?.name ??
                          selectedRequest.targetAppSlug ??
                          "Unknown target"}
                        {selectedTargetEnvironment
                          ? ` / ${selectedTargetEnvironment.name}`
                          : ""}
                      </span>
                    </div>
                  ) : (
                    <p className="text-sm text-muted-foreground">
                      Open a request to review context, comments, execution
                      history, and agent controls.
                    </p>
                  )}
                </div>
                {selectedRequest ? (
                  <Button
                    type="button"
                    variant="outline"
                    onClick={() => {
                      setSelectedRequestId(null);
                      setModalError(null);
                      updateAdminUrl({ tab: "requests", request: null });
                    }}
                  >
                    <X className="h-4 w-4" />
                    Close
                  </Button>
                ) : canCreateRequest ? (
                  <Button
                    type="button"
                    onClick={() => setIsNewRequestOpen(true)}
                  >
                    <FilePlus className="h-4 w-4" />
                    Add Request
                  </Button>
                ) : null}
              </div>

              {selectedRequest ? (
                <ScrollArea className="h-[calc(100vh-190px)]">
                  <RequestDetailsPanel
                    request={selectedRequest}
                    targetApp={selectedTargetApp}
                    targetEnvironment={selectedTargetEnvironment}
                    workflow={selectedWorkflow}
                    isPending={isSaving}
                    error={modalError}
                    canComment={canComment}
                    canRunWorkflowActions={canRunAgent}
                    onSave={handleSaveTriage}
                  />
                </ScrollArea>
              ) : (
                <ChangeRequestList
                  requests={taskList}
                  targetApps={data.targetApps}
                  targetEnvironments={data.targetEnvironments}
                  workflows={data.workflows ?? []}
                  requestTypeOptions={requestTypeOptions}
                  lifecycleFilter={lifecycleFilter}
                  typeFilter={typeFilter}
                  repositoryFilter={repositoryFilter}
                  stepFilters={stepFilters}
                  workflowStepOptions={workflowStepOptions}
                  searchQuery={searchQuery}
                  sortValue={sortValue}
                  onLifecycleFilterChange={setLifecycleFilter}
                  onTypeFilterChange={setTypeFilter}
                  onRepositoryFilterChange={setRepositoryFilter}
                  onStepFiltersChange={setStepFilters}
                  onSearchQueryChange={setSearchQuery}
                  onSortValueChange={setSortValue}
                  onOpenRequest={(nextRequest) => {
                    setSelectedRequestId(nextRequest.id);
                    setModalError(null);
                    updateAdminUrl({ tab: "requests", request: nextRequest });
                  }}
                />
              )}
            </div>

            {!selectedRequest ? (
              <aside className="flex flex-col bg-card/30">
                <div className="border-b border-border/60 px-5 py-4 md:px-6">
                  <p className="text-sm font-medium">Workspace Snapshot</p>
                  <p className="mt-1 text-sm text-muted-foreground">
                    Quick read on request and workflow activity.
                  </p>
                </div>
                <div className="grid gap-3 px-5 py-4 md:px-6">
                  <div className="rounded-2xl border border-border/70 bg-background/80 p-4">
                    <p className="text-xs uppercase tracking-[0.16em] text-muted-foreground">
                      Active
                    </p>
                    <p className="mt-2 text-3xl font-semibold">{activeCount}</p>
                  </div>
                  <div className="rounded-2xl border border-border/70 bg-background/80 p-4">
                    <p className="text-xs uppercase tracking-[0.16em] text-muted-foreground">
                      Closed
                    </p>
                    <p className="mt-2 text-3xl font-semibold">{closedCount}</p>
                  </div>
                  <div className="rounded-2xl border border-amber-400/70 bg-amber-50/80 p-4 text-amber-950">
                    <p className="text-xs uppercase tracking-[0.16em] text-amber-900/75">
                      Needs Attention
                    </p>
                    <p className="mt-2 text-3xl font-semibold">{attentionCount}</p>
                  </div>
                  <div className="rounded-2xl border border-border/70 bg-background/80 p-4">
                    <p className="text-xs uppercase tracking-[0.16em] text-muted-foreground">
                      Active Human Estimate
                    </p>
                    <p className="mt-2 text-3xl font-semibold">
                      {estimatedHumanHoursActiveLabel ?? "0h human"}
                    </p>
                    <p className="mt-1 text-xs text-muted-foreground">
                      {estimatedHumanHoursTotalLabel ?? "0h human"} total
                      estimated
                    </p>
                  </div>
                  <div className="rounded-2xl border border-border/70 bg-background/80 p-4">
                    <p className="text-xs uppercase tracking-[0.16em] text-muted-foreground">
                      Repositories
                    </p>
                    <p className="mt-2 text-3xl font-semibold">
                      {data.targetApps.length}
                    </p>
                  </div>
                  <div className="rounded-2xl border border-border/70 bg-background/80 p-4">
                    <p className="text-xs uppercase tracking-[0.16em] text-muted-foreground">
                      Environments
                    </p>
                    <p className="mt-2 text-3xl font-semibold">
                      {data.targetEnvironments.length}
                    </p>
                  </div>
                </div>
              </aside>
            ) : null}
          </section>
        </TabsContent>

        <TabsContent value="codex-console" className="mt-0 flex-1">
          <section className="min-h-full">
            <div className="flex flex-col gap-3 border-b border-border/60 px-5 py-4 sm:flex-row sm:items-start sm:justify-between md:px-6">
              <div className="min-w-0">
                <h1 className="text-2xl font-semibold tracking-tight">
                  Prism Console
                </h1>
                <p className="text-sm text-muted-foreground">
                  Work directly with Prism on request context, review state, and
                  implementation planning.
                </p>
              </div>
              <div
                id={codexConsoleSessionControlsId}
                className="flex shrink-0 justify-start sm:justify-end"
              />
            </div>

            <CodexConsole
              isActive={activeTab === "codex-console"}
              sessionControlsTargetId={codexConsoleSessionControlsId}
            />
          </section>
        </TabsContent>

        <TabsContent value="tasks" className="mt-0 flex-1">
          <section className="min-h-full">
            <TaskRunnerWorkspace />
          </section>
        </TabsContent>

        <TabsContent value="capture" className="mt-0 flex-1">
          <section className="min-h-full">
            <CaptureWorkspace />
          </section>
        </TabsContent>

        <TabsContent value="skills" className="mt-0 flex-1">
          <section className="min-h-full">
            <SkillsWorkspace />
          </section>
        </TabsContent>

        <TabsContent value="workflows" className="mt-0 flex-1">
          <section className="min-h-full">
            <WorkflowsWorkspace />
          </section>
        </TabsContent>

        <TabsContent value="hooks" className="mt-0 flex-1">
          <section className="min-h-full">
            <HooksWorkspace />
          </section>
        </TabsContent>

        <TabsContent value="settings" className="mt-0 flex-1">
          <section className="min-h-full">
            <div className="border-b border-border/60 px-5 py-4 md:px-6">
              <h1 className="text-2xl font-semibold tracking-tight">
                Settings
              </h1>
              <p className="text-sm text-muted-foreground">
                Configure Prism without moving secrets into the app.
              </p>
            </div>

            <AdminSettingsWorkspace
              setup={data.setup}
              updateStatus={data.updateStatus}
              branding={data.branding}
              onBrandingChange={(branding) =>
                setData((current) => ({
                  ...current,
                  branding,
                }))
              }
              targetApps={data.targetApps}
              targetEnvironments={data.targetEnvironments}
              session={data.session}
            />
          </section>
        </TabsContent>
      </Tabs>

      <NewChangeRequestDialog
        open={isNewRequestOpen}
        onOpenChange={setIsNewRequestOpen}
        targetApps={data.targetApps}
        workflows={data.workflows ?? []}
      />
    </main>
  );
}
