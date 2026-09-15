import { randomUUID } from 'node:crypto';
import {
  prismRuntimeContractVersion,
  resolveRuntimeProfile,
  type RuntimeProfileRecord,
} from './runtime-profiles';
import { modelTierFromAgentConfig, normalizeModelTier, type ModelTier } from '../model-tier';

export type RuntimeTraceEntry = { at: string; kind: string; message: string };

export type RuntimeAuthorityMode = 'full' | 'read_only_utility';

export type RuntimeResponse = {
  id: string | null;
  model: string | null;
  modelTier: ModelTier | null;
  reasoningEffort: string | null;
  provider: string;
  responseText: string;
  output_text: string;
  thread_id: string | null;
  branchName: string | null;
  commitSha: string | null;
  branchUrl: string | null;
  baseBranch: string | null;
  baseCommitSha: string | null;
  trace: RuntimeTraceEntry[];
  runtimeKey: string;
};

export type RuntimeRequestInput = {
  prompt: string;
  sessionId: string;
  /** Runtime-enforced execution authority. Omitted calls retain the full legacy behavior. */
  authorityMode?: RuntimeAuthorityMode;
  continuationId?: string | null;
  recentHistory?: Array<{ role: string; content: string }>;
  skills?: string[];
  credentials?: Array<string | { key: string }>;
  context?: Record<string, string | undefined>;
  metadata?: Record<string, unknown>;
  runtimeKey?: string | null;
  modelTier?: ModelTier | null;
  timeoutMs?: number;
  onProgress?: (progress: {
    status: string;
    runtimeJobId: string;
    runtimeKey: string;
    threadId: string | null;
    trace: RuntimeTraceEntry[];
  }) => void;
};

type NormalizedJob = {
  id?: string;
  status?: string;
  result?: {
    responseText?: string;
    continuationId?: string | null;
    providerMetadata?: Record<string, unknown>;
  } | null;
  error?: { code?: string; message?: string; retryable?: boolean } | null;
  trace?: Array<{ at?: string; kind?: string; message?: string }>;
};

type NormalizedJobPayload = {
  ok?: boolean;
  jobId?: string;
  job?: NormalizedJob;
  error?: { code?: string; message?: string; retryable?: boolean } | null;
};

type LegacyResponse = {
  error?: string | null;
  id?: string | null;
  model?: string | null;
  provider?: string | null;
  responseText?: string;
  output_text?: string;
  thread_id?: string | null;
  branchName?: string | null;
  commitSha?: string | null;
  branchUrl?: string | null;
  baseBranch?: string | null;
  baseCommitSha?: string | null;
  trace?: Array<{ at?: string; kind?: string; message?: string }>;
};

type LegacyJobPayload = {
  jobId?: string;
  job?: {
    status?: string;
    response?: LegacyResponse | null;
    error?: string | null;
    threadId?: string | null;
    trace?: Array<{ at?: string; kind?: string; message?: string }>;
  };
  response?: LegacyResponse | null;
  error?: string | null;
  thread_id?: string | null;
  trace?: Array<{ at?: string; kind?: string; message?: string }>;
};

const readOnlyUtilityAuthorityFeature = 'read-only-utility-authority';
const runtimeCapabilityCache = new Map<string, { supported: boolean; expiresAt: number }>();

type RuntimeCapabilitiesPayload = {
  contractVersion?: unknown;
  runtimeKey?: unknown;
  adapter?: unknown;
  features?: unknown;
};

function defaultTimeoutMs() {
  const maximum = Number.parseInt(process.env.PRISM_RUNTIME_MAX_DURATION_MS ?? '', 10);
  if (Number.isFinite(maximum) && maximum > 0) return maximum + 60_000;
  const milliseconds = Number.parseInt(process.env.CODEX_RUNTIME_TIMEOUT_MS ?? '', 10);
  if (Number.isFinite(milliseconds) && milliseconds > 0) return milliseconds;
  const seconds = Number.parseInt(process.env.CODEX_RUNTIME_REQUEST_TIMEOUT_SECONDS ?? '', 10);
  return Number.isFinite(seconds) && seconds > 0 ? seconds * 1000 : 660_000;
}

