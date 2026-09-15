import { NextResponse } from 'next/server';
import { listRuntimeProfiles, upsertRuntimeProfile } from '@/lib/app-core';
import { requireLocalAdminAccess } from '@/lib/local-admin-api';
import { runtimeProfileInput } from '@/lib/runtime-profile-input';

async function profileHealth(baseUrl: string) {
  try {
    const response = await fetch(`${baseUrl.replace(/\/+$/, '')}/health`, {
      cache: 'no-store',
      signal: AbortSignal.timeout(3_000),
    });
    return { reachable: response.ok, status: response.status };
  } catch {
    return { reachable: false, status: null };
  }
}

export async function GET() {
  const access = await requireLocalAdminAccess();
  if (!access.ok) return NextResponse.json({ ok: false, error: access.error }, { status: access.status });
  const profiles = await Promise.all(listRuntimeProfiles().map(async (profile) => ({
    ...profile,
    health: await profileHealth(profile.baseUrl),
  })));
  return NextResponse.json({ ok: true, profiles });
}

export async function POST(request: Request) {
  const access = await requireLocalAdminAccess();
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
