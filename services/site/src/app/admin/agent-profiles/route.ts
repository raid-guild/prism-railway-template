import { NextResponse } from 'next/server';

import {
  adminAgentProfileId,
  createAuditLog,
  listAgentProfiles,
  upsertAgentProfile,
} from '@/lib/app-core';
import { requireCapabilityAccess } from '@/lib/admin-auth';
import { agentAccentColorForKey, normalizeAgentAccentColor } from '@/lib/agent-profile-colors';
import { modelTiers, normalizeModelTier } from '@/lib/model-tier';

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

function text(value: unknown, maxLength = 2000) {
  return typeof value === 'string' ? value.trim().slice(0, maxLength) : '';
}

function stringList(value: unknown) {
  if (Array.isArray(value)) return value.map((item) => text(item, 160)).filter(Boolean);
  return text(value, 4000).split(',').map((item) => item.trim()).filter(Boolean);
}

export async function GET() {
  const access = await requireCapabilityAccess('canChatAgents');
  if (!access.ok) return NextResponse.json({ ok: false, error: access.error }, { status: access.status });
  return NextResponse.json({ ok: true, profiles: listAgentProfiles().filter((profile) => access.capabilities.includes('canRunAgent') || profile.systemKey !== 'admin-agent') });
}

export async function POST(request: Request) {
  const access = await requireCapabilityAccess('canManageSettings');
  if (!access.ok) return NextResponse.json({ ok: false, error: access.error }, { status: access.status });
  const body = record(await request.json().catch(() => null));
  const key = text(body.key, 120);
  const name = text(body.name, 160);
  const description = text(body.description, 2000) || null;
  const requestedAccentColor = text(body.accentColor ?? body.accent_color, 20);
  const accentColor = requestedAccentColor ? normalizeAgentAccentColor(requestedAccentColor) : agentAccentColorForKey(key);
  const ownerChoice = body.owner === 'admin-agent' ? 'admin-agent' : 'operator';
  const modelTierInput = text(body.modelTier ?? body.model_tier, 40);
  const skills = stringList(body.skills);
  const personaInstructions = text(body.personaInstructions ?? body.persona_instructions, 12000);
  const memoryScope = {
    buckets: stringList(body.memoryBuckets ?? body.memory_buckets),
    knowledgeSourceIds: stringList(body.memorySources ?? body.memory_sources),
    instructions: '',
  };
  if (!key || !name) return NextResponse.json({ ok: false, error: 'key and name are required' }, { status: 400 });
  if (!accentColor) return NextResponse.json({ ok: false, error: 'Select a supported Agent color' }, { status: 400 });
  if (modelTierInput && !modelTiers.includes(modelTierInput as (typeof modelTiers)[number])) {
    return NextResponse.json({ ok: false, error: `MODEL_TIER_INVALID:${modelTierInput}` }, { status: 400 });
  }
  if (ownerChoice === 'operator' && !access.userId) {
    return NextResponse.json({ ok: false, error: 'An authenticated user is required for operator ownership' }, { status: 400 });
  }
  const preview = {
    key,
    name,
    description,
    accentColor,
    status: 'active' as const,
    owner: ownerChoice,
    modelTier: normalizeModelTier(modelTierInput),
    stewardUserIds: access.userId ? [access.userId] : [],
    persona: { name, instructions: personaInstructions },
    skills,
    memoryScope,
    authority: { mode: 'policy-controlled', maximumAccessMode: 'full', consoleAccessMode: 'full' },
    contextPolicy: { continuation: 'session', handoff: null },
  };
  if (body.confirm !== true) return NextResponse.json({ ok: true, confirmed: false, preview });
  try {
    const profile = upsertAgentProfile({
      ...preview,
      ownerType: ownerChoice === 'admin-agent' ? 'agent' : 'user',
      ownerUserId: ownerChoice === 'operator' ? access.userId : null,
      ownerAgentProfileId: ownerChoice === 'admin-agent' ? adminAgentProfileId : null,
      createdByUserId: access.userId,
      accentColor,
      memoryScope,
    });
    createAuditLog({
      actorUserId: access.userId,
      actionType: 'admin.agent_profile.create',
      targetType: 'agent_profile',
      targetId: profile.id,
      meta: { key: profile.key, ownerType: profile.owner.type, ownerAgentProfileId: profile.owner.agentProfileId },
    });
    return NextResponse.json({ ok: true, confirmed: true, profile }, { status: 201 });
  } catch (error) {
    return NextResponse.json({ ok: false, error: error instanceof Error ? error.message : 'AGENT_PROFILE_CREATE_FAILED' }, { status: 400 });
  }
}
