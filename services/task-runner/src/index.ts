import express, { type Request, type Response } from "express";
import { doctorMergeSkills } from "./prism-doctor-skills.js";
import { findOpenWorkflowRequests } from './workflow-single-flight.js';
import { CronExpressionParser } from "cron-parser";
import { spawn } from "node:child_process";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import process from "node:process";
import { setTimeout as sleep } from "node:timers/promises";
import { leaseGatewayCredentials } from "./gateway-lease.js";
import { legacyGatewayWorkflowFindings } from "./prism-doctor-legacy-gateway.js";
import { doctorRepairWorkflowKey, matchingDoctorRepairRequest } from "./prism-doctor-repair.js";
import { taskLifecycleFindings } from "./prism-doctor-task-lifecycle.js";
import { workflowContextFindings } from "./prism-doctor-workflow-context.js";
import {
  applyScriptAgentHandoff,
  scriptAgentHandoffConfig,
} from "./script-agent-handoff.js";

type TaskStatus = "idle" | "running" | "succeeded" | "failed" | "disabled";

type RunnableTask = {
  key: string;
  name: string;
  defaultEnabled: boolean;
  defaultCron: string;
  enabled: boolean;
  cron: string;
  taskType: string;
  outputConfig: Record<string, unknown>;
  run: () => Promise<TaskRunResult>;
};

type BuiltInTask = RunnableTask & {
  taskType: "builtin";
};

type TaskSnapshot = {
  key: string;
  name: string;
  taskType: string;
  enabled: boolean;
  cron: string;
  status: TaskStatus;
  lastRunAt: string | null;
  lastSuccessAt: string | null;
  lastError: string | null;
  nextRunAt: string | null;
};

type TaskRunResult = {
  ok: boolean;
  status: number;
  url: string;
  body: string;
  metadata?: Record<string, unknown>;
  delivery?: OutputDeliveryResult[];
};

type OutputDestination = {
  adapter: string;
  type: string;
  id: string | null;
  label?: string | null;
  title?: string | null;
};

type OutputDeliveryResult = {
  adapter: string;
  destinationId: string;
  label: string | null;
  ok: boolean;
  status?: number;
  url?: string;
  body?: string;
  error?: string;
};

type AppTaskRun = {
  id: string;
};

type AppTask = {
  key: string;
  name: string;
  enabled: boolean;
  scheduleCron: string | null;
  taskType: string;
  inputConfig: Record<string, unknown>;
  instructionConfig: Record<string, unknown>;
  outputConfig: Record<string, unknown>;
  agentConfig: Record<string, unknown>;
  executionPolicy?: {
    executorProfileKey?: string | null;
    executorProfileVersion?: number | null;
    resolution?: string | null;
    runtimeProfileKey?: string | null;
    modelTier?: string | null;
  } | null;
};

type WorkflowRunStepResult = {
  status: number;
  url: string;
  body: string;
  payload: Record<string, unknown>;
};

type DoctorFinding = {
  check: string;
  status: "failed" | "warning";
  subjectType: "workflow" | "task" | "hook" | "skill";
  subjectKey: string;
  stepKey?: string | null;
  expected: string;
  observed: string;
  recommendation: string;
  evidence?: Record<string, unknown>;
};

type SiteTaskScript = {
  key: string;
  runtime: string;
  enabled: boolean;
  checksum: string;
  timeoutMs: number | null;
  updatedAt: string | null;
};

type SiteTaskScriptContent = {
  script: SiteTaskScript;
  content: string;
};

type TaskState = {
  status: TaskStatus;
  lastRunAt: string | null;
  lastSuccessAt: string | null;
  lastError: string | null;
  nextRunAt: Date | null;
  running: boolean;
};

const state = new Map<string, TaskState>();

function nowIso(): string {
  return new Date().toISOString();
}

function parseBoolEnv(name: string, defaultValue: boolean): boolean {
  const raw = (process.env[name] ?? "").trim().toLowerCase();
  if (!raw) {
    return defaultValue;
  }
  return new Set(["1", "true", "yes", "on"]).has(raw);
}

function parseIntEnv(name: string, defaultValue: number, minimum?: number, maximum?: number): number {
  const raw = (process.env[name] ?? "").trim();
  let value = raw ? Number.parseInt(raw, 10) : defaultValue;
  if (!Number.isFinite(value)) {
    throw new Error(`${name} must be an integer`);
  }
  if (typeof minimum === "number") {
    value = Math.max(minimum, value);
  }
  if (typeof maximum === "number") {
    value = Math.min(maximum, value);
  }
  return value;
}

function trimBaseUrl(value: string | undefined): string {
  return (value ?? "").trim().replace(/\/+$/, "");
}

function describeError(error: unknown): string {
  if (error instanceof Error && error.message.trim()) {
    const cause = (error as Error & { cause?: unknown }).cause;
    if (cause instanceof Error && cause.message.trim()) {
      return `${error.message.trim()}: ${cause.message.trim()}`;
    }
    if (cause) {
      return `${error.message.trim()}: ${String(cause)}`;
    }
    return error.message.trim();
  }
  return String(error);
}

function nextCronDate(cron: string, from = new Date()): Date {
  const expression = CronExpressionParser.parse(cron, {
    currentDate: from,
  });
  return expression.next().toDate();
}

function initState(task: RunnableTask): TaskState {
  if (!task.enabled) {
    return {
      status: "disabled",
      lastRunAt: null,
      lastSuccessAt: null,
      lastError: null,
      nextRunAt: null,
      running: false,
    };
  }
  return {
    status: "idle",
    lastRunAt: null,
    lastSuccessAt: null,
    lastError: null,
    nextRunAt: nextCronDate(task.cron),
    running: false,
  };
}

function requireBaseUrl(name: string, value: string): string {
  if (!value) {
    throw new Error(`${name} is required`);
  }
  return value;
}

function appApiBaseUrl(): string | null {
  const baseUrl = trimBaseUrl(process.env.APP_API_BASE_URL);
  return baseUrl || null;
}

function appApiServiceToken(): string {
  return (process.env.APP_API_SERVICE_TOKEN ?? process.env.INTERNAL_SERVICE_TOKEN ?? "").trim();
}

function taskRunnerControlToken(): string {
  return (process.env.TASK_RUNNER_TOKEN ?? process.env.INTERNAL_SERVICE_TOKEN ?? "").trim();
}

function codexRuntimeBaseUrl(): string {
  return trimBaseUrl(process.env.CODEX_RUNTIME_BASE_URL);
}

function httpTimeoutMs() {
  return parseIntEnv(
    "TASK_RUNNER_HTTP_TIMEOUT_MS",
    parseIntEnv("TASK_RUNNER_APP_API_TIMEOUT_MS", 120_000, 1_000, 900_000),
    1_000,
    86_400_000,
  );
}

function longRunningHttpTimeoutMs() {
  const codexRuntimeTimeout = parseIntEnv("CODEX_RUNTIME_TIMEOUT_MS", 900_000, 1_000, 86_400_000);
  return parseIntEnv(
    "TASK_RUNNER_LONG_RUNNING_HTTP_TIMEOUT_MS",
    Math.max(codexRuntimeTimeout + 60_000, 900_000),
    1_000,
    86_400_000,
  );
}

function scriptRunnerTimeoutMs() {
  return parseIntEnv("TASK_RUNNER_SCRIPT_TIMEOUT_MS", 120_000, 1_000, 3_600_000);
}

function scriptRunnerOutputMaxBytes() {
  return parseIntEnv("TASK_RUNNER_SCRIPT_OUTPUT_MAX_BYTES", 256_000, 1_024, 10_000_000);
}

function scriptRunnerKillGraceMs() {
  return parseIntEnv("TASK_RUNNER_SCRIPT_KILL_GRACE_MS", 5_000, 100, 60_000);
}

async function fetchWithTimeout(url: string, init: RequestInit, timeoutMs: number) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, {
      ...init,
      signal: controller.signal,
    });
  } catch (error) {
    if (error instanceof Error && error.name === "AbortError") {
      throw new Error(`APP_API_REQUEST_TIMEOUT:${timeoutMs}:${url}`);
    }
    throw error;
  } finally {
    clearTimeout(timeout);
  }
}

async function postJson(
  baseUrl: string,
  path: string,
  headers: Record<string, string>,
  body: Record<string, unknown> = {},
  timeoutMs = httpTimeoutMs(),
): Promise<TaskRunResult> {
  const url = `${baseUrl}${path.startsWith("/") ? path : `/${path}`}`;
  return postJsonUrl(url, headers, body, timeoutMs);
}

async function postJsonUrl(
  url: string,
  headers: Record<string, string>,
  body: Record<string, unknown> = {},
  timeoutMs = httpTimeoutMs(),
): Promise<TaskRunResult> {
  const result = await postJsonUrlRaw(url, headers, body, timeoutMs);
  if (result.status < 200 || result.status >= 300) {
    throw new Error(`HTTP ${result.status} from ${url}: ${result.body.slice(0, 500)}`);
  }
  return {
    ok: true,
    status: result.status,
    url,
    body: result.body,
  };
}

