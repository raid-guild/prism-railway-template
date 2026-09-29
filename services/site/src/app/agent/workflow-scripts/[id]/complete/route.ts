import { NextResponse } from 'next/server';
import { beginWorkflowScriptCompletion, getWorkflowScriptRun, type ScriptOutcome } from '@/lib/app-core';
import { requireTaskRunnerMutationAccess } from '@/lib/internal-service';
import { finalizeWorkflowScriptAttempt } from '@/lib/workflow-script-completion';
import { validateWorkflowScriptResult } from '@/lib/workflow-script-validation';

type Context = { params: Promise<{ id: string }> };
const outcomes = new Set<ScriptOutcome>(['completed', 'no_op', 'escalate', 'failed']);
export async function POST(request: Request, context: Context) {
  const access = await requireTaskRunnerMutationAccess();
  if (!access.ok) return NextResponse.json({ ok: false, error: access.error }, { status: access.status });
  const { id } = await context.params;
  const text = await request.text();
  if (Buffer.byteLength(text) > 270_000) return NextResponse.json({ ok: false, error: 'SCRIPT_RESULT_TOO_LARGE' }, { status: 413 });
  let body: Record<string, unknown>;
  try { body = JSON.parse(text); } catch { return NextResponse.json({ ok: false, error: 'SCRIPT_RESULT_INVALID_JSON' }, { status: 400 }); }
  const token = typeof body.leaseToken === 'string' ? body.leaseToken : '';
  const outcome = body.outcome as ScriptOutcome;
  const result = body.result && typeof body.result === 'object' && !Array.isArray(body.result)
    ? body.result as Record<string, unknown> : null;
  const exitCode = body.exitCode;
  if (!token || !outcomes.has(outcome) || !result || !Number.isInteger(exitCode) ||
      (outcome !== 'failed' && exitCode !== 0)) {
    return NextResponse.json({ ok: false, error: 'SCRIPT_RESULT_CONTRACT_INVALID' }, { status: 400 });
  }
  const existing = getWorkflowScriptRun(id);
  if (existing && Buffer.byteLength(JSON.stringify(result)) > Number(existing.config.outputMaxBytes ?? 262_144)) {
    return NextResponse.json({ ok: false, error: 'SCRIPT_RESULT_TOO_LARGE' }, { status: 413 });
  }
  if (existing && outcome !== 'failed') {
    const resultError = validateWorkflowScriptResult(String(existing.config.inputBinding ?? ''), result);
    if (resultError) return NextResponse.json({ ok: false, error: resultError }, { status: 400 });
  }
  if (existing?.leaseToken === token && existing.status === 'completing') {
    try { const advanced = await finalizeWorkflowScriptAttempt(id); return NextResponse.json({ ok: true, duplicate: true, advanced }); }
    catch { return NextResponse.json({ ok: false, error: 'SCRIPT_ARTIFACT_PERSIST_FAILED' }, { status: 503 }); }
  }
  if (existing?.leaseToken === token && ['completed', 'no_op', 'escalate', 'failed'].includes(existing.status)) {
    return NextResponse.json({ ok: true, duplicate: true, run: existing });
  }
  const run = beginWorkflowScriptCompletion({ id, token, outcome, result, exitCode: Number(exitCode),
    errorCode: typeof body.errorCode === 'string' ? body.errorCode.slice(0, 100) : null });
  if (!run) return NextResponse.json({ ok: false, error: 'SCRIPT_LEASE_STALE' }, { status: 409 });
  try {
    const advanced = await finalizeWorkflowScriptAttempt(id);
    return NextResponse.json({ ok: true, run: getWorkflowScriptRun(id), advanced });
  } catch {
    return NextResponse.json({ ok: false, error: 'SCRIPT_ARTIFACT_PERSIST_FAILED', retryable: true }, { status: 503 });
  }
}
