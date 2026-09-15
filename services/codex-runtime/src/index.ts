import process from 'node:process';
import { randomUUID } from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import express from 'express';
import type { NextFunction, Request, Response } from 'express';
import { config } from './config.js';
import { JobReceipts } from './job-receipts.js';
import { generateCodexCliReply } from './codex-runtime.js';
import { listPrismSkills } from './prism-skills.js';
import { gatewayClient } from './runtime-gateway.js';
import { modelTier, modelTiers, type ModelTier, type ReasoningEffort } from './model-tier.js';

const startedAt = new Date();
const app = express();
const responseJobs = new Map<string, RuntimeResponseJob>();
const jobReceipts = new JobReceipts(process.env.PRISM_RUNTIME_RECEIPTS_DIR?.trim()
  || path.join(config.targetWorkspaceRoot, '.runtime-receipts'));
const responseJobAbortControllers = new Map<string, AbortController>();
const responseJobIdempotencyKeys = new Map<string, string>();
const runtimeContractVersion = '2026-07-10' as const;
const runtimeKey = process.env.PRISM_RUNTIME_KEY?.trim() || 'codex-default';
type RuntimeAuthorityMode = 'full' | 'read_only_utility';

const standardJsonParser = express.json({ limit: '1mb' });
app.use(standardJsonParser);

type RuntimeRequestBody = {
  contractVersion?: unknown;
  prompt?: unknown;
  sessionId?: unknown;
  authorityMode?: unknown;
  continuationId?: unknown;
  codexThreadId?: unknown;
  recentHistory?: Array<{ role?: unknown; content?: unknown }>;
  skills?: unknown;
  credentials?: unknown;
  context?: unknown;
  metadata?: Record<string, unknown>;
  modelTier?: unknown;
};

type RuntimeResponsePayload = {
  id: string | null;
  object: 'response';
  model: string | null;
  modelTier: ModelTier | null;
  reasoningEffort: ReasoningEffort | null;
  provider: string;
  responseText: string;
  output_text: string;
  thread_id: string | null;
  branchName: string | null;
  commitSha: string | null;
  branchUrl: string | null;
  baseBranch: string | null;
  baseCommitSha: string | null;
  trace: Array<{ at: string; kind: string; message: string }>;
  sessionId: string;
};

type RuntimeResponseJob = {
  id: string;
  status: 'queued' | 'running' | 'succeeded' | 'failed' | 'canceled';
  input: {
    prompt: string;
    sessionId: string;
    authorityMode: RuntimeAuthorityMode;
    codexThreadId: string | null;
    recentHistory: Array<{ role: string; content: string }>;
    credentials: string[];
    gatewayContext: Record<string, string>;
    metadata: Record<string, unknown>;
    modelTier: ModelTier | null;
  };
  response: RuntimeResponsePayload | null;
  error: string | null;
  threadId: string | null;
  trace: Array<{ at: string; kind: string; message: string }>;
  createdAt: string;
  startedAt: string | null;
  finishedAt: string | null;
};

function hasInvalidAuthorityMode(body: RuntimeRequestBody) {
  return body.authorityMode !== undefined
    && body.authorityMode !== 'full'
    && body.authorityMode !== 'read_only_utility';
}

function requestedModelTierValue(body: RuntimeRequestBody) {
  const metadata = body.metadata && typeof body.metadata === 'object' && !Array.isArray(body.metadata)
    ? body.metadata
    : {};
  return body.modelTier
    ?? metadata.modelTier
    ?? metadata.model_tier
    ?? (metadata.agentConfig && typeof metadata.agentConfig === 'object' && !Array.isArray(metadata.agentConfig)
      ? (metadata.agentConfig as Record<string, unknown>).modelTier
        ?? (metadata.agentConfig as Record<string, unknown>).model_tier
      : null);
}

function hasInvalidModelTier(body: RuntimeRequestBody) {
  const value = requestedModelTierValue(body);
  return value !== undefined && value !== null && value !== '' && !modelTier(value);
}

async function pathExists(filePath: string) {
  return fs.access(filePath).then(
    () => true,
    () => false,
  );
}

async function codexAuthConfigured() {
  if (!config.codexHome) {
    return false;
  }
  return pathExists(path.join(config.codexHome, 'auth.json'));
}