async function postJsonUrlRaw(
  url: string,
  headers: Record<string, string>,
  body: Record<string, unknown> = {},
  timeoutMs = httpTimeoutMs(),
): Promise<{ status: number; body: string }> {
  const response = await fetchWithTimeout(url, {
    method: "POST",
    headers: {
      ...headers,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  }, timeoutMs);
  const text = await response.text();
  return { status: response.status, body: text };
}

async function postCodexRuntimeJson(
  baseUrl: string,
  body: Record<string, unknown>,
  timeoutMs = longRunningHttpTimeoutMs(),
): Promise<TaskRunResult> {
  const start = Date.now();
  const remainingTimeoutMs = () => Math.max(1, timeoutMs - (Date.now() - start));
  const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
  let runtimeJobAccepted = false;

  try {
    const createResult = await postJson(
      baseUrl,
      "/v1/responses/jobs",
      {},
      body,
      Math.min(30_000, timeoutMs),
    );
    const createPayload = createResult.body ? JSON.parse(createResult.body) as Record<string, unknown> : {};
    const jobId = typeof createPayload.jobId === "string" ? createPayload.jobId : "";
    if (!jobId) {
      throw new Error("CODEX_RUNTIME_JOB_CREATE_INVALID_RESPONSE");
    }
    runtimeJobAccepted = true;

    for (;;) {
      if (Date.now() - start >= timeoutMs) {
        throw new Error(`CODEX_RUNTIME_REQUEST_TIMEOUT:${timeoutMs}`);
      }
      await sleep(2_000);
      const pollUrl = `${baseUrl}/v1/responses/jobs/${encodeURIComponent(jobId)}`;
      const response = await fetchWithTimeout(pollUrl, { method: "GET" }, Math.min(30_000, remainingTimeoutMs()));
      const text = await response.text();
      const payload = text ? JSON.parse(text) as Record<string, unknown> : {};
      if (!response.ok) {
        throw new Error(`HTTP ${response.status} from ${pollUrl}: ${text.slice(0, 500)}`);
      }
      const job = isRecord(payload.job) ? payload.job : {};
      const status = typeof job.status === "string" ? job.status : "";
      if (status === "queued" || status === "running") {
        continue;
      }
      if (status === "succeeded") {
        const runtimeResponse = isRecord(payload.response)
          ? payload.response
          : isRecord(job.response)
            ? job.response
            : {};
        return {
          ok: true,
          status: response.status,
          url: pollUrl,
          body: JSON.stringify(runtimeResponse),
        };
      }
      throw new Error(`CODEX_RUNTIME_REQUEST_FAILED:${String(payload.error ?? job.error ?? "Unknown codex runtime error")}`);
    }
  } catch (error) {
    if (runtimeJobAccepted) {
      throw error;
    }
    const message = error instanceof Error ? error.message : "";
    if (!message.includes("HTTP 404") && !message.includes("CODEX_RUNTIME_JOB_CREATE_INVALID_RESPONSE")) {
      throw error;
    }
  }

  return postJson(baseUrl, "/v1/responses", {}, body, Math.max(1, remainingTimeoutMs()));
}

async function appApiRequest(path: string, init: RequestInit): Promise<Record<string, unknown> | null> {
  const baseUrl = appApiBaseUrl();
  if (!baseUrl) {
    return null;
  }

  const token = appApiServiceToken();
  const headers = new Headers(init.headers);
  headers.set("Content-Type", "application/json");
  if (token) {
    headers.set("X-Service-Token", token);
  }
  const controlToken = taskRunnerControlToken();
  if (controlToken) {
    headers.set("X-Task-Runner-Token", controlToken);
  }

  const url = `${baseUrl}${path}`;
  const response = await fetchWithTimeout(url, {
    ...init,
    headers,
  }, httpTimeoutMs());
  const text = await response.text();
  if (!response.ok) {
    throw new Error(`APP_API_REQUEST_FAILED:${response.status}:${text.slice(0, 500)}`);
  }
  return text ? JSON.parse(text) as Record<string, unknown> : {};
}

function isAppTask(value: unknown): value is AppTask {
  if (!value || typeof value !== "object") {
    return false;
  }
  const candidate = value as {
    key?: unknown;
    name?: unknown;
    enabled?: unknown;
    scheduleCron?: unknown;
    taskType?: unknown;
    inputConfig?: unknown;
    instructionConfig?: unknown;
    outputConfig?: unknown;
    agentConfig?: unknown;
  };
  return (
    typeof candidate.key === "string"
    && typeof candidate.name === "string"
    && typeof candidate.enabled === "boolean"
    && (candidate.scheduleCron === null || typeof candidate.scheduleCron === "string")
    && typeof candidate.taskType === "string"
    && isRecord(candidate.inputConfig)
    && isRecord(candidate.instructionConfig)
    && isRecord(candidate.outputConfig)
    && (candidate.agentConfig === undefined || candidate.agentConfig === null || isRecord(candidate.agentConfig))
  );
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function stringFromConfig(config: Record<string, unknown>, key: string, fallback = ""): string {
  const value = config[key];
  return typeof value === "string" && value.trim() ? value.trim() : fallback;
}

function boolFromConfig(config: Record<string, unknown>, key: string, fallback: boolean): boolean {
  const value = config[key];
  return typeof value === "boolean" ? value : fallback;
}

function intFromConfig(config: Record<string, unknown>, key: string, fallback: number, minimum: number, maximum: number): number {
  const value = config[key];
  const parsed = typeof value === "number" ? value : typeof value === "string" ? Number.parseInt(value, 10) : fallback;
  if (!Number.isFinite(parsed)) {
    return fallback;
  }
  return Math.min(maximum, Math.max(minimum, Math.trunc(parsed)));
}

function recordFromConfig(config: Record<string, unknown>, key: string): Record<string, unknown> {
  const value = config[key];
  return isRecord(value) ? value : {};
}

async function registerTaskWithSite(task: BuiltInTask): Promise<void> {
  try {
    await appApiRequest("/agent/tasks", {
      method: "POST",
      body: JSON.stringify({
        key: task.key,
        name: task.name,
        description: `Built-in scheduled task: ${task.name}`,
        enabled: task.defaultEnabled,
        triggerType: "schedule",
        scheduleCron: task.defaultCron,
        timezone: "UTC",
        taskType: "builtin",
        inputConfig: {},
        instructionConfig: {},
        outputConfig: {},
        agentConfig: {
          runtime: "task-runner",
          mode: "builtin",
          identity: "prism-task-runner",
          skills: [],
        },
        preserveExisting: true,
      }),
    });
  } catch (error) {
    console.warn(JSON.stringify({ event: "task.site_register_failed", task: task.key, error: describeError(error) }));
  }
}

async function ensureTasksRegisteredWithSite(tasks: BuiltInTask[]): Promise<void> {
  await Promise.all(tasks.map((task) => registerTaskWithSite(task)));
}

async function fetchTasksFromSite(): Promise<AppTask[] | null> {
  try {
    const payload = await appApiRequest("/agent/tasks", { method: "GET" });
    const rows = payload?.tasks;
    if (!Array.isArray(rows)) {
      return null;
    }
    return rows
      .filter(isAppTask)
      .map((task) => ({
        ...task,
        agentConfig: isRecord(task.agentConfig) ? task.agentConfig : {},
      }));
  } catch (error) {
    console.warn(JSON.stringify({ event: "task.site_fetch_failed", error: describeError(error) }));
    return null;
  }
}

function applyTaskConfig(task: RunnableTask, config: { enabled: boolean; cron: string }): void {
  const taskState = state.get(task.key);
  const previousEnabled = task.enabled;
  const previousCron = task.cron;

  task.enabled = config.enabled;
  task.cron = config.cron;

  if (!taskState) {
    state.set(task.key, initState(task));
    return;
  }

  if (!task.enabled) {
    taskState.status = taskState.running ? "running" : "disabled";
    taskState.nextRunAt = null;
    return;
  }

  if (!previousEnabled || previousCron !== task.cron || !taskState.nextRunAt) {
    taskState.nextRunAt = nextCronDate(task.cron);
  }
  if (!taskState.running && taskState.status === "disabled") {
    taskState.status = "idle";
  }
}

function requestedSkillsFromConfig(config: Record<string, unknown>): string[] {
  const raw = config.requestedSkills ?? config.requested_skills ?? config.skills;
  if (!Array.isArray(raw)) {
    return [];
  }
  return raw.filter((item): item is string => typeof item === "string" && item.trim().length > 0).map((item) => item.trim());
}

function mergeRequestedSkills(siteTask: AppTask): string[] {
  const instructionSkills = requestedSkillsFromConfig(siteTask.instructionConfig);
  const agentSkills = requestedSkillsFromConfig(siteTask.agentConfig);
  return Array.from(new Set([...instructionSkills, ...agentSkills]));
}

function modelTierForTask(siteTask: AppTask): string | null {
  const explicit = siteTask.agentConfig.modelTier ?? siteTask.agentConfig.model_tier
  if (typeof explicit === "string" && explicit.trim()) return explicit.trim()
  const inherited = siteTask.executionPolicy?.modelTier
  return typeof inherited === "string" && inherited.trim() ? inherited.trim() : null
}

function requestedGatewayKeysFromConfig(
  config: Record<string, unknown>,
  keys: string[],
): Array<{ key: string }> {
  const raw = keys.map((key) => config[key]).find(Array.isArray);
  if (!raw) return [];
  const normalized = raw.flatMap((entry) => {
    if (typeof entry === "string") return [entry.trim()];
    if (isRecord(entry) && typeof entry.key === "string") return [entry.key.trim()];
    return [];
  }).filter((key) => /^[a-zA-Z][a-zA-Z0-9_.:-]{0,119}$/.test(key));
  return Array.from(new Set(normalized)).map((key) => ({ key }));
}

function outputDestinationsFromConfig(config: Record<string, unknown>): OutputDestination[] {
  const raw = config.outputDestinations ?? config.output_destinations;
  if (!Array.isArray(raw)) {
    return [];
  }
  return raw
    .filter((item): item is Record<string, unknown> => isRecord(item))
    .map((item) => ({
      adapter: typeof item.adapter === "string" ? item.adapter.trim() : "",
      type: typeof item.type === "string" ? item.type.trim() : "",
      id: typeof item.id === "string" && item.id.trim() ? item.id.trim() : null,
      label: typeof item.label === "string" ? item.label : null,
      title: typeof item.title === "string" && item.title.trim()
        ? item.title.trim()
        : typeof item.postTitle === "string" && item.postTitle.trim()
          ? item.postTitle.trim()
          : null,
    }))
    .filter((item) => item.adapter && item.type && (item.id || item.label));
}

function responseTextFromResult(result: TaskRunResult): string {
  try {
    const body = JSON.parse(result.body) as Record<string, unknown>;
    const direct =
      body.responseText ??
      body.output_text ??
      body.summary ??
      body.message ??
      body.text;
    if (typeof direct === "string" && direct.trim()) {
      return direct.trim();
    }
  } catch {
    // The task may return plain text.
  }
  return result.body.trim();
}

function taskResultShouldNotify(result: TaskRunResult): boolean {
  if (result.metadata?.shouldNotify === false) {
    return false;
  }
  try {
    const body = JSON.parse(result.body) as Record<string, unknown>;
    if (body.shouldNotify === false || body.notify === false) {
      return false;
    }
  } catch {
    // Plain text task output is deliverable when destinations are configured.
  }
  return true;
}

function adapterBaseUrl(adapter: string): string {
  if (adapter === "discord" || adapter === "telegram") {
    return trimBaseUrl(process.env.COMMUNICATION_ADAPTER_BASE_URL);
  }
  return "";
}

function adapterHeaders(adapter: string): Record<string, string> {
  if (adapter === "discord" || adapter === "telegram") {
    const token = (process.env.COMMUNICATION_ADAPTER_TOKEN ?? "").trim();
    return token ? { "X-Adapter-Token": token } : {};
  }
  return {};
}

async function resolveOutputDestinationId(destination: OutputDestination): Promise<string | null> {
  if (destination.id) {
    return destination.id;
  }
  const baseUrl = adapterBaseUrl(destination.adapter);
  if (!baseUrl || !destination.label) {
    return null;
  }
  const response = await fetch(`${baseUrl}/destinations`, {
    headers: adapterHeaders(destination.adapter),
  });
  const text = await response.text();
  if (!response.ok) {
    throw new Error(`HTTP ${response.status} from ${baseUrl}/destinations: ${text.slice(0, 500)}`);
  }
  const payload = text ? JSON.parse(text) as Record<string, unknown> : {};
  const destinations = Array.isArray(payload.destinations) ? payload.destinations : [];
  const normalizedLabel = destination.label.trim().toLowerCase();
  const normalizedName = normalizedLabel.replace(/^#/, "");
  const match = destinations
    .filter((item): item is Record<string, unknown> => isRecord(item))
    .find((item) => {
      const itemType = typeof item.type === "string" ? item.type : "";
      const itemLabel = typeof item.label === "string" ? item.label.trim().toLowerCase() : "";
      const itemName = typeof item.name === "string" ? item.name.trim().toLowerCase() : "";
      return (
        itemType === destination.type
        && (itemLabel === normalizedLabel || itemName === normalizedName)
      );
    });
  return typeof match?.id === "string" && match.id.trim() ? match.id.trim() : null;
}

async function deliverTaskOutput(task: RunnableTask, result: TaskRunResult): Promise<OutputDeliveryResult[]> {
  const destinations = outputDestinationsFromConfig(task.outputConfig);
  if (!destinations.length) {
    return [];
  }
  if (!taskResultShouldNotify(result)) {
    return [];
  }
  const content = responseTextFromResult(result);
  if (!content) {
    return destinations.map((destination) => ({
      adapter: destination.adapter,
      destinationId: destination.id ?? "",
      label: destination.label ?? null,
      ok: false,
      error: "Task response was empty",
    }));
  }
  const deliveries: OutputDeliveryResult[] = [];
  for (const destination of destinations) {
    const baseUrl = adapterBaseUrl(destination.adapter);
    let destinationId: string | null = null;
    try {
      destinationId = await resolveOutputDestinationId(destination);
    } catch (error) {
      deliveries.push({
        adapter: destination.adapter,
        destinationId: destination.id ?? "",
        label: destination.label ?? null,
        ok: false,
        error: describeError(error),
      });
      continue;
    }
    if (!baseUrl) {
      deliveries.push({
        adapter: destination.adapter,
        destinationId: destinationId ?? "",
        label: destination.label ?? null,
        ok: false,
        error: `No adapter base URL configured for ${destination.adapter}`,
      });
      continue;
    }
    if (!destinationId) {
      deliveries.push({
        adapter: destination.adapter,
        destinationId: "",
        label: destination.label ?? null,
        ok: false,
        error: `Could not resolve destination ${destination.label ?? destination.type}`,
      });
      continue;
    }
    try {
      const delivery = await postJson(baseUrl, "/messages", adapterHeaders(destination.adapter), {
        adapter: destination.adapter,
        destinationId,
        type: destination.type,
        ...(destination.title ? { title: destination.title } : {}),
        content,
      });
      deliveries.push({
        adapter: destination.adapter,
        destinationId,
        label: destination.label ?? null,
        ok: true,
        status: delivery.status,
        url: delivery.url,
        body: delivery.body,
      });
    } catch (error) {
      deliveries.push({
        adapter: destination.adapter,
        destinationId,
        label: destination.label ?? null,
        ok: false,
        error: describeError(error),
      });
    }
  }
  return deliveries;
}

function buildCodexPromptTask(siteTask: AppTask): RunnableTask | null {
  const prompt = typeof siteTask.instructionConfig.prompt === "string"
    ? siteTask.instructionConfig.prompt.trim()
    : "";
  if (!prompt) {
    console.warn(JSON.stringify({ event: "task.codex_prompt_missing", task: siteTask.key }));
    return null;
  }
  const cron = (siteTask.scheduleCron ?? "").trim() || "0 * * * *";
  return {
    key: siteTask.key,
    name: siteTask.name,
    taskType: "codex-prompt",
    defaultEnabled: false,
    defaultCron: cron,
    enabled: siteTask.enabled,
    cron,
    run: async () => {
      const baseUrl = requireBaseUrl("CODEX_RUNTIME_BASE_URL", codexRuntimeBaseUrl());
      const response = await postCodexRuntimeJson(baseUrl, {
        prompt,
        sessionId: `scheduled-task:${siteTask.key}:${Date.now()}`,
        codexThreadId: null,
        recentHistory: [],
        modelTier: modelTierForTask(siteTask),
        credentials: requestedGatewayKeysFromConfig(siteTask.agentConfig, [
          "gatewayCredentials",
          "gateway_credentials",
        ]),
        context: { delegatedActorId: `task:${siteTask.key}` },
        metadata: {
          transport: "task-runner",
          taskKey: siteTask.key,
          taskName: siteTask.name,
          taskType: siteTask.taskType,
          inputConfig: siteTask.inputConfig,
          outputConfig: siteTask.outputConfig,
          agentConfig: siteTask.agentConfig,
          requestedSkills: mergeRequestedSkills(siteTask),
          allowEmptyResponse: true,
        },
      }, longRunningHttpTimeoutMs());
      return response;
    },
    outputConfig: siteTask.outputConfig,
  };
}

function normalizeTaskScript(value: unknown): SiteTaskScript | null {
  if (!isRecord(value)) {
    return null;
  }
  return {
    key: typeof value.key === "string" ? value.key : "",
    runtime: typeof value.runtime === "string" ? value.runtime : "",
    enabled: value.enabled === true,
    checksum: typeof value.checksum === "string" ? value.checksum : "",
    timeoutMs: typeof value.timeoutMs === "number" && Number.isFinite(value.timeoutMs) ? Math.trunc(value.timeoutMs) : null,
    updatedAt: typeof value.updatedAt === "string" ? value.updatedAt : null,
  };
}

async function fetchTaskScriptContent(scriptKey: string): Promise<SiteTaskScriptContent> {
  const payload = await appApiRequest(`/agent/task-scripts/${encodeURIComponent(scriptKey)}/content`, {
    method: "GET",
  });
  if (!payload) {
    throw new Error("APP_API_BASE_URL is required for script-runner tasks");
  }

  const script = normalizeTaskScript(payload.script);
  const content = typeof payload.content === "string" ? payload.content : "";
  if (!script || !script.key) {
    throw new Error(`SCRIPT_RUNNER_SCRIPT_INVALID:${scriptKey}`);
  }
  if (!script.enabled) {
    throw new Error(`SCRIPT_RUNNER_SCRIPT_DISABLED:${scriptKey}`);
  }
  if (script.runtime !== "node-esm") {
    throw new Error(`SCRIPT_RUNNER_RUNTIME_UNSUPPORTED:${scriptKey}:${script.runtime}`);
  }
  if (!content.trim()) {
    throw new Error(`SCRIPT_RUNNER_SCRIPT_INVALID:${scriptKey}`);
  }

  return { script, content };
}

async function runSiteTaskScript(input: {
  siteTask: AppTask;
  scriptKey: string;
  params: Record<string, unknown>;
  timeoutMs: number | null;
}): Promise<TaskRunResult> {
  const { script, content } = await fetchTaskScriptContent(input.scriptKey);
  const timeoutMs = input.timeoutMs ?? script.timeoutMs ?? scriptRunnerTimeoutMs();
  const outputMaxBytes = scriptRunnerOutputMaxBytes();
  const killGraceMs = scriptRunnerKillGraceMs();
  const gatewayCredentials = requestedGatewayKeysFromConfig(input.siteTask.agentConfig, [
    "gatewayCredentials",
    "gateway_credentials",
  ]).map(({ key }) => key);
  const leasedEnv = await leaseGatewayCredentials({
    credentials: gatewayCredentials,
    context: {
      delegatedActorId: `task:${input.siteTask.key}`,
      runtimeJobId: `script-task:${input.siteTask.key}:${Date.now()}`,
    },
  });

  const payload = {
    task: {
      key: input.siteTask.key,
      name: input.siteTask.name,
      taskType: input.siteTask.taskType,
    },
    scriptKey: input.scriptKey,
    params: input.params,
    inputConfig: input.siteTask.inputConfig,
    outputConfig: input.siteTask.outputConfig,
    agentConfig: input.siteTask.agentConfig,
    triggeredAt: nowIso(),
  };

  const startedAt = Date.now();
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "prism-task-script-"));
  const scriptPath = path.join(tempDir, "script.mjs");
  await fs.writeFile(scriptPath, content, "utf8");

  return await new Promise<TaskRunResult>((resolve, reject) => {
    function cleanupTemp() {
      void fs.rm(tempDir, { recursive: true, force: true }).catch(() => undefined);
    }

    const child = spawn(process.execPath, [scriptPath], {
      env: {
        PRISM_TASK_KEY: input.siteTask.key,
        PRISM_TASK_SCRIPT_KEY: input.scriptKey,
        PRISM_TASK_PARAMS_JSON: JSON.stringify(input.params),
        ...leasedEnv,
      },
      stdio: ["pipe", "pipe", "pipe"],
    });

    let stdout = "";
    let stderr = "";
    let stdoutBytes = 0;
    let stderrBytes = 0;
    let stdoutTruncated = false;
    let stderrTruncated = false;
    let settled = false;
    let killTimeout: NodeJS.Timeout | null = null;

    function appendBounded(current: string, chunk: Buffer | string, currentBytes: number): {
      value: string;
      bytes: number;
      truncated: boolean;
    } {
      const text = String(chunk);
      const bytes = Buffer.byteLength(text);
      const nextBytes = currentBytes + bytes;
      if (currentBytes >= outputMaxBytes) {
        return { value: current, bytes: nextBytes, truncated: true };
      }
      if (nextBytes <= outputMaxBytes) {
        return { value: current + text, bytes: nextBytes, truncated: false };
      }
      const remaining = Math.max(0, outputMaxBytes - currentBytes);
      return {
        value: current + Buffer.from(text).subarray(0, remaining).toString(),
        bytes: nextBytes,
        truncated: true,
      };
    }

    function cleanupTimers() {
      clearTimeout(timeout);
      if (killTimeout) {
        clearTimeout(killTimeout);
        killTimeout = null;
      }
    }

    const timeout = setTimeout(() => {
      if (settled) return;
      settled = true;
      child.kill("SIGTERM");
      child.stdout.destroy();
      child.stderr.destroy();
      killTimeout = setTimeout(() => {
        if (child.exitCode === null && child.signalCode === null) {
          child.kill("SIGKILL");
        }
      }, killGraceMs);
      cleanupTemp();
      reject(new Error(`SCRIPT_RUNNER_TIMEOUT:${input.scriptKey}:${timeoutMs}`));
    }, timeoutMs);

    child.stdout.on("data", (chunk) => {
      if (settled) return;
      const next = appendBounded(stdout, chunk, stdoutBytes);
      stdout = next.value;
      stdoutBytes = next.bytes;
      stdoutTruncated = stdoutTruncated || next.truncated;
    });
    child.stderr.on("data", (chunk) => {
      if (settled) return;
      const next = appendBounded(stderr, chunk, stderrBytes);
      stderr = next.value;
      stderrBytes = next.bytes;
      stderrTruncated = stderrTruncated || next.truncated;
    });
    child.on("error", (error) => {
      if (settled) return;
      settled = true;
      cleanupTimers();
      cleanupTemp();
      reject(error);
    });
    child.on("close", (code) => {
      if (settled) return;
      settled = true;
      cleanupTimers();
      cleanupTemp();
      const stderrText = `${stderr.trim()}${stderrTruncated ? "\n[stderr truncated]" : ""}`;
      if (code !== 0) {
        reject(new Error(`SCRIPT_RUNNER_FAILED:${input.scriptKey}:${code}:${stderrText.slice(0, 500)}`));
        return;
      }

      const stdoutText = `${stdout.trim()}${stdoutTruncated ? "\n[stdout truncated]" : ""}`;
      const body = stdoutText || JSON.stringify({
        ok: true,
        scriptKey: input.scriptKey,
        summary: `Script ${input.scriptKey} completed without output.`,
        durationMs: Date.now() - startedAt,
      });
      resolve({
        ok: true,
        status: 200,
        url: `script://${input.scriptKey}`,
        body,
        metadata: {
          scriptKey: script.key,
          scriptRuntime: script.runtime,
          scriptChecksum: script.checksum,
          scriptUpdatedAt: script.updatedAt,
          gatewayCredentials,
          gatewayEnvNames: Object.keys(leasedEnv).sort(),
          durationMs: Date.now() - startedAt,
          stderr: stderrText || null,
          stdoutTruncated,
          stderrTruncated,
        },
      });
    });

    child.stdin.end(JSON.stringify(payload));
  });
}

function buildScriptRunnerTask(siteTask: AppTask): RunnableTask | null {
  const scriptKey = stringFromConfig(siteTask.inputConfig, "scriptKey") || stringFromConfig(siteTask.inputConfig, "script_key");
  if (!scriptKey) {
    console.warn(JSON.stringify({ event: "task.script_runner_missing_script", task: siteTask.key }));
    return null;
  }
  const cron = (siteTask.scheduleCron ?? "").trim() || "0 * * * *";
  const params = recordFromConfig(siteTask.inputConfig, "params");
  const timeoutMs = Object.prototype.hasOwnProperty.call(siteTask.inputConfig, "timeoutMs")
    ? intFromConfig(siteTask.inputConfig, "timeoutMs", scriptRunnerTimeoutMs(), 1_000, 3_600_000)
    : null;
  let handoffConfig: ReturnType<typeof scriptAgentHandoffConfig>;
  try {
    handoffConfig = scriptAgentHandoffConfig(siteTask.instructionConfig, siteTask.agentConfig);
  } catch (error) {
    console.warn(JSON.stringify({
      event: "task.script_runner_handoff_invalid",
      task: siteTask.key,
      error: describeError(error),
    }));
    return null;
  }

  return {
    key: siteTask.key,
    name: siteTask.name,
    taskType: "script-runner",
    defaultEnabled: false,
    defaultCron: cron,
    enabled: siteTask.enabled,
    cron,
    run: async () => {
      const scriptResult = await runSiteTaskScript({ siteTask, scriptKey, params, timeoutMs });
      return applyScriptAgentHandoff({
        config: handoffConfig,
        scriptTaskResult: scriptResult,
        invokeAgent: async ({ prompt, scriptResult: parsedScriptResult, handoff }) => {
          const baseUrl = requireBaseUrl("CODEX_RUNTIME_BASE_URL", codexRuntimeBaseUrl());
          return postCodexRuntimeJson(baseUrl, {
            prompt,
            sessionId: `script-handoff:${siteTask.key}:${Date.now()}`,
            codexThreadId: null,
            recentHistory: [],
            credentials: requestedGatewayKeysFromConfig(siteTask.agentConfig, [
              "gatewayCredentials",
              "gateway_credentials",
            ]),
            context: { delegatedActorId: `task:${siteTask.key}` },
            metadata: {
              transport: "task-runner",
              taskKey: siteTask.key,
              taskName: siteTask.name,
              taskType: siteTask.taskType,
              scriptKey,
              scriptResult: parsedScriptResult,
              requestedSkills: mergeRequestedSkills(siteTask),
              allowEmptyResponse: true,
              handoff,
            },
          }, longRunningHttpTimeoutMs());
        },
      });
    },
    outputConfig: siteTask.outputConfig,
  };
}

function stringHeadersFromConfig(config: Record<string, unknown>): Record<string, string> {
  const headers = recordFromConfig(config, "headers");
  const result: Record<string, string> = {};
  for (const [key, value] of Object.entries(headers)) {
    const headerName = key.trim();
    if (headerName && headerName.toLowerCase() !== "content-type" && typeof value === "string") {
      result[headerName] = interpolateEnvTemplate(value);
    }
  }
  return result;
}

function interpolateEnvTemplate(value: string): string {
  return value.replace(/\$\{([A-Z0-9_]+)\}/g, (_match, envName: string) => {
    const envValue = (process.env[envName] ?? "").trim();
    if (!envValue) {
      throw new Error(`HTTP_POST_ENV_MISSING:${envName}`);
    }
    return envValue;
  });
}

function bearerEnvFromHttpPostConfig(config: Record<string, unknown>): string {
  const auth = recordFromConfig(config, "auth");
  return (
    stringFromConfig(auth, "bearerEnv")
    || stringFromConfig(auth, "bearer_env")
    || stringFromConfig(config, "bearerEnv")
    || stringFromConfig(config, "bearer_env")
  );
}

function httpPostRetryConfig(config: Record<string, unknown>): { attempts: number; backoff: string } {
  const retry = recordFromConfig(config, "retry");
  const attempts = Object.prototype.hasOwnProperty.call(retry, "attempts")
    ? intFromConfig(retry, "attempts", 1, 1, 10)
    : 1;
  const backoff = stringFromConfig(retry, "backoff", "none").toLowerCase();
  return { attempts, backoff };
}

function httpPostRetryDelayMs(attemptIndex: number, backoff: string): number {
  if (backoff === "exponential") {
    return Math.min(30_000, 1_000 * (2 ** Math.max(0, attemptIndex - 1)));
  }
  if (backoff === "linear") {
    return Math.min(30_000, 1_000 * attemptIndex);
  }
  return 0;
}

function httpPostResultCounts(responseBody: string): Record<string, unknown> | null {
  try {
    const parsed = JSON.parse(responseBody) as unknown;
    if (!isRecord(parsed)) {
      return null;
    }
    const candidates = parsed.resultCounts ?? parsed.counts ?? parsed.results ?? parsed.summary;
    if (isRecord(candidates)) {
      return candidates;
    }
    const counts: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(parsed)) {
      if (/count|total|sent|failed|skipped|queued|dispatched/i.test(key) && (typeof value === "number" || typeof value === "string")) {
        counts[key] = value;
      }
    }
    return Object.keys(counts).length ? counts : null;
  } catch {
    return null;
  }
}

