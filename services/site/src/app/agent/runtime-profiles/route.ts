import { NextResponse } from 'next/server';
import { listRuntimeProfiles, upsertRuntimeProfile } from '@/lib/app-core';
import { requireServiceAccess } from '@/lib/internal-service';
import { runtimeProfileInput } from '@/lib/runtime-profile-input';

export async function GET() {
  const access = await requireServiceAccess();
  if (!access.ok) return NextResponse.json({ ok: false, error: access.error }, { status: access.status });
  return NextResponse.json({ ok: true, profiles: listRuntimeProfiles() });
}

export async function POST(request: Request) {
  const access = await requireServiceAccess();
  if (!access.ok) return NextResponse.json({ ok: false, error: access.error }, { status: access.status });
  const body = await request.json().catch(() => null) as Record<string, unknown> | null;
  const input = runtimeProfileInput(body);
  if (!input) return NextResponse.json({ ok: false, error: 'key, adapter, and baseUrl are required' }, { status: 400 });
  try {
    return NextResponse.json({ ok: true, profile: upsertRuntimeProfile(input) });
  } catch (error) {
    return NextResponse.json({ ok: false, error: error instanceof Error ? error.message : 'RUNTIME_PROFILE_SAVE_FAILED' }, { status: 400 });
  }
}
