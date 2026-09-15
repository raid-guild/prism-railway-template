import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

const fixtureRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'prism-grok-runtime-'));
const fixtureBinary = path.join(fixtureRoot, 'grok');
await fs.writeFile(fixtureBinary, `#!/bin/sh
case "$*" in
  *WAIT_FOR_CANCEL*) sleep 30 ;;
esac
printf '%s\n' "$*" > "$GROK_HOME/last-args"
printf '%s\\n' '{"text":"GROK_TEST_OK","stopReason":"EndTurn","sessionId":"grok-session-test","requestId":"request-test"}'
`, { mode: 0o700 });
process.env.GROK_BIN = fixtureBinary;
process.env.GROK_HOME = fixtureRoot;
process.env.GROK_WORKSPACE_ROOT = fixtureRoot;
process.env.PRISM_RUNTIME_KEY = 'grok-test';

const { runGrok } = await import('./grok-process.js');
const { createGrokRuntimeApp } = await import('./app.js');

async function waitForJob(baseUrl: string, jobId: string) {
  for (let attempt = 0; attempt < 100; attempt += 1) {
    const payload = await fetch(`${baseUrl}/v1/runtime/jobs/${jobId}`).then((response) => response.json()) as {
      job: { status: string; result?: { responseText?: string; continuationId?: string }; input?: unknown };
    };
    if (payload.job.status !== 'queued' && payload.job.status !== 'running') return payload.job;
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  throw new Error('test job did not finish');
}

test.after(async () => {
  await fs.rm(fixtureRoot, { recursive: true, force: true });
});

test('Grok process maps JSON output to the normalized runtime result', async () => {
  const result = await runGrok({
    contractVersion: '2026-07-10',
    prompt: 'test',
    sessionId: 'site-session',
    continuationId: 'existing-grok-session',
    recentHistory: [],
    skills: [],
    context: {},
    metadata: {},
  });
  assert.equal(result.responseText, 'GROK_TEST_OK');
  assert.equal(result.continuationId, 'grok-session-test');
  assert.equal(result.providerMetadata.requestId, 'request-test');
  assert.equal(result.trace.at(-1)?.kind, 'run.completed');
  const args = await fs.readFile(path.join(fixtureRoot, 'last-args'), 'utf8');
  assert.match(args, /Active Prism runtime profile: grok-test \(adapter: grok-build\)\./);
});

test('Grok process terminates when the runtime job is canceled', async () => {
  const controller = new AbortController();
  const running = runGrok({
    contractVersion: '2026-07-10',
    prompt: 'WAIT_FOR_CANCEL',
    sessionId: 'site-session',
  }, controller.signal);
  setTimeout(() => controller.abort(), 50);
  await assert.rejects(running, /RUNTIME_JOB_CANCELED/);
});

test('Grok adapter implements the normalized runtime HTTP contract', async (t) => {
  const server = createGrokRuntimeApp().listen(0, '127.0.0.1');
  await new Promise<void>((resolve) => server.once('listening', resolve));
  t.after(() => server.close());
  const address = server.address();
  assert.ok(address && typeof address === 'object');
  const baseUrl = `http://127.0.0.1:${address.port}`;

  const manifest = await fetch(`${baseUrl}/v1/runtime/manifest`).then((response) => response.json()) as {
    contractVersion: string;
    runtime: { adapter: string };
  };
  assert.equal(manifest.contractVersion, '2026-07-10');
  assert.equal(manifest.runtime.adapter, 'grok-build');

  const accepted = await fetch(`${baseUrl}/v1/runtime/jobs`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'idempotency-key': 'grok-test-request' },
    body: JSON.stringify({
      contractVersion: '2026-07-10',
      prompt: 'test',
      sessionId: 'site-session',
    }),
  }).then((response) => response.json()) as { jobId: string; job: { input?: unknown } };
  assert.ok(accepted.jobId);
  const replayed = await fetch(`${baseUrl}/v1/runtime/jobs`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'idempotency-key': 'grok-test-request' },
    body: JSON.stringify({
      contractVersion: '2026-07-10',
      prompt: 'test',
      sessionId: 'site-session',
    }),
  }).then((response) => response.json()) as { jobId: string };
  assert.equal(replayed.jobId, accepted.jobId);
  assert.equal(accepted.job.input, undefined);
  const completed = await waitForJob(baseUrl, accepted.jobId);
  assert.equal(completed.status, 'succeeded');
  assert.equal(completed.result?.responseText, 'GROK_TEST_OK');
  assert.equal(completed.result?.continuationId, 'grok-session-test');
  assert.equal(completed.input, undefined);

  const waiting = await fetch(`${baseUrl}/v1/runtime/jobs`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      contractVersion: '2026-07-10',
      prompt: 'WAIT_FOR_CANCEL',
      sessionId: 'site-session',
    }),
  }).then((response) => response.json()) as { jobId: string };
  const canceled = await fetch(`${baseUrl}/v1/runtime/jobs/${waiting.jobId}/cancel`, { method: 'POST' })
    .then((response) => response.json()) as { job: { status: string; error?: { code?: string } } };
  assert.equal(canceled.job.status, 'canceled');
  assert.equal(canceled.job.error?.code, 'RUNTIME_JOB_CANCELED');
});