function traceEntries(value: unknown): RuntimeTraceEntry[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((entry): RuntimeTraceEntry[] => {
    if (!entry || typeof entry !== 'object' || Array.isArray(entry)) return [];
    const record = entry as Record<string, unknown>;
    const message = typeof record.message === 'string' ? record.message.trim() : '';
    if (!message) return [];
    return [{
      at: typeof record.at === 'string' ? record.at : new Date().toISOString(),
      kind: typeof record.kind === 'string' ? record.kind : 'runtime',
      message,
    }];
  });
}

function profileKeyFromMetadata(metadata: Record<string, unknown> | undefined) {
  const direct = metadata?.runtimeProfileKey ?? metadata?.runtimeKey;
  if (typeof direct === 'string' && direct.trim()) return direct.trim();
  const workflow = metadata?.workflow && typeof metadata.workflow === 'object' && !Array.isArray(metadata.workflow)
    ? metadata.workflow as Record<string, unknown>
    : null;
  const agentConfig = workflow?.agentConfig && typeof workflow.agentConfig === 'object' && !Array.isArray(workflow.agentConfig)
    ? workflow.agentConfig as Record<string, unknown>
    : null;
  const configured = agentConfig?.runtimeProfileKey ?? agentConfig?.runtimeKey;
  if (typeof configured === 'string' && configured.trim()) return configured.trim();
  const sessionRuntimeKey = metadata?.sessionRuntimeKey;
  return typeof sessionRuntimeKey === 'string' && sessionRuntimeKey.trim() ? sessionRuntimeKey.trim() : null;
}

function modelTierFromMetadata(metadata: Record<string, unknown> | undefined) {
  const direct = normalizeModelTier(metadata?.modelTier ?? metadata?.model_tier);
  if (direct) return direct;
  const workflow = metadata?.workflow && typeof metadata.workflow === 'object' && !Array.isArray(metadata.workflow)
    ? metadata.workflow as Record<string, unknown>
    : null;
  const workflowTier = modelTierFromAgentConfig(workflow?.agentConfig ?? workflow?.agent_config);
  if (workflowTier) return workflowTier;
  return modelTierFromAgentConfig(metadata?.agentConfig ?? metadata?.agent_config);
}

function requiredRuntimeFeaturesFromMetadata(metadata: Record<string, unknown> | undefined, modelTier?: ModelTier | null) {
  const workflow = metadata?.workflow && typeof metadata.workflow === 'object' && !Array.isArray(metadata.workflow)
    ? metadata.workflow as Record<string, unknown>
    : null;
  const agentConfig = workflow?.agentConfig && typeof workflow.agentConfig === 'object' && !Array.isArray(workflow.agentConfig)
    ? workflow.agentConfig as Record<string, unknown>
    : null;
  const value = agentConfig?.requiredRuntimeFeatures ?? metadata?.requiredRuntimeFeatures;
  const configured = Array.isArray(value) ? value : [];
  const required = configured
    .filter((entry): entry is string => typeof entry === 'string')
    .map((entry) => entry.trim())
    .filter(Boolean);
  if (modelTier ?? modelTierFromMetadata(metadata)) required.push('model-tier-routing');
  return Array.from(new Set(required));
}

async function fetchWithTimeout(url: string, init: RequestInit, timeoutMs: number) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { ...init, signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}

