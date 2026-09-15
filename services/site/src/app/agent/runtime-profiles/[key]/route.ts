import { NextResponse } from 'next/server';
import { deleteRuntimeProfile, getRuntimeProfile, upsertRuntimeProfile } from '@/lib/app-core';
import { requireServiceAccess } from '@/lib/internal-service';
import { readRouteParam } from '@/lib/local-admin-api';
import { runtimeProfileInput } from '@/lib/runtime-profile-input';

type RouteContext = { params: Promise<{ key: string }> };

export async function GET(_request: Request, context: RouteContext) {
  const access = await requireServiceAccess();
  if (!access.ok) return NextResponse.json({ ok: false, error: access.error }, { status: access.status });
  const profile = getRuntimeProfile(readRouteParam((await context.params).key));
  return profile
    ? NextResponse.json({ ok: true, profile })
    : NextResponse.json({ ok: false, error: 'Runtime profile not found' }, { status: 404 });
}

export async function PATCH(request: Request, context: RouteContext) {
  const access = await requireServiceAccess();
  if (!access.ok) return NextResponse.json({ ok: false, error: access.error }, { status: access.status });
  const existing = getRuntimeProfile(readRouteParam((await context.params).key));
  if (!existing) return NextResponse.json({ ok: false, error: 'Runtime profile not found' }, { status: 404 });
  const body = await request.json().catch(() => null) as Record<string, unknown> | null;
  try {
    return NextResponse.json({ ok: true, profile: upsertRuntimeProfile(runtimeProfileInput(body, existing)!) });
  } catch (error) {
    return NextResponse.json({ ok: false, error: error instanceof Error ? error.message : 'RUNTIME_PROFILE_SAVE_FAILED' }, { status: 400 });
  }
}

export async function DELETE(_request: Request, context: RouteContext) {
  const access = await requireServiceAccess();
  if (!access.ok) return NextResponse.json({ ok: false, error: access.error }, { status: access.status });
  const deleted = deleteRuntimeProfile(readRouteParam((await context.params).key));
  return deleted
    ? NextResponse.json({ ok: true })
    : NextResponse.json({ ok: false, error: 'Runtime profile not found' }, { status: 404 });
}