function buildHttpPostTask(siteTask: AppTask): RunnableTask | null {
  const url = stringFromConfig(siteTask.inputConfig, "url");
  if (!url) {
    console.warn(JSON.stringify({ event: "task.http_post_missing_url", task: siteTask.key }));
    return null;
  }
  const method = stringFromConfig(siteTask.inputConfig, "method", "POST").toUpperCase();
  if (method !== "POST") {
    console.warn(JSON.stringify({ event: "task.http_post_unsupported_method", task: siteTask.key, method }));
    return null;
  }
  try {
    const parsed = new URL(url);
    if (parsed.protocol !== "https:") {
      throw new Error(`Unsupported protocol: ${parsed.protocol}`);
    }
  } catch (error) {
    console.warn(JSON.stringify({ event: "task.http_post_invalid_url", task: siteTask.key, error: describeError(error) }));
    return null;
  }

  const cron = (siteTask.scheduleCron ?? "").trim() || "0 * * * *";
  const timeoutMs = Object.prototype.hasOwnProperty.call(siteTask.inputConfig, "timeoutMs")
    ? intFromConfig(siteTask.inputConfig, "timeoutMs", httpTimeoutMs(), 1_000, 900_000)
    : httpTimeoutMs();
  const retry = httpPostRetryConfig(siteTask.inputConfig);

  return {
    key: siteTask.key,
    name: siteTask.name,
    taskType: "http-post",
    defaultEnabled: false,
    defaultCron: cron,
    enabled: siteTask.enabled,
    cron,
    run: async () => {
      const headers = stringHeadersFromConfig(siteTask.inputConfig);
      const bearerEnv = bearerEnvFromHttpPostConfig(siteTask.inputConfig);
      if (bearerEnv) {
        const token = (process.env[bearerEnv] ?? "").trim();
        if (!token) {
          throw new Error(`HTTP_POST_BEARER_ENV_MISSING:${bearerEnv}`);
        }
        headers.Authorization = `Bearer ${token}`;
      }
      const body = recordFromConfig(siteTask.inputConfig, "body");
      const startedAt = Date.now();
      const attempts: Array<Record<string, unknown>> = [];
      let lastError: string | null = null;
      let lastStatus = 0;
      let lastBody = "";

      for (let attempt = 1; attempt <= retry.attempts; attempt += 1) {
        const attemptStartedAt = nowIso();
        try {
          const response = await postJsonUrlRaw(url, headers, body, timeoutMs);
          lastStatus = response.status;
          lastBody = response.body;
          const resultCounts = httpPostResultCounts(response.body);
          const attemptLog = {
            timestamp: attemptStartedAt,
            endpoint: url,
            method,
            attempt,
            status: response.status,
            resultCounts,
            errorBody: response.status >= 200 && response.status < 300 ? null : response.body.slice(0, 1_000),
          };
          attempts.push(attemptLog);
          console.log(JSON.stringify({ event: "task.http_post_attempt", task: siteTask.key, ...attemptLog }));

          if (response.status >= 200 && response.status < 300) {
            return {
              ok: true,
              status: response.status,
              url,
              body: JSON.stringify({
                ok: true,
                timestamp: nowIso(),
                endpoint: url,
                method,
                status: response.status,
                resultCounts,
                attempts,
                durationMs: Date.now() - startedAt,
              }),
              metadata: {
                taskType: "http-post",
                timeoutMs,
                retry,
                bearerEnv: bearerEnv || null,
                resultCounts,
              },
            };
          }
          lastError = `HTTP ${response.status} from ${url}: ${response.body.slice(0, 500)}`;
        } catch (error) {
          lastError = describeError(error);
          const attemptLog = {
            timestamp: attemptStartedAt,
            endpoint: url,
            method,
            attempt,
            status: null,
            resultCounts: null,
            errorBody: lastError,
          };
          attempts.push(attemptLog);
          console.warn(JSON.stringify({ event: "task.http_post_attempt_failed", task: siteTask.key, ...attemptLog }));
        }

        const delayMs = attempt < retry.attempts ? httpPostRetryDelayMs(attempt, retry.backoff) : 0;
        if (delayMs > 0) {
          await sleep(delayMs);
        }
      }

      throw new Error(JSON.stringify({
        ok: false,
        timestamp: nowIso(),
        endpoint: url,
        method,
        status: lastStatus || null,
        resultCounts: lastBody ? httpPostResultCounts(lastBody) : null,
        errorBody: lastBody ? lastBody.slice(0, 1_000) : lastError,
        attempts,
      }));
    },
    outputConfig: siteTask.outputConfig,
  };
}

