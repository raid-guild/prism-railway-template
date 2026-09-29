import { NextResponse } from 'next/server';
import { claimWorkflowScriptAttempt, getScriptRevision } from '@/lib/app-core';
import { requireTaskRunnerMutationAccess } from '@/lib/internal-service';

export async function POST() {
  const access = await requireTaskRunnerMutationAccess();
  if (!access.ok) return NextResponse.json({ ok: false, error: access.error }, { status: access.status });
  const run = claimWorkflowScriptAttempt(90);
  if (!run) return NextResponse.json({ ok: true, run: null });
  const revision = getScriptRevision(run.revisionId);
  if (!revision) return NextResponse.json({ ok: false, error: 'SCRIPT_REVISION_MISSING' }, { status: 500 });
  return NextResponse.json({ ok: true, run, revision });
}