function normalizeRuntimeRequest(body: RuntimeRequestBody) {
  const prompt = typeof body.prompt === 'string' ? body.prompt.trim() : '';
  const sessionId = typeof body.sessionId === 'string' ? body.sessionId.trim() : '';

  if (!prompt || !sessionId) {
    return null;
  }

  const requestedAuthorityMode = body.authorityMode === undefined ? 'full' : body.authorityMode;
  if (requestedAuthorityMode !== 'full' && requestedAuthorityMode !== 'read_only_utility') {
    return null;
  }
  const authorityMode: RuntimeAuthorityMode = requestedAuthorityMode;

  const metadata = body.metadata && typeof body.metadata === 'object' && !Array.isArray(body.metadata)
    ? body.metadata
    : {};
  const requestedSkills = normalizeRuntimeSkills(body.skills);
  const existingRequestedSkills = Array.isArray(metadata.requestedSkills)
    ? metadata.requestedSkills.filter((entry): entry is string => typeof entry === 'string' && Boolean(entry.trim()))
    : [];
  const normalizedMetadata = { ...metadata };
  const requestedModelTier = modelTier(requestedModelTierValue(body));
  if (authorityMode === 'read_only_utility') {
    delete normalizedMetadata.requestedSkills;
  } else if (requestedSkills.length) {
    normalizedMetadata.requestedSkills = Array.from(new Set([...existingRequestedSkills, ...requestedSkills]));
  }

  return {
    prompt,
    sessionId,
    authorityMode,
    codexThreadId: typeof body.continuationId === 'string'
      ? authorityMode === 'read_only_utility' ? null : body.continuationId.trim()
      : typeof body.codexThreadId === 'string'
        ? authorityMode === 'read_only_utility' ? null : body.codexThreadId.trim()
        : null,
    recentHistory: Array.isArray(body.recentHistory)
      ? body.recentHistory
        .map((entry) => ({
          role: typeof entry?.role === 'string' ? entry.role : 'user',
          content: typeof entry?.content === 'string' ? entry.content : '',
        }))
        .filter((entry) => entry.content.trim())
      : [],
    credentials: authorityMode === 'read_only_utility' ? [] : normalizeRuntimeCredentials(body.credentials),
    gatewayContext: normalizeGatewayContext(body.context),
    metadata: normalizedMetadata,
    modelTier: requestedModelTier,
  };
}

function normalizeRuntimeCredentials(value: unknown) {
  if (!Array.isArray(value)) return [];
  return Array.from(new Set(value.flatMap((entry): string[] => {
    const record = entry && typeof entry === 'object' && !Array.isArray(entry)
      ? entry as Record<string, unknown>
      : {};
    const key = typeof entry === 'string'
      ? entry.trim()
      : typeof record.key === 'string'
        ? record.key.trim()
        : '';
    return key && /^[a-zA-Z][a-zA-Z0-9_.:-]{0,119}$/.test(key) ? [key] : [];
  })));
}

function normalizeRuntimeSkills(value: unknown) {
  if (!Array.isArray(value)) return [];
  return Array.from(new Set(value.flatMap((entry): string[] => {
    const record = entry && typeof entry === 'object' && !Array.isArray(entry)
      ? entry as Record<string, unknown>
      : {};
    const name = typeof entry === 'string'
      ? entry.trim()
      : typeof record.name === 'string'
        ? record.name.trim()
        : '';
    return name && /^[a-zA-Z0-9][a-zA-Z0-9_.-]{0,119}$/.test(name) ? [name] : [];
  })));
}

function normalizeGatewayContext(value: unknown) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
  const input = value as Record<string, unknown>;
  const allowedKeys = [
    'delegatedActorId',
    'initiatedBy',
    'orgId',
    'requestId',
    'workflowRunId',
    'workflowStepKey',
    'taskRunId',
  ];
  return Object.fromEntries(allowedKeys.flatMap((key) => {
    const candidate = input[key];
    return typeof candidate === 'string' && candidate.trim()
      ? [[key, candidate.trim().slice(0, 200)]]
      : [];
  }));
}

function responsePayloadFromResult(
  result: Awaited<ReturnType<typeof generateCodexCliReply>>,
  sessionId: string,
): RuntimeResponsePayload {
  return {
    id: result.codexThreadId,
    object: 'response',
    model: result.model,
    modelTier: result.modelTier,
    reasoningEffort: result.reasoningEffort,
    provider: result.provider,
    responseText: result.responseText,
    output_text: result.responseText,
    thread_id: result.codexThreadId,
    branchName: result.branchName,
    commitSha: result.commitSha,
    branchUrl: result.branchUrl,
    baseBranch: result.baseBranch,
    baseCommitSha: result.baseCommitSha,
    trace: result.trace,
    sessionId,
  };
}