function statusFromChangeRequest(payload: Record<string, unknown>): string | null {
  const changeRequest = payload.changeRequest;
  if (!isRecord(changeRequest)) {
    return null;
  }
  const status = changeRequest.status;
  return typeof status === "string" && status.trim() ? status.trim() : null;
}

function requestIdFromChangeRequest(payload: Record<string, unknown>): string | null {
  const changeRequest = payload.changeRequest;
  if (!isRecord(changeRequest)) {
    return null;
  }
  const id = changeRequest.id;
  return typeof id === "string" && id.trim() ? id.trim() : null;
}

function requestNumberFromChangeRequest(payload: Record<string, unknown>): number | null {
  const changeRequest = payload.changeRequest;
  if (!isRecord(changeRequest)) {
    return null;
  }
  const requestNumber = changeRequest.requestNumber ?? changeRequest.request_number;
  return typeof requestNumber === "number" && Number.isFinite(requestNumber) ? requestNumber : null;
}

function changeRequestFromPayload(payload: Record<string, unknown>): Record<string, unknown> | null {
  return isRecord(payload.changeRequest) ? payload.changeRequest : null;
}

function workflowKeyFromChangeRequest(payload: Record<string, unknown>): string | null {
  const changeRequest = changeRequestFromPayload(payload);
  const workflowKey = changeRequest?.workflowKey ?? changeRequest?.workflow_key;
  return typeof workflowKey === "string" && workflowKey.trim() ? workflowKey.trim() : null;
}

function currentWorkflowStepKeyFromChangeRequest(payload: Record<string, unknown>): string | null {
  const changeRequest = changeRequestFromPayload(payload);
  const stepKey = changeRequest?.currentWorkflowStepKey ?? changeRequest?.current_workflow_step_key;
  return typeof stepKey === "string" && stepKey.trim() ? stepKey.trim() : null;
}

function workflowRunStatusFromChangeRequest(payload: Record<string, unknown>): string | null {
  const changeRequest = changeRequestFromPayload(payload);
  const status = changeRequest?.workflowRunStatus ?? changeRequest?.workflow_run_status;
  return typeof status === "string" && status.trim() ? status.trim() : null;
}

function workflowStepTypeFromPayload(payload: Record<string, unknown>, stepKey: string | null): string | null {
  if (!stepKey) {
    return null;
  }

  const detail = isRecord(payload.detail) ? payload.detail : null;
  const detailSteps = Array.isArray(detail?.steps) ? detail.steps : [];
  const workflow = isRecord(payload.workflow) ? payload.workflow : null;
  const definition = isRecord(workflow?.definition) ? workflow.definition : null;
  const definitionSteps = Array.isArray(definition?.steps) ? definition.steps : [];
  const steps = [...detailSteps, ...definitionSteps].filter(isRecord);
  const step = steps.find((candidate) => candidate.key === stepKey);
  const stepType = step?.type;
  return typeof stepType === "string" && stepType.trim() ? stepType.trim() : null;
}

async function workflowRunnerCurrentStepCanContinue(requestDetail: Record<string, unknown>, fallbackWorkflowKey: string): Promise<boolean> {
  if (workflowRunStatusFromChangeRequest(requestDetail) === "completed") {
    return false;
  }

  const stepKey = currentWorkflowStepKeyFromChangeRequest(requestDetail);
  if (!stepKey) {
    return false;
  }

  const workflowKey = workflowKeyFromChangeRequest(requestDetail) ?? fallbackWorkflowKey;
  const workflowPayload = await appApiRequest(`/agent/workflows/${encodeURIComponent(workflowKey)}`, { method: "GET" });
  if (!workflowPayload) {
    return false;
  }

  const stepType = workflowStepTypeFromPayload(workflowPayload, stepKey) ?? "agent";
  return stepType === "agent" || stepType === "loop";
}

function workflowStepsFromRecord(workflow: Record<string, unknown>): Record<string, unknown>[] {
  const definition = isRecord(workflow.definition) ? workflow.definition : {};
  return Array.isArray(definition.steps)
    ? definition.steps.filter((step): step is Record<string, unknown> => isRecord(step))
    : [];
}

function workflowKeyFromRecord(workflow: Record<string, unknown>): string {
  return typeof workflow.key === "string" && workflow.key.trim() ? workflow.key.trim() : "unknown-workflow";
}

function workflowStepKey(step: Record<string, unknown>): string {
  return typeof step.key === "string" && step.key.trim() ? step.key.trim() : "unknown-step";
}

function workflowStepType(step: Record<string, unknown>): string {
  return typeof step.type === "string" && step.type.trim() ? step.type.trim() : "agent";
}

function workflowStepNext(step: Record<string, unknown>): string | null {
  return typeof step.next === "string" && step.next.trim() ? step.next.trim() : null;
}

function workflowStepRoutes(step: Record<string, unknown>): Record<string, unknown> {
  return isRecord(step.routes) ? step.routes : {};
}

function workflowStepLoop(step: Record<string, unknown>): Record<string, unknown> {
  return isRecord(step.loop) ? step.loop : {};
}

