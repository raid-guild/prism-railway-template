import { NextResponse } from 'next/server';
import { renewWorkflowScriptLease } from '@/lib/app-core';
import { requireTaskRunnerMutationAccess } from '@/lib/internal-service';

type Context = { params: Promise<{ id: string }> };
export async function POST(request: Request, context: Context) {
  const access = await requireTaskRunnerMutationAccess();
  if (!access.ok) return NextResponse.json({ ok: false, error: access.error }, { status: access.status });
  const { id } = await context.params;
  const body = await request.json().catch(() => null);
  const token = body && typeof body.leaseToken === 'string' ? body.leaseToken : '';
  const renewed = token ? renewWorkflowScriptLease(id, token, 90) : false;
  return NextResponse.json({ ok: renewed }, { status: renewed ? 200 : 409 });
}
