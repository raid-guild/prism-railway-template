"use client";

import {
  useCallback,
  useEffect,
  useMemo,
  useState,
  useTransition,
} from "react";
import {
  Copy,
  Edit3,
  ExternalLink,
  Play,
  RefreshCw,
  Save,
  Trash2,
  Webhook,
  X,
} from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import type { HookRecord, HookRunRecord } from "@/lib/app-core";

type HooksPayload = {
  ok: boolean;
  hooks?: HookRecord[];
  error?: string;
};

type HookRunsPayload = {
  ok: boolean;
  runs?: HookRunRecord[];
  error?: string;
};

type TriggerPayload = {
  ok: boolean;
  changeRequest?: {
    requestNumber?: number;
    title?: string;
  };
  autoStart?: {
    started?: boolean;
    reason?: string;
  } | null;
  error?: string;
};

type HooksView = "custom" | "built-in" | "runs";

function formatTimestamp(value: string | null) {
  if (!value) return "Not triggered";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function endpointForHook(key: string) {
  return `/agent/hooks/${encodeURIComponent(key)}/trigger`;
}

export function HooksWorkspace() {
  const [hooks, setHooks] = useState<HookRecord[]>([]);
  const [runs, setRuns] = useState<HookRunRecord[]>([]);
  const [payloads, setPayloads] = useState<Record<string, string>>({});
  const [editingHookKey, setEditingHookKey] = useState<string | null>(null);
  const [configDrafts, setConfigDrafts] = useState<Record<string, { requestTemplate: string; autoRun: string }>>({});
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [activeView, setActiveView] = useState<HooksView>("custom");
  const [isPending, startTransition] = useTransition();

  const loadHooks = useCallback(() => {
    startTransition(async () => {
      setError(null);
      try {
        const [hooksResponse, runsResponse] = await Promise.all([
          fetch("/admin/hooks", { cache: "no-store" }),
          fetch("/admin/hooks/runs?limit=50", { cache: "no-store" }),
        ]);
        const hooksPayload = (await hooksResponse
          .json()
          .catch(() => ({}))) as HooksPayload;
        const runsPayload = (await runsResponse
          .json()
          .catch(() => ({}))) as HookRunsPayload;
        if (!hooksResponse.ok || !hooksPayload.ok) {
          throw new Error(hooksPayload.error || "Could not load hooks");
        }
        if (!runsResponse.ok || !runsPayload.ok) {
          throw new Error(runsPayload.error || "Could not load hook runs");
        }
        setHooks(hooksPayload.hooks ?? []);
        setRuns(runsPayload.runs ?? []);
      } catch (loadError) {
        setError(
          loadError instanceof Error
            ? loadError.message
            : "Could not load hooks",
        );
      }
    });
  }, []);

  useEffect(() => {
    loadHooks();
  }, [loadHooks]);

  const customHooks = useMemo(
    () => hooks.filter((hook) => !hook.systemDefault),
    [hooks],
  );
  const systemHooks = useMemo(
    () => hooks.filter((hook) => hook.systemDefault),
    [hooks],
  );
  const enabledHookCount = useMemo(
    () => hooks.filter((hook) => hook.enabled).length,
    [hooks],
  );
  const viewOptions: Array<{ value: HooksView; label: string; count: number }> =
    [
      { value: "custom", label: "Custom Hooks", count: customHooks.length },
      { value: "built-in", label: "Built-In Hooks", count: systemHooks.length },
      { value: "runs", label: "Recent Runs", count: runs.length },
    ];
  const runsByHook = useMemo(() => {
    const grouped = new Map<string, HookRunRecord[]>();
    for (const run of runs) {
      const hookRuns = grouped.get(run.hookKey) ?? [];
      hookRuns.push(run);
      grouped.set(run.hookKey, hookRuns);
    }
    return grouped;
  }, [runs]);

  function updateHook(hook: HookRecord, update: Partial<HookRecord>) {
    startTransition(async () => {
      setError(null);
      setMessage(null);
      try {
        const response = await fetch(
          `/admin/hooks/${encodeURIComponent(hook.key)}`,
          {
            method: "PATCH",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(update),
          },
        );
        const payload = (await response.json().catch(() => ({}))) as {
          ok?: boolean;
          hook?: HookRecord;
          error?: string;
        };
        if (!response.ok || !payload.ok || !payload.hook) {
          throw new Error(payload.error || "Could not update hook");
        }
        setHooks((current) =>
          current.map((item) =>
            item.key === hook.key ? (payload.hook as HookRecord) : item,
          ),
        );
      } catch (updateError) {
        setError(
          updateError instanceof Error
            ? updateError.message
            : "Could not update hook",
        );
      }
    });
  }

  function beginEditHook(hook: HookRecord) {
    setEditingHookKey(hook.key);
    setConfigDrafts((current) => ({
      ...current,
      [hook.key]: current[hook.key] ?? {
        requestTemplate: JSON.stringify(hook.requestTemplate ?? {}, null, 2),
        autoRun: JSON.stringify(hook.autoRun ?? {}, null, 2),
      },
    }));
  }

  function cancelEditHook(hook: HookRecord) {
    setEditingHookKey(null);
    setConfigDrafts((current) => {
      const next = { ...current };
      delete next[hook.key];
      return next;
    });
  }

  function updateConfigDraft(hook: HookRecord, field: "requestTemplate" | "autoRun", value: string) {
    setConfigDrafts((current) => ({
      ...current,
      [hook.key]: {
        requestTemplate: current[hook.key]?.requestTemplate ?? JSON.stringify(hook.requestTemplate ?? {}, null, 2),
        autoRun: current[hook.key]?.autoRun ?? JSON.stringify(hook.autoRun ?? {}, null, 2),
        [field]: value,
      },
    }));
  }

  function saveHookConfig(hook: HookRecord) {
    const draft = configDrafts[hook.key];
    if (!draft) return;
    let requestTemplate: Record<string, unknown>;
    let autoRun: Record<string, unknown>;
    try {
      const parsedRequestTemplate = JSON.parse(draft.requestTemplate) as unknown;
      const parsedAutoRun = JSON.parse(draft.autoRun) as unknown;
      requestTemplate = parsedRequestTemplate && typeof parsedRequestTemplate === "object" && !Array.isArray(parsedRequestTemplate)
        ? parsedRequestTemplate as Record<string, unknown>
        : {};
      autoRun = parsedAutoRun && typeof parsedAutoRun === "object" && !Array.isArray(parsedAutoRun)
        ? parsedAutoRun as Record<string, unknown>
        : {};
    } catch {
      setError("Hook config must be valid JSON objects.");
      return;
    }
    updateHook(hook, { requestTemplate, autoRun });
    setEditingHookKey(null);
  }

  function deleteHook(hook: HookRecord) {
    if (hook.systemDefault) return;
    startTransition(async () => {
      setError(null);
      setMessage(null);
      try {
        const response = await fetch(
          `/admin/hooks/${encodeURIComponent(hook.key)}`,
          { method: "DELETE" },
        );
        const payload = (await response.json().catch(() => ({}))) as {
          ok?: boolean;
          error?: string;
        };
        if (!response.ok || !payload.ok) {
          throw new Error(payload.error || "Could not delete hook");
        }
        setHooks((current) => current.filter((item) => item.key !== hook.key));
      } catch (deleteError) {
        setError(
          deleteError instanceof Error
            ? deleteError.message
            : "Could not delete hook",
        );
      }
    });
  }

  function triggerHook(hook: HookRecord) {
    const rawPayload = payloads[hook.key]?.trim() || "{}";
    let parsedPayload: Record<string, unknown>;
    try {
      const parsed = JSON.parse(rawPayload) as unknown;
      parsedPayload =
        parsed && typeof parsed === "object" && !Array.isArray(parsed)
          ? (parsed as Record<string, unknown>)
          : {};
    } catch {
      setError("Test payload must be valid JSON");
      return;
    }

    startTransition(async () => {
      setError(null);
      setMessage(null);
      try {
        const response = await fetch(
          `/admin/hooks/${encodeURIComponent(hook.key)}/trigger`,
          {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(parsedPayload),
          },
        );
        const payload = (await response
          .json()
          .catch(() => ({}))) as TriggerPayload;
        if (!response.ok || !payload.ok) {
          throw new Error(payload.error || "Could not trigger hook");
        }
        setMessage(
          `Created request #${payload.changeRequest?.requestNumber ?? "?"}: ${payload.changeRequest?.title ?? hook.name}`,
        );
        loadHooks();
      } catch (triggerError) {
        setError(
          triggerError instanceof Error
            ? triggerError.message
            : "Could not trigger hook",
        );
      }
    });
  }

  function copyEndpoint(hook: HookRecord) {
    void navigator.clipboard?.writeText(endpointForHook(hook.key));
    setMessage(`Copied ${endpointForHook(hook.key)}`);
  }

  function runSummary(run: HookRunRecord) {
    if (run.status === "succeeded" && run.requestNumber) {
      return `${run.hookName ?? run.hookKey} triggered request #${run.requestNumber}`;
    }
    if (run.status === "failed") {
      return `${run.hookName ?? run.hookKey} failed`;
    }
    return `${run.hookName ?? run.hookKey} is running`;
  }

  function renderRun(run: HookRunRecord, compact = false) {
    return (
      <div
        key={run.id}
        className="flex flex-col gap-2 border border-border bg-background/70 p-3 md:flex-row md:items-center md:justify-between"
      >
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <Badge
              variant={
                run.status === "succeeded"
                  ? "secondary"
                  : run.status === "failed"
                    ? "destructive"
                    : "outline"
              }
            >
              {run.status}
            </Badge>
            <p className="text-sm font-medium">{runSummary(run)}</p>
          </div>
          <p className="mt-1 truncate text-xs text-muted-foreground">
            {formatTimestamp(run.startedAt)}
            {run.agentRunId ? ` - run ${run.agentRunId.slice(0, 8)}` : ""}
            {run.requestTitle ? ` - ${run.requestTitle}` : ""}
            {run.errorMessage ? ` - ${run.errorMessage}` : ""}
          </p>
        </div>
        {run.requestNumber ? (
          <Button
            asChild
            type="button"
            variant="outline"
            size={compact ? "sm" : "default"}
          >
            <a href={`/admin?tab=requests&request=${run.requestNumber}`}>
              <ExternalLink className="mr-2 h-4 w-4" />
              Request #{run.requestNumber}
            </a>
          </Button>
        ) : null}
      </div>
    );
  }

  function renderHook(hook: HookRecord) {
    const hookRuns = runsByHook.get(hook.key) ?? [];
    return (
      <div key={hook.id} className="border border-border bg-card/70 p-4">
        <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
          <div className="min-w-0 space-y-2">
            <div className="flex flex-wrap items-center gap-2">
              <h3 className="text-base font-semibold">{hook.name}</h3>
              <Badge variant="outline">{hook.key}</Badge>
              <Badge variant={hook.enabled ? "secondary" : "muted"}>
                {hook.enabled ? "Enabled" : "Disabled"}
              </Badge>
              {hook.systemDefault ? (
                <Badge variant="outline">Built-in</Badge>
              ) : null}
            </div>
            <p className="text-sm text-muted-foreground">
              {hook.description || "No description."}
            </p>
            <div className="flex flex-wrap gap-3 text-xs text-muted-foreground">
              <span>Workflow: {hook.workflowKey}</span>
              <span>Auth: {hook.authMode}</span>
              <span>Last trigger: {formatTimestamp(hook.lastTriggeredAt)}</span>
            </div>
            <code className="block break-all border border-border bg-background p-2 text-xs">
              POST {endpointForHook(hook.key)}
            </code>
          </div>
          <div className="flex items-center gap-2">
            <Switch
              checked={hook.enabled}
              onCheckedChange={(enabled) => updateHook(hook, { enabled })}
              disabled={isPending}
            />
            <Button
              type="button"
              variant="outline"
              size="icon"
              onClick={() => beginEditHook(hook)}
              title="Edit hook config"
            >
              <Edit3 className="h-4 w-4" />
            </Button>
            <Button
              type="button"
              variant="outline"
              size="icon"
              onClick={() => copyEndpoint(hook)}
              title="Copy endpoint"
            >
              <Copy className="h-4 w-4" />
            </Button>
            {!hook.systemDefault ? (
              <Button
                type="button"
                variant="outline"
                size="icon"
                onClick={() => deleteHook(hook)}
                title="Delete hook"
              >
                <Trash2 className="h-4 w-4" />
              </Button>
            ) : null}
          </div>
        </div>
        {editingHookKey === hook.key ? (
          <div className="mt-4 grid gap-3 border border-border bg-background p-3">
            <div className="flex items-center justify-between gap-3">
              <p className="text-xs font-semibold uppercase tracking-[0.16em] text-muted-foreground">
                Hook Config
              </p>
              {hook.systemDefault ? <Badge variant="outline">Built-in editable</Badge> : null}
            </div>
            <div className="grid gap-2">
              <label className="text-xs font-semibold uppercase tracking-[0.16em] text-muted-foreground">
                Request Template
              </label>
              <Textarea
                value={configDrafts[hook.key]?.requestTemplate ?? JSON.stringify(hook.requestTemplate ?? {}, null, 2)}
                onChange={(event) => updateConfigDraft(hook, "requestTemplate", event.target.value)}
                rows={12}
                className="font-mono text-xs"
              />
            </div>
            <div className="grid gap-2">
              <label className="text-xs font-semibold uppercase tracking-[0.16em] text-muted-foreground">
                Auto Run
              </label>
              <Textarea
                value={configDrafts[hook.key]?.autoRun ?? JSON.stringify(hook.autoRun ?? {}, null, 2)}
                onChange={(event) => updateConfigDraft(hook, "autoRun", event.target.value)}
                rows={5}
                className="font-mono text-xs"
              />
            </div>
            <div className="flex flex-wrap gap-2">
              <Button type="button" onClick={() => saveHookConfig(hook)} disabled={isPending}>
                <Save className="mr-2 h-4 w-4" />
                Save Config
              </Button>
              <Button type="button" variant="outline" onClick={() => cancelEditHook(hook)} disabled={isPending}>
                <X className="mr-2 h-4 w-4" />
                Cancel
              </Button>
            </div>
          </div>
        ) : null}
        <div className="mt-4 space-y-2">
          <label className="text-xs font-semibold uppercase tracking-[0.16em] text-muted-foreground">
            Test Payload
          </label>
          <Textarea
            value={payloads[hook.key] ?? "{}"}
            onChange={(event) =>
              setPayloads((current) => ({
                ...current,
                [hook.key]: event.target.value,
              }))
            }
            rows={4}
            className="font-mono text-xs"
          />
          <Button
            type="button"
            onClick={() => triggerHook(hook)}
            disabled={isPending || !hook.enabled}
          >
            <Play className="mr-2 h-4 w-4" />
            Test trigger
          </Button>
        </div>
        <div className="mt-4 space-y-2">
          <div className="flex items-center justify-between gap-3">
            <p className="text-xs font-semibold uppercase tracking-[0.16em] text-muted-foreground">
              Recent Runs
            </p>
            <Badge variant="outline">{hookRuns.length}</Badge>
          </div>
          {hookRuns.length ? (
            <div className="space-y-2">
              {hookRuns.slice(0, 3).map((run) => renderRun(run, true))}
            </div>
          ) : (
            <p className="border border-border bg-background/70 p-3 text-sm text-muted-foreground">
              No runs recorded yet.
            </p>
          )}
        </div>
      </div>
    );
  }

  return (
    <div className="grid gap-5">
      <div className="flex flex-wrap items-start justify-between gap-3 border-b border-border/60 px-5 py-4 md:px-6">
        <div className="min-w-0">
          <h1 className="text-2xl font-semibold tracking-tight">Hooks</h1>
          <p className="text-sm text-muted-foreground">
            Manage on-demand triggers that create workflow-backed requests.
          </p>
        </div>
        <Button
          type="button"
          variant="outline"
          onClick={loadHooks}
          disabled={isPending}
        >
          <RefreshCw className={`h-4 w-4 ${isPending ? "animate-spin" : ""}`} />
          Refresh
        </Button>
      </div>

      <section className="grid gap-5 px-5 md:px-6">
        <section className="grid gap-3 md:grid-cols-3">
          <div className="border border-border/70 bg-background p-4">
            <p className="text-xs uppercase tracking-[0.16em] text-muted-foreground">
              Hooks
            </p>
            <p className="mt-2 text-3xl font-semibold">{hooks.length}</p>
          </div>
          <div className="border border-border/70 bg-background p-4">
            <p className="text-xs uppercase tracking-[0.16em] text-muted-foreground">
              Enabled
            </p>
            <p className="mt-2 text-3xl font-semibold">{enabledHookCount}</p>
          </div>
          <div className="border border-border/70 bg-background p-4">
            <p className="text-xs uppercase tracking-[0.16em] text-muted-foreground">
              Runs
            </p>
            <p className="mt-2 text-3xl font-semibold">{runs.length}</p>
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
          <div className="border border-destructive bg-destructive/10 p-3 text-sm text-destructive">
            {error}
          </div>
        ) : null}
        {message ? (
          <div className="border border-border bg-background p-3 text-sm">
            {message}
          </div>
        ) : null}

        {activeView === "runs" ? (
          <section className="grid gap-3">
            {runs.length ? (
              <div className="space-y-2">
                {runs.slice(0, 8).map((run) => renderRun(run))}
              </div>
            ) : (
              <p className="border border-border bg-background/70 p-3 text-sm text-muted-foreground">
                No hook runs recorded yet.
              </p>
            )}
          </section>
        ) : null}

        {activeView === "custom" ? (
          <section className="grid gap-3">
            {customHooks.length ? (
              customHooks.map(renderHook)
            ) : (
              <div className="border border-border bg-card/70 p-6 text-sm text-muted-foreground">
                <Webhook className="mb-3 h-5 w-5" />
                No custom hooks registered.
              </div>
            )}
          </section>
        ) : null}

        {activeView === "built-in" ? (
          <section className="grid gap-3">
            {systemHooks.length ? (
              systemHooks.map(renderHook)
            ) : (
              <div className="border border-border bg-card/70 p-6 text-sm text-muted-foreground">
                <Webhook className="mb-3 h-5 w-5" />
                No built-in hooks registered.
              </div>
            )}
          </section>
        ) : null}
      </section>
    </div>
  );
}
