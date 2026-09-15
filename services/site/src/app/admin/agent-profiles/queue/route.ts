import { NextResponse } from 'next/server';

import { listAgentProfileQueueStates, listAgentProfiles } from '@/lib/app-core';
import { requireCapabilityAccess } from '@/lib/admin-auth';

export async function GET() {
  const access = await requireCapabilityAccess('canChatAgents');
  if (!access.ok) return NextResponse.json({ ok: false, error: access.error }, { status: access.status });
  const visibleProfiles = new Map(
    listAgentProfiles()
      .filter((profile) => access.capabilities.includes('canRunAgent') || profile.systemKey !== 'admin-agent')
      .map((profile) => [profile.id, profile.key]),
  );
  const queues = listAgentProfileQueueStates()
    .filter((queue) => visibleProfiles.has(queue.profileId))
    .map(({ profileId, queued, claimed, running }) => ({
      key: visibleProfiles.get(profileId), queued, claimed, running,
    }));
  return NextResponse.json({ ok: true, queues });
}
