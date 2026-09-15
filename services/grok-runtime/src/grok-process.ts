import { spawn } from 'node:child_process';
import type { PrismRuntimeJobRequest, PrismRuntimeTraceEvent } from '@prism-railway/contracts';
import { config } from './config.js';

type GrokOutput = {
  text?: string;
  stopReason?: string;
  sessionId?: string;
  requestId?: string;
};

export type GrokRunResult = {
  responseText: string;
  continuationId: string | null;
  providerMetadata: Record<string, unknown>;
  trace: PrismRuntimeTraceEvent[];
};

function traceEvent(kind: string, message: string): PrismRuntimeTraceEvent {
  return { at: new Date().toISOString(), kind, message: message.slice(0, 500) };
}

async function fetchSkill(name: string) {
  if (!config.appApiBaseUrl || !config.appServiceToken) return null;
  const response = await fetch(`${config.appApiBaseUrl}/agent/skills/${encodeURIComponent(name)}`, {
    headers: { 'x-service-token': config.appServiceToken },
    signal: AbortSignal.timeout(10_000),
  });
  if (response.status === 404) throw new Error(`RUNTIME_SKILL_NOT_FOUND:${name}`);
  if (!response.ok) throw new Error(`RUNTIME_SKILL_FETCH_FAILED:${name}:${response.status}`);
  const payload = await response.json().catch(() => null) as { content?: unknown } | null;
  return typeof payload?.content === 'string' ? payload.content.slice(0, 200_000) : null;
}

async function buildPrompt(input: PrismRuntimeJobRequest) {
  const skillNames = Array.from(new Set((input.skills ?? []).map((skill) => skill.name).filter(Boolean)));
  const skills = await Promise.all(skillNames.map(async (name) => ({ name, content: await fetchSkill(name) })));
  const history = input.continuationId
    ? ''
    : (input.recentHistory ?? [])
      .slice(-12)
      .map((entry) => `${entry.role === 'assistant' ? 'Assistant' : 'User'}: ${entry.content}`)
      .join('\n');
  const sections = [
    'You are Grok Build replying through the Prism runtime adapter.',
    'Behave like direct agent chat. Follow applicable Prism skill instructions and return only the assistant reply.',
    `Active Prism runtime profile: ${config.runtimeKey} (adapter: grok-build).`,
    'Use this active runtime identity when reporting execution details. Ignore legacy workflow agentConfig.runtime labels.',
    `External session id: ${input.sessionId}`,
  ];
  if (input.context && Object.keys(input.context).length) {
    sections.push(`Delegation context: ${JSON.stringify(input.context)}`);
  }
  if (input.metadata && Object.keys(input.metadata).length) {
    sections.push(`Session metadata: ${JSON.stringify(input.metadata)}`);
  }
  if (input.credentials?.length) {
    sections.push(
      `Organization credentials requested for this job: ${JSON.stringify(input.credentials)}`,
      'This adapter version does not support credential leasing. Do not claim that you used these credentials.',
    );
  }
  for (const skill of skills) {
    if (skill.content) sections.push(`Prism skill loaded: ${skill.name}\n${skill.content.trim()}`);
  }
  if (history) sections.push(`Recent conversation:\n${history}`);
  sections.push(`Latest user message: ${input.prompt}`);
  return sections.join('\n\n');
}

function terminateProcess(child: ReturnType<typeof spawn>) {
  if (child.exitCode !== null || child.signalCode !== null) return;
  try {
    if (child.pid && process.platform !== 'win32') process.kill(-child.pid, 'SIGTERM');
    else child.kill('SIGTERM');
  } catch {
    child.kill('SIGTERM');
  }
  const forceKill = setTimeout(() => {
    if (child.exitCode !== null || child.signalCode !== null) return;
    try {
      if (child.pid && process.platform !== 'win32') process.kill(-child.pid, 'SIGKILL');
      else child.kill('SIGKILL');
    } catch {
      child.kill('SIGKILL');
    }
  }, 5_000);
  forceKill.unref();
}