async function assertReadOnlyUtilityAuthority(profile: RuntimeProfileRecord, timeoutMs: number) {
  if (
    profile.contractVersion !== prismRuntimeContractVersion
    || !profile.features.includes(readOnlyUtilityAuthorityFeature)
  ) {
    throw new Error('RUNTIME_AUTHORITY_MODE_UNSUPPORTED:profile');
  }

  const cacheKey = [profile.key, profile.adapter, profile.baseUrl, profile.contractVersion, profile.updatedAt].join('|');
  const cached = runtimeCapabilityCache.get(cacheKey);
  if (cached && cached.expiresAt > Date.now()) {
    if (cached.supported) return;
    throw new Error('RUNTIME_AUTHORITY_MODE_UNSUPPORTED:capabilities');
  }

  let response: Response;
  try {
    response = await fetchWithTimeout(
      `${profile.baseUrl}/v1/runtime/capabilities`,
      { cache: 'no-store' },
      Math.max(1, Math.min(5_000, timeoutMs)),
    );
  } catch (error) {
    throw new Error('RUNTIME_AUTHORITY_CAPABILITIES_UNAVAILABLE', { cause: error });
  }
  const payload = await response.json().catch(() => null) as RuntimeCapabilitiesPayload | null;
  const features = Array.isArray(payload?.features)
    ? payload.features.filter((entry): entry is string => typeof entry === 'string')
    : [];
  const supported = response.ok
    && payload?.contractVersion === prismRuntimeContractVersion
    && payload?.runtimeKey === profile.key
    && payload?.adapter === profile.adapter
    && features.includes(readOnlyUtilityAuthorityFeature);
  runtimeCapabilityCache.set(cacheKey, { supported, expiresAt: Date.now() + 30_000 });
  if (!supported) throw new Error('RUNTIME_AUTHORITY_MODE_UNSUPPORTED:capabilities');
}

function transportError(error: unknown) {
  if (!(error instanceof Error)) return String(error);
  const cause = error.cause && typeof error.cause === 'object'
    ? error.cause as { code?: unknown; message?: unknown }
    : null;
  const causeCode = typeof cause?.code === 'string' ? cause.code : '';
  const causeMessage = typeof cause?.message === 'string' ? cause.message : '';
  return [error.name, error.message, causeCode, causeMessage]
    .map((part) => part.trim())
    .filter(Boolean)
    .join(':');
}

async function fetchWithTransportRetries(
  url: string,
  init: RequestInit,
  timeoutMs: number,
  options: { attempts: number; operation: string },
) {
  const deadline = Date.now() + timeoutMs;
  let lastError: unknown = null;
  for (let attempt = 1; attempt <= options.attempts; attempt += 1) {
    try {
      return await fetchWithTimeout(url, init, Math.max(1, deadline - Date.now()));
    } catch (error) {
      lastError = error;
      const remainingMs = deadline - Date.now();
      if (attempt >= options.attempts || remainingMs <= 0) break;
      const retryDelayMs = Math.min(250 * (2 ** (attempt - 1)), remainingMs);
      console.warn('[site-runtime] transport retry', {
        operation: options.operation,
        attempt,
        maxAttempts: options.attempts,
        retryDelayMs,
        error: transportError(error),
      });
      await new Promise((resolve) => setTimeout(resolve, retryDelayMs));
    }
  }
  throw new Error(
    `RUNTIME_TRANSPORT_FAILED:${options.operation}:${transportError(lastError) || 'unknown'}`,
    { cause: lastError },
  );
}

function normalizedResponse(profile: RuntimeProfileRecord, job: NormalizedJob): RuntimeResponse {
  const metadata = job.result?.providerMetadata ?? {};
  const responseText = typeof job.result?.responseText === 'string' ? job.result.responseText.trim() : '';
  if (!responseText) throw new Error('RUNTIME_EMPTY_RESPONSE');
  const continuationId = typeof job.result?.continuationId === 'string' ? job.result.continuationId : null;
  return {
    id: continuationId,
    model: typeof metadata.model === 'string' ? metadata.model : null,
    modelTier: normalizeModelTier(metadata.modelTier ?? metadata.model_tier),
    reasoningEffort: typeof metadata.reasoningEffort === 'string' ? metadata.reasoningEffort : null,
    provider: profile.adapter,
    responseText,
    output_text: responseText,
    thread_id: continuationId,
    branchName: typeof metadata.branchName === 'string' ? metadata.branchName : null,
    commitSha: typeof metadata.commitSha === 'string' ? metadata.commitSha : null,
    branchUrl: typeof metadata.branchUrl === 'string' ? metadata.branchUrl : null,
    baseBranch: typeof metadata.baseBranch === 'string' ? metadata.baseBranch : null,
    baseCommitSha: typeof metadata.baseCommitSha === 'string' ? metadata.baseCommitSha : null,
    trace: traceEntries(job.trace),
    runtimeKey: profile.key,
  };
}

