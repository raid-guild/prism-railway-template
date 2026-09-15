import { NextResponse } from 'next/server';

import {
  createAuditLog,
  listLegacyAgentProfileMigrationCandidates,
  migrateLegacyInteractionProfileToAgent,
} from '@/lib/app-core';
import { requireCapabilityAccess } from '@/lib/admin-auth';

function text(value: unknown, maxLength = 200) {
  return typeof value === 'string' ? value.trim().slice(0, maxLength) : '';
}

export async function GET() {
  const access = await requireCapabilityAccess('canManageSettings');
  if (!access.ok) return NextResponse.json({ ok: false, error: access.error }, { status: access.status });
  return NextResponse.json({ ok: true, candidates: listLegacyAgentProfileMigrationCandidates() });
}

export async function POST(request: Request) {
  const access = await requireCapabilityAccess('canManageSettings');
  if (!access.ok) return NextResponse.json({ ok: false, error: access.error }, { status: access.status });
  const body = await request.json().catch(() => null) as Record<string, unknown> | null;
  const interactionProfileKey = text(body?.interactionProfileKey ?? body?.interaction_profile_key, 120);
  if (!interactionProfileKey) return NextResponse.json({ ok: false, error: 'interactionProfileKey is required' }, { status: 400 });
  if (body?.confirm !== true) {
    const candidate = listLegacyAgentProfileMigrationCandidates().find((item) => item.interactionProfileKey === interactionProfileKey);
    return candidate
      ? NextResponse.json({ ok: true, confirmed: false, preview: candidate })
      : NextResponse.json({ ok: false, error: 'Legacy interaction profile not found' }, { status: 404 });
  }
  try {
    const result = migrateLegacyInteractionProfileToAgent({
      interactionProfileKey,
      createdByUserId: access.userId,
      ownerUserId: body.owner === 'operator' ? access.userId : null,
    });
    createAuditLog({
      actorUserId: access.userId,
      actionType: 'admin.agent_profile.legacy_interaction.migrate',
      targetType: 'agent_profile',
      targetId: result.profile.id,
      meta: { interactionProfileKey, bindingCount: result.bindings.length },
    });
    return NextResponse.json({ ok: true, confirmed: true, ...result }, { status: 201 });
  } catch (error) {
    return NextResponse.json({ ok: false, error: error instanceof Error ? error.message : 'AGENT_PROFILE_MIGRATION_FAILED' }, { status: 400 });
  }
}
