"use client";

import { useEffect, useMemo, useRef, useState, useTransition } from "react";
import { Edit3, Eye, FileText, GitBranch, RefreshCw, Route, Save, X } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Textarea } from "@/components/ui/textarea";

type WorkflowRecord = {
  id: string;
  key: string;
  name: string;
  description: string | null;
  version: number;
  definition: Record<string, unknown>;
  systemDefault: boolean;
  enabled: boolean;
  createdAt: string;
  updatedAt: string;
};

type WorkflowsPayload = {
  ok?: boolean;
  workflows?: WorkflowRecord[];
  error?: string;
};

type WorkflowStepDetail = {
  key: string;
  label: string;
  type: string;
  instructionPath: string | null;
  resolvedInstructionPath: string | null;
  instructionContent: string | null;
};

type WorkflowDetail = {
  workflowPath: string | null;
  resolvedWorkflowPath: string | null;
  workflowContent: string | null;
  steps: WorkflowStepDetail[];
};

type WorkflowDetailPayload = {
  ok?: boolean;
  workflow?: WorkflowRecord;
  detail?: WorkflowDetail;
  error?: string;
};

type WorkflowView = "custom" | "system";

function workflowSteps(workflow: WorkflowRecord) {
  return Array.isArray(workflow.definition.steps)
    ? workflow.definition.steps.filter(
        (step): step is Record<string, unknown> =>
          Boolean(step) && typeof step === "object" && !Array.isArray(step),
      )
    : [];
}

function stepLabel(step: Record<string, unknown>) {
  return typeof step.label === "string" && step.label.trim()
    ? step.label
    : typeof step.name === "string" && step.name.trim()
      ? step.name
      : typeof step.key === "string"
        ? step.key
        : "Step";
}

function stepType(step: Record<string, unknown>) {
  return typeof step.type === "string" && step.type.trim()
    ? step.type
    : "unknown";
}

function stepKey(step: Record<string, unknown>, index: number) {
  return typeof step.key === "string" && step.key.trim()
    ? step.key
    : `step-${index + 1}`;
}

function stepDotClass(type: string) {
  if (type === "terminal") {
    return "border-muted-foreground/70 bg-background text-muted-foreground";
  }
  if (type === "gate") {
    return "border-primary bg-primary/10 text-primary";
  }
  if (type === "checkpoint") {
    return "border-border bg-muted/40 text-foreground";
  }
  if (type === "loop") {
    return "border-amber-500/70 bg-amber-500/10 text-amber-700";
  }
  if (type === "agent") {
    return "border-primary/80 bg-primary/10 text-primary";
  }
  return "border-border bg-background text-muted-foreground";
}

