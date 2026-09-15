import { NextResponse } from 'next/server';

import { createAuditLog, listAccountabilityDomains, upsertAccountabilityDomain } from '@/lib/app-core';
import { requireServiceAccess } from '@/lib/internal-service';

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

function text(value: unknown, max = 2000) {
  return typeof value === 'string' ? value.trim().slice(0, max) : '';
}

function strings(value: unknown) {
  return Array.isArray(value) ? Array.from(new Set(value.map((item) => text(item, 200)).filter(Boolean))) : [];
}

export async function GET(request: Request) {
  const access = await requireServiceAccess();
  if (!access.ok) return NextResponse.json({ ok: false, error: access.error }, { status: access.status });
  const includeArchived = new URL(request.url).searchParams.get('includeArchived') === 'true';
  return NextResponse.json({ ok: true, domains: listAccountabilityDomains({ includeArchived }) });
}

export async function POST(request: Request) {
  const access = await requireServiceAccess();
  if (!access.ok) return NextResponse.json({ ok: false, error: access.error }, { status: access.status });
  const body = record(await request.json().catch(() => null));
  const preview = {
    key: text(body.key, 80),
    name: text(body.name, 160),
    description: text(body.description) || null,
    status: body.status === 'archived' ? 'archived' as const : 'active' as const,
    governanceRef: record(body.governanceRef ?? body.governance_ref),
    stewardUserIds: strings(body.stewardUserIds ?? body.steward_user_ids),
  };
  if (!preview.key || !preview.name) {
    return NextResponse.json({ ok: false, error: 'key and name are required' }, { status: 400 });
  }
  if (body.confirm !== true) return NextResponse.json({ ok: true, confirmed: false, preview });
  try {
    const domain = upsertAccountabilityDomain(preview);
    createAuditLog({
      actorUserId: null,
      actionType: 'accountability.domain.upsert',
      targetType: 'accountability_domain',
      targetId: domain.id,
      meta: { key: domain.key, version: domain.version, stewardUserIds: domain.stewards.map((item) => item.userId) },
    });
    return NextResponse.json({ ok: true, confirmed: true, domain }, { status: 201 });
  } catch (error) {
    return NextResponse.json({ ok: false, error: error instanceof Error ? error.message : 'ACCOUNTABILITY_DOMAIN_UPSERT_FAILED' }, { status: 400 });
  }
}
