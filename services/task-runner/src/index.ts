import express, { type Request, type Response } from "express";
import { CronExpressionParser } from "cron-parser";
import process from "node:process";
import { setTimeout as sleep } from "node:timers/promises";

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
  delivery?: OutputDeliveryResult[];
};

type OutputDestination = {
  adapter: string;
  type: string;
  id: string | null;
  label?: string | null;
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
};

type WorkflowRunStepResult = {
  status: number;
  url: string;
  body: string;
  payload: Record<string, unknown>;
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
  const response = await fetchWithTimeout(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...headers,
    },
    body: JSON.stringify(body),
  }, timeoutMs);
  const text = await response.text();
  if (!response.ok) {
    throw new Error(`HTTP ${response.status} from ${url}: ${text.slice(0, 500)}`);
  }
  return {
    ok: true,
    status: response.status,
    url,
    body: text,
  };
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
    }))
    .filter((item) => item.adapter && item.type && (item.id || item.label));
}

function responseTextFromResult(result: TaskRunResult): string {
  try {
    const body = JSON.parse(result.body) as Record<string, unknown>;
    const direct =
      body.responseText ??
      body.output_text ??
      body.text;
    if (typeof direct === "string" && direct.trim()) {
      return direct.trim();
    }
  } catch {
    // The task may return plain text.
  }
  return result.body.trim();
}

function adapterBaseUrl(adapter: string): string {
  if (adapter === "discord") {
    return trimBaseUrl(process.env.DISCORD_ADAPTER_BASE_URL);
  }
  return "";
}

function adapterHeaders(adapter: string): Record<string, string> {
  if (adapter === "discord") {
    const token = (process.env.SOURCE_ADAPTER_TOKEN ?? "").trim();
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
        destinationId,
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
      const response = await postJson(baseUrl, "/v1/responses", {}, {
        prompt,
        sessionId: `scheduled-task:${siteTask.key}:${Date.now()}`,
        codexThreadId: null,
        recentHistory: [],
        metadata: {
          transport: "task-runner",
          taskKey: siteTask.key,
          taskName: siteTask.name,
          taskType: siteTask.taskType,
          inputConfig: siteTask.inputConfig,
          outputConfig: siteTask.outputConfig,
          agentConfig: siteTask.agentConfig,
          requestedSkills: mergeRequestedSkills(siteTask),
        },
      }, longRunningHttpTimeoutMs());
      return response;
    },
    outputConfig: siteTask.outputConfig,
  };
}

function statusFromChangeRequest(payload: Record<string, unknown>): string | null {
  const changeRequest = changeRequestFromPayload(payload);
  if (!isRecord(changeRequest)) {
    return null;
  }
  const status = changeRequest.status;
  return typeof status === "string" && status.trim() ? status.trim() : null;
}

function requestIdFromChangeRequest(payload: Record<string, unknown>): string | null {
  const changeRequest = changeRequestFromPayload(payload);
  if (!isRecord(changeRequest)) {
    return null;
  }
  const id = changeRequest.id;
  return typeof id === "string" && id.trim() ? id.trim() : null;
}

function requestNumberFromChangeRequest(payload: Record<string, unknown>): number | null {
  const changeRequest = changeRequestFromPayload(payload);
  if (!isRecord(changeRequest)) {
    return null;
  }
  const requestNumber = changeRequest.requestNumber ?? changeRequest.request_number;
  return typeof requestNumber === "number" && Number.isFinite(requestNumber) ? requestNumber : null;
}

function changeRequestFromPayload(payload: Record<string, unknown>): Record<string, unknown> | null {
  if (isRecord(payload.request)) {
    return payload.request;
  }
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

async function workflowRunnerCurrentStepIsAgent(requestDetail: Record<string, unknown>, fallbackWorkflowKey: string): Promise<boolean> {
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

  return (workflowStepTypeFromPayload(workflowPayload, stepKey) ?? "agent") === "agent";
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
      const requestPayload: Record<string, unknown> = {
        title,
        description,
        workflowKey,
        requestType: stringFromConfig(requestConfig, "requestType", "content"),
        priority: stringFromConfig(requestConfig, "priority", "normal"),
        source: "task-runner",
        autoStart: autoRunEnabled,
        requestedSkills: mergeRequestedSkills(siteTask),
        targetAppId: requestConfig.targetAppId ?? null,
        targetEnvironmentId: requestConfig.targetEnvironmentId ?? null,
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
          if (!currentDetail || !(await workflowRunnerCurrentStepIsAgent(currentDetail, workflowKey))) {
            break;
          }

          const runResult = await appApiPost("/agent/responses", {
            input: [{ role: "user", content: prompt }],
            linked_change_request_id: requestId,
            workflow_action: null,
            auto_continue_until_gate: true,
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
    },
    outputConfig: siteTask.outputConfig,
  };
}

function buildDynamicTask(siteTask: AppTask): RunnableTask | null {
  if (siteTask.taskType === "codex-prompt") {
    return buildCodexPromptTask(siteTask);
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
    if ((task.taskType === "codex-prompt" || task.taskType === "workflow-runner") && !seen.has(task.key)) {
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
  const discordAdapterBaseUrl = trimBaseUrl(process.env.DISCORD_ADAPTER_BASE_URL);
  const sourceAdapterToken = (process.env.SOURCE_ADAPTER_TOKEN ?? "").trim();

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
        const baseUrl = requireBaseUrl("DISCORD_ADAPTER_BASE_URL", discordAdapterBaseUrl);
        const headers: Record<string, string> = {};
        if (sourceAdapterToken) {
          headers["X-Adapter-Token"] = sourceAdapterToken;
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