function WorkflowStepMap({ steps }: { steps: Record<string, unknown>[] }) {
  if (!steps.length) {
    return (
      <div className="border-t border-border/60 pt-4 text-sm text-muted-foreground">
        No steps in definition.
      </div>
    );
  }

  return (
    <div className="border-t border-border/60 pt-4">
      <div
        className="relative flex flex-col gap-3 md:grid"
        style={{
          gridTemplateColumns:
            steps.length > 1
              ? `repeat(${steps.length}, minmax(0, 1fr))`
              : "minmax(0, 1fr)",
        }}
      >
        {steps.length > 1 ? (
          <div
            className="absolute top-3 hidden h-px bg-border md:block"
            style={{
              left: `calc(100% / ${steps.length * 2})`,
              right: `calc(100% / ${steps.length * 2})`,
            }}
          />
        ) : null}
        {steps.map((step, index) => {
          const type = stepType(step);

          return (
            <div
              key={stepKey(step, index)}
              className="relative flex min-w-0 gap-3 md:block"
            >
              {index < steps.length - 1 ? (
                <div className="absolute left-3 top-6 h-[calc(100%+0.75rem)] w-px bg-border md:hidden" />
              ) : null}
              <div className="relative z-10 flex h-6 w-6 shrink-0 items-center justify-center md:mx-auto">
                <div
                  className={[
                    "flex h-6 w-6 items-center justify-center rounded-full border text-[10px] font-semibold",
                    stepDotClass(type),
                  ].join(" ")}
                >
                  {index + 1}
                </div>
              </div>
              <div className="min-w-0 md:mt-2 md:text-center">
                <p className="truncate text-sm font-medium">
                  {stepLabel(step)}
                </p>
                <p className="truncate text-xs text-muted-foreground">
                  {type}
                </p>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

export function WorkflowsWorkspace() {
  const [workflows, setWorkflows] = useState<WorkflowRecord[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [selectedWorkflow, setSelectedWorkflow] =
    useState<WorkflowRecord | null>(null);
  const [selectedWorkflowDetail, setSelectedWorkflowDetail] =
    useState<WorkflowDetail | null>(null);
  const [detailError, setDetailError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [isDetailLoading, setIsDetailLoading] = useState(false);
  const [isEditingJson, setIsEditingJson] = useState(false);
  const [definitionDraft, setDefinitionDraft] = useState("");
  const [activeView, setActiveView] = useState<WorkflowView>("custom");
  const [isRefreshing, startRefresh] = useTransition();
  const detailRequestRef = useRef(0);

  async function loadWorkflows() {
    const response = await fetch("/admin/workflows", { cache: "no-store" });
    const payload = (await response.json()) as WorkflowsPayload;
    if (!response.ok || !payload.ok || !Array.isArray(payload.workflows)) {
      throw new Error(payload.error || "Could not load workflows");
    }
    setWorkflows(payload.workflows);
    setError(null);
  }

  function refresh() {
    setError(null);
    startRefresh(async () => {
      try {
        await loadWorkflows();
      } catch (nextError) {
        setError(
          nextError instanceof Error
            ? nextError.message
            : "Could not load workflows",
        );
      }
    });
  }

  async function openWorkflow(workflow: WorkflowRecord) {
    const requestToken = detailRequestRef.current + 1;
    detailRequestRef.current = requestToken;
    setSelectedWorkflow(workflow);
    setSelectedWorkflowDetail(null);
    setDetailError(null);
    setIsEditingJson(false);
    setDefinitionDraft(JSON.stringify(workflow.definition, null, 2));
    setIsDetailLoading(true);
    try {
      const response = await fetch(
        `/admin/workflows/${encodeURIComponent(workflow.key)}`,
        { cache: "no-store" },
      );
      const payload = (await response.json()) as WorkflowDetailPayload;
      if (!response.ok || !payload.ok || !payload.detail) {
        throw new Error(payload.error || "Could not load workflow detail");
      }
      if (detailRequestRef.current !== requestToken) return;
      setSelectedWorkflow(payload.workflow ?? workflow);
      setDefinitionDraft(JSON.stringify((payload.workflow ?? workflow).definition, null, 2));
      setSelectedWorkflowDetail(payload.detail);
    } catch (nextError) {
      if (detailRequestRef.current !== requestToken) return;
      setDetailError(
        nextError instanceof Error
          ? nextError.message
          : "Could not load workflow detail",
      );
    } finally {
      if (detailRequestRef.current === requestToken) {
        setIsDetailLoading(false);
      }
    }
  }

  async function saveWorkflowDefinition() {
    if (!selectedWorkflow) return;
    let definition: Record<string, unknown>;
    try {
      const parsed = JSON.parse(definitionDraft) as unknown;
      if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
        throw new Error("Workflow JSON must be an object.");
      }
      definition = parsed as Record<string, unknown>;
    } catch (parseError) {
      setDetailError(parseError instanceof Error ? parseError.message : "Workflow JSON is invalid.");
      return;
    }

    setDetailError(null);
    setMessage(null);
    setIsDetailLoading(true);
    try {
      const response = await fetch(`/admin/workflows/${encodeURIComponent(selectedWorkflow.key)}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ definition }),
      });
      const payload = (await response.json().catch(() => ({}))) as WorkflowDetailPayload;
      if (!response.ok || !payload.ok || !payload.workflow) {
        throw new Error(payload.error || "Could not save workflow definition");
      }
      setSelectedWorkflow(payload.workflow);
      setDefinitionDraft(JSON.stringify(payload.workflow.definition, null, 2));
      setWorkflows((current) => current.map((workflow) => workflow.key === payload.workflow?.key ? payload.workflow : workflow));
      setIsEditingJson(false);
      setMessage(`Saved workflow ${payload.workflow.key}`);
      await openWorkflow(payload.workflow);
    } catch (saveError) {
      setDetailError(saveError instanceof Error ? saveError.message : "Could not save workflow definition");
    } finally {
      setIsDetailLoading(false);
    }
  }

  useEffect(() => {
    refresh();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const counts = useMemo(
    () => ({
      total: workflows.length,
      enabled: workflows.filter((workflow) => workflow.enabled).length,
      system: workflows.filter((workflow) => workflow.systemDefault).length,
    }),
    [workflows],
  );
  const customWorkflows = useMemo(
    () => workflows.filter((workflow) => !workflow.systemDefault),
    [workflows],
  );
  const systemWorkflows = useMemo(
    () => workflows.filter((workflow) => workflow.systemDefault),
    [workflows],
  );
  const viewOptions: Array<{
    value: WorkflowView;
    label: string;
    count: number;
  }> = [
    {
      value: "custom",
      label: "Custom Workflows",
      count: customWorkflows.length,
    },
    {
      value: "system",
      label: "System Workflows",
      count: systemWorkflows.length,
    },
  ];

  function renderWorkflow(workflow: WorkflowRecord) {
    const steps = workflowSteps(workflow);
    return (
      <div
        key={workflow.key}
        className="grid gap-4 border border-border/70 bg-background p-4"
      >
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-2">
              <Route className="h-4 w-4 text-muted-foreground" />
              <h2 className="text-base font-semibold">{workflow.name}</h2>
              <Badge variant={workflow.enabled ? "default" : "outline"}>
                {workflow.enabled ? "enabled" : "disabled"}
              </Badge>
              {workflow.systemDefault ? (
                <Badge variant="outline">system</Badge>
              ) : null}
              <Badge variant="outline">v{workflow.version}</Badge>
            </div>
            <p className="mt-2 text-sm text-muted-foreground">
              {workflow.description || "No description found."}
            </p>
            <p className="mt-2 truncate text-xs text-muted-foreground">
              {workflow.key}
            </p>
          </div>

          <Button
            type="button"
            variant="outline"
            className="shrink-0"
            onClick={() => openWorkflow(workflow)}
          >
            <Eye className="h-4 w-4" />
            View
          </Button>
        </div>

        <WorkflowStepMap steps={steps} />
      </div>
    );
  }

  return (
    <div className="grid gap-5">
      <div className="flex flex-wrap items-start justify-between gap-3 border-b border-border/60 px-5 py-4 md:px-6">
        <div className="min-w-0">
          <h1 className="text-2xl font-semibold tracking-tight">Workflows</h1>
          <p className="text-sm text-muted-foreground">
            View request workflow definitions and their agent configuration.
          </p>
        </div>
        <Button
          type="button"
          variant="outline"
          onClick={refresh}
          disabled={isRefreshing}
        >
          <RefreshCw
            className={`h-4 w-4 ${isRefreshing ? "animate-spin" : ""}`}
          />
          Refresh
        </Button>
      </div>

      <section className="grid gap-5 px-5 md:px-6">
        <section className="grid gap-3 md:grid-cols-3">
          <div className="border border-border/70 bg-background p-4">
            <p className="text-xs uppercase tracking-[0.16em] text-muted-foreground">
              Workflows
            </p>
            <p className="mt-2 text-3xl font-semibold">{counts.total}</p>
          </div>
          <div className="border border-border/70 bg-background p-4">
            <p className="text-xs uppercase tracking-[0.16em] text-muted-foreground">
              Enabled
            </p>
            <p className="mt-2 text-3xl font-semibold">{counts.enabled}</p>
          </div>
          <div className="border border-border/70 bg-background p-4">
            <p className="text-xs uppercase tracking-[0.16em] text-muted-foreground">
              System
            </p>
            <p className="mt-2 text-3xl font-semibold">{counts.system}</p>
          </div>
        </section>

        <div className="inline-flex h-auto flex-wrap bg-transparent p-0">
          {viewOptions.map((option) => {
            const isActive = option.value === activeView;
            return (
              <button
                key={option.value}
                type="button"
                aria-pressed={isActive}
                onClick={() => setActiveView(option.value)}
                className={[
                  "rounded-xl border px-4 py-2.5 text-sm font-medium transition-colors",
                  isActive
                    ? "border-border/70 bg-background text-foreground"
                    : "border-transparent text-muted-foreground hover:text-foreground",
                ].join(" ")}
              >
                {option.label}
                <span className="ml-2 text-muted-foreground">
                  {option.count}
                </span>
              </button>
            );
          })}
        </div>

        {error ? (
          <div className="border border-destructive/40 bg-destructive/10 px-4 py-3 text-sm text-destructive">
            {error}
          </div>
        ) : null}

        {activeView === "custom" ? (
          <section className="grid gap-3">
            {customWorkflows.map(renderWorkflow)}
            {!customWorkflows.length && !error ? (
              <div className="border border-border/70 bg-background px-4 py-6 text-sm text-muted-foreground">
                No custom workflows registered.
              </div>
            ) : null}
          </section>
        ) : null}

        {activeView === "system" ? (
          <section className="grid gap-3">
            {systemWorkflows.map(renderWorkflow)}
            {!systemWorkflows.length && !error ? (
              <div className="border border-border/70 bg-background px-4 py-6 text-sm text-muted-foreground">
                No system workflows registered.
              </div>
            ) : null}
          </section>
        ) : null}

        <section className="grid gap-3">
          {!workflows.length && !error ? (
            <div className="border border-border/70 bg-background px-4 py-8 text-sm text-muted-foreground">
              No workflows registered.
            </div>
          ) : null}
        </section>
      </section>

      <Dialog
        open={Boolean(selectedWorkflow)}
        onOpenChange={(open) => {
          if (!open) {
            detailRequestRef.current += 1;
            setSelectedWorkflow(null);
            setSelectedWorkflowDetail(null);
            setDetailError(null);
            setIsEditingJson(false);
            setDefinitionDraft("");
            setIsDetailLoading(false);
          }
        }}
      >
        <DialogContent className="flex max-h-[90vh] max-w-5xl flex-col overflow-hidden">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <GitBranch className="h-4 w-4" />
              {selectedWorkflow?.name ?? "Workflow"}
            </DialogTitle>
          </DialogHeader>
          {detailError ? (
            <div className="border border-destructive/40 bg-destructive/10 px-4 py-3 text-sm text-destructive">
              {detailError}
            </div>
          ) : null}
          {message ? (
            <div className="border border-border bg-background px-4 py-3 text-sm">
              {message}
            </div>
          ) : null}
          <Tabs
            defaultValue="overview"
            className="flex min-h-0 flex-1 flex-col gap-4"
          >
            <TabsList className="h-auto shrink-0 flex-wrap rounded-none bg-muted/50 p-1">
              <TabsTrigger value="overview">Overview</TabsTrigger>
              <TabsTrigger value="steps">Steps</TabsTrigger>
              <TabsTrigger value="json">JSON</TabsTrigger>
            </TabsList>

            <TabsContent value="overview" className="mt-0 min-h-0 flex-1">
              <ScrollArea className="h-[calc(90vh-180px)] border border-border/70 bg-muted/20">
                <div className="space-y-4 p-4">
                  <div className="flex flex-wrap items-center gap-2">
                    <Badge
                      variant={
                        selectedWorkflow?.enabled ? "default" : "outline"
                      }
                    >
                      {selectedWorkflow?.enabled ? "enabled" : "disabled"}
                    </Badge>
                    {selectedWorkflow?.systemDefault ? (
                      <Badge variant="outline">system</Badge>
                    ) : null}
                    {selectedWorkflow ? (
                      <Badge variant="outline">
                        v{selectedWorkflow.version}
                      </Badge>
                    ) : null}
                  </div>
                  <div className="text-sm text-muted-foreground">
                    {selectedWorkflowDetail?.workflowPath ??
                      "No workflow markdown path configured."}
                  </div>
                  {isDetailLoading ? (
                    <p className="text-sm text-muted-foreground">
                      Loading workflow markdown...
                    </p>
                  ) : selectedWorkflowDetail?.workflowContent ? (
                    <pre className="whitespace-pre-wrap break-words text-sm leading-6">
                      {selectedWorkflowDetail.workflowContent}
                    </pre>
                  ) : (
                    <div className="border border-dashed border-border px-4 py-8 text-center text-sm text-muted-foreground">
                      No workflow markdown found.
                    </div>
                  )}
                </div>
              </ScrollArea>
            </TabsContent>

            <TabsContent value="steps" className="mt-0 min-h-0 flex-1">
              <ScrollArea className="h-[calc(90vh-180px)] border border-border/70 bg-muted/20">
                <div className="space-y-4 p-4">
                  {isDetailLoading ? (
                    <p className="text-sm text-muted-foreground">
                      Loading step instructions...
                    </p>
                  ) : selectedWorkflowDetail?.steps.length ? (
                    selectedWorkflowDetail.steps.map((step, index) => (
                      <div
                        key={`${step.key}:${index}`}
                        className="border border-border/70 bg-background p-4"
                      >
                        <div className="flex flex-wrap items-center justify-between gap-3">
                          <div className="min-w-0">
                            <div className="flex flex-wrap items-center gap-2">
                              <div className="flex h-7 w-7 items-center justify-center border border-border/70 bg-muted/30 text-xs">
                                {index + 1}
                              </div>
                              <h3 className="font-semibold">
                                {step.label || step.key || "Step"}
                              </h3>
                              <Badge variant="outline">{step.type}</Badge>
                            </div>
                            <p className="mt-2 break-all text-xs text-muted-foreground">
                              {step.instructionPath ??
                                "No instruction path configured."}
                            </p>
                          </div>
                        </div>
                        {step.instructionContent ? (
                          <pre className="mt-4 whitespace-pre-wrap break-words border border-border/60 bg-muted/20 p-3 text-sm leading-6">
                            {step.instructionContent}
                          </pre>
                        ) : (
                          <div className="mt-4 flex items-center gap-2 border border-dashed border-border px-4 py-6 text-sm text-muted-foreground">
                            <FileText className="h-4 w-4" />
                            No markdown instructions found for this step.
                          </div>
                        )}
                      </div>
                    ))
                  ) : (
                    <div className="border border-dashed border-border px-4 py-8 text-center text-sm text-muted-foreground">
                      No steps in definition.
                    </div>
                  )}
                </div>
              </ScrollArea>
            </TabsContent>

            <TabsContent value="json" className="mt-0 min-h-0 flex-1">
              <div className="grid h-[calc(90vh-180px)] gap-3">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <p className="text-sm text-muted-foreground">
                    Edit the workflow definition JSON. Markdown instruction files remain file-backed.
                  </p>
                  <div className="flex flex-wrap gap-2">
                    {isEditingJson ? (
                      <>
                        <Button type="button" onClick={saveWorkflowDefinition} disabled={isDetailLoading}>
                          <Save className="h-4 w-4" />
                          Save
                        </Button>
                        <Button
                          type="button"
                          variant="outline"
                          onClick={() => {
                            setIsEditingJson(false);
                            setDefinitionDraft(selectedWorkflow ? JSON.stringify(selectedWorkflow.definition, null, 2) : "");
                          }}
                          disabled={isDetailLoading}
                        >
                          <X className="h-4 w-4" />
                          Cancel
                        </Button>
                      </>
                    ) : (
                      <Button type="button" variant="outline" onClick={() => setIsEditingJson(true)}>
                        <Edit3 className="h-4 w-4" />
                        Edit JSON
                      </Button>
                    )}
                  </div>
                </div>
                {isEditingJson ? (
                  <Textarea
                    value={definitionDraft}
                    onChange={(event) => setDefinitionDraft(event.target.value)}
                    className="min-h-0 flex-1 resize-none font-mono text-xs"
                  />
                ) : (
                  <ScrollArea className="min-h-0 border border-border/70 bg-muted/20">
                    <pre className="whitespace-pre-wrap break-words p-4 text-xs leading-6">
                      {selectedWorkflow ? JSON.stringify(selectedWorkflow.definition, null, 2) : ""}
                    </pre>
                  </ScrollArea>
                )}
              </div>
            </TabsContent>
          </Tabs>
        </DialogContent>
      </Dialog>
    </div>
  );
}
