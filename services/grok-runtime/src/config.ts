import os from 'node:os';
import path from 'node:path';

function positiveInteger(name: string, fallback: number) {
  const parsed = Number.parseInt(process.env[name] ?? '', 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

export const config = {
  port: positiveInteger('PORT', 3031),
  grokBinary: process.env.GROK_BIN?.trim() || 'grok',
  grokHome: process.env.GROK_HOME?.trim() || path.join(os.homedir(), '.grok'),
  grokModel: process.env.GROK_MODEL?.trim() || null,
  grokPermissionMode: process.env.GROK_PERMISSION_MODE?.trim() || 'bypassPermissions',
  runtimeKey: process.env.PRISM_RUNTIME_KEY?.trim() || 'grok-local',
  workspaceRoot: path.resolve(process.env.GROK_WORKSPACE_ROOT?.trim() || process.cwd()),
  timeoutMs: positiveInteger('GROK_RUNTIME_TIMEOUT_MS', 600_000),
  appApiBaseUrl: process.env.APP_API_BASE_URL?.trim().replace(/\/+$/, '') || null,
  appServiceToken:
    process.env.APP_API_SERVICE_TOKEN?.trim()
    || process.env.INTERNAL_SERVICE_TOKEN?.trim()
    || null,
};
