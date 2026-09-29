import { NextResponse } from 'next/server';
import { getWorkflowScriptRun, requestWorkflowScriptCancellation } from '@/lib/app-core';
import { requireCapabilityAccess } from '@/lib/admin-auth';

type Context = { params: Promise<{ id: string; runId: string }> };
export async function POST(_request: Request, context: Context) {
  const access = await requireCapabilityAccess('canRunAgent');
  if (!access.ok) return NextResponse.json({ ok: false, error: access.error }, { status: access.status });
  const { id, runId } = await context.params;
  const run = getWorkflowScriptRun(runId);
  if (!run || run.requestId !== id) return NextResponse.json({ ok: false, error: 'SCRIPT_RUN_NOT_FOUND' }, { status: 404 });
  if (!['queued','running','canceling'].includes(run.status)) return NextResponse.json({ ok: false, error: 'SCRIPT_RUN_NOT_ACTIVE' }, { status: 409 });
  return NextResponse.json({ ok: true, run: requestWorkflowScriptCancellation(runId) });
}