function legacyResponse(profile: RuntimeProfileRecord, payload: LegacyResponse | null | undefined): RuntimeResponse {
  const responseText = typeof payload?.responseText === 'string' && payload.responseText.trim()
    ? payload.responseText.trim()
    : typeof payload?.output_text === 'string'
      ? payload.output_text.trim()
      : '';
  if (!responseText) throw new Error('RUNTIME_EMPTY_RESPONSE');
  return {
    id: payload?.id ?? payload?.thread_id ?? null,
    model: payload?.model ?? null,
    modelTier: null,
    reasoningEffort: null,
    provider: payload?.provider ?? profile.adapter,
    responseText,
    output_text: responseText,
    thread_id: payload?.thread_id ?? payload?.id ?? null,
    branchName: payload?.branchName ?? null,
    commitSha: payload?.commitSha ?? null,
    branchUrl: payload?.branchUrl ?? null,
    baseBranch: payload?.baseBranch ?? null,
    baseCommitSha: payload?.baseCommitSha ?? null,
    trace: traceEntries(payload?.trace),
    runtimeKey: profile.key,
  };
}

async function cancelNormalizedJob(profile: RuntimeProfileRecord, jobId: string) {
  await fetchWithTimeout(`${profile.baseUrl}/v1/runtime/jobs/${encodeURIComponent(jobId)}/cancel`, {
    method: 'POST',
  }, 5_000).catch(() => null);
}

// A timed-out poll is not proof that the remote job failed. Re-read once with
// an independent, bounded budget before cancellation; never submit a new job.
async function reconcileNormalizedPollFailure(profile: RuntimeProfileRecord, jobId: string, error: unknown) {
  try {
    const response = await fetchWithTimeout(`${profile.baseUrl}/v1/runtime/jobs/${encodeURIComponent(jobId)}`, { cache: 'no-store' }, 10_000);
    const payload = await response.json() as NormalizedJobPayload;
    if (response.ok && payload.job?.status === 'succeeded') return normalizedResponse(profile, payload.job);
  } catch { /* Preserve the original failure if reconciliation is unavailable. */ }
  await cancelNormalizedJob(profile, jobId);
  throw error;
}

