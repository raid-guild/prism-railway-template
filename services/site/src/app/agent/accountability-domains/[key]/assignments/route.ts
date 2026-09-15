import { NextResponse } from 'next/server';

import { accountabilityTargetTypes, assignAccountabilityDomain, createAuditLog, getAccountabilityDomain, type AccountabilityTargetType } from '@/lib/app-core';
import { requireServiceAccess } from '@/lib/internal-service';

export async function POST(request: Request, context: { params: Promise<{ key: string }> }) {
  const access = await requireServiceAccess();
  if (!access.ok) return NextResponse.json({ ok: false, error: access.error }, { status: access.status });
  const { key } = await context.params;
  const domain = getAccountabilityDomain(key);
  if (!domain) return NextResponse.json({ ok: false, error: 'ACCOUNTABILITY_DOMAIN_NOT_FOUND' }, { status: 404 });
  const payload = await request.json().catch(() => null);
  const body = payload && typeof payload === 'object' && !Array.isArray(payload) ? payload as Record<string, unknown> : {};
  const targetType = typeof body.targetType === 'string' ? body.targetType : body.target_type;
  const targetKey = typeof body.targetKey === 'string' ? body.targetKey.trim() : typeof body.target_key === 'string' ? body.target_key.trim() : '';
  if (!accountabilityTargetTypes.includes(targetType as AccountabilityTargetType) || !targetKey) {
    return NextResponse.json({ ok: false, error: 'targetType and targetKey are required' }, { status: 400 });
  }
  const preview = { domainKey: domain.key, targetType, targetKey };
  if (body.confirm !== true) return NextResponse.json({ ok: true, confirmed: false, preview });
  try {
    const assignment = assignAccountabilityDomain({
      domainKey: domain.key,
      targetType: targetType as AccountabilityTargetType,
      targetKey,
    });
    createAuditLog({
      actorUserId: null, actionType: 'accountability.assignment.upsert', targetType: String(targetType), targetId: assignment.targetId,
      meta: { domainKey: domain.key, targetKey },
    });
    return NextResponse.json({ ok: true, confirmed: true, assignment });
  } catch (error) {
    return NextResponse.json({ ok: false, error: error instanceof Error ? error.message : 'ACCOUNTABILITY_ASSIGNMENT_FAILED' }, { status: 400 });
  }
}