function errorPayload(error: unknown) {
  const message = error instanceof Error ? error.message : 'Unknown codex runtime error';
  const candidate = error as Error & {
    codexThreadId?: string | null;
    trace?: Array<{ at: string; kind: string; message: string }>;
  };
  return {
    ok: false,
    error: message,
    thread_id: candidate.codexThreadId ?? null,
    trace: Array.isArray(candidate.trace) ? candidate.trace : [],
  };
}

function pruneResponseJobs() {
  const completed = [...responseJobs.values()]
    .filter((job) => job.status === 'succeeded' || job.status === 'failed' || job.status === 'canceled')
    .sort((a, b) => a.createdAt.localeCompare(b.createdAt));
  while (responseJobs.size > 100 && completed.length) {
    const job = completed.shift();
    if (job) {
      responseJobs.delete(job.id);
      responseJobAbortControllers.delete(job.id);
      for (const [key, jobId] of responseJobIdempotencyKeys) {
        if (jobId === job.id) responseJobIdempotencyKeys.delete(key);
      }
    }
  }
}

function idempotencyKey(value: unknown) {
  if (typeof value !== 'string') return null;
  const normalized = value.trim();
  return normalized && normalized.length <= 200 && /^[A-Za-z0-9._:-]+$/.test(normalized)
    ? normalized
    : null;
}

function createResponseJob(input: NonNullable<ReturnType<typeof normalizeRuntimeRequest>>) {
  const jobId = randomUUID();
  const now = new Date().toISOString();
  const job: RuntimeResponseJob = {
    id: jobId,
    status: 'queued',
    input,
    response: null,
    error: null,
    threadId: input.codexThreadId,
    trace: [],
    createdAt: now,
    startedAt: null,
    finishedAt: null,
  };
  responseJobs.set(jobId, job);
  responseJobAbortControllers.set(jobId, new AbortController());
  void runResponseJob(jobId);
  return job;
}

function normalizedError(message: string | null, status: RuntimeResponseJob['status']) {
  if (!message && status !== 'canceled') return null;
  const safeMessage = message || 'Runtime job was canceled';
  const code = status === 'canceled'
    ? 'RUNTIME_JOB_CANCELED'
    : safeMessage.match(/^([A-Z][A-Z0-9_]+)/)?.[1] || 'RUNTIME_JOB_FAILED';
  return {
    code,
    message: safeMessage,
    retryable: code === 'CODEX_RUNTIME_TIMEOUT' || code === 'CODEX_RUNTIME_FETCH_FAILED',
  };
}

function normalizedJob(job: RuntimeResponseJob) {
  const response = job.response;
  return {
    id: job.id,
    runtimeKey,
    adapter: 'codex-cli',
    status: job.status,
    createdAt: job.createdAt,
    startedAt: job.startedAt,
    finishedAt: job.finishedAt,
    result: response
      ? {
          responseText: response.responseText,
          continuationId: response.thread_id,
          artifacts: [],
          providerMetadata: {
            model: response.model,
            modelTier: response.modelTier,
            reasoningEffort: response.reasoningEffort,
            branchName: response.branchName,
            commitSha: response.commitSha,
            branchUrl: response.branchUrl,
            baseBranch: response.baseBranch,
            baseCommitSha: response.baseCommitSha,
          },
        }
      : null,
    error: normalizedError(job.error, job.status),
    trace: job.trace,
  };
}

function cancelResponseJob(job: RuntimeResponseJob) {
  if (job.status === 'queued' || job.status === 'running') {
    job.status = 'canceled';
    job.error = 'RUNTIME_JOB_CANCELED';
    job.finishedAt = new Date().toISOString();
    job.trace = [
      ...job.trace,
      { at: job.finishedAt, kind: 'run.cancel_requested', message: 'Runtime job cancellation was requested' },
    ];
    responseJobAbortControllers.get(job.id)?.abort();
  }
  return job;
}

async function runResponseJob(jobId: string) {
  const job = responseJobs.get(jobId);
  if (!job) return;

  if (job.status === 'canceled') return;

  job.status = 'running';
  job.startedAt = new Date().toISOString();
  const abortController = responseJobAbortControllers.get(jobId);

  try {
    const result = await generateCodexCliReply({
      ...job.input,
      gatewayContext: {
        ...job.input.gatewayContext,
        runtimeJobId: job.id,
      },
      signal: abortController?.signal,
      onTrace: (trace) => {
        if (!abortController?.signal.aborted) job.trace = [...trace];
      },
    });
    if (abortController?.signal.aborted) return;
    job.response = responsePayloadFromResult(result, job.input.sessionId);
    job.threadId = result.codexThreadId;
    job.trace = result.trace;
    job.status = 'succeeded';
  } catch (error) {
    if (abortController?.signal.aborted) return;
    const payload = errorPayload(error);
    job.error = payload.error;
    job.threadId = payload.thread_id;
    job.trace = payload.trace;
    job.status = 'failed';
  } finally {
    job.finishedAt ??= new Date().toISOString();
    try {
      jobReceipts.save(normalizedJob(job));
    } catch (error) {
      // Fail closed: do not advertise durable success when the receipt could not be saved.
      job.status = 'failed';
      job.error = 'RUNTIME_RESULT_PERSIST_FAILED';
      console.error('[codex-runtime] terminal receipt persistence failed', error instanceof Error ? error.message : 'unknown');
    }
    pruneResponseJobs();
  }
}

