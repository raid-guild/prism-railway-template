import { NextResponse } from 'next/server';
import { listInteractionAccessEvents } from '@/lib/app-core';
import { readOptionalInteger, requireServiceAccess } from '@/lib/internal-service';

export async function GET(request: Request) {
  const access = await requireServiceAccess();
  if (!access.ok) return NextResponse.json({ ok: false, error: access.error }, { status: access.status });
  const url = new URL(request.url);
  return NextResponse.json({
    ok: true,
    events: listInteractionAccessEvents(url.searchParams.get('interfaceKey'), readOptionalInteger(url.searchParams.get('limit')) ?? 100),
  });
}
