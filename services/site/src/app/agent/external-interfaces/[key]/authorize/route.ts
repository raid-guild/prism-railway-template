import { NextResponse } from 'next/server';
import { authorizeExternalInterface, resolveAgentProfileInteraction } from '@/lib/app-core';
import { credentialsForSourceMode } from '@/lib/gateway-credential-assignment';
import { requireServiceAccess } from '@/lib/internal-service';
import { readRouteParam } from '@/lib/local-admin-api';
import { listEnabledGatewayCredentialsOrEmpty } from '@/lib/prism-gateway';

type RouteContext = { params: Promise<{ key: string }> };

export async function POST(request: Request, context: RouteContext) {
  const access = await requireServiceAccess();
  if (!access.ok) return NextResponse.json({ ok: false, error: access.error }, { status: access.status });
  const credential = request.headers.get('x-prism-interface-credential')?.trim() || '';
  const interfaceKey = readRouteParam((await context.params).key);
  const result = authorizeExternalInterface({
    key: interfaceKey,
    credential,
    origin: request.headers.get('x-prism-interface-origin'),
    requestId: request.headers.get('x-prism-request-id'),
    subject: request.headers.get('x-prism-external-subject'),
  });
  if (result.ok) {
    const agent = resolveAgentProfileInteraction({ surfaceType: 'external', surfaceKey: interfaceKey });
    if (agent?.policy.accessMode === 'off') {
      return NextResponse.json({ ok: false, code: 'EXTERNAL_INTERFACE_DISABLED' }, { status: 409 });
    }
    const resolved = agent ? {
      interface: result.resolved.interface,
      profile: {
        key: agent.profile.key,
        name: agent.profile.name,
        mode: agent.policy.accessMode,
        runtimeProfileKey: agent.profile.runtimeProfileKey,
        persona: {
          name: typeof agent.profile.persona.name === 'string' ? agent.profile.persona.name : agent.profile.name,
          instructions: typeof agent.profile.persona.instructions === 'string' ? agent.profile.persona.instructions : '',
        },
        skills: agent.profile.skills,
        memoryScope: agent.profile.memoryScope,
        allowedWorkflows: agent.policy.allowedWorkflows,
        rateLimit: agent.policy.rateLimit,
        version: agent.profile.version,
      },
    } : result.resolved;
    const credentials = credentialsForSourceMode(
      resolved.profile.mode,
      resolved.profile.mode === 'full' ? await listEnabledGatewayCredentialsOrEmpty() : [],
    );
    return NextResponse.json({ ...result, resolved, credentials });
  }
  const status = result.code === 'EXTERNAL_INTERFACE_NOT_FOUND' ? 404
    : result.code === 'EXTERNAL_INTERFACE_DISABLED' ? 409
      : result.code === 'EXTERNAL_INTERFACE_ORIGIN_DENIED' ? 403
        : 401;
  return NextResponse.json(result, { status });
}
