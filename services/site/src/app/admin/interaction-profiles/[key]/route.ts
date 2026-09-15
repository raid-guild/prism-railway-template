import { NextResponse } from 'next/server';
import { getInteractionProfile } from '@/lib/app-core';
import { requireCapabilityAccess } from '@/lib/admin-auth';
import { readRouteParam } from '@/lib/local-admin-api';

type RouteContext = { params: Promise<{ key: string }> };

export async function GET(_request: Request, context: RouteContext) {
  const access = await requireCapabilityAccess('canManageSettings');
  if (!access.ok) return NextResponse.json({ ok: false, error: access.error }, { status: access.status });
  const profile = getInteractionProfile(readRouteParam((await context.params).key));
  return profile ? NextResponse.json({ ok: true, profile }) : NextResponse.json({ ok: false, error: 'Interaction profile not found' }, { status: 404 });
}

export async function PATCH(_request: Request, _context: RouteContext) {
  const access = await requireCapabilityAccess('canManageSettings');
  if (!access.ok) return NextResponse.json({ ok: false, error: access.error }, { status: access.status });
  return NextResponse.json({ ok: false, error: 'INTERACTION_PROFILES_READ_ONLY_USE_AGENT_PROFILES' }, { status: 410 });
}

export async function DELETE(_request: Request, _context: RouteContext) {
  const access = await requireCapabilityAccess('canManageSettings');
  if (!access.ok) return NextResponse.json({ ok: false, error: access.error }, { status: access.status });
  return NextResponse.json({ ok: false, error: 'INTERACTION_PROFILES_READ_ONLY_USE_AGENT_PROFILES' }, { status: 410 });
}
