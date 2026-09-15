import assert from 'node:assert/strict';
import { spawn, type ChildProcess } from 'node:child_process';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

const contractVersion = '2026-07-10';

async function waitForServer(url: string) {
  const deadline = Date.now() + 10_000;
  while (Date.now() < deadline) {
    const response = await fetch(url).catch(() => null);
    if (response?.ok) return;
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  throw new Error(`Server did not become healthy at ${url}`);
}

async function pollJob(baseUrl: string, jobId: string) {
  const deadline = Date.now() + 10_000;
  while (Date.now() < deadline) {
    const response = await fetch(`${baseUrl}/v1/runtime/jobs/${jobId}`);
    const payload = await response.json() as { job: { status: string } };
    if (payload.job.status !== 'queued' && payload.job.status !== 'running') return payload;
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  throw new Error(`Runtime job ${jobId} did not finish`);
}

test('normalized runtime jobs support discovery, completion, and cancellation', async (t) => {
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'prism-runtime-jobs-'));
  const fakeCodex = path.join(tempDir, 'fake-codex.mjs');
  const port = 32_000 + Math.floor(Math.random() * 1_000);
  const baseUrl = `http://127.0.0.1:${port}`;
  const repoRoot = path.resolve(process.cwd(), '../..');
  let server: ChildProcess | null = null;

  await fs.writeFile(fakeCodex, `#!/usr/bin/env node
import fs from 'node:fs/promises';
const args = process.argv.slice(2);
if (args.at(-1) !== '-') throw new Error('PROMPT_NOT_SENTINEL');
const outputIndex = args.indexOf('-o');
const outputFile = outputIndex >= 0 ? args[outputIndex + 1] : null;
let prompt = '';
for await (const chunk of process.stdin) prompt += chunk;
console.log(JSON.stringify({ type: 'thread.started', thread_id: 'fake-thread' }));
if (prompt.includes('WAIT_FOR_CANCEL')) await new Promise((resolve) => setTimeout(resolve, 30000));
const response = prompt.includes('AUTHORITY_PROBE')
  ? JSON.stringify({
      args,
      env: Object.fromEntries([
        'OPENAI_API_KEY', 'PRISM_AGENT_SERVICE_TOKEN', 'APP_API_SERVICE_TOKEN',
        'COMMUNICATION_ADAPTER_TOKEN', 'PRISM_GATEWAY_TOKEN', 'TARGET_REPO_GITHUB_TOKEN',
      ].map((key) => [key, process.env[key] ?? null])),
    })
  : prompt.includes('LARGE_STDIN_PROMPT') ? 'STDIN_BYTES:' + Buffer.byteLength(prompt) : 'NORMALIZED_OK';
if (outputFile) await fs.writeFile(outputFile, response);
console.log(JSON.stringify({ type: 'item.completed', item: { type: 'agent_message', text: response } }));
`, { mode: 0o700 });

  t.after(async () => {
    server?.kill('SIGTERM');
    await fs.rm(tempDir, { recursive: true, force: true });
  });

  const startServer = () => spawn(process.execPath, [path.resolve(process.cwd(), 'dist/index.js')], {
    env: {
      ...process.env,
      PORT: String(port),
      CODEX_BIN: fakeCodex,
      CODEX_RUNTIME_ENABLED: 'true',
      CODEX_IMAGE_GENERATION_ENABLED: 'false',
      CODEX_WORKSPACE_ROOT: repoRoot,
      CODEX_TARGET_WORKSPACE_ROOT: path.join(tempDir, 'workspaces'),
      CODEX_RUNTIME_TIMEOUT_MS: '60000',
      PRISM_GATEWAY_ENABLED: 'false',
      APP_API_BASE_URL: '',
      APP_API_SERVICE_TOKEN: '',
      OPENAI_API_KEY: 'provider-secret',
      PRISM_AGENT_SERVICE_TOKEN: 'site-secret',
      COMMUNICATION_ADAPTER_TOKEN: 'adapter-secret',
      PRISM_GATEWAY_TOKEN: 'gateway-secret',
      TARGET_REPO_GITHUB_TOKEN: 'repo-secret',
      PRISM_API_BASE: '',
      PRISM_API_KEY: '',
      PRISM_API_READ_KEY: '',
    },
    stdio: ['ignore', 'ignore', 'inherit'],
  });
  server = startServer();
  await waitForServer(`${baseUrl}/health`);

  const manifest = await fetch(`${baseUrl}/v1/runtime/manifest`).then((response) => response.json()) as {
    features: { cancellation: boolean };
    endpoints: Record<string, string>;
  };
  assert.equal(manifest.features.cancellation, true);
  assert.equal(manifest.endpoints.runtimeJobs, '/v1/runtime/jobs');

  const capabilities = await fetch(`${baseUrl}/v1/runtime/capabilities`).then((response) => response.json()) as {
    contractVersion: string;
    features: string[];
  };
  assert.equal(capabilities.contractVersion, contractVersion);
  assert.ok(capabilities.features.includes('cancellation'));
  assert.ok(capabilities.features.includes('browser-automation'));

  const oversizedBody = JSON.stringify({ padding: 'x'.repeat(2 * 1024 * 1024) });
  const oversizedStandardRequest = await fetch(`${baseUrl}/v1/runtime/jobs`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: oversizedBody,
  });
  assert.equal(oversizedStandardRequest.status, 413);

  const invalid = await fetch(`${baseUrl}/v1/runtime/jobs`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ contractVersion: 'invalid', prompt: 'test', sessionId: 'invalid-version' }),
  });
  assert.equal(invalid.status, 400);

  const invalidAuthority = await fetch(`${baseUrl}/v1/runtime/jobs`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      contractVersion,
      prompt: 'test',
      sessionId: 'invalid-authority',
      authorityMode: 'nearly-read-only',
    }),
  });
  assert.equal(invalidAuthority.status, 400);
  assert.equal((await invalidAuthority.json() as { error: { code: string } }).error.code, 'RUNTIME_AUTHORITY_MODE_INVALID');

  const restrictedAccepted = await fetch(`${baseUrl}/v1/runtime/jobs`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      contractVersion,
      prompt: 'AUTHORITY_PROBE',
      sessionId: 'restricted-authority',
      authorityMode: 'read_only_utility',
      continuationId: 'must-not-resume',
      skills: [{ name: 'mutation-skill' }],
      credentials: [{ key: 'crm-write' }],
      metadata: { requestedSkills: ['another-mutation-skill'] },
    }),
  }).then((response) => response.json()) as {
    jobId: string;
  };
  const restrictedCompleted = await pollJob(baseUrl, restrictedAccepted.jobId) as {
    job: { status: string; result: { responseText: string } };
  };
  assert.equal(restrictedCompleted.job.status, 'succeeded');
  const authorityProbe = JSON.parse(restrictedCompleted.job.result.responseText) as {
    args: string[];
    env: Record<string, string | null>;
  };
  assert.ok(authorityProbe.args.includes('read-only'));
  assert.ok(!authorityProbe.args.includes('resume'));
  assert.ok(!authorityProbe.args.includes('--dangerously-bypass-approvals-and-sandbox'));
  assert.equal(authorityProbe.env.OPENAI_API_KEY, 'provider-secret');
  for (const key of [
    'PRISM_AGENT_SERVICE_TOKEN', 'APP_API_SERVICE_TOKEN', 'COMMUNICATION_ADAPTER_TOKEN',
    'PRISM_GATEWAY_TOKEN', 'TARGET_REPO_GITHUB_TOKEN',
  ]) {
    assert.equal(authorityProbe.env[key], null, `${key} reached the restricted child`);
  }

  // The compatibility job response exposes its normalized input, allowing the
  // shared request normalizer's stored boundary to be asserted directly.
  const storedRestricted = await fetch(`${baseUrl}/v1/responses/jobs`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      prompt: 'AUTHORITY_PROBE',
      sessionId: 'restricted-stored-input',
      authorityMode: 'read_only_utility',
      continuationId: 'must-not-resume',
      skills: [{ name: 'mutation-skill' }],
      credentials: [{ key: 'crm-write' }],
      metadata: { requestedSkills: ['another-mutation-skill'] },
    }),
  }).then((response) => response.json()) as {
    job: { input: { authorityMode: string; codexThreadId: string | null; credentials: string[]; metadata: Record<string, unknown> } };
  };
  assert.equal(storedRestricted.job.input.authorityMode, 'read_only_utility');
  assert.equal(storedRestricted.job.input.codexThreadId, null);
  assert.deepEqual(storedRestricted.job.input.credentials, []);
  assert.equal(storedRestricted.job.input.metadata.requestedSkills, undefined);

  const accepted = await fetch(`${baseUrl}/v1/runtime/jobs`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'idempotency-key': 'normalized-success-request' },
    body: JSON.stringify({
      contractVersion,
      prompt: 'Return the test response',
      sessionId: 'normalized-success',
      skills: [{ name: 'test-skill' }],
    }),
  }).then((response) => response.json()) as { jobId: string };
  const replayed = await fetch(`${baseUrl}/v1/runtime/jobs`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'idempotency-key': 'normalized-success-request' },
    body: JSON.stringify({
      contractVersion,
      prompt: 'Return the test response',
      sessionId: 'normalized-success',
      skills: [{ name: 'test-skill' }],
    }),
  }).then((response) => response.json()) as { jobId: string };
  assert.equal(replayed.jobId, accepted.jobId);
  const completed = await pollJob(baseUrl, accepted.jobId) as {
    job: { status: string; result: { responseText: string; continuationId: string } };
  };
  assert.equal(completed.job.status, 'succeeded');
  assert.equal(completed.job.result.responseText, 'NORMALIZED_OK');
  assert.equal(completed.job.result.continuationId, 'fake-thread');

  const largePrompt = `LARGE_STDIN_PROMPT:${'x'.repeat(256 * 1024)}`;
  const largeAccepted = await fetch(`${baseUrl}/v1/runtime/jobs`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ contractVersion, prompt: largePrompt, sessionId: 'large-stdin-prompt' }),
  }).then((response) => response.json()) as { jobId: string };
  const largeCompleted = await pollJob(baseUrl, largeAccepted.jobId) as {
    job: { status: string; result: { responseText: string } };
  };
  assert.equal(largeCompleted.job.status, 'succeeded');
  assert.match(largeCompleted.job.result.responseText, /^STDIN_BYTES:\d+$/);
  assert.ok(Number(largeCompleted.job.result.responseText.split(':')[1]) > 256 * 1024);

  const completedCancel = await fetch(`${baseUrl}/v1/runtime/jobs/${accepted.jobId}/cancel`, { method: 'POST' })
    .then((response) => response.json()) as { job: { status: string } };
  assert.equal(completedCancel.job.status, 'succeeded');

  const waiting = await fetch(`${baseUrl}/v1/runtime/jobs`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ contractVersion, prompt: 'WAIT_FOR_CANCEL', sessionId: 'normalized-cancel' }),
  }).then((response) => response.json()) as { jobId: string };

  const runningDeadline = Date.now() + 5_000;
  while (Date.now() < runningDeadline) {
    const status = await fetch(`${baseUrl}/v1/runtime/jobs/${waiting.jobId}`)
      .then((response) => response.json()) as { job: { status: string } };
    if (status.job.status === 'running') break;
    await new Promise((resolve) => setTimeout(resolve, 25));
  }

  const canceled = await fetch(`${baseUrl}/v1/runtime/jobs/${waiting.jobId}/cancel`, { method: 'POST' })
    .then((response) => response.json()) as { job: { status: string; error: { code: string } } };
  assert.equal(canceled.job.status, 'canceled');
  assert.equal(canceled.job.error.code, 'RUNTIME_JOB_CANCELED');

  await new Promise((resolve) => setTimeout(resolve, 200));
  const afterCancel = await fetch(`${baseUrl}/v1/runtime/jobs/${waiting.jobId}`)
    .then((response) => response.json()) as { job: { status: string } };
  assert.equal(afterCancel.job.status, 'canceled');

  const legacy = await fetch(`${baseUrl}/v1/responses/jobs`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ prompt: 'Return the compatibility response', sessionId: 'compatibility-success' }),
  }).then((response) => response.json()) as { jobId: string };
  const legacyDeadline = Date.now() + 10_000;
  type LegacyJobPayload = { job: { status: string }; response?: { responseText?: string } };
  let legacyPayload: LegacyJobPayload | null = null;
  while (Date.now() < legacyDeadline) {
    legacyPayload = await fetch(`${baseUrl}/v1/responses/jobs/${legacy.jobId}`)
      .then((response) => response.json()) as LegacyJobPayload;
    if (legacyPayload && legacyPayload.job.status !== 'queued' && legacyPayload.job.status !== 'running') break;
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  assert.equal(legacyPayload?.job.status, 'succeeded');
  assert.equal(legacyPayload?.response?.responseText, 'NORMALIZED_OK');

  for (const [executionBudget, expected] of [
    [{ idleTimeoutMs: 300, maxDurationMs: 5000 }, 'IDLE_TIMEOUT'],
    [{ idleTimeoutMs: 5000, maxDurationMs: 300 }, 'BUDGET_EXCEEDED'],
  ] as const) {
    const timed = await fetch(`${baseUrl}/v1/runtime/jobs`, {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ contractVersion, prompt: 'WAIT_FOR_CANCEL', sessionId: 'budget-test',
        metadata: { workflow: { agentConfig: { executionBudget } } } }),
    }).then(r => r.json()) as { jobId: string };
    const result = await pollJob(baseUrl, timed.jobId) as { job: { status: string; error: { message: string } } };
    assert.equal(result.job.status, 'failed');
    assert.match(result.job.error.message, new RegExp(expected));
  }

  const stopped = new Promise<void>(resolve => server!.once('exit', () => resolve()));
  server.kill('SIGTERM');
  await stopped;
  server = startServer();
  await waitForServer(`${baseUrl}/health`);
  const recovered = await pollJob(baseUrl, accepted.jobId) as typeof completed;
  assert.equal(recovered.job.status, 'succeeded');
  assert.equal(recovered.job.result.responseText, 'NORMALIZED_OK');
  const recoveredCancel = await pollJob(baseUrl, waiting.jobId);
  assert.equal(recoveredCancel.job.status, 'canceled');
});
