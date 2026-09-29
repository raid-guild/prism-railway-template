import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import test from 'node:test';
import { executePureWorkflowScript } from './workflow-script-executor.js';

const hash = (value: string) => `sha256:${createHash('sha256').update(value).digest('hex')}`;
async function execute(source: string, snapshot: Record<string, unknown> = {}, timeoutMs = 2_000) {
  return executePureWorkflowScript({ source, checksum: hash(source), snapshot,
    inputChecksum: hash(JSON.stringify(snapshot)), timeoutMs, outputMaxBytes: 1024 });
}

test('pure workflow script receives pinned JSON and returns a validated outcome', async () => {
  const source = `let input=''; for await (const part of process.stdin) input+=part;
    process.stdout.write(JSON.stringify({outcome:'completed',result:{value:JSON.parse(input).value,hasToken:Boolean(process.env.INTERNAL_SERVICE_TOKEN)}}));`;
  const result = await execute(source, { value: 12 });
  assert.deepEqual(result, { outcome: 'completed', result: { value: 12, hasToken: false }, exitCode: 0, errorCode: null });
});

test('empty, malformed, nonzero, and truncated outputs fail instead of becoming no-ops', async () => {
  assert.equal((await execute('')).errorCode, 'SCRIPT_OUTPUT_EMPTY');
  assert.equal((await execute("process.stdout.write('oops')")).errorCode, 'SCRIPT_OUTPUT_INVALID_JSON');
  assert.equal((await execute('process.exit(2)')).errorCode, 'SCRIPT_EXIT_NONZERO');
  assert.equal((await execute("process.stdout.write('x'.repeat(2048))")).errorCode, 'SCRIPT_OUTPUT_TRUNCATED');
});

test('checksum mismatch is rejected before execution and timeout terminates work', async () => {
  const bad = await executePureWorkflowScript({ source: "process.stdout.write('{}')", checksum: hash('different'),
    snapshot: {}, inputChecksum: hash('{}'), timeoutMs: 1000, outputMaxBytes: 1024 });
  assert.equal(bad.errorCode, 'SCRIPT_CHECKSUM_MISMATCH');
  const timed = await execute('setInterval(() => {}, 1000)', {}, 150);
  assert.equal(timed.errorCode, 'SCRIPT_TIMEOUT');
});

test('cancellation terminates the child before control returns to the runner', async () => {
  const source = 'setInterval(() => {}, 1000)';
  const controller = new AbortController();
  const pending = executePureWorkflowScript({ source, checksum: hash(source), snapshot: {},
    inputChecksum: hash('{}'), timeoutMs: 5_000, outputMaxBytes: 1024, signal: controller.signal });
  setTimeout(() => controller.abort(), 80);
  const result = await pending;
  assert.equal(result.errorCode, 'SCRIPT_CANCELED');
  assert.equal(result.outcome, 'failed');
});