function workflowStepByKey(steps: Record<string, unknown>[], key: string | null): Record<string, unknown> | null {
  return key ? steps.find((step) => workflowStepKey(step) === key) ?? null : null;
}

function doctorWorkflowFindings(workflow: Record<string, unknown>): DoctorFinding[] {
  const workflowKey = workflowKeyFromRecord(workflow);
  const steps = workflowStepsFromRecord(workflow);
  const findings: DoctorFinding[] = [];

  for (const step of steps) {
    const stepKey = workflowStepKey(step);
    const type = workflowStepType(step);
    const next = workflowStepNext(step);
    const routes = workflowStepRoutes(step);
    const routeKeys = Object.keys(routes);

    if (type === "terminal") {
      continue;
    }

    if (type === "gate") {
      if (!next) {
        findings.push({
          check: "gate-has-single-forward-next",
          status: "failed",
          subjectType: "workflow",
          subjectKey: workflowKey,
          stepKey,
          expected: "Gate pauses and continues through one forward next step.",
          observed: "Gate has no next step.",
          recommendation: "Set next to the normal forward step and use explicit operator controls for send-back or cancel.",
          evidence: { routes },
        });
      }
      if (routeKeys.length > 0) {
        findings.push({
          check: "gate-does-not-use-route-map",
          status: "failed",
          subjectType: "workflow",
          subjectKey: workflowKey,
          stepKey,
          expected: "Gate uses simple next flow.",
          observed: `Gate defines route keys: ${routeKeys.join(", ")}.`,
          recommendation: "Remove routes and keep only next for normal forward flow.",
          evidence: { next, routes },
        });
      }
      if (next && !workflowStepByKey(steps, next)) {
        findings.push({
          check: "gate-next-step-exists",
          status: "failed",
          subjectType: "workflow",
          subjectKey: workflowKey,
          stepKey,
          expected: "Gate next points to an existing step.",
          observed: `Missing next step: ${next}.`,
          recommendation: "Update next to an existing step key.",
          evidence: { next },
        });
      }
      continue;
    }

    if (type === "loop") {
      const loop = workflowStepLoop(step);
      const target = typeof loop.target === "string" && loop.target.trim() ? loop.target.trim() : null;
      const maxIterations = Number(loop.maxIterations);
      if (!target || !next || !Number.isFinite(maxIterations) || maxIterations <= 0) {
        findings.push({
          check: "loop-has-target-exit-and-max-iterations",
          status: "failed",
          subjectType: "workflow",
          subjectKey: workflowKey,
          stepKey,
          expected: "Loop has loop.target, next, and positive loop.maxIterations.",
          observed: "Loop config is incomplete.",
          recommendation: "Set loop.target, next, and a positive maxIterations value.",
          evidence: { next, loop },
        });
      }
      if (target && !workflowStepByKey(steps, target)) {
        findings.push({
          check: "loop-target-step-exists",
          status: "failed",
          subjectType: "workflow",
          subjectKey: workflowKey,
          stepKey,
          expected: "Loop target points to an existing step.",
          observed: `Missing loop target step: ${target}.`,
          recommendation: "Update loop.target to an existing step key.",
          evidence: { loop },
        });
      }
      if (next && !workflowStepByKey(steps, next)) {
        findings.push({
          check: "loop-next-step-exists",
          status: "failed",
          subjectType: "workflow",
          subjectKey: workflowKey,
          stepKey,
          expected: "Loop next points to an existing step.",
          observed: `Missing next step: ${next}.`,
          recommendation: "Update next to an existing step key.",
          evidence: { next },
        });
      }
      continue;
    }

    if (!next) {
      findings.push({
        check: "step-has-forward-next",
        status: "failed",
        subjectType: "workflow",
        subjectKey: workflowKey,
        stepKey,
        expected: "Non-terminal non-loop steps have a forward next step.",
        observed: `${type} step has no next step.`,
        recommendation: "Set next to the normal forward step, or make this step terminal.",
        evidence: { type },
      });
    } else if (!workflowStepByKey(steps, next)) {
      findings.push({
        check: "step-next-step-exists",
        status: "failed",
        subjectType: "workflow",
        subjectKey: workflowKey,
        stepKey,
        expected: "Step next points to an existing step.",
        observed: `Missing next step: ${next}.`,
        recommendation: "Update next to an existing step key.",
        evidence: { type, next },
      });
    }
  }

  return findings;
}

function doctorTaskWorkflowKey(task: Record<string, unknown>): string | null {
  const inputConfig = isRecord(task.inputConfig) ? task.inputConfig : isRecord(task.input_config) ? task.input_config : {};
  const workflowKey = inputConfig.workflowKey ?? inputConfig.workflow_key;
  return typeof workflowKey === "string" && workflowKey.trim() ? workflowKey.trim() : null;
}

function doctorHookWorkflowKey(hook: Record<string, unknown>): string | null {
  const workflowKey = hook.workflowKey ?? hook.workflow_key;
  return typeof workflowKey === "string" && workflowKey.trim() ? workflowKey.trim() : null;
}

function doctorStringList(value: unknown) {
  return Array.isArray(value)
    ? Array.from(new Set(value
      .filter((entry): entry is string => typeof entry === "string")
      .map((entry) => entry.trim())
      .filter(Boolean)))
    : [];
}

async function doctorRuntimeSkills() {
  const baseUrl = codexRuntimeBaseUrl();
  if (!baseUrl) return [] as Record<string, unknown>[];
  const response = await fetchWithTimeout(`${baseUrl}/skills`, { method: "GET" }, httpTimeoutMs());
  if (!response.ok) {
    throw new Error(`HTTP ${response.status} from ${baseUrl}/skills`);
  }
  const payload = await response.json() as Record<string, unknown>;
  return Array.isArray(payload.skills) ? payload.skills.filter(isRecord) : [];
}

function doctorAgentConfigSkills(value: unknown) {
  return isRecord(value) ? doctorStringList(value.skills) : [];
}

function doctorAgentConfigCredentials(value: unknown) {
  if (!isRecord(value)) return [];
  const credentials = value.gatewayCredentials ?? value.gateway_credentials;
  if (!Array.isArray(credentials)) return [];
  return Array.from(new Set(credentials.flatMap((entry) => {
    if (typeof entry === "string" && entry.trim()) return [entry.trim()];
    if (isRecord(entry) && typeof entry.key === "string" && entry.key.trim()) return [entry.key.trim()];
    return [];
  })));
}

function doctorWorkflowDependencies(workflow: Record<string, unknown>) {
  const definition = isRecord(workflow.definition) ? workflow.definition : {};
  const steps = Array.isArray(definition.steps) ? definition.steps.filter(isRecord) : [];
  return {
    skills: Array.from(new Set([
      ...doctorAgentConfigSkills(definition.agentConfig ?? definition.agent_config),
      ...steps.flatMap((step) => doctorAgentConfigSkills(step.agentConfig ?? step.agent_config)),
    ])),
    directCredentials: Array.from(new Set([
      ...doctorAgentConfigCredentials(definition.agentConfig ?? definition.agent_config),
      ...steps.flatMap((step) => doctorAgentConfigCredentials(step.agentConfig ?? step.agent_config)),
    ])),
  };
}

function doctorSkillDependencyFindings(input: {
  workflows: Record<string, unknown>[];
  skills: Record<string, unknown>[];
}) {
  const findings: DoctorFinding[] = [];
  const skillsByName = new Map(input.skills.map((skill) => [
    typeof skill.name === "string" ? skill.name : "",
    skill,
  ]));

  for (const workflow of input.workflows) {
    const workflowKey = workflowKeyFromRecord(workflow);
    const dependencies = doctorWorkflowDependencies(workflow);
    for (const skillName of dependencies.skills) {
      const skill = skillsByName.get(skillName);
      if (!skill) {
        findings.push({
          check: "workflow-required-skill-exists",
          status: "failed",
          subjectType: "workflow",
          subjectKey: workflowKey,
          expected: `Referenced skill exists: ${skillName}.`,
          observed: `Referenced skill was not found: ${skillName}.`,
          recommendation: "Install the skill or remove the stale workflow skill reference.",
          evidence: { skillName },
        });
        continue;
      }
    }
  }
  return findings;
}

function doctorCredentialDependencyFindings(input: {
  workflows: Record<string, unknown>[];
  tasks: Record<string, unknown>[];
  skills: Record<string, unknown>[];
  connections: Record<string, unknown>[];
}) {
  const findings: DoctorFinding[] = [];
  const skillsByName = new Map(input.skills.map((skill) => [
    typeof skill.name === "string" ? skill.name : "",
    skill,
  ]));
  const connectionsByKey = new Map(input.connections
    .filter((connection) => typeof connection.key === "string")
    .map((connection) => [String(connection.key), connection]));

  function unavailableReason(credentialKey: string) {
    const connection = connectionsByKey.get(credentialKey);
    if (!connection) return "missing";
    if (connection.status === "revoked") return "connection revoked";
    if (!Array.isArray(connection.secretNames) || connection.secretNames.length === 0) return "secret missing";
    return null;
  }

  function addFinding(inputFinding: {
    check: string;
    subjectType: "skill" | "workflow" | "task";
    subjectKey: string;
    credentialKey: string;
    skillName?: string;
  }) {
    const reason = unavailableReason(inputFinding.credentialKey);
    if (!reason) return;
    findings.push({
      check: inputFinding.check,
      status: "failed",
      subjectType: inputFinding.subjectType,
      subjectKey: inputFinding.subjectKey,
      expected: `Required Gateway credential is configured: ${inputFinding.credentialKey}.`,
      observed: `Required Gateway credential ${inputFinding.credentialKey} is unavailable: ${reason}.`,
      recommendation: "Add or repair the credential in Gateway Settings.",
      evidence: {
        credentialKey: inputFinding.credentialKey,
        ...(inputFinding.skillName ? { skillName: inputFinding.skillName } : {}),
        reason,
      },
    });
  }

  for (const skill of input.skills) {
    const skillName = typeof skill.name === "string" && skill.name.trim() ? skill.name.trim() : "unknown-skill";
    for (const credentialKey of doctorStringList(skill.requiredCredentials ?? skill.required_credentials)) {
      addFinding({
        check: "skill-required-credential-available",
        subjectType: "skill",
        subjectKey: skillName,
        credentialKey,
      });
    }
  }

  for (const workflow of input.workflows) {
    const workflowKey = workflowKeyFromRecord(workflow);
    const dependencies = doctorWorkflowDependencies(workflow);
    for (const skillName of dependencies.skills) {
      const skill = skillsByName.get(skillName);
      if (!skill) continue;
      for (const credentialKey of doctorStringList(skill.requiredCredentials ?? skill.required_credentials)) {
        addFinding({
          check: "workflow-skill-credential-available",
          subjectType: "workflow",
          subjectKey: workflowKey,
          credentialKey,
          skillName,
        });
      }
    }
    for (const credentialKey of dependencies.directCredentials) {
      addFinding({
        check: "workflow-direct-credential-available",
        subjectType: "workflow",
        subjectKey: workflowKey,
        credentialKey,
      });
    }
  }

  for (const task of input.tasks) {
    const taskKey = typeof task.key === "string" && task.key.trim() ? task.key.trim() : "unknown-task";
    const agentConfigValue = task.agentConfig ?? task.agent_config;
    const agentConfig = isRecord(agentConfigValue) ? agentConfigValue : {};
    for (const credentialKey of doctorStringList(
      agentConfig.gatewayCredentials ?? agentConfig.gateway_credentials,
    )) {
      addFinding({
        check: "task-required-credential-available",
        subjectType: "task",
        subjectKey: taskKey,
        credentialKey,
      });
    }
  }

  return findings;
}

function doctorRepairRequestTitle() {
  return "Repair Prism Doctor findings";
}

function doctorReportArtifactStamp(generatedAt: string) {
  return generatedAt.replace(/[^0-9A-Za-z]+/g, "-").replace(/^-|-$/g, "");
}

