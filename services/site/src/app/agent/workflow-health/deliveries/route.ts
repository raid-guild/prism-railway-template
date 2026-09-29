import { NextResponse } from 'next/server';
import { getRequestArtifact, getWorkflowHealthDelivery, recordWorkflowHealthDelivery } from '@/lib/app-core';
import { requireServiceAccess } from '@/lib/internal-service';

export async function GET(request: Request) {
  const access = await requireServiceAccess();
  if (!access.ok) return NextResponse.json({ ok: false, error: access.error }, { status: access.status });
  const scopeKey = new URL(request.url).searchParams.get('scopeKey') ?? '';
  return NextResponse.json({ ok: true, delivery: scopeKey ? getWorkflowHealthDelivery(scopeKey) : null });
}
export async function POST(request: Request) {
  const access = await requireServiceAccess();
  if (!access.ok) return NextResponse.json({ ok: false, error: access.error }, { status: access.status });
  const body = await request.json().catch(() => null);
  const scopeKey = typeof body?.scopeKey === 'string' ? body.scopeKey : '';
  const fingerprint = typeof body?.fingerprint === 'string' ? body.fingerprint : '';
  const requestId = typeof body?.requestId === 'string' ? body.requestId : '';
  const reportArtifactId = typeof body?.reportArtifactId === 'string' ? body.reportArtifactId : '';
  const providerMessageId = typeof body?.providerMessageId === 'string' ? body.providerMessageId : '';
  const artifact = getRequestArtifact(reportArtifactId);
  if (!/^[a-z0-9][a-z0-9-]{2,80}$/.test(scopeKey) || !/^sha256:[a-f0-9]{64}$/.test(fingerprint) ||
      !artifact || artifact.requestId !== requestId || artifact.name !== 'workflow-health-report.md' ||
      !providerMessageId.trim()) {
    return NextResponse.json({ ok: false, error: 'WORKFLOW_HEALTH_DELIVERY_INVALID' }, { status: 400 });
  }
  const existing = getWorkflowHealthDelivery(scopeKey);
  if (existing && existing.fingerprint === fingerprint && existing.providerMessageId === providerMessageId) {
    return NextResponse.json({ ok: true, duplicate: true, delivery: existing });
  }
  const delivery = recordWorkflowHealthDelivery({ scopeKey, fingerprint, requestId, reportArtifactId, providerMessageId });
  return NextResponse.json({ ok: true, delivery }, { status: 201 });
}
