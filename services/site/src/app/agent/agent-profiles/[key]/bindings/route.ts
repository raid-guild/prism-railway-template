import { NextResponse } from 'next/server';

import { createAuditLog, getAgentProfile, upsertAgentProfileBinding } from '@/lib/app-core';
import { requireServiceAccess } from '@/lib/internal-service';

const surfaceTypes = ['buzz', 'discord', 'telegram', 'external', 'user'] as const;

function text(value: unknown, maxLength = 300) {
  return typeof value === 'string' ? value.trim().slice(0, maxLength) : '';
}

export async function POST(request: Request, context: { params: Promise<{ key: string }> }) {
  const access = await requireServiceAccess();
  if (!access.ok) return NextResponse.json({ ok: false, error: access.error }, { status: access.status });
  const profile = getAgentProfile((await context.params).key);
  if (!profile) return NextResponse.json({ ok: false, error: 'Agent Profile not found' }, { status: 404 });
  const body = await request.json().catch(() => null) as Record<string, unknown> | null;
  const surfaceType = text(body?.surfaceType ?? body?.surface_type, 40);
  const surfaceKey = text(body?.surfaceKey ?? body?.surface_key);
  if (!surfaceTypes.includes(surfaceType as typeof surfaceTypes[number]) || !surfaceKey) {
    return NextResponse.json({ ok: false, error: 'A supported surfaceType and surfaceKey are required' }, { status: 400 });
  }
  try {
    const configuration = body?.policy && typeof body.policy === 'object' && !Array.isArray(body.policy)
      ? body.policy as Record<string, unknown>
      : body?.configuration && typeof body.configuration === 'object' && !Array.isArray(body.configuration)
        ? body.configuration as Record<string, unknown>
        : { accessMode: 'readonly' };
    const binding = upsertAgentProfileBinding({
      profileId: profile.id,
      surfaceType: surfaceType as typeof surfaceTypes[number],
      surfaceKey,
      label: text(body?.label) || null,
      enabled: body?.enabled !== false,
      configuration,
    });
    createAuditLog({
      actorUserId: null,
      actionType: 'agent.agent_profile.binding.upsert',
      targetType: 'agent_profile',
      targetId: profile.id,
      meta: { surfaceType, surfaceKey, accessMode: binding.configuration.accessMode },
    });
    return NextResponse.json({ ok: true, binding }, { status: 201 });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'AGENT_PROFILE_BINDING_FAILED';
    const prefix = 'AGENT_PROFILE_BINDING_DESTINATION_IN_USE:';
    if (message.startsWith(prefix)) {
      const assignedAgentKey = message.slice(prefix.length);
      return NextResponse.json({
        ok: false,
        code: 'AGENT_PROFILE_BINDING_DESTINATION_IN_USE',
        assignedAgentKey,
        error: `This destination is already assigned to ${assignedAgentKey}. Disable that binding before assigning another agent.`,
      }, { status: 409 });
    }
    return NextResponse.json({ ok: false, error: message }, { status: 400 });
  }
}
