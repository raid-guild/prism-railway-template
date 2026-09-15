import { NextResponse } from 'next/server';
import { getAgentProfile, getInteractionProfile, listExternalInterfaces, listInteractionAccessEvents, upsertAgentProfileBinding, upsertExternalInterface, upsertInteractionProfile } from '@/lib/app-core';
import { requireCapabilityAccess } from '@/lib/admin-auth';
import { externalInterfaceInput } from '@/lib/external-interaction-input';

export async function GET() {
  const access = await requireCapabilityAccess('canManageSettings');
  if (!access.ok) return NextResponse.json({ ok: false, error: access.error }, { status: access.status });
  return NextResponse.json({
    ok: true,
    interfaces: listExternalInterfaces(),
    recentEvents: listInteractionAccessEvents(null, 50),
  });
}

export async function POST(request: Request) {
  const access = await requireCapabilityAccess('canManageSettings');
  if (!access.ok) return NextResponse.json({ ok: false, error: access.error }, { status: access.status });
  const body = await request.json().catch(() => null) as Record<string, unknown> | null;
  const agentProfileKey = typeof body?.agentProfileKey === 'string' ? body.agentProfileKey.trim() : typeof body?.agent_profile_key === 'string' ? body.agent_profile_key.trim() : '';
  const agentProfile = agentProfileKey ? getAgentProfile(agentProfileKey) : null;
  if (agentProfileKey && !agentProfile) return NextResponse.json({ ok: false, error: 'Agent Profile not found' }, { status: 404 });
  if (agentProfile && !getInteractionProfile(agentProfile.key)) upsertInteractionProfile({ key: agentProfile.key, name: agentProfile.name, mode: 'full' });
  const input = externalInterfaceInput(agentProfile ? { ...body, interactionProfileKey: agentProfile.key } : body);
  if (!input) return NextResponse.json({ ok: false, error: 'key and agentProfileKey are required' }, { status: 400 });
  try {
    const externalInterface = upsertExternalInterface(input);
    if (agentProfile) upsertAgentProfileBinding({
      profileId: agentProfile.id, surfaceType: 'external', surfaceKey: externalInterface.key,
      label: externalInterface.name, enabled: externalInterface.enabled,
      configuration: body?.policy && typeof body.policy === 'object' ? body.policy as Record<string, unknown> : { accessMode: 'readonly' },
      createdByUserId: access.userId,
    });
    return NextResponse.json({ ok: true, interface: externalInterface, agentProfile: agentProfile ? getAgentProfile(agentProfile.key) : null });
  } catch (error) {
    return NextResponse.json({ ok: false, error: error instanceof Error ? error.message : 'EXTERNAL_INTERFACE_SAVE_FAILED' }, { status: 400 });
  }
}
