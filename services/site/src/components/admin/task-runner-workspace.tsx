"use client";

import { useEffect, useMemo, useRef, useState, useTransition } from "react";
import {
  AlertCircle,
  CheckCircle2,
  Clock3,
  Eye,
  Trash2,
  Plus,
  Play,
  RefreshCw,
  Save,
} from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import type { TaskRecord, TaskRunRecord } from "@/lib/app-core";

type RunnerTask = {
  key: string;
  enabled: boolean;
  cron: string;
  status: string;
  lastRunAt: string | null;
  lastSuccessAt: string | null;
  lastError: string | null;
  nextRunAt: string | null;
};

type RunnerStatus = {
  configured: boolean;
  reachable: boolean;
  tasks: RunnerTask[];
  error: string | null;
};

type TaskPayload = {
  ok: boolean;
  tasks: TaskRecord[];
  runs: TaskRunRecord[];
  runner: RunnerStatus;
  error?: string;
};

type TasksView = "custom" | "built-in" | "runs";

const cronPresets = [
  {
    label: "Hourly at :55",
    value: "55 * * * *",
    preview: "Runs hourly at minute 55 UTC",
  },
  {
    label: "Every hour",
    value: "0 * * * *",
    preview: "Runs hourly at minute 0 UTC",
  },
  {
    label: "Daily at 9:00 UTC",
    value: "0 9 * * *",
    preview: "Runs daily at 09:00 UTC",
  },
  {
    label: "Weekdays at 9:00 UTC",
    value: "0 9 * * 1-5",
    preview: "Runs Monday-Friday at 09:00 UTC",
  },
  {
    label: "Weekly Monday 9:00 UTC",
    value: "0 9 * * 1",
    preview: "Runs every Monday at 09:00 UTC",
  },
  {
    label: "Monthly on the 1st 9:00 UTC",
    value: "0 9 1 * *",
    preview: "Runs monthly on day 1 at 09:00 UTC",
  },
];

const cronAllowedPattern = /^[\d*\/,\-\s]+$/;
const weekdayLabels: Record<string, string> = {
  "0": "Sunday",
  "1": "Monday",
  "2": "Tuesday",
  "3": "Wednesday",
  "4": "Thursday",
  "5": "Friday",
  "6": "Saturday",
  "7": "Sunday",
};

function padTime(value: string) {
  return value.padStart(2, "0");
}

function cronDetails(value: string) {
  const cron = value.trim().replace(/\s+/g, " ");
  if (!cron) {
    return { valid: false, preview: "Cron is required." };
  }
  const preset = cronPresets.find((item) => item.value === cron);
  if (preset) {
    return { valid: true, preview: preset.preview };
  }
  const parts = cron.split(" ");
  if (parts.length !== 5) {
    return {
      valid: false,
      preview: "Use five fields: minute hour day month weekday.",
    };
  }
  if (!cronAllowedPattern.test(cron)) {
    return {
      valid: false,
      preview: "Only numbers, *, /, comma, and ranges are supported here.",
    };
  }

  const [minute, hour, day, month, weekday] = parts;
  const fixedMinute = /^\d+$/.test(minute) ? Number(minute) : null;
  const fixedHour = /^\d+$/.test(hour) ? Number(hour) : null;
  if (fixedMinute !== null && (fixedMinute < 0 || fixedMinute > 59)) {
    return { valid: false, preview: "Minute must be between 0 and 59." };
  }
  if (fixedHour !== null && (fixedHour < 0 || fixedHour > 23)) {
    return { valid: false, preview: "Hour must be between 0 and 23." };
  }

  if (
    fixedMinute !== null &&
    hour === "*" &&
    day === "*" &&
    month === "*" &&
    weekday === "*"
  ) {
    return { valid: true, preview: `Runs hourly at minute ${fixedMinute} UTC` };
  }
  if (
    fixedMinute !== null &&
    fixedHour !== null &&
    day === "*" &&
    month === "*" &&
    weekday === "*"
  ) {
    return {
      valid: true,
      preview: `Runs daily at ${padTime(String(fixedHour))}:${padTime(String(fixedMinute))} UTC`,
    };
  }
  if (
    fixedMinute !== null &&
    fixedHour !== null &&
    day === "*" &&
    month === "*" &&
    weekday === "1-5"
  ) {
    return {
      valid: true,
      preview: `Runs Monday-Friday at ${padTime(String(fixedHour))}:${padTime(String(fixedMinute))} UTC`,
    };
  }
  if (
    fixedMinute !== null &&
    fixedHour !== null &&
    day === "*" &&
    month === "*" &&
    weekdayLabels[weekday]
  ) {
    return {
      valid: true,
      preview: `Runs every ${weekdayLabels[weekday]} at ${padTime(String(fixedHour))}:${padTime(String(fixedMinute))} UTC`,
    };
  }
  if (
    fixedMinute !== null &&
    fixedHour !== null &&
    /^\d+$/.test(day) &&
    month === "*" &&
    weekday === "*"
  ) {
    return {
      valid: true,
      preview: `Runs monthly on day ${day} at ${padTime(String(fixedHour))}:${padTime(String(fixedMinute))} UTC`,
    };
  }

  return {
    valid: true,
    preview: "Custom schedule. Times are interpreted as UTC.",
  };
}

