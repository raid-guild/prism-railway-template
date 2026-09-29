import { createHash } from 'node:crypto';
import { spawn } from 'node:child_process';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';

export type PureScriptExecution = { outcome: 'completed' | 'no_op' | 'escalate' | 'failed';
  result: Record<string, unknown>; exitCode: number; errorCode: string | null };
const checksum = (text: string) => `sha256:${createHash('sha256').update(text).digest('hex')}`;
const object = (value: unknown): value is Record<string, unknown> => Boolean(value) && typeof value === 'object' && !Array.isArray(value);

function stopGroup(pid: number | undefined) {
  if (!pid) return;
  try { process.kill(-pid, 'SIGTERM'); } catch { /* already exited */ }
  setTimeout(() => { try { process.kill(-pid, 'SIGKILL'); } catch { /* already exited */ } }, 1_000).unref();
}

export async function executePureWorkflowScript(input: {
  source: string; checksum: string; snapshot: Record<string, unknown>; inputChecksum: string;
  timeoutMs: number; outputMaxBytes: number; signal?: AbortSignal;
}): Promise<PureScriptExecution> {
  if (checksum(input.source) !== input.checksum || checksum(JSON.stringify(input.snapshot)) !== input.inputChecksum) {
    return { outcome: 'failed', result: { reason: 'Pinned checksum mismatch' }, exitCode: -1, errorCode: 'SCRIPT_CHECKSUM_MISMATCH' };
  }
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'prism-workflow-script-'));
  const scriptPath = path.join(directory, 'script.mjs');
  try {
    await fs.writeFile(scriptPath, input.source, 'utf8');
    return await new Promise<PureScriptExecution>((resolve) => {
      const child = spawn(process.execPath, [scriptPath], { env: {}, cwd: directory, detached: true,
        stdio: ['pipe', 'pipe', 'pipe'] });
      let output = '';
      let bytes = 0;
      let truncated = false;
      let timedOut = false;
      let aborted = false;
      const terminate = () => { aborted = true; stopGroup(child.pid); };
      if (input.signal?.aborted) terminate();
      input.signal?.addEventListener('abort', terminate, { once: true });
      const timeout = setTimeout(() => { timedOut = true; stopGroup(child.pid); }, input.timeoutMs);
      child.stdout.on('data', (chunk: Buffer) => {
        bytes += chunk.byteLength;
        if (bytes > input.outputMaxBytes) { truncated = true; stopGroup(child.pid); return; }
        output += chunk.toString('utf8');
      });
      // Diagnostics may contain secrets even in reviewed scripts. Persist a code, not stderr.
      child.stderr.resume();
      child.on('error', () => { stopGroup(child.pid); });
      child.on('close', (code) => {
        clearTimeout(timeout);
        input.signal?.removeEventListener('abort', terminate);
        if (aborted) return resolve({ outcome: 'failed', result: { reason: 'Execution canceled' }, exitCode: -1, errorCode: 'SCRIPT_CANCELED' });
        if (timedOut) return resolve({ outcome: 'failed', result: { reason: 'Execution timed out' }, exitCode: -1, errorCode: 'SCRIPT_TIMEOUT' });
        if (truncated) return resolve({ outcome: 'failed', result: { reason: 'Output exceeded limit' }, exitCode: -1, errorCode: 'SCRIPT_OUTPUT_TRUNCATED' });
        if (code !== 0) return resolve({ outcome: 'failed', result: { reason: 'Script exited unsuccessfully' }, exitCode: code ?? -1, errorCode: 'SCRIPT_EXIT_NONZERO' });
        if (!output.trim()) return resolve({ outcome: 'failed', result: { reason: 'Script produced no result' }, exitCode: 0, errorCode: 'SCRIPT_OUTPUT_EMPTY' });
        let parsed: unknown;
        try { parsed = JSON.parse(output); } catch { return resolve({ outcome: 'failed', result: { reason: 'Script result is not JSON' }, exitCode: 0, errorCode: 'SCRIPT_OUTPUT_INVALID_JSON' }); }
        if (!object(parsed) || !new Set(['completed','no_op','escalate']).has(String(parsed.outcome)) || !object(parsed.result)) {
          return resolve({ outcome: 'failed', result: { reason: 'Script result did not match contract' }, exitCode: 0, errorCode: 'SCRIPT_RESULT_INVALID' });
        }
        resolve({ outcome: parsed.outcome as PureScriptExecution['outcome'], result: parsed.result, exitCode: 0, errorCode: null });
      });
      child.stdin.end(JSON.stringify(input.snapshot));
    });
  } finally {
    await fs.rm(directory, { recursive: true, force: true });
  }
}
