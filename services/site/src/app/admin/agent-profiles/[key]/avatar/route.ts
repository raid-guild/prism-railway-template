import { NextResponse } from 'next/server';

import {
  createAuditLog,
  getAgentProfile,
  readAgentAvatar,
  upsertAgentProfile,
  validateAgentAvatar,
  writeAgentAvatar,
} from '@/lib/app-core';
import { requireCapabilityAccess } from '@/lib/admin-auth';

type RouteContext = { params: Promise<{ key: string }> };

export async function GET(_request: Request, context: RouteContext) {
  const access = await requireCapabilityAccess('canChatAgents');
  if (!access.ok) return NextResponse.json({ ok: false, error: access.error }, { status: access.status });
  const profile = getAgentProfile((await context.params).key);
  if (!profile) return NextResponse.json({ ok: false, error: 'Agent Profile not found' }, { status: 404 });
  try {
    const avatar = readAgentAvatar(profile.id);
    return new NextResponse(avatar.bytes, {
      headers: {
        'content-type': avatar.mimeType,
        'content-disposition': 'inline',
        'cache-control': 'private, max-age=86400, immutable',
        'x-content-type-options': 'nosniff',
      },
    });
  } catch {
    return NextResponse.json({ ok: false, error: 'Agent avatar not found' }, { status: 404 });
  }
}

export async function POST(request: Request, context: RouteContext) {
  const access = await requireCapabilityAccess('canManageSettings');
  if (!access.ok) return NextResponse.json({ ok: false, error: access.error }, { status: access.status });
  const profile = getAgentProfile((await context.params).key);
  if (!profile) return NextResponse.json({ ok: false, error: 'Agent Profile not found' }, { status: 404 });
  const formData = await request.formData().catch(() => null);
  const file = formData?.get('file');
  if (!(file instanceof File)) return NextResponse.json({ ok: false, error: 'An image file is required' }, { status: 400 });
  if (file.size > 5 * 1024 * 1024) return NextResponse.json({ ok: false, error: 'AGENT_AVATAR_TOO_LARGE' }, { status: 413 });
  try {
    const bytes = new Uint8Array(await file.arrayBuffer());
    validateAgentAvatar(bytes);
    writeAgentAvatar(profile.id, bytes);
    const nextVersion = profile.version + 1;
    const avatarUrl = `/admin/agent-profiles/${encodeURIComponent(profile.key)}/avatar?v=${nextVersion}`;
    const updated = upsertAgentProfile({
      key: profile.key,
      name: profile.name,
      description: profile.description,
      avatarUrl,
      status: profile.status,
      ownerType: profile.owner.type,
      ownerUserId: profile.owner.userId,
      ownerAgentProfileId: profile.owner.agentProfileId,
      stewardUserIds: profile.stewards.map((steward) => steward.userId),
      persona: profile.persona,
      runtimeProfileKey: profile.runtimeProfileKey,
      skills: profile.skills,
      memoryScope: profile.memoryScope,
      authority: profile.authority,
      contextPolicy: profile.contextPolicy,
      createdByUserId: access.userId,
      allowSystemProfileUpdate: Boolean(profile.systemKey),
    });
    createAuditLog({ actorUserId: access.userId, actionType: 'admin.agent_profile.avatar.upload', targetType: 'agent_profile', targetId: profile.id, meta: { version: updated.version, size: bytes.length } });
    return NextResponse.json({ ok: true, profile: updated });
  } catch (error) {
    return NextResponse.json({ ok: false, error: error instanceof Error ? error.message : 'AGENT_AVATAR_UPLOAD_FAILED' }, { status: 400 });
  }
}