app.get('/health', async (_req, res) => {
  res.json({
    ok: true,
    service: 'codex-runtime',
    uptimeSeconds: Math.floor(process.uptime()),
    startedAt: startedAt.toISOString(),
    codexBinary: config.codexBinary,
    codexHome: config.codexHome,
    codexAuthConfigured: await codexAuthConfigured(),
    codexRuntimeEnabled: config.codexRuntimeEnabled,
    codexImageGenerationEnabled: config.codexImageGenerationEnabled,
    prismGateway: gatewayClient.status(),
  });
});

app.get('/codex/health', (_req, res) => {
  res.json({ ok: true, provider: 'codex-cli' });
});

app.get('/v1/runtime/manifest', (_req, res) => {
  res.json({
    ok: true,
    contractVersion: runtimeContractVersion,
    runtime: {
      key: runtimeKey,
      adapter: 'codex-cli',
      service: 'codex-runtime',
    },
    endpoints: {
      health: '/health',
      synchronousResponses: '/v1/responses',
      responseJobs: '/v1/responses/jobs',
      responseJob: '/v1/responses/jobs/:jobId',
      runtimeCapabilities: '/v1/runtime/capabilities',
      runtimeJobs: '/v1/runtime/jobs',
      runtimeJob: '/v1/runtime/jobs/:jobId',
      cancelRuntimeJob: '/v1/runtime/jobs/:jobId/cancel',
    },
    features: {
      synchronousResponses: true,
      asynchronousJobs: true,
      idempotentJobCreation: true,
      cancellation: true,
      sessionContinuity: true,
      traceEvents: true,
      gatewayCredentials: true,
      workspaceAssignment: true,
      browserAutomation: true,
      modelTiers,
      authorityModes: ['full', 'read_only_utility'],
    },
  });
});

app.get('/v1/runtime/capabilities', (_req, res) => {
  res.json({
    contractVersion: runtimeContractVersion,
    runtimeKey,
    adapter: 'codex-cli',
    features: [
      'browser-automation',
      'repository',
      'shell',
      'site-hosted-skills',
      'continuations',
      'gateway-credentials',
      'workspace-assignment',
      'trace-events',
      'progress-aware-timeouts',
      'durable-terminal-results',
      'cancellation',
      'idempotent-job-creation',
      'model-tier-routing',
      'read-only-utility-authority',
    ],
  });
});

app.get('/skills', async (_req, res) => {
  try {
    const skills = await listPrismSkills();
    res.json({ ok: true, skills });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown skills error';
    res.status(500).json({ ok: false, error: message });
  }
});

app.post('/v1/responses', async (req, res) => {
  const body = req.body as RuntimeRequestBody;
  if (hasInvalidAuthorityMode(body)) {
    res.status(400).json({ ok: false, error: 'RUNTIME_AUTHORITY_MODE_INVALID' });
    return;
  }
  if (hasInvalidModelTier(body)) {
    res.status(400).json({ ok: false, error: 'MODEL_TIER_INVALID' });
    return;
  }
  const input = normalizeRuntimeRequest(body);

  if (!input) {
    res.status(400).json({ ok: false, error: 'prompt and sessionId are required' });
    return;
  }

  try {
    const result = await generateCodexCliReply(input);
    res.json(responsePayloadFromResult(result, input.sessionId));
  } catch (error) {
    res.status(500).json(errorPayload(error));
  }
});

app.post('/v1/responses/jobs', (req, res) => {
  const body = req.body as RuntimeRequestBody;
  if (hasInvalidAuthorityMode(body)) {
    res.status(400).json({ ok: false, error: 'RUNTIME_AUTHORITY_MODE_INVALID' });
    return;
  }
  if (hasInvalidModelTier(body)) {
    res.status(400).json({ ok: false, error: 'MODEL_TIER_INVALID' });
    return;
  }
  const input = normalizeRuntimeRequest(body);
  if (!input) {
    res.status(400).json({ ok: false, error: 'prompt and sessionId are required' });
    return;
  }

  const job = createResponseJob(input);

  res.status(202).json({
    ok: true,
    jobId: job.id,
    job,
  });
});

