import fs from 'node:fs/promises';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import express from 'express';
import {
  PRISM_RUNTIME_CONTRACT_VERSION,
  type PrismRuntimeJob,
  type PrismRuntimeJobRequest,
} from '@prism-railway/contracts';
import { config } from './config.js';
import { runGrok } from './grok-process.js';

type StoredJob = PrismRuntimeJob & { input: PrismRuntimeJobRequest };

function validRequest(value: unknown): value is PrismRuntimeJobRequest {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const input = value as Record<string, unknown>;
  return input.contractVersion === PRISM_RUNTIME_CONTRACT_VERSION
    && typeof input.prompt === 'string' && Boolean(input.prompt.trim())
    && typeof input.sessionId === 'string' && Boolean(input.sessionId.trim());
}

function normalizedError(error: unknown) {
  const message = error instanceof Error ? error.message : String(error);
  const code = message.match(/^([A-Z][A-Z0-9_]+)/)?.[1] || 'RUNTIME_JOB_FAILED';
  return { code, message: message.slice(0, 2_000), retryable: code === 'RUNTIME_REQUEST_TIMEOUT' || code === 'GROK_RUNTIME_SPAWN_FAILED' };
}

export function createGrokRuntimeApp() {
  const app = express();
  const jobs = new Map<string, StoredJob>();
  const controllers = new Map<string, AbortController>();
  const idempotencyKeys = new Map<string, string>();
  const startedAt = new Date();
  app.use(express.json({ limit: '1mb' }));

  const publicJob = (job: StoredJob): PrismRuntimeJob => {
    const { input: _input, ...result } = job;
    return result;
  };

  const prune = () => {
    const complete = [...jobs.values()]
      .filter((job) => job.status === 'succeeded' || job.status === 'failed' || job.status === 'canceled')
      .sort((a, b) => a.createdAt.localeCompare(b.createdAt));
    while (jobs.size > 100 && complete.length) {
      const job = complete.shift();
      if (job) {
        jobs.delete(job.id);
        controllers.delete(job.id);
        for (const [key, jobId] of idempotencyKeys) {
          if (jobId === job.id) idempotencyKeys.delete(key);
        }
      }
    }
  };

  const runJob = async (job: StoredJob) => {
    if (job.status === 'canceled') return;
    job.status = 'running';
    job.startedAt = new Date().toISOString();
    const controller = controllers.get(job.id);
    try {
      const result = await runGrok(job.input, controller?.signal, (trace) => {
        if (!controller?.signal.aborted) job.trace = trace;
      });
      if (controller?.signal.aborted) return;
      job.result = {
        responseText: result.responseText,
        continuationId: result.continuationId,
        artifacts: [],
        providerMetadata: result.providerMetadata,
      };
      job.trace = result.trace;
      job.status = 'succeeded';
    } catch (error) {
      if (controller?.signal.aborted) return;
      job.error = normalizedError(error);
      job.status = 'failed';
    } finally {
      job.finishedAt ??= new Date().toISOString();
      prune();
    }
  };

  app.get('/health', async (_request, response) => {
    const authConfigured = await fs.access(path.join(config.grokHome, 'auth.json')).then(() => true, () => false);
    response.json({
      ok: true,
      service: 'grok-runtime',
      runtimeKey: config.runtimeKey,
      grokBinary: config.grokBinary,
      grokHome: config.grokHome,
      grokAuthConfigured: authConfigured,
      startedAt: startedAt.toISOString(),
      uptimeSeconds: Math.floor(process.uptime()),
    });
  });

  app.get('/v1/runtime/manifest', (_request, response) => response.json({
    ok: true,
    contractVersion: PRISM_RUNTIME_CONTRACT_VERSION,
    runtime: { key: config.runtimeKey, adapter: 'grok-build', service: 'grok-runtime' },
    endpoints: {
      health: '/health',
      runtimeCapabilities: '/v1/runtime/capabilities',
      runtimeJobs: '/v1/runtime/jobs',
      runtimeJob: '/v1/runtime/jobs/:jobId',
      cancelRuntimeJob: '/v1/runtime/jobs/:jobId/cancel',
    },
    features: {
      asynchronousJobs: true,
      idempotentJobCreation: true,
      cancellation: true,
      sessionContinuity: true,
      traceEvents: true,
      siteHostedSkills: true,
      repository: true,
      shell: true,
      gatewayCredentials: false,
      workspaceAssignment: false,
    },
  }));

  app.get('/v1/runtime/capabilities', (_request, response) => response.json({
    contractVersion: PRISM_RUNTIME_CONTRACT_VERSION,
    runtimeKey: config.runtimeKey,
    adapter: 'grok-build',
    features: ['repository', 'shell', 'site-hosted-skills', 'continuations', 'trace-events', 'cancellation', 'idempotent-job-creation'],
  }));

  app.post('/v1/runtime/jobs', (request, response) => {
    if (!validRequest(request.body)) {
      const unsupportedVersion = request.body?.contractVersion !== PRISM_RUNTIME_CONTRACT_VERSION;
      response.status(400).json({
        ok: false,
        error: {
          code: unsupportedVersion ? 'RUNTIME_CONTRACT_VERSION_UNSUPPORTED' : 'RUNTIME_JOB_INPUT_INVALID',
          message: unsupportedVersion
            ? `contractVersion must be ${PRISM_RUNTIME_CONTRACT_VERSION}`
            : 'prompt and sessionId are required',
          retryable: false,
        },
      });
      return;
    }
    const rawIdempotencyKey = request.header('idempotency-key');
    const requestIdempotencyKey = typeof rawIdempotencyKey === 'string'
      && rawIdempotencyKey.trim().length > 0
      && rawIdempotencyKey.trim().length <= 200
      && /^[A-Za-z0-9._:-]+$/.test(rawIdempotencyKey.trim())
      ? rawIdempotencyKey.trim()
      : null;
    if (rawIdempotencyKey && !requestIdempotencyKey) {
      response.status(400).json({
        ok: false,
        error: {
          code: 'RUNTIME_IDEMPOTENCY_KEY_INVALID',
          message: 'idempotency-key must contain 1-200 letters, numbers, dots, underscores, colons, or hyphens',
          retryable: false,
        },
      });
      return;
    }
    const existingJobId = requestIdempotencyKey ? idempotencyKeys.get(requestIdempotencyKey) : null;
    const existingJob = existingJobId ? jobs.get(existingJobId) : null;
    if (existingJob) {
      response.status(202).json({ ok: true, jobId: existingJob.id, job: publicJob(existingJob) });
      return;
    }
    const id = randomUUID();
    const job: StoredJob = {
      id,
      runtimeKey: config.runtimeKey,
      adapter: 'grok-build',
      status: 'queued',
      createdAt: new Date().toISOString(),
      startedAt: null,
      finishedAt: null,
      result: null,
      error: null,
      trace: [],
      input: request.body,
    };
    jobs.set(id, job);
    if (requestIdempotencyKey) idempotencyKeys.set(requestIdempotencyKey, id);
    controllers.set(id, new AbortController());
    void runJob(job);
    response.status(202).json({ ok: true, jobId: id, job: publicJob(job) });
  });

  app.get('/v1/runtime/jobs/:jobId', (request, response) => {
    const job = jobs.get(request.params.jobId);
    if (!job) {
      response.status(404).json({ ok: false, error: { code: 'RUNTIME_JOB_NOT_FOUND', message: 'Runtime job not found', retryable: false } });
      return;
    }
    response.json({ ok: job.status !== 'failed', job: publicJob(job) });
  });

  app.post('/v1/runtime/jobs/:jobId/cancel', (request, response) => {
    const job = jobs.get(request.params.jobId);
    if (!job) {
      response.status(404).json({ ok: false, error: { code: 'RUNTIME_JOB_NOT_FOUND', message: 'Runtime job not found', retryable: false } });
      return;
    }
    if (job.status === 'queued' || job.status === 'running') {
      job.status = 'canceled';
      job.error = { code: 'RUNTIME_JOB_CANCELED', message: 'Runtime job was canceled', retryable: false };
      job.finishedAt = new Date().toISOString();
      controllers.get(job.id)?.abort();
    }
    response.json({ ok: true, job: publicJob(job) });
  });

  return app;
}
