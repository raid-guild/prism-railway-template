import { NextResponse } from 'next/server';
import { listInteractionProfiles } from '@/lib/app-core';
import { requireCapabilityAccess } from '@/lib/admin-auth';

export async function GET() {
  const access = await requireCapabilityAccess('canManageSettings');
  if (!access.ok) return NextResponse.json({ ok: false, error: access.error }, { status: access.status });
  return NextResponse.json({ ok: true, profiles: listInteractionProfiles() });
}

export async function POST(_request: Request) {
  const access = await requireCapabilityAccess('canManageSettings');
  if (!access.ok) return NextResponse.json({ ok: false, error: access.error }, { status: access.status });
  return NextResponse.json({ ok: false, error: 'INTERACTION_PROFILES_READ_ONLY_USE_AGENT_PROFILES' }, { status: 410 });
}