app.get('/v1/responses/jobs/:jobId', (req, res) => {
  const job = responseJobs.get(req.params.jobId);
  if (!job) {
    res.status(404).json({ ok: false, error: 'Runtime response job not found' });
    return;
  }

  res.json({
    ok: job.status !== 'failed',
    job,
    response: job.response,
    error: job.error,
    thread_id: job.threadId,
    trace: job.trace,
  });
});

app.post('/v1/runtime/jobs', (req, res) => {
  const body = req.body as RuntimeRequestBody;
  if (body?.contractVersion !== runtimeContractVersion) {
    res.status(400).json({
      ok: false,
      error: {
        code: 'RUNTIME_CONTRACT_VERSION_UNSUPPORTED',
        message: `contractVersion must be ${runtimeContractVersion}`,
        retryable: false,
      },
    });
    return;
  }
  if (hasInvalidAuthorityMode(body)) {
    res.status(400).json({
      ok: false,
      error: {
        code: 'RUNTIME_AUTHORITY_MODE_INVALID',
        message: 'authorityMode must be full or read_only_utility',
        retryable: false,
      },
    });
    return;
  }
  if (hasInvalidModelTier(body)) {
    res.status(400).json({
      ok: false,
      error: { code: 'MODEL_TIER_INVALID', message: 'modelTier must be economy, standard, or deep', retryable: false },
    });
    return;
  }

  const input = normalizeRuntimeRequest(body);
  if (!input) {
    res.status(400).json({
      ok: false,
      error: {
        code: 'RUNTIME_JOB_INPUT_INVALID',
        message: 'prompt and sessionId are required',
        retryable: false,
      },
    });
    return;
  }

  const rawIdempotencyKey = req.header('idempotency-key');
  const requestIdempotencyKey = idempotencyKey(rawIdempotencyKey);
  if (rawIdempotencyKey && !requestIdempotencyKey) {
    res.status(400).json({
      ok: false,
      error: {
        code: 'RUNTIME_IDEMPOTENCY_KEY_INVALID',
        message: 'idempotency-key must contain 1-200 letters, numbers, dots, underscores, colons, or hyphens',
        retryable: false,
      },
    });
    return;
  }

  const existingJobId = requestIdempotencyKey
    ? responseJobIdempotencyKeys.get(requestIdempotencyKey)
    : null;
  const existingJob = existingJobId ? responseJobs.get(existingJobId) : null;
  if (existingJob) {
    res.status(202).json({ ok: true, jobId: existingJob.id, job: normalizedJob(existingJob) });
    return;
  }

  const job = createResponseJob(input);
  if (requestIdempotencyKey) responseJobIdempotencyKeys.set(requestIdempotencyKey, job.id);
  res.status(202).json({ ok: true, jobId: job.id, job: normalizedJob(job) });
});

app.get('/v1/runtime/jobs/:jobId', (req, res) => {
  const job = responseJobs.get(req.params.jobId);
  if (!job) {
    const receipt = jobReceipts.read(req.params.jobId);
    if (receipt) {
      res.json({ ok: receipt.status !== 'failed', job: receipt });
      return;
    }
    res.status(404).json({
      ok: false,
      error: {
        code: 'RUNTIME_JOB_NOT_FOUND',
        message: 'Runtime job not found',
        retryable: false,
      },
    });
    return;
  }
  res.json({ ok: job.status !== 'failed', job: normalizedJob(job) });
});

app.post('/v1/runtime/jobs/:jobId/cancel', (req, res) => {
  const job = responseJobs.get(req.params.jobId);
  if (!job) {
    res.status(404).json({
      ok: false,
      error: {
        code: 'RUNTIME_JOB_NOT_FOUND',
        message: 'Runtime job not found',
        retryable: false,
      },
    });
    return;
  }
  res.json({ ok: true, job: normalizedJob(cancelResponseJob(job)) });
});

app.use((error: unknown, _request: Request, response: Response, next: NextFunction) => {
  if (error && typeof error === 'object' && 'status' in error && error.status === 413) {
    response.status(413).json({ ok: false, error: 'RUNTIME_REQUEST_TOO_LARGE' });
    return;
  }
  next(error);
});

app.listen(config.port, '0.0.0.0', () => {
  console.log(`codex-runtime listening on ${config.port}`);
});
