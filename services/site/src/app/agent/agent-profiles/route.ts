import { NextResponse } from 'next/server';

import {
  adminAgentProfileId,
  assignAccountabilityDomain,
  createAuditLog,
  getAccountabilityAssignment,
  listAgentProfiles,
  upsertAgentProfile,
} from '@/lib/app-core';
import { requireServiceAccess } from '@/lib/internal-service';
import { modelTiers, normalizeModelTier } from '@/lib/model-tier';

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

function text(value: unknown, maxLength: number) {
  return typeof value === 'string' ? value.trim().slice(0, maxLength) : '';
}

function stringList(value: unknown) {
  return Array.isArray(value)
    ? Array.from(new Set(value.map((item) => text(item, 160)).filter(Boolean)))
    : text(value, 4000).split(',').map((item) => item.trim()).filter(Boolean);
}

function optionalMemoryScope(body: Record<string, unknown>) {
  const hasMemoryScope = Object.prototype.hasOwnProperty.call(body, 'memoryScope')
    || Object.prototype.hasOwnProperty.call(body, 'memory_scope');
  if (!hasMemoryScope) return null;
  const value = body.memoryScope ?? body.memory_scope;
  const scope = value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
  const scopeName = text(scope.scope, 80);
  return {
    ...(scopeName ? { scope: scopeName } : {}),
    buckets: stringList(scope.buckets),
    knowledgeSourceIds: stringList(scope.knowledgeSourceIds ?? scope.knowledge_source_ids),
    kinds: stringList(scope.kinds),
    tags: stringList(scope.tags),
    entities: stringList(scope.entities),
    audiences: stringList(scope.audiences),
    stabilities: stringList(scope.stabilities),
    instructions: text(scope.instructions, 10_000),
    enforcement: 'instructions-only' as const,
  };
}

export async function GET() {
  const access = await requireServiceAccess();
  if (!access.ok) return NextResponse.json({ ok: false, error: access.error }, { status: access.status });
  return NextResponse.json({
    ok: true,
    profiles: listAgentProfiles().map((profile) => ({
      ...profile,
      accountabilityDomain: getAccountabilityAssignment('agent_profile', profile.id),
    })),
  });
}

export async function POST(request: Request) {
  const access = await requireServiceAccess();
  if (!access.ok) return NextResponse.json({ ok: false, error: access.error }, { status: access.status });
  const body = record(await request.json().catch(() => null));
  const key = text(body.key, 120);
  const name = text(body.name, 160);
  if (!key || !name) return NextResponse.json({ ok: false, error: 'key and name are required' }, { status: 400 });
  const owner = body.owner === 'workspace' ? 'workspace' : 'admin-agent';
  const modelTierInput = text(body.modelTier ?? body.model_tier, 40);
  if (modelTierInput && !modelTiers.includes(modelTierInput as (typeof modelTiers)[number])) {
    return NextResponse.json({ ok: false, error: `MODEL_TIER_INVALID:${modelTierInput}` }, { status: 400 });
  }
  const memoryScope = optionalMemoryScope(body);
  const preview = {
    key,
    name,
    description: text(body.description, 2000) || null,
    status: 'active' as const,
    owner,
    modelTier: normalizeModelTier(modelTierInput),
    persona: { name, instructions: text(body.personaInstructions ?? body.persona_instructions, 12000) },
    skills: stringList(body.skills),
    ...(memoryScope ? { memoryScope } : {}),
    authority: { mode: 'policy-controlled', maximumAccessMode: 'full', consoleAccessMode: 'full' },
    contextPolicy: { continuation: 'session', handoff: null },
    accountabilityDomainKey: text(body.accountabilityDomainKey ?? body.accountability_domain_key, 80) || null,
  };
  if (body.confirm !== true) return NextResponse.json({ ok: true, confirmed: false, preview });
  try {
    const profile = upsertAgentProfile({
      ...preview,
      ownerType: owner === 'workspace' ? 'workspace' : 'agent',
      ownerAgentProfileId: owner === 'admin-agent' ? adminAgentProfileId : null,
      stewardUserIds: stringList(body.stewardUserIds ?? body.steward_user_ids),
    });
    const assignment = preview.accountabilityDomainKey
      ? assignAccountabilityDomain({ targetType: 'agent_profile', targetKey: profile.key, domainKey: preview.accountabilityDomainKey })
      : null;
    createAuditLog({
      actorUserId: null,
      actionType: 'agent.agent_profile.create',
      targetType: 'agent_profile',
      targetId: profile.id,
      meta: { key: profile.key, ownerType: profile.owner.type, ownerAgentProfileId: profile.owner.agentProfileId, accountabilityDomainKey: assignment?.domainKey ?? null },
    });
    return NextResponse.json({ ok: true, confirmed: true, profile, accountabilityAssignment: assignment }, { status: 201 });
  } catch (error) {
    return NextResponse.json({ ok: false, error: error instanceof Error ? error.message : 'AGENT_PROFILE_CREATE_FAILED' }, { status: 400 });
  }
}