function doctorRepairSummary(report: {
  generatedAt: string;
  summary: {
    workflowsChecked: number;
    tasksChecked: number;
    hooksChecked: number;
    skillsChecked: number;
    findings: number;
    failed: number;
    warnings: number;
    workflowFindingSubjects: number;
    durationMs: number;
  };
  findings: DoctorFinding[];
}) {
  const failedBySubject = new Map<string, number>();
  const warningBySubject = new Map<string, number>();
  for (const finding of report.findings) {
    const key = `${finding.subjectType}:${finding.subjectKey}`;
    if (finding.status === "failed") {
      failedBySubject.set(key, (failedBySubject.get(key) ?? 0) + 1);
    } else {
      warningBySubject.set(key, (warningBySubject.get(key) ?? 0) + 1);
    }
  }

  const failedLines = [...failedBySubject.entries()]
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .slice(0, 20)
    .map(([subject, count]) => `- ${subject}: ${count} failed check${count === 1 ? "" : "s"}`);
  const warningLines = [...warningBySubject.entries()]
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .slice(0, 10)
    .map(([subject, count]) => `- ${subject}: ${count} warning${count === 1 ? "" : "s"}`);

  return [
    `Prism Doctor found ${report.summary.failed} failed check${report.summary.failed === 1 ? "" : "s"} and ${report.summary.warnings} warning${report.summary.warnings === 1 ? "" : "s"} at ${report.generatedAt}.`,
    "",
    `Checked ${report.summary.workflowsChecked} workflows, ${report.summary.tasksChecked} tasks, ${report.summary.hooksChecked} hooks, and ${report.summary.skillsChecked} skills.`,
    "",
    "Failed subjects:",
    failedLines.length ? failedLines.join("\n") : "- None",
    "",
    "Warnings:",
    warningLines.length ? warningLines.join("\n") : "- None",
    "",
    "Recommended repair flow:",
    "1. Read the attached stamped `prism-doctor-report-<timestamp>.json` and `prism-doctor-report-<timestamp>.md` artifacts.",
    "2. Repair the listed workflow, skill, task, hook, or credential drift deliberately.",
    "3. Rerun Prism Doctor and confirm the failed finding count is zero.",
  ].join("\n");
}

function doctorReportMarkdown(report: {
  generatedAt: string;
  summary: {
    workflowsChecked: number;
    tasksChecked: number;
    hooksChecked: number;
    skillsChecked: number;
    findings: number;
    failed: number;
    warnings: number;
    workflowFindingSubjects: number;
    durationMs: number;
  };
  findings: DoctorFinding[];
}) {
  const findingLines = report.findings.map((finding) => {
    const step = finding.stepKey ? ` step \`${finding.stepKey}\`` : "";
    return [
      `### ${finding.status.toUpperCase()}: ${finding.check}`,
      "",
      `- Subject: \`${finding.subjectType}:${finding.subjectKey}\`${step}`,
      `- Expected: ${finding.expected}`,
      `- Observed: ${finding.observed}`,
      `- Recommendation: ${finding.recommendation}`,
      finding.evidence ? `- Evidence: \`${JSON.stringify(finding.evidence)}\`` : null,
    ].filter(Boolean).join("\n");
  });

  return [
    "# Prism Doctor Report",
    "",
    `Generated: ${report.generatedAt}`,
    "",
    "## Summary",
    "",
    `- Workflows checked: ${report.summary.workflowsChecked}`,
    `- Tasks checked: ${report.summary.tasksChecked}`,
    `- Hooks checked: ${report.summary.hooksChecked}`,
    `- Skills checked: ${report.summary.skillsChecked}`,
    `- Findings: ${report.summary.findings}`,
    `- Failed: ${report.summary.failed}`,
    `- Warnings: ${report.summary.warnings}`,
    `- Workflow subjects with findings: ${report.summary.workflowFindingSubjects}`,
    `- Duration: ${report.summary.durationMs}ms`,
    "",
    "## Findings",
    "",
    findingLines.length ? findingLines.join("\n\n") : "No findings.",
    "",
  ].join("\n");
}

function doctorRequestRecord(value: unknown): Record<string, unknown> | null {
  return isRecord(value) && typeof value.id === "string" ? value : null;
}

async function attachDoctorReportArtifact(input: {
  requestId: string;
  name: string;
  kind: string;
  mimeType: string;
  content: string;
  generatedAt: string;
}) {
  return appApiRequest(`/agent/change-board/requests/${encodeURIComponent(input.requestId)}/artifacts`, {
    method: "POST",
    body: JSON.stringify({
      kind: input.kind,
      name: input.name,
      mimeType: input.mimeType,
      content: input.content,
      encoding: "utf8",
      createdBy: "prism-doctor",
      metadata: {
        reportType: "prism-doctor",
        generatedAt: input.generatedAt,
      },
    }),
  });
}

async function ensureDoctorRepairRequest(report: {
  generatedAt: string;
  summary: {
    workflowsChecked: number;
    tasksChecked: number;
    hooksChecked: number;
    skillsChecked: number;
    findings: number;
    failed: number;
    warnings: number;
    workflowFindingSubjects: number;
    durationMs: number;
  };
  findings: DoctorFinding[];
}) {
  if (report.summary.failed <= 0) {
    return null;
  }

  const summary = doctorRepairSummary(report);
  const existingPayload = await appApiRequest(
    "/agent/change-board/requests?source=prism-doctor&openOnly=true&limit=25",
    { method: "GET" },
  ) ?? {};
  const existingRequests = Array.isArray(existingPayload.changeRequests)
    ? existingPayload.changeRequests.filter(isRecord)
    : [];
  const existing = matchingDoctorRepairRequest(existingRequests, doctorRepairRequestTitle(), doctorRepairWorkflowKey());
  const existingId = typeof existing?.id === "string" ? existing.id : null;
  const request = existingId
    ? doctorRequestRecord((await appApiRequest(`/agent/change-board/requests/${encodeURIComponent(existingId)}`, {
        method: "PATCH",
        body: JSON.stringify({
          triageSummary: summary,
          reviewNotes: `Latest Prism Doctor run: ${report.generatedAt}`,
          agentRecommendation: "Repair failed Prism Doctor findings, then rerun Prism Doctor.",
        }),
      }) ?? {}).changeRequest)
    : doctorRequestRecord((await appApiRequest("/agent/change-board/requests", {
        method: "POST",
        body: JSON.stringify({
          title: doctorRepairRequestTitle(),
          description: summary,
          requestType: "ops",
          priority: report.summary.failed > 0 ? "high" : "normal",
          workflowKey: doctorRepairWorkflowKey(),
          source: "prism-doctor",
          triageSummary: summary,
          agentRecommendation: "Repair failed Prism Doctor findings, then rerun Prism Doctor.",
          estimatedHumanHours: 1,
          autoStart: false,
          allowTargetless: true,
          acceptanceCriteria: [
            "Prism Doctor has been rerun.",
            "The rerun report has zero failed findings.",
            "Any remaining warnings are documented or intentionally deferred.",
          ],
        }),
      }) ?? {}).changeRequest);

  if (!request || typeof request.id !== "string") {
    throw new Error("PRISM_DOCTOR_REPAIR_REQUEST_CREATE_FAILED");
  }

  const stamp = doctorReportArtifactStamp(report.generatedAt);
  const markdown = doctorReportMarkdown(report);
  await attachDoctorReportArtifact({
    requestId: request.id,
    name: `prism-doctor-report-${stamp}.json`,
    kind: "json",
    mimeType: "application/json",
    content: JSON.stringify(report, null, 2),
    generatedAt: report.generatedAt,
  });
  await attachDoctorReportArtifact({
    requestId: request.id,
    name: `prism-doctor-report-${stamp}.md`,
    kind: "markdown",
    mimeType: "text/markdown",
    content: markdown,
    generatedAt: report.generatedAt,
  });

  return {
    created: !existingId,
    requestId: request.id,
    requestNumber: typeof request.requestNumber === "number" ? request.requestNumber : null,
    title: typeof request.title === "string" ? request.title : doctorRepairRequestTitle(),
    artifacts: [
      `prism-doctor-report-${stamp}.json`,
      `prism-doctor-report-${stamp}.md`,
    ],
  };
}

async function runPrismDoctorTask(): Promise<TaskRunResult> {
  const startedAt = Date.now();
  const workflowPayload = await appApiRequest("/agent/workflows", { method: "GET" }) ?? {};
  const taskPayload = await appApiRequest("/agent/tasks", { method: "GET" }) ?? {};
  const hookPayload = await appApiRequest("/agent/hooks", { method: "GET" }) ?? {};
  const skillPayload = await appApiRequest("/agent/skills", { method: "GET" }) ?? {};
  const gatewayPayload: Record<string, unknown> = await appApiRequest("/agent/gateway", { method: "GET" })
    .catch(() => null) ?? {};
  const workflows = Array.isArray(workflowPayload.workflows) ? workflowPayload.workflows.filter(isRecord) : [];
  const tasks = Array.isArray(taskPayload.tasks) ? taskPayload.tasks.filter(isRecord) : [];
  const hooks = Array.isArray(hookPayload.hooks) ? hookPayload.hooks.filter(isRecord) : [];
  const hostedSkills = Array.isArray(skillPayload.skills) ? skillPayload.skills.filter(isRecord) : [];
  const runtimeSkills = await doctorRuntimeSkills().catch(() => [] as Record<string, unknown>[]);
  const skills = doctorMergeSkills(hostedSkills, runtimeSkills);
  const gateway = isRecord(gatewayPayload.gateway) ? gatewayPayload.gateway : {};
  const gatewayConnections = Array.isArray(gateway.connections) ? gateway.connections.filter(isRecord) : [];
  const workflowDetails = new Map<string, Record<string, unknown>>();
  await Promise.all(workflows.map(async (workflow) => {
    const workflowKey = workflowKeyFromRecord(workflow);
    if (workflowKey === "unknown-workflow") return;
    const payload = await appApiRequest(`/agent/workflows/${encodeURIComponent(workflowKey)}`, { method: "GET" })
      .catch(() => null);
    if (isRecord(payload?.detail)) workflowDetails.set(workflowKey, payload.detail);
  }));
  const initialFindings = [
    ...workflows.flatMap(doctorWorkflowFindings),
    ...workflows.flatMap(workflowContextFindings),
    ...workflows.flatMap((workflow) => legacyGatewayWorkflowFindings({
      workflow,
      detail: workflowDetails.get(workflowKeyFromRecord(workflow)) ?? null,
    })),
    ...doctorSkillDependencyFindings({ workflows, skills }),
    ...doctorCredentialDependencyFindings({
      workflows,
      tasks,
      skills,
      connections: gatewayConnections,
    }),
    ...tasks.flatMap(taskLifecycleFindings),
  ];
  const workflowsWithFindings = new Set(initialFindings
    .filter((finding) => finding.subjectType === "workflow")
    .map((finding) => finding.subjectKey));
  const findings = [...initialFindings];

  for (const task of tasks) {
    const taskKey = typeof task.key === "string" && task.key.trim() ? task.key.trim() : "unknown-task";
    const workflowKey = doctorTaskWorkflowKey(task);
    if (workflowKey && workflowsWithFindings.has(workflowKey)) {
      findings.push({
        check: "task-references-workflow-with-findings",
        status: "warning",
        subjectType: "task",
        subjectKey: taskKey,
        expected: "Tasks reference workflows that pass Doctor checks.",
        observed: `Task references workflow with findings: ${workflowKey}.`,
        recommendation: "Repair the referenced workflow before enabling or relying on this task.",
        evidence: {
          workflowKey,
          enabled: task.enabled ?? null,
          taskType: task.taskType ?? task.task_type ?? null,
        },
      });
    }
  }

  for (const hook of hooks) {
    const hookKey = typeof hook.key === "string" && hook.key.trim() ? hook.key.trim() : "unknown-hook";
    const workflowKey = doctorHookWorkflowKey(hook);
    if (workflowKey && workflowsWithFindings.has(workflowKey)) {
      findings.push({
        check: "hook-references-workflow-with-findings",
        status: "warning",
        subjectType: "hook",
        subjectKey: hookKey,
        expected: "Hooks reference workflows that pass Doctor checks.",
        observed: `Hook references workflow with findings: ${workflowKey}.`,
        recommendation: "Repair the referenced workflow before enabling or relying on this hook.",
        evidence: {
          workflowKey,
          enabled: hook.enabled ?? null,
          authMode: hook.authMode ?? hook.auth_mode ?? null,
        },
      });
    }
  }

  const report: {
    ok: boolean;
    reportType: string;
    generatedAt: string;
    mode: string;
    summary: {
      workflowsChecked: number;
      tasksChecked: number;
      hooksChecked: number;
      skillsChecked: number;
      findings: number;
      failed: number;
      warnings: number;
      workflowFindingSubjects: number;
      durationMs: number;
    };
    findings: DoctorFinding[];
    repairPlan: {
      automaticMutation: boolean;
      recommendedNextStep: string;
      repairRequest?: Awaited<ReturnType<typeof ensureDoctorRepairRequest>>;
      repairRequestError?: string;
    };
  } = {
    ok: true,
    reportType: "prism-doctor",
    generatedAt: nowIso(),
    mode: "report-and-repair-request",
    summary: {
      workflowsChecked: workflows.length,
      tasksChecked: tasks.length,
      hooksChecked: hooks.length,
      skillsChecked: skills.length,
      findings: findings.length,
      failed: findings.filter((finding) => finding.status === "failed").length,
      warnings: findings.filter((finding) => finding.status === "warning").length,
      workflowFindingSubjects: workflowsWithFindings.size,
      durationMs: Date.now() - startedAt,
    },
    findings,
    repairPlan: {
      automaticMutation: false,
      recommendedNextStep: findings.length
        ? "Review findings, make deliberate workflow/task/hook edits, then rerun Prism Doctor."
        : "No repair needed.",
    },
  };
  try {
    report.repairPlan.repairRequest = await ensureDoctorRepairRequest(report);
  } catch (error) {
    report.repairPlan.repairRequestError = describeError(error);
    console.warn(JSON.stringify({
      event: "prism_doctor.repair_request_failed",
      error: report.repairPlan.repairRequestError,
    }));
  }

  return {
    ok: true,
    status: 200,
    url: "prism-doctor://site",
    body: JSON.stringify(report, null, 2),
    metadata: {
      reportType: "prism-doctor",
      findings: findings.length,
      failed: report.summary.failed,
      warnings: report.summary.warnings,
      repairRequest: report.repairPlan.repairRequest,
      repairRequestError: report.repairPlan.repairRequestError,
    },
  };
}