async function requestNormalized(
  profile: RuntimeProfileRecord,
  input: RuntimeRequestInput,
  timeoutMs: number,
): Promise<RuntimeResponse | null> {
  const startedAt = Date.now();
  const jobsUrl = `${profile.baseUrl}/v1/runtime/jobs`;
  const authorityMode = input.authorityMode ?? 'full';
  const body = {
    contractVersion: prismRuntimeContractVersion,
    prompt: input.prompt,
    sessionId: input.sessionId,
    ...(authorityMode === 'read_only_utility' ? { authorityMode } : {}),
    continuationId: input.continuationId ?? null,
    recentHistory: input.recentHistory ?? [],
    skills: authorityMode === 'read_only_utility'
      ? []
      : (input.skills ?? []).map((name) => ({ name })),
    credentials: authorityMode === 'read_only_utility'
      ? []
      : (input.credentials ?? []).map((entry) => typeof entry === 'string' ? { key: entry } : entry),
    context: input.context ?? {},
    metadata: input.metadata ?? {},
    modelTier: input.modelTier ?? modelTierFromMetadata(input.metadata),
  };
  const idempotencyKey = `site-${randomUUID()}`;
  const canRetryCreate = profile.adapter === 'codex-cli'
    || profile.adapter === 'grok-build'
    || profile.features.includes('idempotent-job-creation');
  const submit = await fetchWithTransportRetries(jobsUrl, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'idempotency-key': idempotencyKey,
    },
    body: JSON.stringify(body),
  }, Math.min(30_000, timeoutMs), {
    attempts: canRetryCreate ? 3 : 1,
    operation: 'create-job',
  });
  if (submit.status === 404) return null;
  const accepted = await submit.json().catch(() => null) as NormalizedJobPayload | null;
  if (!submit.ok) {
    throw new Error(`RUNTIME_JOB_CREATE_FAILED:${submit.status}:${accepted?.error?.code || accepted?.error?.message || 'unknown'}`);
  }
  const jobId = typeof accepted?.jobId === 'string' ? accepted.jobId : '';
  if (!jobId) throw new Error('RUNTIME_JOB_CREATE_INVALID_RESPONSE');
  input.onProgress?.({
    status: typeof accepted?.job?.status === 'string' ? accepted.job.status : 'queued',
    runtimeJobId: jobId,
    runtimeKey: profile.key,
    threadId: typeof accepted?.job?.result?.continuationId === 'string'
      ? accepted.job.result.continuationId
      : null,
    trace: traceEntries(accepted?.job?.trace),
  });

  for (;;) {
    if (Date.now() - startedAt >= timeoutMs) {
      return reconcileNormalizedPollFailure(profile, jobId, new Error(`RUNTIME_REQUEST_TIMEOUT:${timeoutMs}`));
    }
    await new Promise((resolve) => setTimeout(resolve, 2_000));
    let poll: Response;
    try {
      poll = await fetchWithTransportRetries(
        `${jobsUrl}/${encodeURIComponent(jobId)}`,
        { cache: 'no-store' },
        Math.min(30_000, Math.max(1, timeoutMs - (Date.now() - startedAt))),
        { attempts: 3, operation: 'poll-job' },
      );
    } catch (error) {
      // Keep observing the same job through a temporary network outage. A
      // failed HTTP poll must not become a failed execution before its budget.
      if (Date.now() - startedAt < timeoutMs) continue;
      return reconcileNormalizedPollFailure(profile, jobId, new Error(`RUNTIME_REQUEST_TIMEOUT:${timeoutMs}`, { cause: error }));
    }
    const payload = await poll.json().catch(() => null) as NormalizedJobPayload | null;
    if (!poll.ok) throw new Error(`RUNTIME_JOB_POLL_FAILED:${poll.status}:${payload?.error?.code || 'unknown'}`);
    const job = payload?.job;
    const status = typeof job?.status === 'string' ? job.status : '';
    input.onProgress?.({
      status,
      runtimeJobId: jobId,
      runtimeKey: profile.key,
      threadId: typeof job?.result?.continuationId === 'string' ? job.result.continuationId : null,
      trace: traceEntries(job?.trace),
    });
    if (status === 'queued' || status === 'running') continue;
    if (status === 'succeeded' && job) return normalizedResponse(profile, job);
    throw new Error(`RUNTIME_REQUEST_FAILED:${job?.error?.code || 'RUNTIME_JOB_FAILED'}:${job?.error?.message || 'Runtime job failed'}`);
  }
}

async function requestLegacy(profile: RuntimeProfileRecord, input: RuntimeRequestInput, timeoutMs: number) {
  const startedAt = Date.now();
  const body = {
    prompt: input.prompt,
    sessionId: input.sessionId,
    ...(input.authorityMode === 'read_only_utility' ? { authorityMode: input.authorityMode } : {}),
    codexThreadId: input.continuationId ?? null,
    recentHistory: input.recentHistory ?? [],
    credentials: input.credentials ?? [],
    context: input.context ?? {},
    modelTier: input.modelTier ?? modelTierFromMetadata(input.metadata),
    metadata: {
      ...(input.metadata ?? {}),
      ...((input.skills ?? []).length ? { requestedSkills: input.skills } : {}),
    },
  };
  const jobsUrl = `${profile.baseUrl}/v1/responses/jobs`;
  const submit = await fetchWithTimeout(jobsUrl, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  }, Math.min(30_000, timeoutMs));
  if (submit.status !== 404) {
    const accepted = await submit.json().catch(() => null) as LegacyJobPayload | null;
    if (!submit.ok) throw new Error(`RUNTIME_JOB_CREATE_FAILED:${submit.status}:${accepted?.error || 'unknown'}`);
    const jobId = typeof accepted?.jobId === 'string' ? accepted.jobId : '';
    if (!jobId) throw new Error('RUNTIME_JOB_CREATE_INVALID_RESPONSE');
    input.onProgress?.({
      status: typeof accepted?.job?.status === 'string' ? accepted.job.status : 'queued',
      runtimeJobId: jobId,
      runtimeKey: profile.key,
      threadId: accepted?.job?.threadId ?? null,
      trace: traceEntries(accepted?.job?.trace),
    });
    for (;;) {
      if (Date.now() - startedAt >= timeoutMs) throw new Error(`RUNTIME_REQUEST_TIMEOUT:${timeoutMs}`);
      await new Promise((resolve) => setTimeout(resolve, 2_000));
      const poll = await fetchWithTransportRetries(
        `${jobsUrl}/${encodeURIComponent(jobId)}`,
        { cache: 'no-store' },
        Math.min(30_000, Math.max(1, timeoutMs - (Date.now() - startedAt))),
        { attempts: 3, operation: 'poll-legacy-job' },
      );
      const payload = await poll.json().catch(() => null) as LegacyJobPayload | null;
      if (!poll.ok) throw new Error(`RUNTIME_JOB_POLL_FAILED:${poll.status}:${payload?.error || 'unknown'}`);
      const status = payload?.job?.status ?? '';
      const trace = traceEntries(payload?.trace ?? payload?.job?.trace);
      input.onProgress?.({ status, runtimeJobId: jobId, runtimeKey: profile.key, threadId: payload?.thread_id ?? payload?.job?.threadId ?? null, trace });
      if (status === 'queued' || status === 'running') continue;
      if (status === 'succeeded') return legacyResponse(profile, payload?.response ?? payload?.job?.response);
      throw new Error(`RUNTIME_REQUEST_FAILED:${payload?.error || payload?.job?.error || 'Runtime job failed'}`);
    }
  }

  const response = await fetchWithTimeout(`${profile.baseUrl}/v1/responses`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  }, Math.max(1, timeoutMs - (Date.now() - startedAt)));
  const payload = await response.json().catch(() => null) as LegacyResponse | null;
  if (!response.ok) throw new Error(`RUNTIME_REQUEST_FAILED:${response.status}:${payload?.error || 'unknown'}`);
  return legacyResponse(profile, payload);
}

