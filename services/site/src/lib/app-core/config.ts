import path from 'node:path';

export type CommunityProvider = 'discord' | 'slack' | 'telegram' | null;

export interface AppConfig {
  workspaceRoot: string;
  repoRoot: string;
  dataRoot: string;
  customSkillsRoot: string;
  skillSourcesRoot: string;
  docsDataDir: string;
  dbPath: string;
  port: number;
  sessionCookieName: string;
  sessionMaxAgeMs: number;
  adminEmail: string;
  adminPassword: string;
  prismMemoryBaseUrl: string;
  codexRuntimeBaseUrl: string;
  communityProvider: CommunityProvider;
  discordBotToken: string | null;
  slackBotToken: string | null;
  telegramBotToken: string | null;
  nodeEnv: string;
}

let cachedConfig: AppConfig | null = null;

function normalizeProvider(input: string | undefined): CommunityProvider {
  if (!input) return null;

  const value = input.trim().toLowerCase();
  if (value === 'discord' || value === 'slack' || value === 'telegram') {
    return value;
  }

  return null;
}

function normalizeHttpPath(value: string | undefined, fallback = '') {
  const candidate = value?.trim() || fallback;
  if (!candidate || candidate === '/') {
    return '';
  }

  return `/${candidate.replace(/^\/+|\/+$/g, '')}`;
}

function normalizeBaseUrl(value: string | undefined) {
  return value?.trim().replace(/\/+$/, '') || '';
}

function resolveDocsDataDir(repoRoot: string) {
  const explicit = process.env.DOCS_DATA_DIR?.trim();
  if (explicit) {
    return path.resolve(explicit);
  }

  return path.resolve(repoRoot, 'docs/data');
}

function resolveDataRoot(workspaceRoot: string) {
  const explicit = process.env.PRISM_AGENT_DATA_ROOT?.trim();
  if (explicit) {
    return path.resolve(explicit);
  }

  const railwayVolumePath = process.env.RAILWAY_VOLUME_MOUNT_PATH?.trim();
  if (railwayVolumePath) {
    return path.resolve(railwayVolumePath);
  }

  return path.resolve(workspaceRoot, 'data');
}

export function loadConfig(): AppConfig {
  if (cachedConfig) {
    return cachedConfig;
  }

  const workspaceRoot = process.cwd();
  const repoRoot = path.resolve(workspaceRoot, '../..');
  const dataRoot = resolveDataRoot(workspaceRoot);
  const explicitProvider = normalizeProvider(process.env.COMMUNITY_PROVIDER);
  const discordBotToken = process.env.DISCORD_BOT_TOKEN?.trim() || null;
  const slackBotToken = process.env.SLACK_BOT_TOKEN?.trim() || null;
  const telegramBotToken = process.env.TELEGRAM_BOT_TOKEN?.trim() || null;
  const prismApiPort = Number(process.env.PRISM_API_PORT || 8788);
  const prismApiRootPath = normalizeHttpPath(process.env.PRISM_API_ROOT_PATH, '/prism-memory');
  const inferredProvider = explicitProvider
    ?? (discordBotToken ? 'discord' : null)
    ?? (slackBotToken ? 'slack' : null)
    ?? (telegramBotToken ? 'telegram' : null);

  cachedConfig = {
    workspaceRoot,
    repoRoot,
    dataRoot,
    customSkillsRoot: path.resolve(dataRoot, 'skills'),
    skillSourcesRoot: path.resolve(dataRoot, 'skill-sources'),
    docsDataDir: resolveDocsDataDir(repoRoot),
    dbPath: path.resolve(dataRoot, 'prism-agent.db'),
    port: Number(process.env.PORT || 4010),
    sessionCookieName: process.env.SESSION_COOKIE_NAME?.trim() || 'prism_agent_session',
    sessionMaxAgeMs: Number(process.env.SESSION_MAX_AGE_MS || 1000 * 60 * 60 * 24 * 30),
    adminEmail: process.env.ADMIN_EMAIL?.trim().toLowerCase() || 'admin@local.agent',
    adminPassword: process.env.ADMIN_PASSWORD?.trim() || 'changeme',
    prismMemoryBaseUrl:
      normalizeBaseUrl(process.env.PRISM_MEMORY_BASE_URL)
      || `http://127.0.0.1:${Number.isFinite(prismApiPort) ? prismApiPort : 8788}${prismApiRootPath}`,
    codexRuntimeBaseUrl:
      normalizeBaseUrl(process.env.CODEX_RUNTIME_BASE_URL)
      || (process.env.RAILWAY_SERVICE_CODEX_RUNTIME_URL?.trim()
        ? `https://${process.env.RAILWAY_SERVICE_CODEX_RUNTIME_URL.trim().replace(/\/+$/, '')}`
        : ''),
    communityProvider: inferredProvider,
    discordBotToken,
    slackBotToken,
    telegramBotToken,
    nodeEnv: process.env.NODE_ENV?.trim() || 'development',
  };

  return cachedConfig;
}