function formatDate(value: string | null) {
  if (!value) return "Not recorded";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function statusBadge(status: string) {
  if (status === "succeeded") {
    return (
      <Badge className="border-emerald-200 bg-emerald-50 text-emerald-800">
        succeeded
      </Badge>
    );
  }
  if (status === "running") {
    return <Badge variant="secondary">running</Badge>;
  }
  if (status === "failed") {
    return <Badge variant="destructive">failed</Badge>;
  }
  if (status === "disabled") {
    return <Badge variant="muted">disabled</Badge>;
  }
  return <Badge variant="outline">{status || "unknown"}</Badge>;
}

function taskDescription(key: string) {
  if (key === "discord-sync") return "Pulls Discord activity into Prism.";
  if (key === "memory-run") return "Runs the Prism Memory pipeline.";
  if (key === "knowledge-run") return "Refreshes Prism Knowledge artifacts.";
  if (key === "knowledge-source-sync")
    return "Checks configured GitHub knowledge sources and syncs changed branches.";
  if (key === "skill-source-sync")
    return "Syncs configured GitHub skill sources into the site skill catalog.";
  if (key === "prism-doctor")
    return "Checks workflows, tasks, and hooks for structural drift without mutating content.";
  if (key === "portal-email-dispatch" || key === "portal-notification-email-dispatch")
    return "Dispatches queued Portal email notifications through the Portal API.";
  return "Scheduled task";
}

function taskTypeBadge(taskType: string) {
  if (taskType === "builtin") {
    return <Badge variant="secondary">System</Badge>;
  }
  if (taskType === "codex-prompt") {
    return <Badge variant="outline">Custom</Badge>;
  }
  if (taskType === "workflow-runner") {
    return <Badge variant="default">Workflow</Badge>;
  }
  if (taskType === "http-post") {
    return <Badge variant="outline">HTTP</Badge>;
  }
  return <Badge variant="muted">{taskType || "task"}</Badge>;
}

function formatSnapshot(value: unknown) {
  if (value === null || value === undefined) return "";
  if (typeof value === "string") return value;
  try {
    return JSON.stringify(value, null, 2);
  } catch {
    return String(value);
  }
}

function parseJsonObject(value: unknown) {
  if (typeof value !== "string") return null;
  try {
    const parsed = JSON.parse(value) as unknown;
    return parsed && typeof parsed === "object" && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : null;
  } catch {
    return null;
  }
}

function runResponseText(run: TaskRunRecord | null) {
  const body = run?.outputSnapshot?.body;
  const parsedBody = parseJsonObject(body);
  const directText =
    parsedBody?.responseText ??
    parsedBody?.output_text ??
    parsedBody?.text ??
    run?.outputSnapshot?.responseText ??
    run?.outputSnapshot?.output_text;

  return typeof directText === "string" && directText.trim()
    ? directText.trim()
    : null;
}

export function TaskRunnerWorkspace() {
  const [tasks, setTasks] = useState<TaskRecord[]>([]);
  const [runs, setRuns] = useState<TaskRunRecord[]>([]);
  const [runner, setRunner] = useState<RunnerStatus>({
    configured: false,
    reachable: false,
    tasks: [],
    error: null,
  });
  const [drafts, setDrafts] = useState<
    Record<string, { enabled: boolean; scheduleCron: string }>
  >({});
  const [error, setError] = useState<string | null>(null);
  const [savingKey, setSavingKey] = useState<string | null>(null);
  const [runningKey, setRunningKey] = useState<string | null>(null);
  const [deletingKey, setDeletingKey] = useState<string | null>(null);
  const [isCreateOpen, setIsCreateOpen] = useState(false);
  const [activeView, setActiveView] = useState<TasksView>("custom");
  const [isCreating, setIsCreating] = useState(false);
  const [selectedRun, setSelectedRun] = useState<TaskRunRecord | null>(null);
  const [createForm, setCreateForm] = useState({
    name: "",
    scheduleCron: "0 9 * * *",
    prompt: "",
  });
  const hasLoadedTasksRef = useRef(false);
  const [isRefreshing, startRefresh] = useTransition();

  async function loadTasks() {
    const response = await fetch("/admin/tasks", { cache: "no-store" });
    const payload = (await response.json()) as TaskPayload;
    if (!response.ok || !payload.ok) {
      throw new Error(payload.error || "Could not load tasks");
    }

    setTasks(payload.tasks);
    setRuns(payload.runs);
    setRunner(payload.runner);
    hasLoadedTasksRef.current = true;
    setError(null);
    setDrafts((current) => {
      const next = { ...current };
      for (const task of payload.tasks) {
        if (!next[task.key]) {
          next[task.key] = {
            enabled: task.enabled,
            scheduleCron: task.scheduleCron ?? "",
          };
        }
      }
      return next;
    });
  }

  function refresh() {
    setError(null);
    startRefresh(async () => {
      try {
        await loadTasks();
      } catch (nextError) {
        if (!hasLoadedTasksRef.current) {
          setError(
            nextError instanceof Error
              ? nextError.message
              : "Could not load tasks",
          );
        }
      }
    });
  }

  useEffect(() => {
    refresh();
    const intervalId = window.setInterval(refresh, 5000);
    return () => window.clearInterval(intervalId);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const latestRunByTask = useMemo(() => {
    const map = new Map<string, TaskRunRecord>();
    for (const run of runs) {
      if (run.taskKey && !map.has(run.taskKey)) {
        map.set(run.taskKey, run);
      }
    }
    return map;
  }, [runs]);

  const runnerByTask = useMemo(() => {
    const map = new Map<string, RunnerTask>();
    for (const task of runner.tasks) {
      map.set(task.key, task);
    }
    return map;
  }, [runner.tasks]);
  const customTasks = useMemo(
    () => tasks.filter((task) => task.taskType !== "builtin"),
    [tasks],
  );
  const builtInTasks = useMemo(
    () => tasks.filter((task) => task.taskType === "builtin"),
    [tasks],
  );
  const enabledTaskCount = useMemo(
    () => tasks.filter((task) => task.enabled).length,
    [tasks],
  );
  const viewOptions: Array<{ value: TasksView; label: string; count: number }> =
    [
      { value: "custom", label: "Custom Tasks", count: customTasks.length },
      {
        value: "built-in",
        label: "Built-In Tasks",
        count: builtInTasks.length,
      },
      { value: "runs", label: "Recent Runs", count: runs.length },
    ];
  const selectedRunResponse = runResponseText(selectedRun);
  const createCron = cronDetails(createForm.scheduleCron);

  async function saveTask(task: TaskRecord) {
    const draft = drafts[task.key];
    if (!draft) return;

    setError(null);
    setSavingKey(task.key);
    try {
      const response = await fetch("/admin/tasks", {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          key: task.key,
          enabled: draft.enabled,
          scheduleCron: draft.scheduleCron.trim() || null,
        }),
      });
      const payload = (await response.json()) as {
        ok?: boolean;
        error?: string;
      };
      if (!response.ok || payload.ok === false) {
        throw new Error(payload.error || "Could not save task");
      }
      await loadTasks();
    } catch (nextError) {
      setError(
        nextError instanceof Error ? nextError.message : "Could not save task",
      );
    } finally {
      setSavingKey(null);
    }
  }

  async function runTask(task: TaskRecord) {
    setError(null);
    setRunningKey(task.key);
    try {
      const response = await fetch(
        `/admin/tasks/${encodeURIComponent(task.key)}/run`,
        {
          method: "POST",
        },
      );
      const payload = (await response.json()) as {
        ok?: boolean;
        error?: string;
      };
      if (!response.ok || payload.ok === false) {
        throw new Error(payload.error || "Could not run task");
      }
      await loadTasks();
    } catch (nextError) {
      setError(
        nextError instanceof Error ? nextError.message : "Could not run task",
      );
    } finally {
      setRunningKey(null);
    }
  }

  async function createCustomTask() {
    setError(null);
    setIsCreating(true);
    try {
      const response = await fetch("/admin/tasks", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(createForm),
      });
      const payload = (await response.json()) as {
        ok?: boolean;
        error?: string;
      };
      if (!response.ok || payload.ok === false) {
        throw new Error(payload.error || "Could not create task");
      }
      setCreateForm({ name: "", scheduleCron: "0 9 * * *", prompt: "" });
      setIsCreateOpen(false);
      await loadTasks();
    } catch (nextError) {
      setError(
        nextError instanceof Error
          ? nextError.message
          : "Could not create task",
      );
    } finally {
      setIsCreating(false);
    }
  }

  async function deleteTask(task: TaskRecord) {
    if (task.taskType === "builtin") return;
    const confirmed = window.confirm(
      `Delete task "${task.name}"? Run history will remain, but the task will no longer be scheduled.`,
    );
    if (!confirmed) return;

    setError(null);
    setDeletingKey(task.key);
    try {
      const response = await fetch(
        `/admin/tasks/${encodeURIComponent(task.key)}`,
        {
          method: "DELETE",
        },
      );
      const payload = (await response.json()) as {
        ok?: boolean;
        error?: string;
      };
      if (!response.ok || payload.ok === false) {
        throw new Error(payload.error || "Could not delete task");
      }
      await loadTasks();
    } catch (nextError) {
      setError(
        nextError instanceof Error
          ? nextError.message
          : "Could not delete task",
      );
    } finally {
      setDeletingKey(null);
    }
  }

  function renderTask(task: TaskRecord) {
    const draft = drafts[task.key] ?? {
      enabled: task.enabled,
      scheduleCron: task.scheduleCron ?? "",
    };
    const cron = cronDetails(draft.scheduleCron);
    const latestRun = latestRunByTask.get(task.key);
    const runnerTask = runnerByTask.get(task.key);
    const dirty =
      draft.enabled !== task.enabled ||
      draft.scheduleCron.trim() !== (task.scheduleCron ?? "");

    return (
      <div
        key={task.id}
        className="grid gap-4 border border-border/70 bg-background p-4 lg:grid-cols-[minmax(220px,1fr)_minmax(280px,360px)_minmax(220px,280px)]"
      >
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <h2 className="text-base font-semibold">{task.name}</h2>
            <Badge variant="outline">{task.key}</Badge>
            {taskTypeBadge(task.taskType)}
            {statusBadge(
              runnerTask?.status ??
                latestRun?.status ??
                (task.enabled ? "idle" : "disabled"),
            )}
          </div>
          <p className="mt-2 text-sm text-muted-foreground">
            {task.description || taskDescription(task.key)}
          </p>
          <div className="mt-3 grid gap-1 text-xs text-muted-foreground">
            <span>
              Last run:{" "}
              {formatDate(
                runnerTask?.lastRunAt ?? latestRun?.startedAt ?? null,
              )}
            </span>
            <span>
              Last success: {formatDate(runnerTask?.lastSuccessAt ?? null)}
            </span>
            <span>Next run: {formatDate(runnerTask?.nextRunAt ?? null)}</span>
          </div>
        </div>

        <div className="grid gap-3">
          <div className="flex items-center justify-between gap-3">
            <Label htmlFor={`${task.key}-enabled`}>Enabled</Label>
            <Switch
              id={`${task.key}-enabled`}
              checked={draft.enabled}
              onCheckedChange={(checked) =>
                setDrafts((current) => {
                  const latest = current[task.key] ?? draft;
                  return {
                    ...current,
                    [task.key]: { ...latest, enabled: checked },
                  };
                })
              }
            />
          </div>
          <div className="grid gap-2">
            <Label
              htmlFor={`${task.key}-cron`}
              className="flex items-center gap-2"
            >
              <Clock3 className="h-4 w-4" />
              Cron
            </Label>
            <Select
              value={
                cronPresets.some(
                  (preset) => preset.value === draft.scheduleCron.trim(),
                )
                  ? draft.scheduleCron.trim()
                  : ""
              }
              onValueChange={(value) =>
                setDrafts((current) => {
                  const latest = current[task.key] ?? draft;
                  return {
                    ...current,
                    [task.key]: { ...latest, scheduleCron: value },
                  };
                })
              }
            >
              <SelectTrigger aria-label={`Cron preset for ${task.name}`}>
                <SelectValue placeholder="Choose a preset" />
              </SelectTrigger>
              <SelectContent>
                {cronPresets.map((preset) => (
                  <SelectItem key={preset.value} value={preset.value}>
                    {preset.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Input
              id={`${task.key}-cron`}
              value={draft.scheduleCron}
              placeholder="0 * * * *"
              onChange={(event) =>
                setDrafts((current) => {
                  const latest = current[task.key] ?? draft;
                  return {
                    ...current,
                    [task.key]: { ...latest, scheduleCron: event.target.value },
                  };
                })
              }
            />
            <p
              className={`text-xs ${cron.valid ? "text-muted-foreground" : "text-destructive"}`}
            >
              {cron.preview}
            </p>
          </div>
        </div>

        <div className="flex flex-col justify-between gap-3">
          <div className="grid gap-1 text-xs text-muted-foreground">
            <span>Updated: {formatDate(task.updatedAt)}</span>
            <span>Timezone: {task.timezone}</span>
            {runnerTask?.lastError ? (
              <span className="text-destructive">{runnerTask.lastError}</span>
            ) : null}
          </div>
          <div className="flex flex-wrap justify-end gap-2">
            <Button
              type="button"
              variant="outline"
              onClick={() => runTask(task)}
              disabled={!runner.configured || runningKey === task.key}
              title={
                runner.configured
                  ? "Run task now"
                  : "Set TASK_RUNNER_BASE_URL on the site service"
              }
            >
              <Play className="h-4 w-4" />
              Run
            </Button>
            <Button
              type="button"
              onClick={() => saveTask(task)}
              disabled={!dirty || !cron.valid || savingKey === task.key}
            >
              <Save className="h-4 w-4" />
              Save
            </Button>
            {task.taskType !== "builtin" ? (
              <Button
                type="button"
                variant="outline"
                onClick={() => deleteTask(task)}
                disabled={deletingKey === task.key}
                title="Delete custom task"
              >
                <Trash2 className="h-4 w-4" />
                Delete
              </Button>
            ) : null}
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="grid gap-5">
      <div className="flex flex-wrap items-start justify-between gap-3 border-b border-border/60 px-5 py-4 md:px-6">
        <div className="min-w-0">
          <h1 className="text-2xl font-semibold tracking-tight">Tasks</h1>
          <p className="text-sm text-muted-foreground">
            View built-in schedules, edit DB-backed cron settings, and run tasks
            manually.
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button type="button" onClick={() => setIsCreateOpen(true)}>
            <Plus className="h-4 w-4" />
            New Custom Task
          </Button>
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
      </div>

      <section className="grid gap-5 px-5 md:px-6">
        <section className="grid gap-3 md:grid-cols-3">
          <div className="border border-border/70 bg-background p-4">
            <p className="text-xs uppercase tracking-[0.16em] text-muted-foreground">
              DB Tasks
            </p>
            <p className="mt-2 text-3xl font-semibold">{tasks.length}</p>
          </div>
          <div className="border border-border/70 bg-background p-4">
            <p className="text-xs uppercase tracking-[0.16em] text-muted-foreground">
              Enabled
            </p>
            <p className="mt-2 text-3xl font-semibold">{enabledTaskCount}</p>
          </div>
          <div className="border border-border/70 bg-background p-4">
            <p className="text-xs uppercase tracking-[0.16em] text-muted-foreground">
              Runner
            </p>
            <div className="mt-3 flex items-center gap-2">
              {runner.reachable ? (
                <CheckCircle2 className="h-4 w-4 text-emerald-600" />
              ) : (
                <AlertCircle className="h-4 w-4 text-muted-foreground" />
              )}
              <p className="text-sm font-medium">
                {runner.reachable
                  ? "Reachable"
                  : runner.configured
                    ? "Unreachable"
                    : "Not configured"}
              </p>
            </div>
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
        {runner.error ? (
          <div className="border border-border/70 bg-muted/40 px-4 py-3 text-sm text-muted-foreground">
            {runner.error}
          </div>
        ) : null}

        {activeView === "custom" ? (
          <section className="grid gap-3">
            {customTasks.map(renderTask)}
            {!customTasks.length && !error ? (
              <div className="border border-border/70 bg-background px-4 py-6 text-sm text-muted-foreground">
                No custom tasks created.
              </div>
            ) : null}
          </section>
        ) : null}

        {activeView === "built-in" ? (
          <section className="grid gap-3">
            {builtInTasks.map(renderTask)}
            {!builtInTasks.length && !error ? (
              <div className="border border-border/70 bg-background px-4 py-6 text-sm text-muted-foreground">
                No built-in tasks registered.
              </div>
            ) : null}
          </section>
        ) : null}

        {activeView === "runs" ? (
          <section className="grid gap-3">
            <div className="overflow-x-auto border border-border/70 bg-background">
              <table className="w-full min-w-[760px] text-left text-sm">
                <thead className="border-b border-border/70 bg-muted/40 text-xs uppercase tracking-[0.12em] text-muted-foreground">
                  <tr>
                    <th className="px-4 py-3 font-medium">Task</th>
                    <th className="px-4 py-3 font-medium">Run</th>
                    <th className="px-4 py-3 font-medium">Status</th>
                    <th className="px-4 py-3 font-medium">Source</th>
                    <th className="px-4 py-3 font-medium">Started</th>
                    <th className="px-4 py-3 font-medium">Finished</th>
                    <th className="px-4 py-3 font-medium">Summary</th>
                    <th className="px-4 py-3 font-medium text-right">
                      Actions
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {runs.slice(0, 20).map((run) => (
                    <tr
                      key={run.id}
                      className="border-b border-border/50 last:border-b-0"
                    >
                      <td className="px-4 py-3 font-medium">
                        {run.taskKey ?? "unknown"}
                      </td>
                      <td className="px-4 py-3 font-mono text-xs text-muted-foreground">
                        {run.agentRunId ? run.agentRunId.slice(0, 8) : "legacy"}
                      </td>
                      <td className="px-4 py-3">{statusBadge(run.status)}</td>
                      <td className="px-4 py-3 text-muted-foreground">
                        {run.triggerSource}
                      </td>
                      <td className="px-4 py-3 text-muted-foreground">
                        {formatDate(run.startedAt)}
                      </td>
                      <td className="px-4 py-3 text-muted-foreground">
                        {formatDate(run.finishedAt)}
                      </td>
                      <td className="max-w-[280px] truncate px-4 py-3 text-muted-foreground">
                        {run.errorMessage || run.resultSummary || ""}
                      </td>
                      <td className="px-4 py-3 text-right">
                        <Button
                          type="button"
                          variant="outline"
                          size="sm"
                          onClick={() => setSelectedRun(run)}
                        >
                          <Eye className="h-4 w-4" />
                          View
                        </Button>
                      </td>
                    </tr>
                  ))}
                  {!runs.length ? (
                    <tr>
                      <td
                        className="px-4 py-6 text-center text-muted-foreground"
                        colSpan={8}
                      >
                        No task runs recorded yet.
                      </td>
                    </tr>
                  ) : null}
                </tbody>
              </table>
            </div>
          </section>
        ) : null}
      </section>

      <Dialog open={isCreateOpen} onOpenChange={setIsCreateOpen}>
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle>New Custom Task</DialogTitle>
            <DialogDescription>
              Create a disabled scheduled prompt task. Use chat for tasks that
              need to resolve output destinations like Discord channels, then
              enable after a manual run succeeds.
            </DialogDescription>
          </DialogHeader>
          <div className="grid gap-4">
            <div className="grid gap-2">
              <Label htmlFor="custom-task-name">Name</Label>
              <Input
                id="custom-task-name"
                value={createForm.name}
                onChange={(event) =>
                  setCreateForm((current) => ({
                    ...current,
                    name: event.target.value,
                  }))
                }
                placeholder="Daily memory brief"
              />
            </div>
            <div className="grid gap-2">
              <Label htmlFor="custom-task-cron">Cron</Label>
              <Select
                value={
                  cronPresets.some(
                    (preset) => preset.value === createForm.scheduleCron.trim(),
                  )
                    ? createForm.scheduleCron.trim()
                    : ""
                }
                onValueChange={(value) =>
                  setCreateForm((current) => ({
                    ...current,
                    scheduleCron: value,
                  }))
                }
              >
                <SelectTrigger aria-label="Custom task cron preset">
                  <SelectValue placeholder="Choose a preset" />
                </SelectTrigger>
                <SelectContent>
                  {cronPresets.map((preset) => (
                    <SelectItem key={preset.value} value={preset.value}>
                      {preset.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <Input
                id="custom-task-cron"
                value={createForm.scheduleCron}
                onChange={(event) =>
                  setCreateForm((current) => ({
                    ...current,
                    scheduleCron: event.target.value,
                  }))
                }
                placeholder="0 9 * * *"
              />
              <p
                className={`text-xs ${createCron.valid ? "text-muted-foreground" : "text-destructive"}`}
              >
                {createCron.preview}
              </p>
            </div>
            <div className="grid gap-2">
              <Label htmlFor="custom-task-prompt">Prompt</Label>
              <Textarea
                id="custom-task-prompt"
                value={createForm.prompt}
                onChange={(event) =>
                  setCreateForm((current) => ({
                    ...current,
                    prompt: event.target.value,
                  }))
                }
                rows={8}
                placeholder="Create a concise daily brief from Prism Memory. Do not ask follow-up questions. Return the brief and a short summary of what sources you used."
              />
            </div>
          </div>
          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              onClick={() => setIsCreateOpen(false)}
            >
              Cancel
            </Button>
            <Button
              type="button"
              onClick={createCustomTask}
              disabled={
                isCreating ||
                !createForm.name.trim() ||
                !createCron.valid ||
                !createForm.prompt.trim()
              }
            >
              <Plus className="h-4 w-4" />
              Create
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog
        open={Boolean(selectedRun)}
        onOpenChange={(open) => {
          if (!open) setSelectedRun(null);
        }}
      >
        <DialogContent className="max-h-[85vh] max-w-3xl overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Task Run</DialogTitle>
            <DialogDescription>
              {selectedRun?.taskKey ?? "unknown"} -{" "}
              {selectedRun?.triggerSource ?? "unknown"} -{" "}
              {selectedRun ? formatDate(selectedRun.startedAt) : "Not recorded"}
            </DialogDescription>
          </DialogHeader>
          {selectedRun ? (
            <div className="grid gap-4">
              <div className="flex flex-wrap items-center gap-2">
                {statusBadge(selectedRun.status)}
                <Badge variant="outline">
                  {selectedRun.taskName ?? selectedRun.taskKey ?? "unknown"}
                </Badge>
                <Badge variant="outline">
                  {selectedRun.agentRunId
                    ? `agent run ${selectedRun.agentRunId}`
                    : "legacy task run"}
                </Badge>
              </div>

              {selectedRun.resultSummary ? (
                <div className="grid gap-2">
                  <p className="text-sm font-medium">Summary</p>
                  <p className="whitespace-pre-wrap border border-border/70 bg-muted/30 p-3 text-sm text-muted-foreground">
                    {selectedRun.resultSummary}
                  </p>
                </div>
              ) : null}

              {selectedRun.errorMessage ? (
                <div className="grid gap-2">
                  <p className="text-sm font-medium text-destructive">Error</p>
                  <p className="whitespace-pre-wrap border border-destructive/40 bg-destructive/10 p-3 text-sm text-destructive">
                    {selectedRun.errorMessage}
                  </p>
                </div>
              ) : null}

              {selectedRunResponse ? (
                <div className="grid gap-2">
                  <p className="text-sm font-medium">Response</p>
                  <pre className="max-h-80 overflow-auto whitespace-pre-wrap border border-border/70 bg-muted/30 p-3 text-sm text-muted-foreground">
                    {selectedRunResponse}
                  </pre>
                </div>
              ) : null}

              <div className="grid gap-2">
                <p className="text-sm font-medium">Output Snapshot</p>
                <pre className="max-h-80 overflow-auto border border-border/70 bg-muted/30 p-3 text-xs text-muted-foreground">
                  {formatSnapshot(selectedRun.outputSnapshot)}
                </pre>
              </div>
            </div>
          ) : null}
        </DialogContent>
      </Dialog>
    </div>
  );
}