export async function requestRuntimeResponse(input: RuntimeRequestInput) {
  const modelTier = input.modelTier ?? modelTierFromMetadata(input.metadata);
  const profile = resolveRuntimeProfile(
    input.runtimeKey || profileKeyFromMetadata(input.metadata),
    undefined,
    requiredRuntimeFeaturesFromMetadata(input.metadata, modelTier),
  );
  const sessionRuntimeKey = typeof input.metadata?.sessionRuntimeKey === 'string'
    ? input.metadata.sessionRuntimeKey.trim()
    : '';
  return requestRuntimeResponseWithProfile(profile, {
    ...input,
    modelTier,
    continuationId: sessionRuntimeKey && sessionRuntimeKey !== profile.key ? null : input.continuationId,
  });
}

export async function cancelRuntimeJob(input: { runtimeKey: string; runtimeJobId: string }) {
  const runtimeKey = input.runtimeKey.trim();
  const runtimeJobId = input.runtimeJobId.trim();
  if (!runtimeKey || !runtimeJobId) throw new Error('RUNTIME_JOB_CANCEL_INPUT_INVALID');
  const profile = resolveRuntimeProfile(runtimeKey);
  const response = await fetchWithTimeout(
    `${profile.baseUrl}/v1/runtime/jobs/${encodeURIComponent(runtimeJobId)}/cancel`,
    { method: 'POST' },
    10_000,
  );
  if (response.status === 404) return { requested: false, status: response.status };
  if (!response.ok) throw new Error(`RUNTIME_JOB_CANCEL_FAILED:${response.status}`);
  return { requested: true, status: response.status };
}

export async function requestRuntimeResponseWithProfile(
  profile: RuntimeProfileRecord,
  input: RuntimeRequestInput,
) {
  const timeoutMs = input.timeoutMs ?? defaultTimeoutMs();
  if (input.authorityMode === 'read_only_utility') {
    await assertReadOnlyUtilityAuthority(profile, timeoutMs);
  }
  const normalized = await requestNormalized(profile, input, timeoutMs);
  if (normalized) return normalized;
  // A legacy adapter cannot prove that it enforces the restricted authority
  // contract. Never silently downgrade a read-only utility invocation.
  if (input.authorityMode && input.authorityMode !== 'full') {
    throw new Error('RUNTIME_AUTHORITY_MODE_UNSUPPORTED');
  }
  return requestLegacy(profile, input, timeoutMs);
}
