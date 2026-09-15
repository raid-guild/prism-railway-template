import { NextResponse } from 'next/server';

import { createAuditLog, getAgentProfile, upsertAgentProfileBinding } from '@/lib/app-core';
import { requireCapabilityAccess } from '@/lib/admin-auth';

const surfaceTypes = ['buzz', 'discord', 'telegram', 'external', 'user'] as const;

function text(value: unknown, maxLength = 300) {
  return typeof value === 'string' ? value.trim().slice(0, maxLength) : '';
}

function bindingError(error: unknown) {
  const message = error instanceof Error ? error.message : 'AGENT_PROFILE_BINDING_FAILED';
  const prefix = 'AGENT_PROFILE_BINDING_DESTINATION_IN_USE:';
  if (message.startsWith(prefix)) {
    const assignedAgentKey = message.slice(prefix.length);
    return {
      status: 409,
      payload: {
        ok: false,
        code: 'AGENT_PROFILE_BINDING_DESTINATION_IN_USE',
        assignedAgentKey,
        error: `This destination is already assigned to ${assignedAgentKey}. Disable that binding before assigning another agent.`,
      },
    };
  }
  return { status: 400, payload: { ok: false, error: message } };
}

export async function POST(request: Request, context: { params: Promise<{ key: string }> }) {
  const access = await requireCapabilityAccess('canManageSettings');
  if (!access.ok) return NextResponse.json({ ok: false, error: access.error }, { status: access.status });
  const profile = getAgentProfile((await context.params).key);
  if (!profile) return NextResponse.json({ ok: false, error: 'Agent Profile not found' }, { status: 404 });
  const body = await request.json().catch(() => null) as Record<string, unknown> | null;
  const surfaceType = text(body?.surfaceType, 40);
  const surfaceKey = text(body?.surfaceKey);
  const accessMode = text(body?.accessMode ?? body?.mode, 40) || "readonly";
  if (!['off', 'readonly', 'run-approved', 'full'].includes(accessMode)) {
    return NextResponse.json({ ok: false, error: 'A supported accessMode is required' }, { status: 400 });
  }
  if (!surfaceTypes.includes(surfaceType as typeof surfaceTypes[number]) || !surfaceKey) {
    return NextResponse.json({ ok: false, error: 'A supported surfaceType and surfaceKey are required' }, { status: 400 });
  }
  try {
    const binding = upsertAgentProfileBinding({
      profileId: profile.id,
      surfaceType: surfaceType as typeof surfaceTypes[number],
      surfaceKey,
      label: text(body?.label) || null,
      enabled: body?.enabled !== false,
      configuration: {
        accessMode,
        allowedWorkflows: Array.isArray(body?.allowedWorkflows)
          ? body.allowedWorkflows
          : text(body?.allowedWorkflows, 4000).split(',').map((value) => value.trim()).filter(Boolean),
        rateLimit: {
          windowSeconds: Number(body?.rateLimitWindowSeconds ?? 60),
          maxRequests: Number(body?.rateLimitMaxRequests ?? 6),
        },
      },
      createdByUserId: access.userId,
    });
    createAuditLog({ actorUserId: access.userId, actionType: 'admin.agent_profile.binding.upsert', targetType: 'agent_profile', targetId: profile.id, meta: { surfaceType, surfaceKey, accessMode } });
    return NextResponse.json({ ok: true, binding });
  } catch (error) {
    const failure = bindingError(error);
    return NextResponse.json(failure.payload, { status: failure.status });
  }
}

export async function PATCH(request: Request, context: { params: Promise<{ key: string }> }) {
  const access = await requireCapabilityAccess('canManageSettings');
  if (!access.ok) return NextResponse.json({ ok: false, error: access.error }, { status: access.status });
  const profile = getAgentProfile((await context.params).key);
  if (!profile) return NextResponse.json({ ok: false, error: 'Agent Profile not found' }, { status: 404 });
  const body = await request.json().catch(() => null) as Record<string, unknown> | null;
  const bindingId = text(body?.bindingId ?? body?.binding_id);
  const binding = profile.bindings.find((candidate) => candidate.id === bindingId);
  if (!binding) return NextResponse.json({ ok: false, error: 'Agent Profile binding not found' }, { status: 404 });
  try {
    const updated = upsertAgentProfileBinding({
      profileId: profile.id,
      surfaceType: binding.surfaceType,
      surfaceKey: binding.surfaceKey,
      label: binding.label,
      enabled: body?.enabled === true,
      configuration: binding.configuration,
      createdByUserId: access.userId,
    });
    createAuditLog({
      actorUserId: access.userId,
      actionType: body?.enabled === true ? 'admin.agent_profile.binding.enable' : 'admin.agent_profile.binding.disable',
      targetType: 'agent_profile',
      targetId: profile.id,
      meta: { bindingId: binding.id, surfaceType: binding.surfaceType, surfaceKey: binding.surfaceKey },
    });
    return NextResponse.json({ ok: true, binding: updated });
  } catch (error) {
    const failure = bindingError(error);
    return NextResponse.json(failure.payload, { status: failure.status });
  }
}
