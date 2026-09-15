import { NextResponse } from 'next/server';

import { createAuditLog, getAgentProfile, upsertAgentProfile } from '@/lib/app-core';
import { requireCapabilityAccess } from '@/lib/admin-auth';
import { modelTiers, normalizeModelTier } from '@/lib/model-tier';

export async function GET(_request: Request, context: { params: Promise<{ key: string }> }) {
  const access = await requireCapabilityAccess('canChatAgents');
  if (!access.ok) return NextResponse.json({ ok: false, error: access.error }, { status: access.status });
  const profile = getAgentProfile((await context.params).key);
  if (profile?.systemKey === 'admin-agent' && !access.capabilities.includes('canRunAgent')) {
    return NextResponse.json({ ok: false, error: 'Forbidden' }, { status: 403 });
  }
  return profile
    ? NextResponse.json({ ok: true, profile })
    : NextResponse.json({ ok: false, error: 'Agent Profile not found' }, { status: 404 });
}

function text(value: unknown, maxLength: number) {
  return typeof value === 'string' ? value.trim().slice(0, maxLength) : '';
}

function stringList(value: unknown) {
  if (Array.isArray(value)) return value.map((entry) => text(entry, 160)).filter(Boolean);
  return text(value, 4000).split(',').map((entry) => entry.trim()).filter(Boolean);
}

function memoryScopeInput(body: Record<string, unknown>, existing: Record<string, unknown>) {
  if (!Object.prototype.hasOwnProperty.call(body, 'memoryScope')) return existing;
  const input = body.memoryScope;
  if (!input || typeof input !== 'object' || Array.isArray(input)) return {};
  const scope = input as Record<string, unknown>;
  const mode = text(scope.scope, 80);
  return {
    ...(mode ? { scope: mode } : {}),
    buckets: stringList(scope.buckets),
    knowledgeSourceIds: stringList(scope.knowledgeSourceIds ?? scope.knowledge_source_ids),
    kinds: stringList(scope.kinds), tags: stringList(scope.tags), entities: stringList(scope.entities),
    audiences: stringList(scope.audiences), stabilities: stringList(scope.stabilities),
    instructions: text(scope.instructions, 10_000),
  };
}

export async function PATCH(request: Request, context: { params: Promise<{ key: string }> }) {
  const access = await requireCapabilityAccess('canManageSettings');
  if (!access.ok) return NextResponse.json({ ok: false, error: access.error }, { status: access.status });
  const profile = getAgentProfile((await context.params).key);
  if (!profile) return NextResponse.json({ ok: false, error: 'Agent Profile not found' }, { status: 404 });
  const body = await request.json().catch(() => null) as Record<string, unknown> | null;
  if (!body) return NextResponse.json({ ok: false, error: 'Invalid JSON body' }, { status: 400 });
  const name = text(body.name, 160);
  if (!name) return NextResponse.json({ ok: false, error: 'name is required' }, { status: 400 });
  const personaInstructions = text(body.personaInstructions ?? body.persona_instructions, 20_000);
  const modelTierInput = text(body.modelTier ?? body.model_tier, 40);
  if (modelTierInput && !modelTiers.includes(modelTierInput as (typeof modelTiers)[number])) {
    return NextResponse.json({ ok: false, error: `MODEL_TIER_INVALID:${modelTierInput}` }, { status: 400 });
  }
  try {
    const updated = upsertAgentProfile({
      key: profile.key,
      name,
      description: text(body.description, 2000) || null,
      avatarUrl: text(body.avatarUrl ?? body.avatar_url, 2000) || null,
      accentColor: text(body.accentColor ?? body.accent_color, 20) || profile.accentColor,
      status: profile.status,
      ownerType: profile.owner.type,
      ownerUserId: profile.owner.userId,
      ownerAgentProfileId: profile.owner.agentProfileId,
      stewardUserIds: profile.stewards.map((steward) => steward.userId),
      persona: { ...profile.persona, name, instructions: personaInstructions },
      runtimeProfileKey: text(body.runtimeProfileKey ?? body.runtime_profile_key, 120) || null,
      modelTier: normalizeModelTier(modelTierInput),
      skills: stringList(body.skills),
      memoryScope: memoryScopeInput(body, profile.memoryScope),
      authority: profile.authority,
      contextPolicy: profile.contextPolicy,
      createdByUserId: access.userId,
      allowSystemProfileUpdate: Boolean(profile.systemKey),
    });
    createAuditLog({
      actorUserId: access.userId,
      actionType: 'admin.agent_profile.update',
      targetType: 'agent_profile',
      targetId: profile.id,
      meta: { key: profile.key, version: updated.version },
    });
    return NextResponse.json({ ok: true, profile: updated });
  } catch (error) {
    return NextResponse.json({ ok: false, error: error instanceof Error ? error.message : 'AGENT_PROFILE_UPDATE_FAILED' }, { status: 400 });
  }
}
