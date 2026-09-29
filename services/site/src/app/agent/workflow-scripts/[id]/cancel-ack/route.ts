import { NextResponse } from 'next/server';
import { acknowledgeWorkflowScriptCancellation } from '@/lib/app-core';
import { requireTaskRunnerMutationAccess } from '@/lib/internal-service';

type Context = { params: Promise<{ id: string }> };
export async function POST(request: Request, context: Context) {
  const access = await requireTaskRunnerMutationAccess();
  if (!access.ok) return NextResponse.json({ ok: false, error: access.error }, { status: access.status });
  const { id } = await context.params;
  const body = await request.json().catch(() => null);
  const token = typeof body?.leaseToken === 'string' ? body.leaseToken : '';
  const acknowledged = token ? acknowledgeWorkflowScriptCancellation(id, token) : false;
  return NextResponse.json({ ok: acknowledged }, { status: acknowledged ? 200 : 409 });
}
