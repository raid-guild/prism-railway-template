import { NextResponse } from 'next/server';
import { listWorkflowEventFeed } from '@/lib/app-core';
import { requireServiceAccess } from '@/lib/internal-service';

export async function GET(request: Request) {
  const access = await requireServiceAccess();
  if (!access.ok) return NextResponse.json({ ok: false, error: access.error }, { status: access.status });
  const params = new URL(request.url).searchParams;
  const eventTypes = params.getAll('eventType')
    .flatMap((value) => value.split(','))
    .map((value) => value.trim())
    .filter(Boolean);
  const rawLimit = params.get('limit');
  const limit = rawLimit ? Number(rawLimit) : undefined;
  try {
    return NextResponse.json({
      ok: true,
      ...listWorkflowEventFeed({ cursor: params.get('cursor'), eventTypes, limit }),
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'WORKFLOW_EVENT_FEED_FAILED';
    const status = message.startsWith('WORKFLOW_EVENT_') ? 400 : 500;
    return NextResponse.json({ ok: false, error: message }, { status });
  }
}
