import { NextResponse } from 'next/server';

import { createAuditLog, getAccountabilityDomain, upsertAccountabilityDomain } from '@/lib/app-core';
import { requireServiceAccess } from '@/lib/internal-service';

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

function strings(value: unknown) {
  return Array.isArray(value) ? Array.from(new Set(value.filter((item): item is string => typeof item === 'string').map((item) => item.trim()).filter(Boolean))) : undefined;
}

export async function GET(_request: Request, context: { params: Promise<{ key: string }> }) {
  const access = await requireServiceAccess();
  if (!access.ok) return NextResponse.json({ ok: false, error: access.error }, { status: access.status });
  const { key } = await context.params;
  const domain = getAccountabilityDomain(key);
  return domain
    ? NextResponse.json({ ok: true, domain })
    : NextResponse.json({ ok: false, error: 'ACCOUNTABILITY_DOMAIN_NOT_FOUND' }, { status: 404 });
}

export async function PATCH(request: Request, context: { params: Promise<{ key: string }> }) {
  const access = await requireServiceAccess();
  if (!access.ok) return NextResponse.json({ ok: false, error: access.error }, { status: access.status });
  const { key } = await context.params;
  const existing = getAccountabilityDomain(key);
  if (!existing) return NextResponse.json({ ok: false, error: 'ACCOUNTABILITY_DOMAIN_NOT_FOUND' }, { status: 404 });
  const body = record(await request.json().catch(() => null));
  const preview = {
    key: existing.key,
    name: typeof body.name === 'string' && body.name.trim() ? body.name.trim() : existing.name,
    description: body.description === undefined ? existing.description : typeof body.description === 'string' ? body.description.trim() || null : null,
    status: body.status === 'archived' ? 'archived' as const : body.status === 'active' ? 'active' as const : existing.status,
    governanceRef: body.governanceRef === undefined && body.governance_ref === undefined
      ? existing.governanceRef
      : record(body.governanceRef ?? body.governance_ref),
    stewardUserIds: strings(body.stewardUserIds ?? body.steward_user_ids) ?? existing.stewards.map((item) => item.userId),
  };
  if (body.confirm !== true) return NextResponse.json({ ok: true, confirmed: false, preview });
  try {
    const domain = upsertAccountabilityDomain(preview);
    createAuditLog({
      actorUserId: null, actionType: 'accountability.domain.update', targetType: 'accountability_domain', targetId: domain.id,
      meta: { key: domain.key, status: domain.status, version: domain.version },
    });
    return NextResponse.json({ ok: true, confirmed: true, domain });
  } catch (error) {
    return NextResponse.json({ ok: false, error: error instanceof Error ? error.message : 'ACCOUNTABILITY_DOMAIN_UPDATE_FAILED' }, { status: 400 });
  }
}