export async function runGrok(
  input: PrismRuntimeJobRequest,
  signal?: AbortSignal,
  onTrace?: (trace: PrismRuntimeTraceEvent[]) => void,
): Promise<GrokRunResult> {
  const trace: PrismRuntimeTraceEvent[] = [];
  const appendTrace = (kind: string, message: string) => {
    trace.push(traceEvent(kind, message));
    if (trace.length > 40) trace.splice(0, trace.length - 40);
    onTrace?.([...trace]);
  };
  const prompt = await buildPrompt(input);
  const args = [
    ...(input.continuationId ? ['--resume', input.continuationId] : []),
    '--single', prompt,
    '--output-format', 'json',
    '--permission-mode', config.grokPermissionMode,
    '--cwd', config.workspaceRoot,
    ...(config.grokModel ? ['--model', config.grokModel] : []),
  ];
  appendTrace('run.started', input.continuationId ? 'Resuming Grok session' : 'Starting Grok session');

  return new Promise<GrokRunResult>((resolve, reject) => {
    const child = spawn(config.grokBinary, args, {
      cwd: config.workspaceRoot,
      env: {
        ...process.env,
        GROK_HOME: config.grokHome,
        ...(config.appApiBaseUrl ? { PRISM_AGENT_API_BASE_URL: config.appApiBaseUrl } : {}),
        ...(config.appServiceToken ? { PRISM_AGENT_SERVICE_TOKEN: config.appServiceToken } : {}),
      },
      detached: process.platform !== 'win32',
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let stdout = '';
    let stderr = '';
    let settled = false;
    const finish = (error?: Error, result?: GrokRunResult) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      signal?.removeEventListener('abort', cancel);
      if (error) reject(error);
      else resolve(result!);
    };
    const cancel = () => {
      terminateProcess(child);
      appendTrace('run.canceled', 'Grok runtime job was canceled');
      finish(new Error('RUNTIME_JOB_CANCELED'));
    };
    const timeout = setTimeout(() => {
      terminateProcess(child);
      appendTrace('run.timeout', `Grok runtime exceeded ${config.timeoutMs}ms`);
      finish(new Error(`RUNTIME_REQUEST_TIMEOUT:${config.timeoutMs}`));
    }, config.timeoutMs);
    signal?.addEventListener('abort', cancel, { once: true });
    if (signal?.aborted) return cancel();

    child.stdout?.on('data', (chunk) => {
      stdout += String(chunk);
      if (stdout.length > 10_000_000) cancel();
    });
    child.stderr?.on('data', (chunk) => {
      stderr += String(chunk);
      if (stderr.length > 1_000_000) stderr = stderr.slice(-1_000_000);
    });
    child.on('error', (error) => finish(new Error(`GROK_RUNTIME_SPAWN_FAILED:${error.message}`)));
    child.on('close', (code, processSignal) => {
      if (settled) return;
      if (code !== 0) {
        const detail = stderr.trim() || stdout.trim() || `exit ${code ?? processSignal ?? 'unknown'}`;
        appendTrace('run.failed', detail);
        finish(new Error(`GROK_RUNTIME_FAILED:${code ?? processSignal ?? 'unknown'}:${detail.slice(0, 2_000)}`));
        return;
      }
      let payload: GrokOutput;
      try {
        payload = JSON.parse(stdout) as GrokOutput;
      } catch {
        finish(new Error('GROK_RUNTIME_OUTPUT_INVALID'));
        return;
      }
      const responseText = typeof payload.text === 'string' ? payload.text.trim() : '';
      if (!responseText) {
        finish(new Error('RUNTIME_EMPTY_RESPONSE'));
        return;
      }
      appendTrace('run.completed', 'Grok completed successfully');
      finish(undefined, {
        responseText,
        continuationId: typeof payload.sessionId === 'string' ? payload.sessionId : null,
        providerMetadata: {
          model: config.grokModel,
          stopReason: payload.stopReason ?? null,
          requestId: payload.requestId ?? null,
        },
        trace,
      });
    });
  });
}
