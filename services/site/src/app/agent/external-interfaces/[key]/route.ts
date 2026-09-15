import { NextResponse } from 'next/server';
import { deleteExternalInterface, getExternalInterface, resolveExternalInterface, upsertExternalInterface } from '@/lib/app-core';
import { externalInterfaceInput } from '@/lib/external-interaction-input';
import { requireServiceAccess } from '@/lib/internal-service';
import { readRouteParam } from '@/lib/local-admin-api';

type RouteContext = { params: Promise<{ key: string }> };

export async function GET(_request: Request, context: RouteContext) {
  const access = await requireServiceAccess();
  if (!access.ok) return NextResponse.json({ ok: false, error: access.error }, { status: access.status });
  const resolved = resolveExternalInterface(readRouteParam((await context.params).key));
  return resolved ? NextResponse.json({ ok: true, resolved }) : NextResponse.json({ ok: false, error: 'External interface not found' }, { status: 404 });
}

export async function PATCH(request: Request, context: RouteContext) {
  const access = await requireServiceAccess();
  if (!access.ok) return NextResponse.json({ ok: false, error: access.error }, { status: access.status });
  const existing = getExternalInterface(readRouteParam((await context.params).key));
  if (!existing) return NextResponse.json({ ok: false, error: 'External interface not found' }, { status: 404 });
  const input = externalInterfaceInput(await request.json().catch(() => null), existing);
  try {
    return NextResponse.json({ ok: true, interface: upsertExternalInterface(input!) });
  } catch (error) {
    return NextResponse.json({ ok: false, error: error instanceof Error ? error.message : 'EXTERNAL_INTERFACE_SAVE_FAILED' }, { status: 400 });
  }
}

export async function DELETE(_request: Request, context: RouteContext) {
  const access = await requireServiceAccess();
  if (!access.ok) return NextResponse.json({ ok: false, error: access.error }, { status: access.status });
  return deleteExternalInterface(readRouteParam((await context.params).key))
    ? NextResponse.json({ ok: true })
    : NextResponse.json({ ok: false, error: 'External interface not found' }, { status: 404 });
}
