import path from 'node:path';

function readBooleanEnv(name: string, fallback: boolean) {
  const value = process.env[name]?.trim().toLowerCase();
  if (!value) return fallback;
  return ['1', 'true', 'yes', 'on'].includes(value);
}

function readNumberEnv(name: string, fallback: number) {
  const value = process.env[name]?.trim();
  if (!value) return fallback;

  const parsed = Number.parseInt(value, 10);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    return fallback;
  }

  return parsed;
}

function readOptionalNumberEnv(name: string) {
  const value = process.env[name]?.trim();
  if (!value) return null;
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
}

const workspaceRoot = path.resolve(process.cwd());

export const config = {
  codexBinary: process.env.CODEX_BIN?.trim() || 'codex',
  codexHome: process.env.CODEX_HOME?.trim() || null,
  codexModel: process.env.CODEX_MODEL?.trim() || null,
  codexModelEconomy: process.env.CODEX_MODEL_ECONOMY?.trim() || null,
  codexModelStandard: process.env.CODEX_MODEL_STANDARD?.trim() || null,
  codexModelDeep: process.env.CODEX_MODEL_DEEP?.trim() || null,
  codexReasoningEffortEconomy: process.env.CODEX_REASONING_EFFORT_ECONOMY?.trim() || null,
  codexReasoningEffortStandard: process.env.CODEX_REASONING_EFFORT_STANDARD?.trim() || null,
  codexReasoningEffortDeep: process.env.CODEX_REASONING_EFFORT_DEEP?.trim() || null,
  gitAuthorName: process.env.GIT_AUTHOR_NAME?.trim() || 'Prism Codex',
  gitAuthorEmail: process.env.GIT_AUTHOR_EMAIL?.trim() || 'prism-codex@users.noreply.github.com',
  gitCommitterName: process.env.GIT_COMMITTER_NAME?.trim() || process.env.GIT_AUTHOR_NAME?.trim() || 'Prism Codex',
  gitCommitterEmail:
    process.env.GIT_COMMITTER_EMAIL?.trim()
    || process.env.GIT_AUTHOR_EMAIL?.trim()
    || 'prism-codex@users.noreply.github.com',
  prismApiBase: process.env.PRISM_API_BASE?.trim().replace(/\/+$/, '') || null,
  prismApiKey: process.env.PRISM_API_READ_KEY?.trim() || process.env.PRISM_API_KEY?.trim() || null,
  appApiBaseUrl: process.env.APP_API_BASE_URL?.trim().replace(/\/+$/, '') || null,
  appServiceToken:
    process.env.APP_API_SERVICE_TOKEN?.trim()
    || process.env.INTERNAL_SERVICE_TOKEN?.trim()
    || process.env.SERVICE_SHARED_TOKEN?.trim()
    || null,
  githubToken:
    process.env.TARGET_REPO_GITHUB_TOKEN?.trim()
    || process.env.GITHUB_TOKEN?.trim()
    || null,
  targetWorkspaceRoot:
    process.env.CODEX_TARGET_WORKSPACE_ROOT?.trim()
    || (process.env.RAILWAY_VOLUME_MOUNT_PATH?.trim()
      ? path.resolve(process.env.RAILWAY_VOLUME_MOUNT_PATH.trim(), 'workspaces')
      : path.resolve(workspaceRoot, '.codex-target-workspaces')),
  prismSkillCacheTtlMs: readNumberEnv('PRISM_SKILL_CACHE_TTL_MS', 300_000),
  prismGatewayEnabled: readBooleanEnv('PRISM_GATEWAY_ENABLED', false),
  prismGatewayBaseUrl: process.env.PRISM_GATEWAY_BASE_URL?.trim().replace(/\/+$/, '') || null,
  prismGatewayToken: process.env.PRISM_GATEWAY_TOKEN?.trim() || null,
  prismGatewayTimeoutMs: readNumberEnv('PRISM_GATEWAY_TIMEOUT_MS', 70_000),
  codexRuntimeEnabled: readBooleanEnv('CODEX_RUNTIME_ENABLED', true),
  codexImageGenerationEnabled: readBooleanEnv('CODEX_IMAGE_GENERATION_ENABLED', true),
  codexRuntimeTimeoutMs: readNumberEnv('CODEX_RUNTIME_TIMEOUT_MS', 600_000),
  codexRuntimeIdleTimeoutMs: readNumberEnv('PRISM_RUNTIME_IDLE_TIMEOUT_MS', readNumberEnv('CODEX_RUNTIME_TIMEOUT_MS', 1_200_000)),
  codexRuntimeMaxDurationMs: readNumberEnv('PRISM_RUNTIME_MAX_DURATION_MS', 3_600_000),
  codexRuntimePromptWarnBytes: readOptionalNumberEnv('CODEX_RUNTIME_PROMPT_WARN_BYTES'),
  codexRuntimePromptMaxBytes: readOptionalNumberEnv('CODEX_RUNTIME_PROMPT_MAX_BYTES'),
  codexWorkspaceRoot: process.env.CODEX_WORKSPACE_ROOT?.trim() || workspaceRoot,
  port: readNumberEnv('PORT', 3030),
  workspaceRoot,
};
