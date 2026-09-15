import { NextResponse } from 'next/server';

import { resolveAgentProfileInteraction } from '@/lib/app-core';
import { parseString, requireServiceAccess } from '@/lib/internal-service';

const surfaceTypes = ['buzz', 'discord', 'telegram', 'external', 'user'] as const;

export async function GET(request: Request) {
  const access = await requireServiceAccess();
  if (!access.ok) return NextResponse.json({ ok: false, error: access.error }, { status: access.status });
  const url = new URL(request.url);
  const surfaceType = parseString(url.searchParams.get('surfaceType'));
  const surfaceKey = parseString(url.searchParams.get('surfaceKey'));
  const threadId = parseString(url.searchParams.get('threadId')) || null;
  const userId = parseString(url.searchParams.get('userId')) || null;
  const groupIds = url.searchParams.getAll('groupId').map((value) => parseString(value)).filter(Boolean);
  if (!surfaceTypes.includes(surfaceType as typeof surfaceTypes[number]) || !surfaceKey) {
    return NextResponse.json({ ok: false, error: 'A supported surfaceType and surfaceKey are required' }, { status: 400 });
  }
  const resolved = resolveAgentProfileInteraction({
    surfaceType: surfaceType as typeof surfaceTypes[number], surfaceKey, threadId, userId, groupIds,
  });
  return NextResponse.json({ ok: true, resolved });
}