function autoStartStarted(payload: Record<string, unknown>) {
  return isRecord(payload.autoStart) && payload.autoStart.started === true;
}

function autoStartShouldWait(payload: Record<string, unknown>) {
  return isRecord(payload.autoStart) && payload.autoStart.reason === "current_step_is_not_agent";
}

function workflowRunnerShouldStop(status: string | null, stopStatuses: Set<string>) {
  if (!status) {
    return false;
  }
  return stopStatuses.has(status);
}

async function appApiPost(path: string, body: Record<string, unknown>, timeoutMs = httpTimeoutMs()): Promise<WorkflowRunStepResult> {
  const baseUrl = requireBaseUrl("APP_API_BASE_URL", appApiBaseUrl() ?? "");
  const token = appApiServiceToken();
  const headers: Record<string, string> = {};
  if (token) {
    headers["X-Service-Token"] = token;
  }
  const result = await postJson(baseUrl, path, headers, body, timeoutMs);
  const payload = result.body ? JSON.parse(result.body) as Record<string, unknown> : {};
  return {
    status: result.status,
    url: result.url,
    body: result.body,
    payload,
  };
}

const workflowLaunchLocks = new Set<string>();
function buildWorkflowRunnerTask(siteTask: AppTask): RunnableTask | null {
  const workflowKey = stringFromConfig(siteTask.inputConfig, "workflowKey");
  const requestConfig = recordFromConfig(siteTask.inputConfig, "request");
  if (!workflowKey) {
    console.warn(JSON.stringify({ event: "task.workflow_runner_missing_workflow", task: siteTask.key }));
    return null;
  }

  const title = stringFromConfig(requestConfig, "title", siteTask.name);
  const description = stringFromConfig(requestConfig, "description");
  if (!title || !description) {
    console.warn(JSON.stringify({ event: "task.workflow_runner_missing_request", task: siteTask.key }));
    return null;
  }

  const autoRunConfig = recordFromConfig(siteTask.inputConfig, "autoRun");
  const autoRunEnabled = boolFromConfig(autoRunConfig, "enabled", true);
  const maxSteps = intFromConfig(autoRunConfig, "maxSteps", 1, 0, 10);
  const stopStatuses = new Set(
    (Array.isArray(autoRunConfig.stopStatuses) ? autoRunConfig.stopStatuses : ["closed"])
      .filter((item): item is string => typeof item === "string" && item.trim().length > 0)
      .map((item) => item.trim()),
  );
  const prompt = stringFromConfig(
    siteTask.instructionConfig,
    "prompt",
    `Run the current workflow step for the request created by task ${siteTask.key} using the request description and workflow step instructions.`,
  );
  const cron = (siteTask.scheduleCron ?? "").trim() || "0 * * * *";

  return {
    key: siteTask.key,
    name: siteTask.name,
    taskType: "workflow-runner",
    defaultEnabled: false,
    defaultCron: cron,
    enabled: siteTask.enabled,
    cron,
    run: async () => {
      const singleFlight = boolFromConfig(siteTask.inputConfig, 'singleFlight', false);
      const singleFlightKeys = Array.from(new Set([workflowKey, ...(
        Array.isArray(siteTask.inputConfig.singleFlightWorkflowKeys)
          ? siteTask.inputConfig.singleFlightWorkflowKeys.filter((key): key is string => typeof key === 'string') : []
      )])).sort();
      const lockKey = singleFlightKeys.join(',');
      const skip = (reason: string, requestNumbers: unknown[] = []) => ({ ok: true, status: 200, url: 'workflow-single-flight', body: JSON.stringify({ skipped: true, reason, requestNumbers }) });
      if (singleFlight && workflowLaunchLocks.has(lockKey)) return skip('launch-in-progress');
      if (singleFlight) workflowLaunchLocks.add(lockKey);
      try {
      if (singleFlight) {
        const open = await appApiRequest('/agent/change-board/requests?openOnly=true&limit=500', { method: 'GET' });
        const matches = findOpenWorkflowRequests(open, singleFlightKeys);
        if (matches.length) return skip('existing-open-workflow', matches.map(row => row.requestNumber));
      }
      const requestPayload: Record<string, unknown> = {
        title,
        description,
        workflowKey,
        requestType: stringFromConfig(requestConfig, "requestType", "content"),
        priority: stringFromConfig(requestConfig, "priority", "normal"),
        source: `task:${siteTask.key}`,
        autoStart: autoRunEnabled,
        requestedSkills: mergeRequestedSkills(siteTask),
        targetAppId: requestConfig.targetAppId ?? null,
        targetEnvironmentId: requestConfig.targetEnvironmentId ?? null,
        estimatedHumanHours: requestConfig.estimatedHumanHours ?? requestConfig.estimated_human_hours ?? null,
        constraints: isRecord(requestConfig.constraints) ? requestConfig.constraints : {},
        attachments: Array.isArray(requestConfig.attachments) ? requestConfig.attachments : [],
      };
      const createResult = await appApiPost("/agent/change-board/requests", requestPayload);
      const requestId = requestIdFromChangeRequest(createResult.payload);
      const requestNumber = requestNumberFromChangeRequest(createResult.payload);
      if (!requestId) {
        throw new Error(`WORKFLOW_RUNNER_REQUEST_CREATE_INVALID_RESPONSE:${createResult.body.slice(0, 500)}`);
      }

      const stepResults: WorkflowRunStepResult[] = [];
      let lastStatus = statusFromChangeRequest(createResult.payload);
      if (autoRunEnabled && !autoStartStarted(createResult.payload) && !autoStartShouldWait(createResult.payload)) {
        for (let index = 0; index < maxSteps; index += 1) {
          const currentDetail = await appApiRequest(`/agent/change-board/requests/${encodeURIComponent(requestId)}`, {
            method: "GET",
          });
          if (currentDetail) {
            lastStatus = statusFromChangeRequest(currentDetail) ?? lastStatus;
          }
          if (workflowRunnerShouldStop(lastStatus, stopStatuses)) {
            break;
          }
          if (!currentDetail || !(await workflowRunnerCurrentStepCanContinue(currentDetail, workflowKey))) {
            break;
          }

          const runResult = await appApiPost("/agent/responses", {
            input: [{ role: "user", content: prompt }],
            linked_change_request_id: requestId,
            workflow_action: null,
            requested_skills: mergeRequestedSkills(siteTask),
          }, longRunningHttpTimeoutMs());
          stepResults.push(runResult);
          const detailResult = await appApiRequest(`/agent/change-board/requests/${encodeURIComponent(requestId)}`, {
            method: "GET",
          });
          lastStatus = detailResult ? statusFromChangeRequest(detailResult) : lastStatus;
        }
      } else if (autoRunEnabled) {
        const detailResult = await appApiRequest(`/agent/change-board/requests/${encodeURIComponent(requestId)}`, {
          method: "GET",
        });
        lastStatus = detailResult ? statusFromChangeRequest(detailResult) : lastStatus;
      }

      return {
        ok: true,
        status: createResult.status,
        url: createResult.url,
        body: JSON.stringify({
          requestId,
          requestNumber,
          workflowKey,
          status: lastStatus,
          autoRun: {
            enabled: autoRunEnabled,
            stepsRun: stepResults.length,
            maxSteps,
            stopStatuses: Array.from(stopStatuses),
          },
          createResponse: createResult.payload,
          stepResponses: stepResults.map((result) => ({
            status: result.status,
            url: result.url,
            payload: result.payload,
          })),
        }),
      };
      } finally {
        if (singleFlight) workflowLaunchLocks.delete(lockKey);
      }
    },
    outputConfig: siteTask.outputConfig,
  };
}

function buildDynamicTask(siteTask: AppTask): RunnableTask | null {
  if (siteTask.taskType === "codex-prompt") {
    return buildCodexPromptTask(siteTask);
  }
  if (siteTask.taskType === "script-runner") {
    return buildScriptRunnerTask(siteTask);
  }
  if (siteTask.taskType === "http-post") {
    return buildHttpPostTask(siteTask);
  }
  if (siteTask.taskType === "workflow-runner") {
    return buildWorkflowRunnerTask(siteTask);
  }
  return null;
}

function syncDynamicTasks(runnableTasks: RunnableTask[], siteTasks: AppTask[]): void {
  const seen = new Set<string>();
  for (const siteTask of siteTasks) {
    const nextTask = buildDynamicTask(siteTask);
    if (!nextTask) {
      continue;
    }
    seen.add(siteTask.key);
    const existingIndex = runnableTasks.findIndex((task) => task.key === nextTask.key);
    if (existingIndex >= 0) {
      runnableTasks[existingIndex] = nextTask;
    } else {
      runnableTasks.push(nextTask);
    }
    try {
      applyTaskConfig(nextTask, {
        enabled: siteTask.enabled,
        cron: nextTask.cron,
      });
    } catch (error) {
      console.warn(JSON.stringify({ event: "task.site_config_invalid", task: nextTask.key, error: describeError(error) }));
    }
  }

  for (let index = runnableTasks.length - 1; index >= 0; index -= 1) {
    const task = runnableTasks[index];
    if ((task.taskType === "codex-prompt" || task.taskType === "script-runner" || task.taskType === "http-post" || task.taskType === "workflow-runner") && !seen.has(task.key)) {
      runnableTasks.splice(index, 1);
      state.delete(task.key);
    }
  }
}

async function syncTasksFromSite(tasks: RunnableTask[]): Promise<void> {
  const siteTasks = await fetchTasksFromSite();
  if (!siteTasks) {
    return;
  }
  for (const task of tasks) {
    if (task.taskType !== "builtin") {
      continue;
    }
    const siteTask = siteTasks.find((candidate) => candidate.key === task.key);
    try {
      applyTaskConfig(task, {
        enabled: siteTask?.enabled ?? task.defaultEnabled,
        cron: (siteTask?.scheduleCron ?? task.defaultCron).trim() || task.defaultCron,
      });
    } catch (error) {
      console.warn(JSON.stringify({ event: "task.site_config_invalid", task: task.key, error: describeError(error) }));
    }
  }
  syncDynamicTasks(tasks, siteTasks);
}

