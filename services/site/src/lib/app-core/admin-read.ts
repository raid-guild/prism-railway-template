import { loadConfig } from './config';
import { listAgentRuns, listChangeRequests, listTargetApps, listTargetEnvironments, listWorkflows } from './repository';
import { resolveRuntimeProfile } from './runtime-profiles';
import { projectActiveRequestAgentRuns } from '../prism-lab/active-run-projection';

async function fetchJson(baseUrl: string, path: string) {
  if (!baseUrl) {
    return { ok: false, configured: false, status: null, payload: null, error: 'BASE_URL_MISSING' };
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 5000);

  try {
    const response = await fetch(`${baseUrl}${path}`, { signal: controller.signal });
    const payload = await response.json().catch(() => null);
    return {
      ok: response.ok,
      configured: true,
      status: response.status,
      payload,
      error: response.ok ? null : 'HEALTHCHECK_FAILED',
    };
  } catch (error) {
    return {
      ok: false,
      configured: true,
      status: null,
      payload: null,
      error: error instanceof Error ? error.message : 'HEALTHCHECK_ERROR',
    };
  } finally {
    clearTimeout(timer);
  }
}

export async function getAdminSetupStatus() {
  const config = loadConfig();
  const runtimeProfile = (() => {
    try {
      return resolveRuntimeProfile();
    } catch {
      return null;
    }
  })();

  const [prismMemory, codexRuntime] = await Promise.all([
    fetchJson(config.prismMemoryBaseUrl, '/health'),
    fetchJson(runtimeProfile?.baseUrl ?? '', '/health'),
  ]);

  const codexPayload =
    codexRuntime.payload && typeof codexRuntime.payload === 'object' && !Array.isArray(codexRuntime.payload)
      ? codexRuntime.payload as Record<string, unknown>
      : {};
  const prismPayload =
    prismMemory.payload && typeof prismMemory.payload === 'object' && !Array.isArray(prismMemory.payload)
      ? prismMemory.payload as Record<string, unknown>
      : {};

  return {
    prismMemory: {
      configured: prismMemory.configured,
      reachable: prismMemory.ok,
      status: prismMemory.status,
      error: prismMemory.error,
      space: typeof prismPayload.space === 'string' ? prismPayload.space : null,
    },
    codexRuntime: {
      configured: codexRuntime.configured,
      reachable: codexRuntime.ok,
      status: codexRuntime.status,
      error: codexRuntime.error,
      codexAuthConfigured: codexPayload.codexAuthConfigured === true,
      codexHome: typeof codexPayload.codexHome === 'string' ? codexPayload.codexHome : null,
      runtimeKey: runtimeProfile?.key ?? null,
      adapter: runtimeProfile?.adapter ?? null,
    },
    targets: {
      targetAppCount: listTargetApps().length,
      targetEnvironmentCount: listTargetEnvironments().length,
    },
    community: {
      provider: config.communityProvider,
    },
  };
}

export function getAdminBoardSnapshot(input: { targetAppId?: string } = {}) {
  const activeRequestAgentRuns = projectActiveRequestAgentRuns(
    ['queued', 'claimed', 'running'].flatMap((status) => listAgentRuns({ status, limit: 200 })),
  );

  return {
    targetApps: listTargetApps(),
    targetEnvironments: listTargetEnvironments(input.targetAppId),
    changeRequests: listChangeRequests({
      targetAppId: input.targetAppId,
    }),
    workflows: listWorkflows(),
    activeRequestAgentRuns,
  };
}
