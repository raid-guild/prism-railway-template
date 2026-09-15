import { NextResponse } from 'next/server';
import { revokeExternalInterfaceCredential, rotateExternalInterfaceCredential } from '@/lib/app-core';
import { requireCapabilityAccess } from '@/lib/admin-auth';
import { readRouteParam } from '@/lib/local-admin-api';

type RouteContext = { params: Promise<{ key: string }> };

export async function POST(_request: Request, context: RouteContext) {
  const access = await requireCapabilityAccess('canManageSettings');
  if (!access.ok) return NextResponse.json({ ok: false, error: access.error }, { status: access.status });
  try {
    const rotated = rotateExternalInterfaceCredential(readRouteParam((await context.params).key));
    return NextResponse.json({ ok: true, ...rotated });
  } catch (error) {
    return NextResponse.json({ ok: false, error: error instanceof Error ? error.message : 'EXTERNAL_INTERFACE_CREDENTIAL_ROTATE_FAILED' }, { status: 404 });
  }
}

export async function DELETE(_request: Request, context: RouteContext) {
  const access = await requireCapabilityAccess('canManageSettings');
  if (!access.ok) return NextResponse.json({ ok: false, error: access.error }, { status: access.status });
  return revokeExternalInterfaceCredential(readRouteParam((await context.params).key))
    ? NextResponse.json({ ok: true })
    : NextResponse.json({ ok: false, error: 'External interface not found' }, { status: 404 });
}