async function createTaskRunInSite(task: RunnableTask, source: "schedule" | "manual"): Promise<AppTaskRun | null> {
  try {
    const payload = await appApiRequest("/agent/tasks/runs", {
      method: "POST",
      body: JSON.stringify({
        taskKey: task.key,
        status: "running",
        triggerSource: source,
        startedAt: nowIso(),
      }),
    });
    const run = payload?.run;
    if (run && typeof run === "object" && "id" in run && typeof (run as { id?: unknown }).id === "string") {
      return { id: (run as { id: string }).id };
    }
  } catch (error) {
    console.warn(JSON.stringify({ event: "task.site_run_create_failed", task: task.key, error: describeError(error) }));
  }
  return null;
}

async function updateTaskRunInSite(
  run: AppTaskRun | null,
  status: "succeeded" | "failed",
  payload: {
    resultSummary?: string | null;
    errorMessage?: string | null;
    outputSnapshot?: Record<string, unknown>;
  },
): Promise<void> {
  if (!run) {
    return;
  }
  try {
    await appApiRequest(`/agent/tasks/runs/${encodeURIComponent(run.id)}`, {
      method: "PATCH",
      body: JSON.stringify({
        status,
        finishedAt: nowIso(),
        resultSummary: payload.resultSummary ?? null,
        errorMessage: payload.errorMessage ?? null,
        outputSnapshot: payload.outputSnapshot ?? {},
      }),
    });
  } catch (error) {
    console.warn(JSON.stringify({ event: "task.site_run_update_failed", runId: run.id, error: describeError(error) }));
  }
}

function buildBuiltInTasks(): BuiltInTask[] {
  const prismMemoryBaseUrl = trimBaseUrl(process.env.PRISM_MEMORY_BASE_URL ?? process.env.PRISM_API_BASE);
  const prismApiKey = (process.env.PRISM_API_KEY ?? "").trim();
  const communicationAdapterBaseUrl = trimBaseUrl(process.env.COMMUNICATION_ADAPTER_BASE_URL);
  const communicationAdapterToken = (process.env.COMMUNICATION_ADAPTER_TOKEN ?? "").trim();

  return [
    {
      key: "discord-sync",
      name: "Discord sync",
      defaultEnabled: false,
      defaultCron: "0 * * * *",
      enabled: false,
      cron: "0 * * * *",
      taskType: "builtin",
      outputConfig: {},
      run: async () => {
        const baseUrl = requireBaseUrl("COMMUNICATION_ADAPTER_BASE_URL", communicationAdapterBaseUrl);
        const headers: Record<string, string> = {};
        if (communicationAdapterToken) {
          headers["X-Adapter-Token"] = communicationAdapterToken;
        }
        return postJson(baseUrl, "/sync", headers);
      },
    },
    {
      key: "memory-run",
      name: "Prism memory run",
      defaultEnabled: false,
      defaultCron: "45 * * * *",
      enabled: false,
      cron: "45 * * * *",
      taskType: "builtin",
      outputConfig: {},
      run: async () => {
        const baseUrl = requireBaseUrl("PRISM_MEMORY_BASE_URL", prismMemoryBaseUrl);
        const headers: Record<string, string> = {};
        if (prismApiKey) {
          headers["X-Prism-Api-Key"] = prismApiKey;
        }
        return postJson(baseUrl, "/ops/memory/run", headers);
      },
    },
    {
      key: "knowledge-run",
      name: "Prism knowledge run",
      defaultEnabled: false,
      defaultCron: "55 * * * *",
      enabled: false,
      cron: "55 * * * *",
      taskType: "builtin",
      outputConfig: {},
      run: async () => {
        const baseUrl = requireBaseUrl("PRISM_MEMORY_BASE_URL", prismMemoryBaseUrl);
        const headers: Record<string, string> = {};
        if (prismApiKey) {
          headers["X-Prism-Api-Key"] = prismApiKey;
        }
        return postJson(baseUrl, "/ops/knowledge/run", headers);
      },
    },
    {
      key: "knowledge-source-sync",
      name: "Prism knowledge source sync",
      defaultEnabled: false,
      defaultCron: "15 * * * *",
      enabled: false,
      cron: "15 * * * *",
      taskType: "builtin",
      outputConfig: {},
      run: async () => {
        const baseUrl = requireBaseUrl("PRISM_MEMORY_BASE_URL", prismMemoryBaseUrl);
        const headers: Record<string, string> = {};
        if (prismApiKey) {
          headers["X-Prism-Api-Key"] = prismApiKey;
        }
        return postJson(baseUrl, "/ops/knowledge/sources/sync", headers);
      },
    },
    {
      key: "skill-source-sync",
      name: "Prism skill source sync",
      defaultEnabled: false,
      defaultCron: "20 * * * *",
      enabled: false,
      cron: "20 * * * *",
      taskType: "builtin",
      outputConfig: {},
      run: async () => {
        const baseUrl = requireBaseUrl("APP_API_BASE_URL", appApiBaseUrl() ?? "");
        const token = appApiServiceToken();
        const headers: Record<string, string> = {};
        if (token) {
          headers["X-Service-Token"] = token;
        }
        return postJson(baseUrl, "/agent/skill-sources/sync", headers);
      },
    },
    {
      key: "prism-doctor",
      name: "Prism Doctor",
      defaultEnabled: false,
      defaultCron: "0 15 * * 1",
      enabled: false,
      cron: "0 15 * * 1",
      taskType: "builtin",
      outputConfig: {},
      run: runPrismDoctorTask,
    },
  ];
}

async function runTask(task: RunnableTask, source: "schedule" | "manual"): Promise<TaskRunResult> {
  const taskState = state.get(task.key);
  if (!taskState) {
    throw new Error(`Unknown task state for ${task.key}`);
  }
  if (!task.enabled && source === "schedule") {
    throw new Error(`Task ${task.key} is disabled`);
  }
  if (taskState.running) {
    throw new Error(`Task ${task.key} is already running`);
  }

  taskState.running = true;
  taskState.status = "running";
  taskState.lastRunAt = nowIso();
  taskState.lastError = null;
  const appRun = await createTaskRunInSite(task, source);
  console.log(JSON.stringify({ event: "task.started", task: task.key, source, at: taskState.lastRunAt }));

  try {
    const result = await task.run();
    const delivery = await deliverTaskOutput(task, result);
    result.delivery = delivery;
    taskState.status = "succeeded";
    taskState.lastSuccessAt = nowIso();
    taskState.nextRunAt = nextCronDate(task.cron);
    await updateTaskRunInSite(appRun, "succeeded", {
      resultSummary: `HTTP ${result.status} from ${result.url}`,
      outputSnapshot: {
        status: result.status,
        url: result.url,
        body: result.body,
        metadata: result.metadata ?? {},
        delivery,
      },
    });
    console.log(
      JSON.stringify({
        event: "task.succeeded",
        task: task.key,
        source,
        status: result.status,
        url: result.url,
        at: taskState.lastSuccessAt,
      }),
    );
    return result;
  } catch (error) {
    const message = describeError(error);
    taskState.status = "failed";
    taskState.lastError = message;
    taskState.nextRunAt = nextCronDate(task.cron);
    await updateTaskRunInSite(appRun, "failed", {
      errorMessage: message,
    });
    console.error(JSON.stringify({ event: "task.failed", task: task.key, source, error: message, at: nowIso() }));
    throw error;
  } finally {
    taskState.running = false;
  }
}

function startTaskRun(task: RunnableTask, source: "schedule" | "manual") {
  const taskState = state.get(task.key);
  if (!taskState) {
    throw new Error(`Unknown task state for ${task.key}`);
  }
  if (!task.enabled && source === "schedule") {
    throw new Error(`Task ${task.key} is disabled`);
  }
  if (taskState.running) {
    throw new Error(`Task ${task.key} is already running`);
  }

  const promise = runTask(task, source).catch(() => {
    // Failure is recorded in task state, site task run rows, and logs.
  });
  return promise;
}

function taskSnapshot(task: RunnableTask): TaskSnapshot {
  const taskState = state.get(task.key) ?? initState(task);
  return {
    key: task.key,
    name: task.name,
    taskType: task.taskType,
    enabled: task.enabled,
    cron: task.cron,
    status: task.enabled ? taskState.status : "disabled",
    lastRunAt: taskState.lastRunAt,
    lastSuccessAt: taskState.lastSuccessAt,
    lastError: taskState.lastError,
    nextRunAt: task.enabled && taskState.nextRunAt ? taskState.nextRunAt.toISOString() : null,
  };
}

function requireRunnerToken(request: Request, response: Response): boolean {
  const expected = (process.env.TASK_RUNNER_TOKEN ?? "").trim();
  if (!expected) {
    return true;
  }
  const actual = String(request.headers["x-task-runner-token"] ?? "").trim();
  if (actual === expected) {
    return true;
  }
  response.status(401).json({ ok: false, error: "Unauthorized" });
  return false;
}

async function schedulerLoop(tasks: RunnableTask[], builtInTasks: BuiltInTask[], pollSeconds: number): Promise<void> {
  while (true) {
    if (!parseBoolEnv("TASK_RUNNER_DISABLED", false)) {
      await ensureTasksRegisteredWithSite(builtInTasks);
      await syncTasksFromSite(tasks);
      const now = new Date();
      for (const task of tasks) {
        const taskState = state.get(task.key);
        if (!task.enabled || !taskState || taskState.running || !taskState.nextRunAt) {
          continue;
        }
        if (taskState.nextRunAt.getTime() <= now.getTime()) {
          try {
            startTaskRun(task, "schedule");
          } catch (error) {
            console.warn(JSON.stringify({ event: "task.schedule_start_failed", task: task.key, error: describeError(error) }));
          }
        }
      }
    }
    await sleep(pollSeconds * 1000);
  }
}

async function main(): Promise<void> {
  const builtInTasks = buildBuiltInTasks();
  const tasks: RunnableTask[] = [...builtInTasks];
  for (const task of tasks) {
    state.set(task.key, initState(task));
  }
  await ensureTasksRegisteredWithSite(builtInTasks);
  await syncTasksFromSite(tasks);

  const app = express();
  app.use(express.json({ limit: "1mb" }));

  app.get("/health", (_request, response) => {
    response.json({
      ok: true,
      service: "task-runner",
      disabled: parseBoolEnv("TASK_RUNNER_DISABLED", false),
      tasks: tasks.map(taskSnapshot),
    });
  });

  app.get("/tasks", (request, response) => {
    if (!requireRunnerToken(request, response)) {
      return;
    }
    syncTasksFromSite(tasks)
      .then(() => {
        response.json({ ok: true, tasks: tasks.map(taskSnapshot) });
      })
      .catch((error) => {
        response.status(500).json({ ok: false, error: describeError(error) });
      });
  });

  app.post("/tasks/:key/run", async (request, response) => {
    if (!requireRunnerToken(request, response)) {
      return;
    }
    const key = request.params.key;
    await syncTasksFromSite(tasks);
    const task = tasks.find((candidate) => candidate.key === key);
    if (!task) {
      response.status(404).json({ ok: false, error: `Unknown task: ${key}` });
      return;
    }
    try {
      startTaskRun(task, "manual");
      response.status(202).json({ ok: true, accepted: true, task: taskSnapshot(task) });
    } catch (error) {
      response.status(409).json({ ok: false, task: taskSnapshot(task), error: describeError(error) });
    }
  });

  const port = parseIntEnv("PORT", 8790, 1, 65535);
  const pollSeconds = parseIntEnv("TASK_RUNNER_POLL_SECONDS", 60, 5, 3600);
  app.listen(port, () => {
    console.log(JSON.stringify({ event: "task-runner.started", port, pollSeconds, tasks: tasks.map(taskSnapshot) }));
  });

  schedulerLoop(tasks, builtInTasks, pollSeconds).catch((error) => {
    console.error(JSON.stringify({ event: "task-runner.scheduler_failed", error: describeError(error) }));
    process.exitCode = 1;
  });
}

main().catch((error) => {
  console.error(JSON.stringify({ event: "task-runner.failed", error: describeError(error) }));
  process.exit(1);
});
