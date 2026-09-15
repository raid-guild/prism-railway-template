import express, { type Request, type Response } from "express";
import {
  ChatInputCommandInteraction,
  Client,
  Events,
  GatewayIntentBits,
  Interaction,
  Message,
  PermissionFlagsBits,
  REST,
  Routes,
  SlashCommandBuilder,
  TextChannel,
  ThreadAutoArchiveDuration,
  type AnyThreadChannel,
  type TextBasedChannel,
} from "discord.js";
import fs from "node:fs/promises";
import { randomUUID, timingSafeEqual } from "node:crypto";
import path from "node:path";
import process from "node:process";
import { setTimeout as sleep } from "node:timers/promises";
import { DiscordVoiceManager } from "./voice.js";
import { ExternalInteractionRateLimiter } from "./external-interaction-rate-limit.js";
import { buildAdvisoryMemoryInstructions, type AdvisoryMemoryScope } from "./external-interaction-memory-policy.js";
import { sanitizePublicOutput } from "./public-output-sanitizer.js";
import { requestSiteRuntime } from "./site-runtime.js";
import { discordDestinationType } from "./discord-output.js";
import { discordAgentRoutingStatus, unavailableDiscordAgentMessage, unconfiguredDiscordChannelMessage } from "./discord-agent-routing.js";
import { AppApiRequestError, isAppApiNotFound } from "./app-api-error.js";
import {
  DiscordHistoryError,
  fetchDiscordHistoryContext,
  parseDiscordHistoryContextInput,
  parseDiscordHistorySearchInput,
  searchDiscordHistory,
} from "./discord-history.js";
import {
  BuzzCliClient,
  buzzInteractionCursorTimestamp,
  buzzConversationRootFromThread,
  buzzEventDirectReplyId,
  buzzEventReplyIds,
  buzzEventRootIds,
  buzzEventMentionsPubkey,
  buzzMentionPrompt,
  buzzThreadHasDirectReplyFrom,
  buzzThreadRootId,
  normalizeBuzzMessage,
  parseBuzzChannelAllowlist,
  selectUnseenBuzzEvents,
  type BuzzChannel,
  type BuzzChannelMemberRole,
  type BuzzEvent,
} from "./buzz.js";

const DISCORD_API_BASE = "https://discord.com/api/v10";
const TELEGRAM_API_BASE = "https://api.telegram.org";
const DISCORD_TEXT_CHANNEL_TYPES = new Set([0, 5, 10, 11, 12]);
const DISCORD_FORUM_CHANNEL_TYPES = new Set([15, 16]);
const DISCORD_PARENT_CHANNEL_TYPES = new Set([0, 5, 15, 16]);
const BRIDGE_THREAD_PREFIX = "prism ";
const TEXT_ATTACHMENT_EXTENSIONS = new Set([".md", ".markdown", ".mdx", ".txt", ".text", ".log", ".json", ".yml", ".yaml"]);
const DISCORD_ATTACHMENT_HOST_SUFFIXES = ["discordapp.com", "discordapp.net", "discord.com", "discordcdn.com"];
const CHANGE_REQUEST_ASYNC_PATTERN =
  /\b(start|continue|run|resume|deploy)\b.*\b(change request|cr\s*#?\d+|latest change request|request\s*#?\d+)\b/i;
const WRITE_INTENT_PATTERN =
  /\b(create|add|update|edit|change|delete|remove|run|start|continue|resume|trigger|send|post|publish|deploy|merge|approve|reject|close|reopen|save|set|configure|install|write)\b/i;
const WRITE_TARGET_PATTERN =
  /\b(task|workflow|skill|hook|request|change request|cr\s*#?\d+|artifact|comment|message|discord|telegram|channel|repo|repository|branch|pull request|pr\s*#?\d+|issue|settings?|branding|policy|env|environment|file|code)\b/i;
const PROMOTE_DOC_MESSAGE_LIMIT = 80;
const PROMOTE_DOC_TRANSCRIPT_MAX_CHARS = 20_000;
const PROMOTE_DOC_CAPABILITY = "memory.promote_doc";

type JsonValue = null | boolean | number | string | JsonValue[] | { [key: string]: JsonValue };
type JsonObject = { [key: string]: JsonValue };

type AdapterConfig = ReturnType<typeof adapterConfig>;

type DiscordAuthor = {
  id?: string | null;
  username?: string | null;
  displayName?: string | null;
  bot: boolean;
};

type AttachmentText = {
  filename: string;
  url: string;
  status: string;
  size?: number | null;
  truncated?: boolean;
  text?: string;
  error?: string;
};

type AttachmentFetchResult = {
  body: Buffer;
  metadata: JsonObject;
  contentType: string;
  filename: string;
};

type AttachmentSummary = JsonObject & {
  id: string;
  filename: string;
  contentType: string | null;
  size: number | null;
  url: string | null;
};

type AdapterDestination = {
  adapter: string;
  id: string;
  destinationId?: string;
  platform?: string;
  type: string;
  name: string | null;
  label: string;
  parentId?: string | null;
};

type KnownTelegramChat = {
  id: string;
  type: string;
  title: string | null;
  username: string | null;
  firstSeenAt: string;
  lastSeenAt: string;
};

type DiscordAccessMode = "off" | "readonly" | "run-approved" | "full";

type DiscordRateLimitConfig = {
  windowSeconds: number;
  maxRequests: number;
};

type DiscordAccessPolicyRule = {
  mode?: DiscordAccessMode;
  interactionProfileKey?: string;
  capabilities?: string[];
  skills?: string[];
  rateLimit?: Partial<DiscordRateLimitConfig>;
};

type DiscordAccessPolicyConfig = {
  defaultMode: DiscordAccessMode;
  defaultRateLimit: DiscordRateLimitConfig;
  targets: Record<string, DiscordAccessPolicyRule>;
  groups: Record<string, DiscordAccessPolicyRule>;
  users: Record<string, DiscordAccessPolicyRule>;
};

type ResolvedDiscordAccessPolicy = {
  mode: DiscordAccessMode;
  interactionProfileKey: string | null;
  capabilities: string[];
  skills: string[];
  rateLimit: DiscordRateLimitConfig;
  matchedRules: string[];
  agentProfile?: ExternalInteractionAuthorization["profile"];
  agentResolutionFailed?: boolean;
};

let bridgeClient: Client | null = null;
let voiceManager: DiscordVoiceManager | null = null;
let discordReady = false;
let discordUserTag: string | null = null;
let telegramBotUsername: string | null = null;
const discordPromptQueues = new Map<string, Promise<void>>();
const discordRateLimitBuckets = new Map<string, { windowStartMs: number; count: number }>();
const externalInteractionRateLimiter = new ExternalInteractionRateLimiter();
let sourceAdapterPolicyCache: { expiresAt: number; platforms: Record<string, DiscordAccessPolicyConfig> } | null = null;
const interactionProfileCache = new Map<string, {
  expiresAt: number;
  profile: ExternalInteractionAuthorization["profile"];
}>();
const buzzInteractionStatus: {
  running: boolean;
  lastPollAt: string | null;
  lastSuccessAt: string | null;
  lastError: string | null;
  processedCount: number;
} = {
  running: false,
  lastPollAt: null,
  lastSuccessAt: null,
  lastError: null,
  processedCount: 0,
};

function nowUtcIso(): string {
  return new Date().toISOString();
}

function describeError(error: unknown): string {
  if (error instanceof Error && error.message.trim()) {
    const cause = (error as Error & { cause?: unknown }).cause;
    if (cause instanceof Error && cause.message.trim()) {
      return `${error.message.trim()}: ${cause.message.trim()}`;
    }
    if (cause) {
      return `${error.message.trim()}: ${String(cause)}`;
    }
    return error.message.trim();
  }
  return String(error);
}

function parseIntEnv(name: string, defaultValue: number, minimum?: number, maximum?: number): number {
  const raw = (process.env[name] ?? "").trim();
  let value = raw ? Number.parseInt(raw, 10) : defaultValue;
  if (!Number.isFinite(value)) {
    throw new Error(`${name} must be an integer`);
  }
  if (typeof minimum === "number") {
    value = Math.max(minimum, value);
  }
  if (typeof maximum === "number") {
    value = Math.min(maximum, value);
  }
  return value;
}

function parseBoolEnv(name: string, defaultValue: boolean): boolean {
  const raw = (process.env[name] ?? "").trim().toLowerCase();
  if (!raw) {
    return defaultValue;
  }
  return new Set(["1", "true", "yes", "on"]).has(raw);
}

function parseJsonEnv(name: string): unknown {
  const raw = (process.env[name] ?? "").trim();
  if (!raw) {
    return null;
  }
  try {
    return JSON.parse(raw) as unknown;
  } catch (error) {
    throw new Error(`${name} must be valid JSON: ${describeError(error)}`);
  }
}

function parseAccessMode(value: unknown, fallback: DiscordAccessMode): DiscordAccessMode {
  if (value === "off" || value === "readonly" || value === "run-approved" || value === "full") {
    return value;
  }
  return fallback;
}

function parseStringRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function parseCapabilities(value: unknown): string[] | undefined {
  if (!Array.isArray(value)) {
    return undefined;
  }
  return value
    .filter((entry): entry is string => typeof entry === "string" && entry.trim().length > 0)
    .map((entry) => entry.trim());
}

function parseRateLimitConfig(value: unknown, fallback: DiscordRateLimitConfig): DiscordRateLimitConfig {
  const record = parseStringRecord(value);
  const windowSeconds = typeof record.windowSeconds === "number"
    ? record.windowSeconds
    : typeof record.window_seconds === "number"
      ? record.window_seconds
      : fallback.windowSeconds;
  const maxRequests = typeof record.maxRequests === "number"
    ? record.maxRequests
    : typeof record.max_requests === "number"
      ? record.max_requests
      : fallback.maxRequests;

  return {
    windowSeconds: Math.max(1, Math.min(86_400, Math.floor(windowSeconds))),
    maxRequests: Math.max(1, Math.min(10_000, Math.floor(maxRequests))),
  };
}

function parsePartialRateLimitConfig(value: unknown): Partial<DiscordRateLimitConfig> | undefined {
  const record = parseStringRecord(value);
  const rateLimit: Partial<DiscordRateLimitConfig> = {};
  if (record.windowSeconds !== undefined || record.window_seconds !== undefined) {
    rateLimit.windowSeconds = parseRateLimitConfig(record, { windowSeconds: 60, maxRequests: 6 }).windowSeconds;
  }
  if (record.maxRequests !== undefined || record.max_requests !== undefined) {
    rateLimit.maxRequests = parseRateLimitConfig(record, { windowSeconds: 60, maxRequests: 6 }).maxRequests;
  }
  return Object.keys(rateLimit).length ? rateLimit : undefined;
}

function parseAccessPolicyRule(value: unknown): DiscordAccessPolicyRule {
  const record = parseStringRecord(value);
  const rawMode = record.mode;
  const rawInteractionProfileKey = record.interactionProfileKey ?? record.interaction_profile_key;
  const interactionProfileKey = typeof rawInteractionProfileKey === "string"
    && /^[a-z0-9][a-z0-9._-]{0,119}$/.test(rawInteractionProfileKey.trim().toLowerCase())
    ? rawInteractionProfileKey.trim().toLowerCase()
    : undefined;
  const rateLimit = parsePartialRateLimitConfig(record.rateLimit ?? record.rate_limit);
  const rawSkills = record.skills ?? record.requestedSkills ?? record.requested_skills;
  const skills = Array.isArray(rawSkills)
    ? rawSkills
      .filter((value): value is string => typeof value === "string")
      .map((value) => value.trim())
      .filter((value) => /^[a-zA-Z][a-zA-Z0-9_.-]{0,119}$/.test(value))
    : [];
  return {
    mode: rawMode === "off" || rawMode === "readonly" || rawMode === "run-approved" || rawMode === "full"
      ? rawMode
      : undefined,
    ...(interactionProfileKey ? { interactionProfileKey } : {}),
    capabilities: parseCapabilities(record.capabilities),
    ...(skills.length ? { skills: [...new Set(skills)] } : {}),
    ...(rateLimit ? { rateLimit } : {}),
  };
}

function dataRoot(): string {
  const configured = (process.env.SOURCE_ADAPTER_DATA_ROOT ?? "").trim();
  if (configured) {
    return path.resolve(configured);
  }
  return path.resolve(path.dirname(new URL(import.meta.url).pathname), "..", "data");
}

function checkpointPath(): string {
  return path.join(dataRoot(), "checkpoints.json");
}

function telegramChatsPath(): string {
  return path.join(dataRoot(), "telegram-chats.json");
}

function telegramOffsetPath(): string {
  return path.join(dataRoot(), "telegram-offset.json");
}

function buzzInteractionStatePath(): string {
  return path.join(dataRoot(), "buzz-interactions.json");
}

function sourceAdapterPublicBaseUrl(): string | null {
  const explicit = (process.env.SOURCE_ADAPTER_PUBLIC_BASE_URL ?? "").trim().replace(/\/+$/, "");
  if (explicit) {
    return explicit;
  }
  const railwayPublic = (process.env.RAILWAY_PUBLIC_DOMAIN ?? process.env.RAILWAY_STATIC_URL ?? "").trim();
  if (railwayPublic) {
    return `https://${railwayPublic.replace(/\/+$/, "")}`;
  }
  const port = Number(process.env.PORT ?? "8789");
  if (Number.isFinite(port) && port > 0) {
    return `http://127.0.0.1:${port}`;
  }
  return null;
}

async function loadCheckpoints(): Promise<Record<string, JsonValue>> {
  try {
    const content = await fs.readFile(checkpointPath(), "utf8");
    return JSON.parse(content) as Record<string, JsonValue>;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      return {};
    }
    throw error;
  }
}

async function saveCheckpoints(payload: Record<string, JsonValue>): Promise<void> {
  await fs.mkdir(dataRoot(), { recursive: true });
  await fs.writeFile(checkpointPath(), `${JSON.stringify(payload, null, 2)}\n`, "utf8");
}

async function loadKnownTelegramChats(): Promise<Record<string, KnownTelegramChat>> {
  try {
    const content = await fs.readFile(telegramChatsPath(), "utf8");
    const parsed = JSON.parse(content) as unknown;
    const record = parseStringRecord(parsed);
    return Object.fromEntries(
      Object.entries(record)
        .filter((entry): entry is [string, Record<string, unknown>] => !!entry[1] && typeof entry[1] === "object" && !Array.isArray(entry[1]))
        .map(([id, chat]) => [id, {
          id,
          type: typeof chat.type === "string" ? chat.type : "unknown",
          title: typeof chat.title === "string" && chat.title.trim() ? chat.title.trim() : null,
          username: typeof chat.username === "string" && chat.username.trim() ? chat.username.trim() : null,
          firstSeenAt: typeof chat.firstSeenAt === "string" ? chat.firstSeenAt : nowUtcIso(),
          lastSeenAt: typeof chat.lastSeenAt === "string" ? chat.lastSeenAt : nowUtcIso(),
        }]),
    );
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      return {};
    }
    throw error;
  }
}

async function saveKnownTelegramChats(chats: Record<string, KnownTelegramChat>): Promise<void> {
  await fs.mkdir(dataRoot(), { recursive: true });
  await fs.writeFile(telegramChatsPath(), `${JSON.stringify(chats, null, 2)}\n`, "utf8");
}

async function readTelegramOffset(): Promise<number | null> {
  try {
    const content = await fs.readFile(telegramOffsetPath(), "utf8");
    const parsed = JSON.parse(content) as unknown;
    const offset = parseStringRecord(parsed).offset;
    return typeof offset === "number" && Number.isSafeInteger(offset) ? offset : null;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      return null;
    }
    throw error;
  }
}

async function saveTelegramOffset(offset: number): Promise<void> {
  await fs.mkdir(dataRoot(), { recursive: true });
  await fs.writeFile(telegramOffsetPath(), `${JSON.stringify({ offset }, null, 2)}\n`, "utf8");
}

type BuzzInteractionState = {
  cursorTimestamp: number;
  processedEventIds: string[];
  conversationEventRoots: Array<{ eventId: string; rootEventId: string }>;
};

async function loadBuzzInteractionState(): Promise<BuzzInteractionState> {
  try {
    const content = await fs.readFile(buzzInteractionStatePath(), "utf8");
    const parsed = parseStringRecord(JSON.parse(content) as unknown);
    const cursorTimestamp = typeof parsed.cursorTimestamp === "number" && Number.isFinite(parsed.cursorTimestamp)
      ? Math.max(0, Math.trunc(parsed.cursorTimestamp))
      : 0;
    const processedEventIds = Array.isArray(parsed.processedEventIds)
      ? parsed.processedEventIds.filter((value): value is string => typeof value === "string" && /^[0-9a-f]{64}$/.test(value))
      : [];
    const conversationEventRoots = Array.isArray(parsed.conversationEventRoots)
      ? parsed.conversationEventRoots.flatMap((value): Array<{ eventId: string; rootEventId: string }> => {
        const entry = parseStringRecord(value);
        return typeof entry.eventId === "string"
          && /^[0-9a-f]{64}$/.test(entry.eventId)
          && typeof entry.rootEventId === "string"
          && /^[0-9a-f]{64}$/.test(entry.rootEventId)
          ? [{ eventId: entry.eventId, rootEventId: entry.rootEventId }]
          : [];
      })
      : [];
    return { cursorTimestamp, processedEventIds, conversationEventRoots };
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      return { cursorTimestamp: 0, processedEventIds: [], conversationEventRoots: [] };
    }
    throw error;
  }
}

async function saveBuzzInteractionState(state: BuzzInteractionState): Promise<void> {
  await fs.mkdir(dataRoot(), { recursive: true });
  const target = buzzInteractionStatePath();
  const temporary = `${target}.${process.pid}.tmp`;
  const retainedEventIds = state.processedEventIds.slice(-adapterConfig().buzzCheckpointEventLimit);
  const retainedConversationEventRoots = state.conversationEventRoots.slice(-adapterConfig().buzzCheckpointEventLimit);
  await fs.writeFile(temporary, `${JSON.stringify({
    cursorTimestamp: Math.max(0, Math.trunc(state.cursorTimestamp)),
    processedEventIds: retainedEventIds,
    conversationEventRoots: retainedConversationEventRoots,
    updatedAt: nowUtcIso(),
  }, null, 2)}\n`, "utf8");
  await fs.rename(temporary, target);
}

function rememberBuzzConversationEvent(
  state: BuzzInteractionState,
  eventId: string | null,
  rootEventId: string,
): void {
  if (!eventId) return;
  state.conversationEventRoots = state.conversationEventRoots.filter((entry) => entry.eventId !== eventId);
  state.conversationEventRoots.push({ eventId, rootEventId });
}

function checkpointOverlapMinutes(): number {
  return parseIntEnv("SOURCE_CHECKPOINT_OVERLAP_MINUTES", 5, 0, 24 * 60);
}

function adapterConfig() {
  const sourceKind = (process.env.SOURCE_KIND ?? "discord").trim() || "discord";
  return {
    sourceKind,
    space: (process.env.SOURCE_SPACE ?? "community").trim() || "community",
    syncMode: (process.env.SOURCE_SYNC_MODE ?? "manual").trim() || "manual",
    prismApiBase: (process.env.PRISM_API_BASE ?? "").trim().replace(/\/+$/, ""),
    prismIngestPath: (process.env.PRISM_INGEST_PATH ?? "/ingest/messages").trim() || "/ingest/messages",
    discordGuildId: (process.env.DISCORD_GUILD_ID ?? "").trim(),
    discordWindowHours: parseIntEnv("DISCORD_SYNC_WINDOW_HOURS", 24, 1, 24 * 30),
    discordMaxMessagesPerChannel: parseIntEnv("DISCORD_MAX_MESSAGES_PER_CHANNEL", 200, 1, 1000),
    discordIncludeArchivedThreads: parseBoolEnv("DISCORD_INCLUDE_ARCHIVED_THREADS", false),
    discordIgnoreBotMessages: parseBoolEnv("DISCORD_IGNORE_BOT_MESSAGES", false),
    discordAttachmentTextEnabled: parseBoolEnv("DISCORD_ATTACHMENT_TEXT_ENABLED", true),
    discordEmbedTextEnabled: parseBoolEnv("DISCORD_EMBED_TEXT_ENABLED", true),
    discordAttachmentTextMaxBytes: parseIntEnv("DISCORD_ATTACHMENT_TEXT_MAX_BYTES", 200_000, 1, 2_000_000),
    discordAttachmentTextMaxChars: parseIntEnv("DISCORD_ATTACHMENT_TEXT_MAX_CHARS", 12_000, 500, 100_000),
    discordAttachmentTextMaxFilesPerMessage: parseIntEnv("DISCORD_ATTACHMENT_TEXT_MAX_FILES_PER_MESSAGE", 3, 0, 10),
    discordAttachmentFetchMaxBytes: parseIntEnv("DISCORD_ATTACHMENT_FETCH_MAX_BYTES", 50 * 1024 * 1024, 1, 500 * 1024 * 1024),
    discordChatEnabled: parseBoolEnv("DISCORD_CHAT_ENABLED", true),
    discordRegisterCommands: parseBoolEnv("DISCORD_REGISTER_COMMANDS", true),
    discordCommandGuildId: ((process.env.DISCORD_COMMAND_GUILD_ID ?? "").trim() || (process.env.DISCORD_GUILD_ID ?? "").trim()),
    discordApplicationId: (process.env.DISCORD_APPLICATION_ID ?? "").trim(),
    codexRuntimeRequestTimeoutSeconds: parseIntEnv("CODEX_RUNTIME_REQUEST_TIMEOUT_SECONDS", 660, 30, 3600),
    telegramDiscoveryEnabled: parseBoolEnv("TELEGRAM_DISCOVERY_ENABLED", Boolean((process.env.TELEGRAM_BOT_TOKEN ?? "").trim())),
    telegramDmEnabled: parseBoolEnv("TELEGRAM_DM_ENABLED", false),
    telegramPollIntervalSeconds: parseIntEnv("TELEGRAM_POLL_INTERVAL_SECONDS", 10, 2, 300),
    buzzEnabled: parseBoolEnv("BUZZ_ENABLED", sourceKind === "buzz"),
    buzzRelayUrl: (process.env.BUZZ_RELAY_URL ?? "").trim().replace(/\/+$/, ""),
    buzzPublicKey: (process.env.BUZZ_PUBLIC_KEY ?? "").trim().toLowerCase(),
    buzzChannelAllowlist: parseBuzzChannelAllowlist(process.env.BUZZ_CHANNEL_ALLOWLIST),
    buzzHistoryChannelAllowlist: parseBuzzChannelAllowlist(process.env.BUZZ_HISTORY_CHANNEL_ALLOWLIST),
    buzzWindowHours: parseIntEnv("BUZZ_SYNC_WINDOW_HOURS", 24, 1, 24 * 30),
    buzzMaxMessagesPerChannel: parseIntEnv("BUZZ_MAX_MESSAGES_PER_CHANNEL", 500, 1, 5000),
    buzzIgnoreOwnMessages: parseBoolEnv("BUZZ_IGNORE_OWN_MESSAGES", true),
    buzzCheckpointEventLimit: parseIntEnv("BUZZ_CHECKPOINT_EVENT_LIMIT", 10_000, 100, 100_000),
    buzzInteractionEnabled: parseBoolEnv("BUZZ_INTERACTION_ENABLED", false),
    buzzInteractionProfileKey: (process.env.BUZZ_INTERACTION_PROFILE_KEY ?? "").trim().toLowerCase(),
    buzzInteractionDisplayName: (process.env.BUZZ_INTERACTION_DISPLAY_NAME ?? "Prism").trim() || "Prism",
    buzzInteractionPollSeconds: parseIntEnv("BUZZ_INTERACTION_POLL_SECONDS", 5, 2, 300),
    buzzInteractionLookbackSeconds: parseIntEnv("BUZZ_INTERACTION_LOOKBACK_SECONDS", 3600, 30, 7 * 24 * 3600),
    buzzHistoryMaxLookbackSeconds: parseIntEnv("BUZZ_HISTORY_MAX_LOOKBACK_SECONDS", 7200, 60, 7 * 24 * 3600),
    buzzHistoryMaxMessages: parseIntEnv("BUZZ_HISTORY_MAX_MESSAGES", 100, 1, 1000),
    checkpointOverlapMinutes: checkpointOverlapMinutes(),
  };
}

function capabilitiesForMode(mode: DiscordAccessMode): string[] {
  switch (mode) {
    case "off":
      return [];
    case "readonly":
      return ["chat.read", "memory.read", "requests.read", "artifacts.read"];
    case "run-approved":
      return [
        "chat.read",
        "memory.read",
        "requests.read",
        "artifacts.read",
        "tasks.run_existing",
        "workflows.run_existing",
        "requests.create",
      ];
    case "full":
      return [
        "chat.read",
        "memory.read",
        "requests.read",
        "artifacts.read",
        "tasks.run_existing",
        "workflows.run_existing",
        "requests.create",
        "adapter.send_message",
        "memory.write",
        "knowledge.write",
        PROMOTE_DOC_CAPABILITY,
        "skills.author",
        "tasks.author",
        "workflows.author",
      ];
  }
}

function mergePolicyRule(
  current: ResolvedDiscordAccessPolicy,
  rule: DiscordAccessPolicyRule | undefined,
  matchedRule: string,
): ResolvedDiscordAccessPolicy {
  if (!rule) {
    return current;
  }

  const mode = rule.mode ?? current.mode;
  const modeChanged = Boolean(rule.mode && rule.mode !== current.mode);
  const capabilities = rule.capabilities ?? (modeChanged ? capabilitiesForMode(mode) : current.capabilities);
  const ruleLimit = rule.rateLimit
    ? {
        windowSeconds: rule.rateLimit.windowSeconds ?? current.rateLimit.windowSeconds,
        maxRequests: rule.rateLimit.maxRequests ?? current.rateLimit.maxRequests,
      }
    : current.rateLimit;

  return {
    mode,
    interactionProfileKey: rule.interactionProfileKey ?? (modeChanged ? null : current.interactionProfileKey),
    capabilities,
    skills: rule.skills ?? current.skills,
    rateLimit: ruleLimit,
    matchedRules: [...current.matchedRules, matchedRule],
  };
}

function parseAccessPolicyConfig(
  rawInput: unknown,
  defaults: { defaultMode: DiscordAccessMode; defaultRateLimit: DiscordRateLimitConfig },
): DiscordAccessPolicyConfig {
  const raw = parseStringRecord(rawInput);
  const defaultMode = parseAccessMode(raw.defaultMode ?? raw.default_mode, defaults.defaultMode);
  const defaultRateLimit = parseRateLimitConfig(raw.defaultRateLimit ?? raw.default_rate_limit, defaults.defaultRateLimit);

  const parseRules = (value: unknown) =>
    Object.fromEntries(
      Object.entries(parseStringRecord(value)).map(([key, rule]) => [key, parseAccessPolicyRule(rule)]),
    );

  return {
    defaultMode,
    defaultRateLimit,
    targets: parseRules(raw.targets ?? raw.channels),
    groups: parseRules(raw.groups ?? raw.roles),
    users: parseRules(raw.users),
  };
}

function defaultDiscordAccessPolicy(): DiscordAccessPolicyConfig {
  return parseAccessPolicyConfig({}, {
    defaultMode: "readonly",
    defaultRateLimit: {
      windowSeconds: parseIntEnv("DISCORD_RATE_LIMIT_WINDOW_SECONDS", 60, 1, 86_400),
      maxRequests: parseIntEnv("DISCORD_RATE_LIMIT_MAX_REQUESTS", 6, 1, 10_000),
    },
  });
}

function defaultTelegramAccessPolicy(): DiscordAccessPolicyConfig {
  return parseAccessPolicyConfig({}, {
    defaultMode: "off",
    defaultRateLimit: {
      windowSeconds: parseIntEnv("TELEGRAM_RATE_LIMIT_WINDOW_SECONDS", 60, 1, 86_400),
      maxRequests: parseIntEnv("TELEGRAM_RATE_LIMIT_MAX_REQUESTS", 6, 1, 10_000),
    },
  });
}

function defaultBuzzAccessPolicy(): DiscordAccessPolicyConfig {
  return parseAccessPolicyConfig({}, {
    defaultMode: "off",
    defaultRateLimit: {
      windowSeconds: parseIntEnv("BUZZ_RATE_LIMIT_WINDOW_SECONDS", 60, 1, 86_400),
      maxRequests: parseIntEnv("BUZZ_RATE_LIMIT_MAX_REQUESTS", 6, 1, 10_000),
    },
  });
}

function parseDiscordAccessPolicyConfig(rawInput: unknown): DiscordAccessPolicyConfig {
  return parseAccessPolicyConfig(rawInput, defaultDiscordAccessPolicy());
}

function parseTelegramAccessPolicyConfig(rawInput: unknown): DiscordAccessPolicyConfig {
  return parseAccessPolicyConfig(rawInput, defaultTelegramAccessPolicy());
}

function loadDiscordAccessPolicyConfigFromEnv(): DiscordAccessPolicyConfig {
  const raw = parseStringRecord(parseJsonEnv("DISCORD_ACCESS_POLICY_JSON"));
  return parseDiscordAccessPolicyConfig(raw);
}

async function loadSourceAdapterPlatformPolicies(): Promise<Record<string, DiscordAccessPolicyConfig>> {
  const now = Date.now();
  if (sourceAdapterPolicyCache && sourceAdapterPolicyCache.expiresAt > now) {
    return sourceAdapterPolicyCache.platforms;
  }

  try {
    const payload = await appApiRequest("/agent/source-adapter-policy");
    const policy = parseStringRecord(payload.policy);
    const platforms = parseStringRecord(policy.platforms);
    const parsedPlatforms = {
      discord: parseDiscordAccessPolicyConfig(platforms.discord),
      telegram: parseTelegramAccessPolicyConfig(platforms.telegram),
      buzz: parseAccessPolicyConfig(platforms.buzz, defaultBuzzAccessPolicy()),
    };
    sourceAdapterPolicyCache = {
      platforms: parsedPlatforms,
      expiresAt: now + 30_000,
    };
    return parsedPlatforms;
  } catch (error) {
    console.warn(`[source-adapter] using env/source defaults for access policy fallback: ${describeError(error)}`);
    const parsedPlatforms = {
      discord: loadDiscordAccessPolicyConfigFromEnv(),
      telegram: defaultTelegramAccessPolicy(),
      buzz: defaultBuzzAccessPolicy(),
    };
    sourceAdapterPolicyCache = {
      platforms: parsedPlatforms,
      expiresAt: now + 30_000,
    };
    return parsedPlatforms;
  }
}

async function loadDiscordAccessPolicyConfig(): Promise<DiscordAccessPolicyConfig> {
  const platforms = await loadSourceAdapterPlatformPolicies();
  return platforms.discord ?? defaultDiscordAccessPolicy();
}

async function loadTelegramAccessPolicyConfig(): Promise<DiscordAccessPolicyConfig> {
  const platforms = await loadSourceAdapterPlatformPolicies();
  return platforms.telegram ?? defaultTelegramAccessPolicy();
}

async function loadBuzzAccessPolicyConfig(): Promise<DiscordAccessPolicyConfig> {
  const platforms = await loadSourceAdapterPlatformPolicies();
  return platforms.buzz ?? defaultBuzzAccessPolicy();
}

async function resolveAgentProfileSurface(input: {
  surfaceType: "discord" | "telegram" | "buzz";
  surfaceKey: string;
  threadId?: string | null;
  userId: string;
  groupIds?: string[];
}): Promise<ResolvedDiscordAccessPolicy | null> {
  const query = new URLSearchParams({
    surfaceType: input.surfaceType,
    surfaceKey: input.surfaceKey,
    userId: input.userId,
  });
  if (input.threadId) query.set("threadId", input.threadId);
  for (const groupId of input.groupIds ?? []) query.append("groupId", groupId);
  const payload = await appApiRequest(`/agent/agent-profiles/resolve?${query.toString()}`);
  const resolved = parseStringRecord(payload.resolved);
  if (!Object.keys(resolved).length) return null;
  const rawProfile = parseStringRecord(resolved.profile);
  const rawPolicy = parseStringRecord(resolved.policy);
  const persona = parseStringRecord(rawProfile.persona);
  const memoryScope = parseStringRecord(rawProfile.memoryScope ?? rawProfile.memory_scope);
  const mode = parseAccessMode(rawPolicy.accessMode ?? rawPolicy.access_mode, "off");
  const rateLimit = parseRateLimitConfig(rawPolicy.rateLimit ?? rawPolicy.rate_limit, { windowSeconds: 60, maxRequests: 6 });
  const profileKey = typeof rawProfile.key === "string" ? rawProfile.key.trim() : "";
  if (!profileKey) throw new Error("Agent Profile resolution returned no profile key");
  const profile: ExternalInteractionAuthorization["profile"] = {
    key: profileKey,
    name: typeof rawProfile.name === "string" && rawProfile.name.trim() ? rawProfile.name.trim() : profileKey,
    mode,
    runtimeProfileKey: typeof rawProfile.runtimeProfileKey === "string" && rawProfile.runtimeProfileKey.trim()
      ? rawProfile.runtimeProfileKey.trim()
      : null,
    persona: {
      name: typeof persona.name === "string" && persona.name.trim() ? persona.name.trim() : null,
      instructions: typeof persona.instructions === "string" ? persona.instructions.trim() : "",
    },
    skills: Array.isArray(rawProfile.skills)
      ? rawProfile.skills.filter((value): value is string => typeof value === "string")
      : [],
    memoryScope: {
      knowledgeSourceIds: Array.isArray(memoryScope.knowledgeSourceIds) ? memoryScope.knowledgeSourceIds.filter((value): value is string => typeof value === "string") : [],
      buckets: Array.isArray(memoryScope.buckets) ? memoryScope.buckets.filter((value): value is string => typeof value === "string") : [],
      instructions: typeof memoryScope.instructions === "string" ? memoryScope.instructions.trim() : "",
      enforcement: "instructions-only",
    },
    allowedWorkflows: Array.isArray(rawPolicy.allowedWorkflows)
      ? rawPolicy.allowedWorkflows.filter((value): value is string => typeof value === "string")
      : [],
    rateLimit,
    version: typeof rawProfile.version === "number" && Number.isFinite(rawProfile.version) ? Math.trunc(rawProfile.version) : 1,
  };
  return {
    mode,
    interactionProfileKey: profile.key,
    capabilities: Array.isArray(rawPolicy.capabilities)
      ? rawPolicy.capabilities.filter((value): value is string => typeof value === "string")
      : capabilitiesForMode(mode),
    skills: profile.skills,
    rateLimit,
    matchedRules: Array.isArray(rawPolicy.matchedRules)
      ? rawPolicy.matchedRules.filter((value): value is string => typeof value === "string")
      : ["agent-profile-binding"],
    agentProfile: profile,
  };
}

async function resolveDiscordAccessPolicy(input: {
  channelId: string;
  threadId: string | null;
  authorId: string;
  roleIds: string[];
}): Promise<ResolvedDiscordAccessPolicy> {
  let agentResolutionFailed = false;
  const agentPolicy = await resolveAgentProfileSurface({
    surfaceType: "discord", surfaceKey: input.channelId, threadId: input.threadId,
    userId: input.authorId, groupIds: input.roleIds,
  }).catch((error) => {
    console.warn(`[source-adapter] Agent Profile binding resolution failed; using legacy compatibility: ${describeError(error)}`);
    agentResolutionFailed = true;
    return null;
  });
  if (agentPolicy) return agentPolicy;
  const config = await loadDiscordAccessPolicyConfig();
  let resolved: ResolvedDiscordAccessPolicy = {
    mode: config.defaultMode,
    interactionProfileKey: null,
    capabilities: capabilitiesForMode(config.defaultMode),
    skills: [],
    rateLimit: config.defaultRateLimit,
    matchedRules: ["default"],
  };

  resolved = mergePolicyRule(resolved, config.targets[input.channelId], `target:${input.channelId}`);
  if (input.threadId) {
    resolved = mergePolicyRule(resolved, config.targets[input.threadId], `target:${input.threadId}`);
  }
  for (const roleId of input.roleIds) {
    resolved = mergePolicyRule(resolved, config.groups[roleId], `group:${roleId}`);
  }
  resolved = mergePolicyRule(resolved, config.users[input.authorId], `user:${input.authorId}`);

  return { ...resolved, agentResolutionFailed };
}

async function resolveTelegramAccessPolicy(input: {
  chatId: string;
  authorId: string;
}): Promise<ResolvedDiscordAccessPolicy> {
  const agentPolicy = await resolveAgentProfileSurface({
    surfaceType: "telegram", surfaceKey: input.chatId, userId: input.authorId,
  }).catch((error) => {
    console.warn(`[source-adapter] Agent Profile binding resolution failed; using legacy compatibility: ${describeError(error)}`);
    return null;
  });
  if (agentPolicy) return agentPolicy;
  const config = await loadTelegramAccessPolicyConfig();
  let resolved: ResolvedDiscordAccessPolicy = {
    mode: config.defaultMode,
    interactionProfileKey: null,
    capabilities: capabilitiesForMode(config.defaultMode),
    skills: [],
    rateLimit: config.defaultRateLimit,
    matchedRules: ["default"],
  };

  resolved = mergePolicyRule(resolved, config.targets[input.chatId], `target:${input.chatId}`);
  resolved = mergePolicyRule(resolved, config.users[input.authorId], `user:${input.authorId}`);

  return resolved;
}

async function resolveBuzzAccessPolicy(input: {
  channelId: string;
  authorPubkey: string;
}): Promise<ResolvedDiscordAccessPolicy> {
  const agentPolicy = await resolveAgentProfileSurface({
    surfaceType: "buzz", surfaceKey: input.channelId, userId: input.authorPubkey,
  }).catch((error) => {
    console.warn(`[source-adapter] Agent Profile binding resolution failed; using legacy compatibility: ${describeError(error)}`);
    return null;
  });
  if (agentPolicy) return agentPolicy;
  const config = await loadBuzzAccessPolicyConfig();
  let resolved: ResolvedDiscordAccessPolicy = {
    mode: config.defaultMode,
    interactionProfileKey: null,
    capabilities: capabilitiesForMode(config.defaultMode),
    skills: [],
    rateLimit: config.defaultRateLimit,
    matchedRules: ["default"],
  };

  resolved = mergePolicyRule(resolved, config.targets[input.channelId], `target:${input.channelId}`);
  resolved = mergePolicyRule(resolved, config.users[input.authorPubkey], `user:${input.authorPubkey}`);
  return resolved;
}

async function listInteractiveBuzzChannels(client: BuzzCliClient) {
  const config = adapterConfig();
  const ceiling = new Set(config.buzzChannelAllowlist);
  const visible = (await client.listVisibleChannels()).filter((channel) => (
    ceiling.size === 0 || ceiling.has(channel.channelId)
  ));
  const resolved = await Promise.all(visible.map(async (channel) => ({
    channel,
    policy: await resolveBuzzAccessPolicy({ channelId: channel.channelId, authorPubkey: "" }),
  })));
  return resolved.filter(({ policy }) => policy.mode !== "off").map(({ channel }) => channel);
}

function checkDiscordRateLimit(key: string, limit: DiscordRateLimitConfig): { ok: true } | { ok: false; retryAfterSeconds: number } {
  const now = Date.now();
  const windowMs = limit.windowSeconds * 1000;
  for (const [bucketKey, bucket] of discordRateLimitBuckets) {
    if (now - bucket.windowStartMs >= windowMs) {
      discordRateLimitBuckets.delete(bucketKey);
    }
  }
  const bucket = discordRateLimitBuckets.get(key);
  if (!bucket || now - bucket.windowStartMs >= windowMs) {
    discordRateLimitBuckets.set(key, { windowStartMs: now, count: 1 });
    return { ok: true };
  }
  if (bucket.count >= limit.maxRequests) {
    return {
      ok: false,
      retryAfterSeconds: Math.max(1, Math.ceil((windowMs - (now - bucket.windowStartMs)) / 1000)),
    };
  }
  bucket.count += 1;
  return { ok: true };
}

function checkpointKey(config: AdapterConfig): string {
  const guildId = config.discordGuildId || "default";
  return `${config.sourceKind}:${config.space}:${guildId}`;
}

async function currentCheckpoint(config: AdapterConfig): Promise<JsonObject | null> {
  const checkpoints = await loadCheckpoints();
  const value = checkpoints[checkpointKey(config)];
  if (!value || Array.isArray(value) || typeof value !== "object") {
    return null;
  }
  return value as JsonObject;
}

function parseIsoDate(value: string): Date {
  const normalized = value.endsWith("Z") ? value : `${value.replace(/\+00:00$/, "")}Z`;
  return new Date(normalized);
}

function buildMessageAuthor(message: JsonObject): DiscordAuthor {
  const author = (message.author && typeof message.author === "object" ? message.author : {}) as JsonObject;
  const member = (message.member && typeof message.member === "object" ? message.member : {}) as JsonObject;
  return {
    id: typeof author.id === "string" ? author.id : null,
    username: typeof author.username === "string" ? author.username : null,
    displayName:
      (typeof member.nick === "string" && member.nick) ||
      (typeof author.global_name === "string" && author.global_name) ||
      (typeof author.username === "string" ? author.username : null),
    bot: Boolean(author.bot),
  };
}

function cleanMultilineText(value: string): string {
  return value.replace(/\r\n/g, "\n").replace(/\r/g, "\n").trim();
}

function attachmentIsTextLike(attachment: JsonObject): boolean {
  const filename = String(attachment.filename ?? "").toLowerCase();
  const contentType = String(attachment.content_type ?? "").toLowerCase();
  const suffix = path.extname(filename).toLowerCase();
  if (TEXT_ATTACHMENT_EXTENSIONS.has(suffix)) {
    return true;
  }
  return (
    contentType.startsWith("text/") ||
    new Set(["application/json", "application/x-yaml", "application/yaml"]).has(contentType)
  );
}

function attachmentUrlAllowed(url: string): boolean {
  try {
    const hostname = new URL(url).hostname.toLowerCase();
    return DISCORD_ATTACHMENT_HOST_SUFFIXES.some((suffix) => hostname === suffix || hostname.endsWith(`.${suffix}`));
  } catch {
    return false;
  }
}

async function readAttachmentText(attachment: JsonObject, config: AdapterConfig): Promise<AttachmentText | null> {
  if (!config.discordAttachmentTextEnabled || !attachmentIsTextLike(attachment)) {
    return null;
  }
  const url = String(attachment.url ?? "").trim();
  const filename = String(attachment.filename ?? "").trim();
  if (!url || !filename || !attachmentUrlAllowed(url)) {
    return null;
  }

  const size = typeof attachment.size === "number" ? attachment.size : Number(attachment.size ?? NaN);
  const sizeValue = Number.isFinite(size) ? size : null;
  if (sizeValue !== null && sizeValue > config.discordAttachmentTextMaxBytes) {
    return { filename, url, status: "skipped_too_large", size: sizeValue };
  }

  const headers = new Headers({ "User-Agent": "prism-source-adapter/1.0" });
  if (new URL(url).hostname.includes("discord") && process.env.DISCORD_BOT_TOKEN) {
    headers.set("Authorization", `Bot ${process.env.DISCORD_BOT_TOKEN}`);
  }

  try {
    const response = await fetch(url, { headers });
    if (!response.ok) {
      return { filename, url, status: "fetch_failed", error: `${response.status} ${response.statusText}` };
    }
    const body = new Uint8Array(await response.arrayBuffer());
    let truncated = body.byteLength > config.discordAttachmentTextMaxBytes;
    const limited = truncated ? body.slice(0, config.discordAttachmentTextMaxBytes) : body;
    const text = cleanMultilineText(Buffer.from(limited).toString("utf8"));
    if (!text) {
      return { filename, url, status: "empty" };
    }
    const limitedText = text.slice(0, config.discordAttachmentTextMaxChars).trim();
    if (limitedText.length < text.length) {
      truncated = true;
    }
    return { filename, url, status: "ok", size: sizeValue, truncated, text: limitedText };
  } catch (error) {
    return { filename, url, status: "fetch_failed", error: describeError(error) };
  }
}

function renderDiscordMessageText(baseText: string, embeds: JsonObject[], attachmentTexts: AttachmentText[], config: AdapterConfig): string {
  const sections: string[] = [];
  const cleanedBase = cleanMultilineText(baseText);
  if (cleanedBase) {
    sections.push(cleanedBase);
  }

  if (config.discordEmbedTextEnabled) {
    const embedLines = embeds
      .map((embed) => [embed.title, embed.description, embed.url].filter((part) => typeof part === "string" && part.trim()).join(" | "))
      .filter(Boolean)
      .map((line) => `- ${line}`);
    if (embedLines.length > 0) {
      sections.push(`Embeds:\n${embedLines.join("\n")}`);
    }
  }

  const extracted = attachmentTexts.filter((item) => item.status === "ok" && item.text?.trim());
  if (extracted.length > 0) {
    sections.push(
      extracted
        .map((item) => `Attachment: ${item.filename}${item.truncated ? " (truncated)" : ""}\n\`\`\`text\n${item.text}\n\`\`\``)
        .join("\n\n"),
    );
  }

  return sections.join("\n\n").trim();
}

function stringField(record: JsonObject, key: string): string {
  const value = record[key];
  return typeof value === "string" ? value.trim() : "";
}

function numberField(record: JsonObject, key: string): number | null {
  const value = record[key];
  if (typeof value === "number" && Number.isFinite(value)) {
    return value;
  }
  if (typeof value === "string" && value.trim()) {
    const parsed = Number.parseInt(value, 10);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

async function fetchDiscordAttachment(input: {
  channelId: string;
  messageId: string;
  attachmentId: string;
}): Promise<AttachmentFetchResult> {
  const config = adapterConfig();
  const message = await discordApiRequest<JsonObject>(
    `/channels/${encodeURIComponent(input.channelId)}/messages/${encodeURIComponent(input.messageId)}`,
  );
  const attachments = Array.isArray(message.attachments)
    ? message.attachments.filter((item): item is JsonObject => Boolean(item) && typeof item === "object" && !Array.isArray(item))
    : [];
  const attachment = attachments.find((item) => stringField(item, "id") === input.attachmentId);
  if (!attachment) {
    throw new Error("ATTACHMENT_NOT_FOUND");
  }

  const url = stringField(attachment, "url");
  if (!url || !attachmentUrlAllowed(url)) {
    throw new Error("ATTACHMENT_URL_NOT_ALLOWED");
  }
  const filename = stringField(attachment, "filename") || "attachment";
  const size = numberField(attachment, "size");
  if (size !== null && size > config.discordAttachmentFetchMaxBytes) {
    throw new Error(`ATTACHMENT_TOO_LARGE:${size}:${config.discordAttachmentFetchMaxBytes}`);
  }

  const headers = new Headers({ "User-Agent": "prism-source-adapter/1.0" });
  if (new URL(url).hostname.includes("discord") && process.env.DISCORD_BOT_TOKEN) {
    headers.set("Authorization", `Bot ${process.env.DISCORD_BOT_TOKEN}`);
  }
  const response = await fetch(url, { headers });
  if (!response.ok) {
    throw new Error(`ATTACHMENT_FETCH_FAILED:${response.status}:${response.statusText}`);
  }
  const body = Buffer.from(await response.arrayBuffer());
  if (body.byteLength > config.discordAttachmentFetchMaxBytes) {
    throw new Error(`ATTACHMENT_TOO_LARGE:${body.byteLength}:${config.discordAttachmentFetchMaxBytes}`);
  }

  const contentType =
    stringField(attachment, "content_type") ||
    response.headers.get("content-type")?.trim() ||
    "application/octet-stream";
  const width = numberField(attachment, "width");
  const height = numberField(attachment, "height");
  const metadata: JsonObject = {
    platform: "discord",
    channelId: input.channelId,
    messageId: input.messageId,
    attachmentId: input.attachmentId,
    filename,
    contentType,
    size: size ?? body.byteLength,
    url,
    sourceUrlDurable: false,
    messageUrl: config.discordGuildId
      ? discordMessageUrl(config.discordGuildId, input.channelId, input.messageId)
      : null,
    width,
    height,
    fetchedAt: nowUtcIso(),
  };

  return {
    body,
    metadata,
    contentType,
    filename,
  };
}

async function resolveDiscordMessageAttachments(input: {
  channelId: string;
  messageId: string;
}): Promise<{ message: JsonObject; attachments: AttachmentSummary[] }> {
  const config = adapterConfig();
  const message = await discordApiRequest<JsonObject>(
    `/channels/${encodeURIComponent(input.channelId)}/messages/${encodeURIComponent(input.messageId)}`,
  );
  const attachments = Array.isArray(message.attachments)
    ? message.attachments.filter((item): item is JsonObject => Boolean(item) && typeof item === "object" && !Array.isArray(item))
    : [];
  return {
    message: {
      id: input.messageId,
      channelId: input.channelId,
      messageUrl: config.discordGuildId
        ? discordMessageUrl(config.discordGuildId, input.channelId, input.messageId)
        : null,
      author: buildMessageAuthor(message),
      timestamp: stringField(message, "timestamp") || null,
      text: stringField(message, "content"),
    },
    attachments: attachments.map((attachment) => {
      const id = stringField(attachment, "id");
      const filename = stringField(attachment, "filename") || "attachment";
      const contentType = stringField(attachment, "content_type") || null;
      return {
        id,
        filename,
        contentType,
        size: numberField(attachment, "size"),
        url: stringField(attachment, "url") || null,
        width: numberField(attachment, "width"),
        height: numberField(attachment, "height"),
        textLike: attachmentIsTextLike(attachment),
      };
    }).filter((attachment) => attachment.id),
  };
}

function appApiBaseUrl(): string {
  const direct = (process.env.APP_API_BASE_URL ?? "").trim().replace(/\/+$/, "");
  if (direct) {
    return direct;
  }
  const railway = (process.env.RAILWAY_SERVICE_API_URL ?? "").trim();
  if (railway) {
    return `https://${railway.replace(/\/+$/, "")}`;
  }
  throw new Error("APP_API_BASE_URL is required");
}

function appApiServiceToken(): string {
  const token =
    (process.env.APP_API_SERVICE_TOKEN ?? "").trim() ||
    (process.env.INTERNAL_SERVICE_TOKEN ?? "").trim() ||
    (process.env.SERVICE_SHARED_TOKEN ?? "").trim();
  if (!token) {
    throw new Error("APP_API_SERVICE_TOKEN or INTERNAL_SERVICE_TOKEN is required");
  }
  return token;
}

function prismApiBaseUrl(): string {
  const baseUrl = (process.env.PRISM_API_BASE ?? "").trim().replace(/\/+$/, "");
  if (!baseUrl) {
    throw new Error("PRISM_API_BASE is required");
  }
  return baseUrl;
}

function prismArtifactBaseUrl(): string {
  return (process.env.PRISM_ARTIFACT_PUBLIC_BASE_URL ?? "").trim().replace(/\/+$/, "") || prismApiBaseUrl();
}

function prismApiKey(): string {
  const apiKey = (process.env.PRISM_API_KEY ?? "").trim();
  if (!apiKey) {
    throw new Error("PRISM_API_KEY is required");
  }
  return apiKey;
}

async function appApiRequest(pathname: string, init: RequestInit = {}): Promise<JsonObject> {
  const response = await fetch(`${appApiBaseUrl()}${pathname}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${appApiServiceToken()}`,
      ...(init.body ? { "Content-Type": "application/json" } : {}),
      ...(init.headers ?? {}),
    },
  });
  if (!response.ok) {
    throw new AppApiRequestError(response.status, await response.text());
  }
  return (await response.json()) as JsonObject;
}

async function lookupDiscordSession(discordChannelId: string | null, discordThreadId: string | null, limit = 25): Promise<JsonObject | null> {
  const params = new URLSearchParams({
    channelId: discordChannelId ?? "",
    threadId: discordThreadId ?? "",
    limit: String(limit),
  });
  try {
    return await appApiRequest(`/agent/agent-sessions/discord/lookup?${params.toString()}`);
  } catch (error) {
    if (isAppApiNotFound(error)) return null;
    throw error;
  }
}

async function lookupSourceSession(source: string, contextKey: string, limit = 25): Promise<JsonObject | null> {
  const params = new URLSearchParams({
    source,
    contextKey,
    limit: String(limit),
  });
  try {
    return await appApiRequest(`/agent/agent-sessions/source/lookup?${params.toString()}`);
  } catch (error) {
    if (isAppApiNotFound(error)) return null;
    throw error;
  }
}

async function upsertDiscordSession(input: {
  title: string;
  discordGuildId: string;
  discordChannelId: string;
  discordThreadId: string | null;
  meta: JsonObject;
  lastMessageAt: string;
}): Promise<JsonObject> {
  const payload = await appApiRequest("/agent/agent-sessions/discord/upsert", {
    method: "POST",
    body: JSON.stringify({
      source: "discord",
      status: "active",
      title: input.title,
      discordGuildId: input.discordGuildId,
      discordChannelId: input.discordChannelId,
      discordThreadId: input.discordThreadId,
      meta: input.meta,
      lastMessageAt: input.lastMessageAt,
    }),
  });
  return payload.session as JsonObject;
}

async function upsertSourceSession(input: {
  source: string;
  contextKey: string;
  title: string;
  meta: JsonObject;
  lastMessageAt: string;
}): Promise<JsonObject> {
  const payload = await appApiRequest("/agent/agent-sessions/source/upsert", {
    method: "POST",
    body: JSON.stringify({
      source: input.source,
      contextKey: input.contextKey,
      status: "active",
      title: input.title,
      meta: input.meta,
      lastMessageAt: input.lastMessageAt,
    }),
  });
  return payload.session as JsonObject;
}

async function appendSessionMessage(input: {
  sessionId: string;
  role: string;
  source: string;
  sourceMessageId: string | null;
  content: string;
  meta: JsonObject;
  createdAt: string;
}): Promise<void> {
  await appApiRequest(`/agent/agent-sessions/${input.sessionId}/messages`, {
    method: "POST",
    body: JSON.stringify({
      role: input.role,
      source: input.source,
      sourceMessageId: input.sourceMessageId,
      content: input.content,
      meta: input.meta,
      createdAt: input.createdAt,
    }),
  });
}

type RuntimeCredentialDescriptor = { key: string };

async function resolveInteractiveGatewayCredentials(input: {
  platform: "discord" | "telegram" | "buzz";
  targetId: string;
  threadId?: string | null;
  groupIds?: string[];
  userId: string;
}): Promise<RuntimeCredentialDescriptor[]> {
  try {
    const payload = await appApiRequest("/agent/gateway/interactive-credentials", {
      method: "POST",
      body: JSON.stringify(input),
    });
    const credentials = (Array.isArray(payload.credentials) ? payload.credentials : []).flatMap((entry): RuntimeCredentialDescriptor[] => {
      const record = entry && typeof entry === "object" && !Array.isArray(entry) ? entry as JsonObject : {};
      const key = typeof entry === "string" ? entry.trim() : typeof record.key === "string" ? record.key.trim() : "";
      return /^[a-zA-Z][a-zA-Z0-9_.:-]{0,119}$/.test(key) ? [{ key }] : [];
    });
    return Array.from(new Map(credentials.map((descriptor) => [descriptor.key, descriptor])).values());
  } catch (error) {
    console.warn("[source-adapter] interactive Gateway credentials unavailable; continuing without them", describeError(error));
    return [];
  }
}

async function runtimeRequest(input: {
  prompt: string;
  sessionId: string;
  continuationId: string | null;
  recentHistory: Array<{ role: string; content: string }>;
  credentials?: RuntimeCredentialDescriptor[];
  skills?: string[];
  gatewayContext?: JsonObject;
  metadata: JsonObject;
  runtimeProfileKey?: string | null;
}): Promise<{ responseText: string; continuationId: string | null; provider: string | null; runtimeKey: string | null }> {
  const timeoutMs = adapterConfig().codexRuntimeRequestTimeoutSeconds * 1000;
  const requestedSkills = Array.isArray(input.metadata.requestedSkills)
    ? input.metadata.requestedSkills.filter((value): value is string => typeof value === "string" && Boolean(value.trim()))
    : [];
  const result = await requestSiteRuntime({
    prompt: input.prompt,
    sessionId: input.sessionId,
    continuationId: input.continuationId,
    recentHistory: input.recentHistory,
    credentials: input.credentials ?? [],
    skills: [...new Set([...(input.skills ?? []), ...requestedSkills])],
    context: input.gatewayContext ?? {},
    metadata: input.metadata,
    runtimeProfileKey: input.runtimeProfileKey ?? null,
    timeoutMs,
  });
  return {
    responseText: result.responseText,
    continuationId: result.continuationId,
    provider: result.provider,
    runtimeKey: result.runtimeKey,
  };
}

type ExternalInteractionAuthorization = {
  interface: {
    key: string;
    name: string;
    enabled: boolean;
    interactionProfileKey: string;
  };
  profile: {
    key: string;
    name: string;
    mode: DiscordAccessMode;
    runtimeProfileKey: string | null;
    persona: { name: string | null; instructions: string };
    skills: string[];
    memoryScope?: AdvisoryMemoryScope;
    allowedWorkflows: string[];
    rateLimit: DiscordRateLimitConfig;
    version: number;
  };
  credentials: RuntimeCredentialDescriptor[];
};

class ExternalInteractionHttpError extends Error {
  constructor(readonly status: number, message: string) {
    super(message);
  }
}

function externalInterfaceCredential(request: Request) {
  const explicit = request.header("X-Prism-Interface-Key")?.trim();
  if (explicit) return explicit;
  const authorization = request.header("Authorization")?.trim() ?? "";
  return authorization.toLowerCase().startsWith("bearer ") ? authorization.slice(7).trim() : "";
}

function safeExternalHeader(value: string | undefined, maxLength: number) {
  return (value ?? "").trim().slice(0, maxLength);
}

async function authorizeExternalInteraction(
  request: Request,
  interfaceKey: string,
  requestId: string,
): Promise<ExternalInteractionAuthorization> {
  const credential = externalInterfaceCredential(request);
  const response = await fetch(
    `${appApiBaseUrl()}/agent/external-interfaces/${encodeURIComponent(interfaceKey)}/authorize`,
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${appApiServiceToken()}`,
        "x-prism-interface-credential": credential,
        "x-prism-request-id": requestId,
        ...(request.header("origin") ? { "x-prism-interface-origin": safeExternalHeader(request.header("origin"), 500) } : {}),
        ...(request.header("x-prism-external-subject")
          ? { "x-prism-external-subject": safeExternalHeader(request.header("x-prism-external-subject"), 300) }
          : {}),
      },
    },
  );
  const payload = await response.json().catch(() => null) as {
    error?: unknown;
    code?: unknown;
    resolved?: unknown;
    credentials?: unknown;
  } | null;
  if (!response.ok) {
    throw new ExternalInteractionHttpError(
      response.status,
      typeof payload?.code === "string" ? payload.code : "EXTERNAL_INTERFACE_AUTHORIZATION_FAILED",
    );
  }
  const resolved = payload?.resolved;
  if (!resolved || typeof resolved !== "object" || Array.isArray(resolved)) {
    throw new ExternalInteractionHttpError(502, "EXTERNAL_INTERFACE_AUTHORIZATION_INVALID");
  }
  const credentials = (Array.isArray(payload?.credentials) ? payload.credentials : []).flatMap((entry): RuntimeCredentialDescriptor[] => {
    const record = entry && typeof entry === "object" && !Array.isArray(entry) ? entry as JsonObject : {};
    const key = typeof entry === "string" ? entry.trim() : typeof record.key === "string" ? record.key.trim() : "";
    return /^[a-zA-Z][a-zA-Z0-9_.:-]{0,119}$/.test(key) ? [{ key }] : [];
  });
  return {
    ...resolved as Omit<ExternalInteractionAuthorization, "credentials">,
    credentials: Array.from(new Map(credentials.map((descriptor) => [descriptor.key, descriptor])).values()),
  };
}

function checkExternalInteractionRateLimit(
  key: string,
  limit: DiscordRateLimitConfig,
): { ok: true } | { ok: false; retryAfterSeconds: number } {
  return externalInteractionRateLimiter.check(key, limit);
}

function externalInteractionPolicyInstructions(authorization: ExternalInteractionAuthorization) {
  const persona = authorization.profile.persona.instructions.trim();
  const memory = buildAdvisoryMemoryInstructions(externalInteractionMemoryScope(authorization));
  const access = authorization.profile.mode === "readonly"
    ? "This external interaction is readonly. Do not call writer endpoints, create or mutate tasks/workflows/skills/requests, send messages, or modify repositories. Answer only from available approved context."
    : authorization.profile.mode === "run-approved"
      ? `This external interaction may run only these existing workflows through an explicit adapter action: ${authorization.profile.allowedWorkflows.join(", ") || "none"}. Do not author workflows or perform broad administrative changes.`
      : "This external interaction is trusted for full agent behavior, including normal trusted-run credential access, subject to normal Prism safeguards.";
  return [persona, memory, access].filter(Boolean).join("\n\n");
}

function externalInteractionMemoryScope(authorization: ExternalInteractionAuthorization): AdvisoryMemoryScope {
  return authorization.profile.memoryScope ?? {
    knowledgeSourceIds: [],
    buckets: [],
    instructions: "",
    enforcement: "instructions-only",
  };
}

async function loadInteractionProfile(
  profileKey: string,
  expectedMode: DiscordAccessMode,
): Promise<ExternalInteractionAuthorization["profile"]> {
  const normalizedKey = profileKey.trim().toLowerCase();
  if (!/^[a-z0-9][a-z0-9._-]{0,119}$/.test(normalizedKey)) {
    throw new Error("Source policy must specify a valid interactionProfileKey");
  }
  const cached = interactionProfileCache.get(normalizedKey);
  if (cached && cached.expiresAt > Date.now()) {
    if (cached.profile.mode !== expectedMode) {
      throw new Error(`Source policy mode ${expectedMode} does not match profile ${normalizedKey} mode ${cached.profile.mode}`);
    }
    return cached.profile;
  }
  const payload = await appApiRequest(
    `/agent/interaction-profiles/${encodeURIComponent(normalizedKey)}`,
  );
  const raw = parseStringRecord(payload.profile);
  const mode = raw.mode;
  if (mode !== "readonly" && mode !== "run-approved" && mode !== "full") {
    throw new Error(`Interaction profile has an invalid mode: ${String(mode || "missing")}`);
  }
  if (mode !== expectedMode) {
    throw new Error(`Source policy mode ${expectedMode} does not match profile ${normalizedKey} mode ${mode}`);
  }
  const persona = parseStringRecord(raw.persona);
  const memoryScope = parseStringRecord(raw.memoryScope ?? raw.memory_scope);
  const rateLimit = parseRateLimitConfig(raw.rateLimit ?? raw.rate_limit, { windowSeconds: 60, maxRequests: 6 });
  const version = typeof raw.version === "number" && Number.isFinite(raw.version) ? Math.trunc(raw.version) : 1;
  const profile: ExternalInteractionAuthorization["profile"] = {
    key: typeof raw.key === "string" && raw.key.trim() ? raw.key.trim() : normalizedKey,
    name: typeof raw.name === "string" && raw.name.trim() ? raw.name.trim() : normalizedKey,
    mode,
    runtimeProfileKey: typeof raw.runtimeProfileKey === "string" && raw.runtimeProfileKey.trim()
      ? raw.runtimeProfileKey.trim()
      : null,
    persona: {
      name: typeof persona.name === "string" && persona.name.trim() ? persona.name.trim() : null,
      instructions: typeof persona.instructions === "string" ? persona.instructions.trim() : "",
    },
    skills: Array.isArray(raw.skills)
      ? raw.skills.filter((value): value is string => typeof value === "string")
      : [],
    memoryScope: {
      knowledgeSourceIds: Array.isArray(memoryScope.knowledgeSourceIds)
        ? memoryScope.knowledgeSourceIds.filter((value): value is string => typeof value === "string")
        : [],
      buckets: Array.isArray(memoryScope.buckets)
        ? memoryScope.buckets.filter((value): value is string => typeof value === "string")
        : [],
      instructions: typeof memoryScope.instructions === "string" ? memoryScope.instructions.trim() : "",
      enforcement: "instructions-only",
    },
    allowedWorkflows: Array.isArray(raw.allowedWorkflows)
      ? raw.allowedWorkflows.filter((value): value is string => typeof value === "string")
      : [],
    rateLimit,
    version,
  };
  interactionProfileCache.set(normalizedKey, { profile, expiresAt: Date.now() + 30_000 });
  return profile;
}

async function referencedInteractionProfile(accessPolicy: ResolvedDiscordAccessPolicy) {
  if (accessPolicy.agentProfile) return accessPolicy.agentProfile;
  if (!accessPolicy.interactionProfileKey) return null;
  return loadInteractionProfile(accessPolicy.interactionProfileKey, accessPolicy.mode);
}

function communicationProfileInstructions(
  profile: ExternalInteractionAuthorization["profile"] | null,
  accessPolicy: ResolvedDiscordAccessPolicy,
) {
  if (profile) return externalInteractionPolicyInstructions(buzzInteractionAuthorization(profile, []));
  return accessPolicy.mode === "readonly"
    ? "This session is readonly. Do not call writer endpoints, create or mutate tasks/workflows/skills/requests, send adapter messages beyond this reply, or modify repositories. Answer from available context only."
    : accessPolicy.mode === "run-approved"
      ? "This session may run existing approved tasks or workflows, but must not author new skills/tasks/workflows or perform broad administrative changes."
      : "This session is trusted for full agent behavior, subject to normal Prism safeguards.";
}

function buzzInteractionAuthorization(
  profile: ExternalInteractionAuthorization["profile"],
  credentials: RuntimeCredentialDescriptor[],
): ExternalInteractionAuthorization {
  return {
    interface: {
      key: `buzz:${profile.key}`,
      name: "Buzz",
      enabled: true,
      interactionProfileKey: profile.key,
    },
    profile,
    credentials,
  };
}

function externalSessionMeta(value: unknown): JsonObject {
  const session = value && typeof value === "object" && !Array.isArray(value) ? value as JsonObject : {};
  return session.meta && typeof session.meta === "object" && !Array.isArray(session.meta)
    ? session.meta as JsonObject
    : {};
}

async function discordApiRequest<T extends JsonValue>(
  pathname: string,
  params?: Record<string, string | number | undefined>,
  init: RequestInit = {},
): Promise<T> {
  const token = (process.env.DISCORD_BOT_TOKEN ?? "").trim();
  if (!token) {
    throw new Error("DISCORD_BOT_TOKEN is required for Discord adapter operations");
  }
  const url = new URL(`${DISCORD_API_BASE}${pathname}`);
  for (const [key, value] of Object.entries(params ?? {})) {
    if (value !== undefined && value !== null && `${value}` !== "") {
      url.searchParams.set(key, String(value));
    }
  }
  const response = await fetch(url, {
    ...init,
    headers: {
      Authorization: `Bot ${token}`,
      "Content-Type": "application/json",
      "User-Agent": "prism-source-adapter/0.1",
      ...(init.headers ?? {}),
    },
  });
  if (!response.ok) {
    throw new Error(`Discord API failed: ${response.status} ${pathname} ${(await response.text()).slice(0, 200)}`);
  }
  return (await response.json()) as T;
}

async function telegramApiRequest<T extends JsonValue>(
  method: string,
  body?: Record<string, unknown>,
): Promise<T> {
  const token = (process.env.TELEGRAM_BOT_TOKEN ?? "").trim();
  if (!token) {
    throw new Error("TELEGRAM_BOT_TOKEN is required for Telegram adapter operations");
  }
  const response = await fetch(`${TELEGRAM_API_BASE}/bot${token}/${method}`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "User-Agent": "prism-source-adapter/0.1",
    },
    body: JSON.stringify(body ?? {}),
  });
  const text = await response.text();
  let payload: JsonObject | null = null;
  try {
    payload = text ? JSON.parse(text) as JsonObject : null;
  } catch {
    payload = null;
  }
  const ok = payload && typeof payload.ok === "boolean" ? payload.ok : response.ok;
  if (!response.ok || !ok) {
    const description = typeof payload?.description === "string" ? payload.description : text.slice(0, 200);
    throw new Error(`Telegram API failed: ${response.status} ${method} ${description}`);
  }
  return (payload?.result ?? payload) as T;
}

function buzzClient(channelAllowlist?: string[]): BuzzCliClient {
  const config = adapterConfig();
  if (!config.buzzEnabled) {
    throw new Error("Buzz adapter is disabled");
  }
  return new BuzzCliClient({
    relayUrl: config.buzzRelayUrl,
    privateKey: (process.env.BUZZ_PRIVATE_KEY ?? "").trim(),
    publicKey: config.buzzPublicKey,
    channelAllowlist: channelAllowlist ?? config.buzzChannelAllowlist,
    maxMessagesPerChannel: config.buzzMaxMessagesPerChannel,
    ignoreOwnMessages: config.buzzIgnoreOwnMessages,
    command: (process.env.BUZZ_CLI_PATH ?? "buzz").trim() || "buzz",
    timeoutMs: parseIntEnv("BUZZ_CLI_TIMEOUT_SECONDS", 30, 5, 300) * 1000,
  });
}

function constantTimeTokenMatches(candidate: string, expected: string): boolean {
  const candidateBytes = Buffer.from(candidate);
  const expectedBytes = Buffer.from(expected);
  return candidateBytes.length === expectedBytes.length && timingSafeEqual(candidateBytes, expectedBytes);
}

function requireBuzzChannelAdminToken(request: Request): void {
  const expected = (process.env.BUZZ_CHANNEL_ADMIN_TOKEN ?? "").trim();
  if (!expected) throw new Error("BUZZ_CHANNEL_ADMIN_NOT_CONFIGURED");
  const candidate = request.header("X-Buzz-Admin-Token")?.trim() ?? "";
  if (!candidate || !constantTimeTokenMatches(candidate, expected)) throw new Error("Unauthorized");
}

function requireInternalServiceToken(request: Request): void {
  const expected = (process.env.INTERNAL_SERVICE_TOKEN ?? "").trim();
  if (!expected) throw new Error("INTERNAL_SERVICE_TOKEN_NOT_CONFIGURED");
  const candidate = request.header("x-service-token")?.trim() ?? "";
  if (!candidate || !constantTimeTokenMatches(candidate, expected)) throw new Error("Unauthorized");
}

function buzzHistoryStatus(message: string): number {
  if (message === "Unauthorized") return 401;
  if (message === "BUZZ_HISTORY_NOT_CONFIGURED" || message === "INTERNAL_SERVICE_TOKEN_NOT_CONFIGURED") return 503;
  if (message === "BUZZ_HISTORY_CHANNEL_FORBIDDEN") return 403;
  if (message.includes("must be") || message.includes("exceeds") || message.includes("required")) return 400;
  return 502;
}

function parseBuzzHistorySince(value: unknown, maxLookbackSeconds: number, now: Date): Date {
  if (value === undefined || value === null || value === "") {
    return new Date(now.getTime() - maxLookbackSeconds * 1000);
  }
  const normalized = String(value).trim();
  const parsed = /^\d+$/.test(normalized)
    ? new Date(Number(normalized) * 1000)
    : new Date(normalized);
  if (!Number.isFinite(parsed.getTime())) throw new Error("since must be an ISO timestamp or Unix timestamp in seconds");
  if (parsed.getTime() > now.getTime()) throw new Error("since must not be in the future");
  if (now.getTime() - parsed.getTime() > maxLookbackSeconds * 1000) {
    throw new Error(`since exceeds the maximum lookback of ${maxLookbackSeconds} seconds`);
  }
  return parsed;
}

function parseBuzzHistoryLimit(value: unknown, maxMessages: number): number {
  if (value === undefined || value === null || value === "") return Math.min(50, maxMessages);
  const limit = Number(value);
  if (!Number.isSafeInteger(limit) || limit < 1 || limit > maxMessages) {
    throw new Error(`limit must be an integer from 1 to ${maxMessages}`);
  }
  return limit;
}

function buzzChannelAdminStatus(message: string): number {
  if (message === "Unauthorized") return 401;
  if (message === "BUZZ_CHANNEL_ADMIN_NOT_CONFIGURED") return 503;
  if (message.includes("required") || message.includes("must be") || message.includes("cannot be") || message.includes("at least one")) return 400;
  return 500;
}

function buzzChannelUuid(value: unknown): string {
  const channelId = typeof value === "string" ? value.trim().toLowerCase() : "";
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(channelId)) {
    throw new Error("channelId must be a UUID");
  }
  return channelId;
}

function buzzChannelPubkey(value: unknown): string {
  const pubkey = typeof value === "string" ? value.trim().toLowerCase() : "";
  if (!/^[0-9a-f]{64}$/.test(pubkey)) throw new Error("pubkey must be a 64-character hex value");
  return pubkey;
}

function buzzChannelAccessMode(value: unknown): Exclude<DiscordAccessMode, "off"> {
  if (value === undefined || value === null || value === "") return "full";
  if (value === "readonly" || value === "run-approved" || value === "full") return value;
  throw new Error("mode must be readonly, run-approved, or full");
}

async function registerBuzzChannelBinding(input: {
  channelId: string;
  mode: DiscordAccessMode;
  agentProfileKey: string;
}): Promise<JsonObject> {
  if (input.mode === "off") throw new Error("managed Buzz channels cannot use off mode");
  const updated = await appApiRequest(`/agent/agent-profiles/${encodeURIComponent(input.agentProfileKey)}/bindings`, {
    method: "POST",
    body: JSON.stringify({
      surfaceType: "buzz",
      surfaceKey: input.channelId,
      label: `Buzz channel ${input.channelId}`,
      enabled: true,
      policy: { accessMode: input.mode },
    }),
  });
  return parseStringRecord(updated.binding) as JsonObject;
}

function buzzResultEventId(result: Record<string, unknown>): string | null {
  const eventId = typeof result.event_id === "string"
    ? result.event_id
    : typeof result.id === "string"
      ? result.id
      : "";
  return /^[0-9a-f]{64}$/i.test(eventId) ? eventId.toLowerCase() : null;
}

async function sendBuzzAssistantMessage(input: {
  client: BuzzCliClient;
  channelId: string;
  threadRootEventId: string;
  content: string;
}): Promise<{ sourceMessageId: string | null; text: string; redactions: ReturnType<typeof sanitizePublicOutput>["redactions"] }> {
  const sanitized = sanitizePublicOutput(input.content);
  if (sanitized.redactions.length) {
    console.warn("[buzz-adapter] sanitized public Buzz reply", {
      channelId: input.channelId,
      threadRootEventId: input.threadRootEventId,
      redactions: sanitized.redactions,
    });
  }
  const result = await input.client.sendMessage(input.channelId, sanitized.text, { replyTo: input.threadRootEventId });
  return {
    sourceMessageId: buzzResultEventId(result),
    text: sanitized.text,
    redactions: sanitized.redactions,
  };
}

async function loadBuzzConversationThread(input: {
  client: BuzzCliClient;
  channelId: string;
  event: BuzzEvent;
  publicKey: string;
  preferredRootEventId?: string | null;
}): Promise<{ rootEventId: string | null; thread: BuzzEvent[] | null; fetchFailed: boolean }> {
  const candidates = [...new Set([
    input.preferredRootEventId,
    ...buzzEventRootIds(input.event),
    ...buzzEventReplyIds(input.event),
    input.event.id,
  ].filter((value): value is string => Boolean(value)))];
  let fetchFailed = false;
  for (const candidateEventId of candidates) {
    let thread: BuzzEvent[];
    try {
      thread = await input.client.getThread(input.channelId, candidateEventId);
    } catch (error) {
      fetchFailed = true;
      console.warn("[buzz-adapter] thread correlation candidate failed", {
        channelId: input.channelId,
        sourceEventId: input.event.id,
        candidateEventId,
        error: describeError(error),
      });
      continue;
    }
    const rootEventId = buzzConversationRootFromThread(thread, input.event, input.publicKey);
    if (!rootEventId) continue;
    if (candidateEventId.toLowerCase() !== rootEventId) {
      try {
        thread = await input.client.getThread(input.channelId, rootEventId);
      } catch (error) {
        console.warn("[buzz-adapter] canonical thread fetch failed", {
          channelId: input.channelId,
          sourceEventId: input.event.id,
          rootEventId,
          error: describeError(error),
        });
        return { rootEventId, thread: null, fetchFailed: true };
      }
    }
    return { rootEventId, thread, fetchFailed };
  }
  return { rootEventId: null, thread: null, fetchFailed };
}

async function runBuzzPrompt(input: {
  client: BuzzCliClient;
  channel: BuzzChannel;
  event: BuzzEvent;
  conversationRootEventId: string;
  explicitMention: boolean;
  thread: BuzzEvent[];
  profile: ExternalInteractionAuthorization["profile"];
  accessPolicy: ResolvedDiscordAccessPolicy;
  credentials: RuntimeCredentialDescriptor[];
}): Promise<{ replyEventId: string | null; runtimeKey: string | null }> {
  const config = adapterConfig();
  const authorization = buzzInteractionAuthorization(input.profile, input.credentials);
  let prompt = input.explicitMention
    ? buzzMentionPrompt(input.event.content, config.buzzInteractionDisplayName)
    : input.event.content.trim();
  if (input.explicitMention && (!prompt || /^[\^↑]+$/.test(prompt))) {
    const precedingHumanMessage = input.thread
      .filter((event) =>
        event.id.toLowerCase() !== input.event.id.toLowerCase()
        && event.pubkey.toLowerCase() !== config.buzzPublicKey
        && event.createdAt <= input.event.createdAt
        && event.content.trim())
      .sort((left, right) => left.createdAt - right.createdAt || left.id.localeCompare(right.id))
      .at(-1);
    prompt = precedingHumanMessage?.content.trim() ?? "";
  }
  if (!prompt) {
    const sent = await sendBuzzAssistantMessage({
      client: input.client,
      channelId: input.channel.channelId,
      threadRootEventId: input.conversationRootEventId,
      content: `Send @${config.buzzInteractionDisplayName} a question or request.`,
    });
    return { replyEventId: sent.sourceMessageId, runtimeKey: null };
  }

  const userLimit = checkDiscordRateLimit(
    `buzz:user:${input.event.pubkey}:${input.profile.key}`,
    input.profile.rateLimit,
  );
  const channelLimit = checkDiscordRateLimit(
    `buzz:channel:${input.channel.channelId}:${input.profile.key}`,
    {
      windowSeconds: input.profile.rateLimit.windowSeconds,
      maxRequests: Math.max(1, input.profile.rateLimit.maxRequests * 2),
    },
  );
  const blockedLimit = !userLimit.ok ? userLimit : !channelLimit.ok ? channelLimit : null;
  if (blockedLimit) {
    const sent = await sendBuzzAssistantMessage({
      client: input.client,
      channelId: input.channel.channelId,
      threadRootEventId: input.conversationRootEventId,
      content: `Prism is rate limited here. Try again in about ${blockedLimit.retryAfterSeconds} seconds.`,
    });
    return { replyEventId: sent.sourceMessageId, runtimeKey: null };
  }
  if (input.accessPolicy.mode === "readonly" && promptLikelyRequiresWriteAccess(prompt)) {
    const sent = await sendBuzzAssistantMessage({
      client: input.client,
      channelId: input.channel.channelId,
      threadRootEventId: input.conversationRootEventId,
      content: readonlyWriteAccessMessage(),
    });
    return { replyEventId: sent.sourceMessageId, runtimeKey: null };
  }

  const contextKey = `${input.profile.key}:${input.channel.channelId}:${input.conversationRootEventId}`;
  let existing: JsonObject | null = null;
  try {
    existing = await lookupSourceSession("buzz", contextKey);
  } catch (error) {
    console.warn("[buzz-adapter] session lookup failed", describeError(error));
  }
  const createdAt = new Date(input.event.createdAt * 1000).toISOString();
  const session = await upsertSourceSession({
    source: "buzz",
    contextKey,
    title: `Buzz #${input.channel.name}: ${input.conversationRootEventId.slice(0, 12)}`,
    meta: {
      transport: "buzz",
      channelId: input.channel.channelId,
      channelName: input.channel.name,
      authorPubkey: input.event.pubkey,
      conversationRootEventId: input.conversationRootEventId,
      interactionProfileKey: input.profile.key,
      interactionProfileVersion: input.profile.version,
      accessMode: input.profile.mode,
      memoryScope: externalInteractionMemoryScope(authorization),
    },
    lastMessageAt: createdAt,
  });
  await appendSessionMessage({
    sessionId: String(session.id),
    role: "user",
    source: "buzz",
    sourceMessageId: input.event.id,
    content: prompt,
    meta: {
      authorPubkey: input.event.pubkey,
      channelId: input.channel.channelId,
      conversationRootEventId: input.conversationRootEventId,
      interactionProfileKey: input.profile.key,
      interactionProfileVersion: input.profile.version,
    },
    createdAt,
  });

  const existingMessages = Array.isArray(existing?.messages) ? existing.messages : [];
  const persistedHistory = existingMessages
    .slice(-20)
    .flatMap((entry): Array<{ role: string; content: string }> => {
      if (!entry || typeof entry !== "object" || Array.isArray(entry)) return [];
      const record = entry as JsonObject;
      return typeof record.content === "string" && record.content
        ? [{ role: typeof record.role === "string" ? record.role : "user", content: record.content }]
        : [];
    });
  let channelHistory: BuzzEvent[] = [];
  try {
    channelHistory = await input.client.getMessages(
      input.channel.channelId,
      new Date((input.event.createdAt - config.buzzHistoryMaxLookbackSeconds) * 1000),
      { limit: config.buzzHistoryMaxMessages, includeOwnMessages: true },
    );
  } catch (error) {
    console.warn("[buzz-adapter] recent channel context unavailable; continuing with thread history", {
      channelId: input.channel.channelId,
      sourceEventId: input.event.id,
      error: describeError(error),
    });
  }
  const observedEvents = [...new Map([...channelHistory, ...input.thread]
    .map((event) => [event.id.toLowerCase(), event])).values()];
  const observedHistory = observedEvents
    .filter((event) =>
      event.id.toLowerCase() !== input.event.id.toLowerCase()
      && event.createdAt <= input.event.createdAt
      && event.content.trim())
    .sort((left, right) => left.createdAt - right.createdAt || left.id.localeCompare(right.id))
    .slice(-20)
    .map((event) => ({
      role: event.pubkey.toLowerCase() === config.buzzPublicKey ? "assistant" : "user",
      content: event.content.trim(),
    }));
  const recentHistory = observedHistory.length > 0 ? observedHistory : persistedHistory;
  const existingSession = existing?.session && typeof existing.session === "object" && !Array.isArray(existing.session)
    ? existing.session as JsonObject
    : {};
  const existingMeta = externalSessionMeta(existingSession);
  const sessionMeta = externalSessionMeta(session);
  const profileChanged = existingMeta.interactionProfileKey !== input.profile.key
    || existingMeta.interactionProfileVersion !== input.profile.version;
  const continuationId = profileChanged
    ? null
    : typeof existingMeta.runtimeContinuationId === "string"
      ? existingMeta.runtimeContinuationId
      : typeof sessionMeta.runtimeContinuationId === "string"
        ? sessionMeta.runtimeContinuationId
        : null;

  const typing = input.client.startTypingIndicator(input.channel.channelId, input.conversationRootEventId);
  let workingReactionAdded = false;
  try {
    await input.client.addReaction(input.event.id, "💬");
    workingReactionAdded = true;
  } catch (error) {
    console.warn("[buzz-adapter] working reaction unavailable", {
      channelId: input.channel.channelId,
      sourceEventId: input.event.id,
      error: describeError(error),
    });
  }
  const stopWorkingFeedback = async () => {
    await typing.stop();
    if (!workingReactionAdded) return;
    workingReactionAdded = false;
    await input.client.removeReaction(input.event.id, "💬").catch((error) => {
      console.warn("[buzz-adapter] working reaction cleanup failed", {
        channelId: input.channel.channelId,
        sourceEventId: input.event.id,
        error: describeError(error),
      });
    });
  };
  let result: Awaited<ReturnType<typeof runtimeRequest>>;
  try {
    result = await runtimeRequest({
      prompt,
      sessionId: String(session.id),
      continuationId,
      recentHistory,
      credentials: input.credentials,
      skills: input.accessPolicy.skills,
      runtimeProfileKey: input.profile.runtimeProfileKey,
      gatewayContext: { delegatedActorId: `buzz:${input.event.pubkey}` },
      metadata: {
        transport: "buzz",
        buzzChannelId: input.channel.channelId,
        buzzChannelName: input.channel.name,
        buzzAuthorPubkey: input.event.pubkey,
        buzzSourceEventId: input.event.id,
        buzzConversationRootEventId: input.conversationRootEventId,
        interactionProfileKey: input.profile.key,
        interactionProfileVersion: input.profile.version,
        externalAccessMode: input.profile.mode,
        allowedWorkflows: input.profile.allowedWorkflows,
        memoryScope: externalInteractionMemoryScope(authorization),
        requestOrigin: { sourceSessionId: String(session.id), sourceMessageId: input.event.id },
        policyInstructions: [
          externalInteractionPolicyInstructions(authorization),
          input.profile.mode !== "readonly"
            ? `When creating a request with POST /agent/change-board/requests, include sourceSessionId ${String(session.id)} and sourceMessageId ${input.event.id}; do not supply identity display fields.`
            : "",
        ].filter(Boolean).join("\n\n"),
        sourceAccessPolicy: input.accessPolicy,
        requestedSkills: [...new Set([...input.profile.skills, ...input.accessPolicy.skills])],
        credentialPolicy: input.credentials.length ? "source-policy" : "none",
      },
    });
  } catch (error) {
    await stopWorkingFeedback();
    console.error("[buzz-adapter] runtime request failed", {
      channelId: input.channel.channelId,
      sourceEventId: input.event.id,
      error: describeError(error),
    });
    const sent = await sendBuzzAssistantMessage({
      client: input.client,
      channelId: input.channel.channelId,
      threadRootEventId: input.conversationRootEventId,
      content: "I received your message, but Prism's runtime is temporarily unavailable. Please try again shortly.",
    });
    await appendSessionMessage({
      sessionId: String(session.id),
      role: "assistant",
      source: "buzz",
      sourceMessageId: sent.sourceMessageId,
      content: sent.text,
      meta: { failed: true, interactionProfileKey: input.profile.key },
      createdAt: nowUtcIso(),
    });
    return { replyEventId: sent.sourceMessageId, runtimeKey: null };
  }

  let sent: Awaited<ReturnType<typeof sendBuzzAssistantMessage>>;
  try {
    sent = await sendBuzzAssistantMessage({
      client: input.client,
      channelId: input.channel.channelId,
      threadRootEventId: input.conversationRootEventId,
      content: result.responseText,
    });
  } finally {
    await stopWorkingFeedback();
  }
  try {
    await upsertSourceSession({
      source: "buzz",
      contextKey,
      title: typeof session.title === "string" ? session.title : `Buzz #${input.channel.name}`,
      meta: {
        ...sessionMeta,
        transport: "buzz",
        channelId: input.channel.channelId,
        channelName: input.channel.name,
        authorPubkey: input.event.pubkey,
        conversationRootEventId: input.conversationRootEventId,
        interactionProfileKey: input.profile.key,
        interactionProfileVersion: input.profile.version,
        runtimeContinuationId: result.continuationId,
        runtimeKey: result.runtimeKey ?? input.profile.runtimeProfileKey,
        runtimeProvider: result.provider,
        accessMode: input.profile.mode,
        memoryScope: externalInteractionMemoryScope(authorization),
      },
      lastMessageAt: nowUtcIso(),
    });
    await appendSessionMessage({
      sessionId: String(session.id),
      role: "assistant",
      source: "buzz",
      sourceMessageId: sent.sourceMessageId,
      content: sent.text,
      meta: {
        runtimeContinuationId: result.continuationId,
        interactionProfileKey: input.profile.key,
        interactionProfileVersion: input.profile.version,
        redactions: sent.redactions as unknown as JsonValue,
      },
      createdAt: nowUtcIso(),
    });
  } catch (error) {
    // Delivery has already succeeded. Do not send an error reply and create a
    // duplicate; the persisted Buzz interaction checkpoint remains authoritative.
    console.error("[buzz-adapter] reply delivered but session persistence failed", {
      channelId: input.channel.channelId,
      sourceEventId: input.event.id,
      replyEventId: sent.sourceMessageId,
      error: describeError(error),
    });
  }
  return { replyEventId: sent.sourceMessageId, runtimeKey: result.runtimeKey };
}

async function runBuzzInteractionPoll(): Promise<JsonObject> {
  const config = adapterConfig();
  if (!config.buzzInteractionEnabled) {
    throw new Error("Buzz interaction polling is disabled");
  }
  if (!config.buzzEnabled) {
    throw new Error("BUZZ_ENABLED must be true when Buzz interaction polling is enabled");
  }
  if (!/^[0-9a-f]{64}$/.test(config.buzzPublicKey)) {
    throw new Error("BUZZ_PUBLIC_KEY must be a 64-character lowercase hex key");
  }

  // Advance only through the instant this scan began. Runtime calls can take
  // minutes; using completion time would skip messages that arrived while an
  // earlier interaction was still running.
  const pollStartedTimestamp = Math.floor(Date.now() / 1000);
  buzzInteractionStatus.lastPollAt = nowUtcIso();
  const client = await buzzClient();
  const state = await loadBuzzInteractionState();
  const processed = new Set(state.processedEventIds);
  const conversationRoots = new Map(
    state.conversationEventRoots.map((entry) => [entry.eventId, entry.rootEventId]),
  );
  const initialSince = pollStartedTimestamp - config.buzzInteractionLookbackSeconds;
  const sinceTimestamp = Math.max(0, (state.cursorTimestamp || initialSince) - 10);
  const channels = await listInteractiveBuzzChannels(client);
  const collected: Array<{ channel: BuzzChannel; event: BuzzEvent }> = [];
  for (const channel of channels) {
    const events = await client.getMessages(channel.channelId, new Date(sinceTimestamp * 1000));
    collected.push(...events.map((event) => ({ channel, event })));
  }
  collected.sort((left, right) => left.event.createdAt - right.event.createdAt || left.event.id.localeCompare(right.event.id));
  const interactions = collected.filter(({ event }) =>
    !processed.has(event.id)
    && (buzzEventMentionsPubkey(event, config.buzzPublicKey) || buzzEventReplyIds(event).length > 0)
  );
  const results: JsonObject[] = [];
  const profileKeys = new Set<string>();
  const deferredTimestamps: number[] = [];
  for (const entry of interactions) {
    const explicitMention = buzzEventMentionsPubkey(entry.event, config.buzzPublicKey);
    const replyEventIds = buzzEventReplyIds(entry.event);
    const preferredRootEventId = replyEventIds
      .map((eventId) => conversationRoots.get(eventId) ?? null)
      .find((eventId): eventId is string => eventId !== null)
      ?? (replyEventIds.length === 0 && explicitMention ? entry.event.id : null);
    const resolvedThread = await loadBuzzConversationThread({
      client,
      channelId: entry.channel.channelId,
      event: entry.event,
      publicKey: config.buzzPublicKey,
      preferredRootEventId,
    });
    if (!resolvedThread.rootEventId || !resolvedThread.thread) {
      if (resolvedThread.fetchFailed) {
        deferredTimestamps.push(entry.event.createdAt);
        continue;
      }
      processed.add(entry.event.id);
      continue;
    }
    const conversationRootEventId = resolvedThread.rootEventId;
    const thread = resolvedThread.thread;
    rememberBuzzConversationEvent(state, entry.event.id, conversationRootEventId);
    conversationRoots.set(entry.event.id, conversationRootEventId);
    for (const threadEvent of thread ?? []) {
      rememberBuzzConversationEvent(state, threadEvent.id, conversationRootEventId);
      conversationRoots.set(threadEvent.id, conversationRootEventId);
    }

    const accessPolicy = await resolveBuzzAccessPolicy({
      channelId: entry.channel.channelId,
      authorPubkey: entry.event.pubkey,
    });
    if (accessPolicy.mode === "off") {
      processed.add(entry.event.id);
      results.push({
        sourceEventId: entry.event.id,
        status: "policy-off",
        accessPolicy,
      });
      state.processedEventIds = [...processed];
      await saveBuzzInteractionState(state);
      continue;
    }
    if (!accessPolicy.interactionProfileKey) {
      console.error("[buzz-adapter] mapped Buzz access policy is missing interactionProfileKey", {
        channelId: entry.channel.channelId,
        sourceEventId: entry.event.id,
        accessPolicy,
      });
      deferredTimestamps.push(entry.event.createdAt);
      results.push({ sourceEventId: entry.event.id, status: "profile-unmapped", accessPolicy });
      continue;
    }

    let profile: ExternalInteractionAuthorization["profile"];
    try {
      const loaded = await referencedInteractionProfile(accessPolicy);
      if (!loaded) throw new Error("Buzz Agent Profile is unavailable");
      profile = { ...loaded, rateLimit: accessPolicy.rateLimit };
    } catch (error) {
      console.error("[buzz-adapter] Buzz interaction profile resolution failed", {
        channelId: entry.channel.channelId,
        sourceEventId: entry.event.id,
        profileKey: accessPolicy.interactionProfileKey,
        error: describeError(error),
      });
      deferredTimestamps.push(entry.event.createdAt);
      results.push({ sourceEventId: entry.event.id, status: "profile-error", accessPolicy });
      continue;
    }
    profileKeys.add(profile.key);
    const credentials = await resolveInteractiveGatewayCredentials({
      platform: "buzz",
      targetId: entry.channel.channelId,
      userId: entry.event.pubkey,
    });
    if (buzzThreadHasDirectReplyFrom(thread, config.buzzPublicKey, entry.event.id)) {
      processed.add(entry.event.id);
      results.push({ sourceEventId: entry.event.id, status: "already-replied" });
    } else {
      const result = await runBuzzPrompt({
        client,
        channel: entry.channel,
        event: entry.event,
        conversationRootEventId,
        explicitMention,
        thread,
        profile,
        accessPolicy,
        credentials,
      });
      rememberBuzzConversationEvent(state, result.replyEventId, conversationRootEventId);
      if (result.replyEventId) conversationRoots.set(result.replyEventId, conversationRootEventId);
      processed.add(entry.event.id);
      buzzInteractionStatus.processedCount += 1;
      results.push({
        sourceEventId: entry.event.id,
        conversationRootEventId,
        interactionKind: explicitMention ? "mention" : "reply",
        status: "replied",
        replyEventId: result.replyEventId,
        runtimeKey: result.runtimeKey,
        profileKey: profile.key,
        accessMode: accessPolicy.mode,
      });
    }
    state.processedEventIds = [...processed];
    await saveBuzzInteractionState(state);
  }
  state.processedEventIds = [...processed];
  state.cursorTimestamp = buzzInteractionCursorTimestamp(pollStartedTimestamp, deferredTimestamps);
  await saveBuzzInteractionState(state);
  buzzInteractionStatus.lastSuccessAt = nowUtcIso();
  buzzInteractionStatus.lastError = null;
  return {
    ok: true,
    profileKeys: [...profileKeys],
    channelCount: channels.length,
    scannedEventCount: collected.length,
    interactionCount: interactions.length,
    results,
  };
}

function startBuzzInteractionPolling(): (() => void) | null {
  const config = adapterConfig();
  if (!config.buzzInteractionEnabled) return null;
  let stopped = false;
  let timer: NodeJS.Timeout | null = null;
  const schedule = () => {
    if (stopped) return;
    timer = setTimeout(() => void tick(), config.buzzInteractionPollSeconds * 1000);
  };
  const tick = async () => {
    if (stopped) return;
    if (buzzInteractionStatus.running) {
      schedule();
      return;
    }
    buzzInteractionStatus.running = true;
    try {
      const result = await runBuzzInteractionPoll();
      if (Array.isArray(result.results) && result.results.length > 0) {
        console.log("[buzz-adapter] interaction poll processed", result);
      }
    } catch (error) {
      buzzInteractionStatus.lastError = describeError(error);
      console.error("[buzz-adapter] interaction poll failed", buzzInteractionStatus.lastError);
    } finally {
      buzzInteractionStatus.running = false;
      schedule();
    }
  };
  void tick();
  return () => {
    stopped = true;
    if (timer) clearTimeout(timer);
  };
}

async function listDiscordDestinations(): Promise<AdapterDestination[]> {
  const config = adapterConfig();
  if (!config.discordGuildId) {
    throw new Error("DISCORD_GUILD_ID is required to list Discord destinations");
  }
  const channelsPayload = await discordApiRequest<JsonValue[]>(`/guilds/${config.discordGuildId}/channels`);
  if (!Array.isArray(channelsPayload)) {
    throw new Error("Discord guild channels response was not a list");
  }
  return channelsPayload
    .filter((item): item is JsonObject => !!item && typeof item === "object" && !Array.isArray(item))
    .filter((channel) => DISCORD_TEXT_CHANNEL_TYPES.has(Number(channel.type)) || DISCORD_FORUM_CHANNEL_TYPES.has(Number(channel.type)))
    .filter((channel) => typeof channel.id === "string")
    .map((channel) => {
      const name = typeof channel.name === "string" && channel.name.trim() ? channel.name.trim() : null;
      return {
        adapter: "discord",
        platform: "discord",
        id: `discord:${String(channel.id)}`,
        destinationId: String(channel.id),
        type: DISCORD_FORUM_CHANNEL_TYPES.has(Number(channel.type)) ? "discord-forum" : "discord-channel",
        name,
        label: name ? `${DISCORD_FORUM_CHANNEL_TYPES.has(Number(channel.type)) ? "Forum / " : "#"}${name}` : String(channel.id),
        parentId: typeof channel.parent_id === "string" ? channel.parent_id : null,
      };
    })
    .sort((a, b) => a.label.localeCompare(b.label));
}

async function listTelegramDestinations(): Promise<AdapterDestination[]> {
  if (!(process.env.TELEGRAM_BOT_TOKEN ?? "").trim()) {
    return [];
  }
  const chats = await loadKnownTelegramChats();
  return Object.values(chats)
    .filter((chat) => chat.type !== "private")
    .map((chat) => ({
      adapter: "telegram",
      platform: "telegram",
      id: `telegram:${chat.id}`,
      destinationId: chat.id,
      type: chat.type === "channel" ? "telegram-channel" : "telegram-chat",
      name: chat.title ?? chat.username ?? chat.id,
      label: chat.title
        ? `Telegram / ${chat.title}`
        : chat.username
          ? `Telegram / @${chat.username}`
          : `Telegram / ${chat.id}`,
    }))
    .sort((a, b) => a.label.localeCompare(b.label));
}

async function listBuzzDestinations(): Promise<AdapterDestination[]> {
  const config = adapterConfig();
  if (!config.buzzEnabled) return [];
  const client = buzzClient();
  return (await listInteractiveBuzzChannels(client)).map((channel) => ({
    adapter: "buzz",
    platform: "buzz",
    id: `buzz:${channel.channelId}`,
    destinationId: channel.channelId,
    type: "buzz-channel",
    name: channel.name,
    label: `Buzz / #${channel.name}`,
  }));
}

async function listAdapterDestinations(): Promise<AdapterDestination[]> {
  const destinations: AdapterDestination[] = [];
  try {
    destinations.push(...await listDiscordDestinations());
  } catch (error) {
    console.warn(`[source-adapter] Discord destination discovery failed: ${describeError(error)}`);
  }
  try {
    destinations.push(...await listTelegramDestinations());
  } catch (error) {
    console.warn(`[source-adapter] Telegram destination discovery failed: ${describeError(error)}`);
  }
  try {
    destinations.push(...await listBuzzDestinations());
  } catch (error) {
    console.warn(`[source-adapter] Buzz destination discovery failed: ${describeError(error)}`);
  }
  return destinations;
}

async function inspectDiscordGuildChannels(): Promise<JsonObject> {
  const config = adapterConfig();
  if (!config.discordGuildId) {
    throw new Error("DISCORD_GUILD_ID is required to inspect Discord channels");
  }
  const channelsPayload = await discordApiRequest<JsonValue[]>(`/guilds/${config.discordGuildId}/channels`);
  if (!Array.isArray(channelsPayload)) {
    throw new Error("Discord guild channels response was not a list");
  }
  const channels = channelsPayload
    .filter((item): item is JsonObject => !!item && typeof item === "object" && !Array.isArray(item))
    .filter((channel) => typeof channel.id === "string")
    .map((channel) => ({
      id: String(channel.id),
      name: typeof channel.name === "string" ? channel.name : String(channel.id),
      type: Number(channel.type),
      parentId: typeof channel.parent_id === "string" ? channel.parent_id : null,
      position: typeof channel.position === "number" ? channel.position : 0,
    }));
  const channelById = new Map(channels.map((channel) => [channel.id, channel]));
  const channelParentCategoryId = (channel: (typeof channels)[number]) => {
    if ([10, 11, 12].includes(channel.type) && channel.parentId) {
      return channelById.get(channel.parentId)?.parentId ?? null;
    }
    return channel.parentId;
  };
  const toInventoryChannel = (channel: (typeof channels)[number]) => ({
    id: channel.id,
    name: channel.name,
    type: channel.type,
    parentId: channel.parentId,
    parentCategoryId: channelParentCategoryId(channel),
    position: channel.position,
  });
  const categories = channels
    .filter((channel) => channel.type === 4)
    .sort((a, b) => a.position - b.position || a.name.localeCompare(b.name))
    .map((category) => ({
      id: category.id,
      name: category.name,
      position: category.position,
      children: channels
        .filter((channel) => channelParentCategoryId(channel) === category.id && DISCORD_TEXT_CHANNEL_TYPES.has(channel.type))
        .sort((a, b) => a.position - b.position || a.name.localeCompare(b.name))
        .map(toInventoryChannel),
    }));
  const uncategorized = channels
    .filter((channel) => !channelParentCategoryId(channel) && DISCORD_TEXT_CHANNEL_TYPES.has(channel.type))
    .sort((a, b) => a.position - b.position || a.name.localeCompare(b.name))
    .map(toInventoryChannel);

  return {
    guildId: config.discordGuildId,
    mappingCandidates: categories.map((category) => ({
      id: category.id,
      name: category.name,
      childCount: Array.isArray(category.children) ? category.children.length : 0,
    })),
    categories,
    uncategorized,
  };
}

function normalizeDiscordForumPostTitle(value: unknown): string {
  const title = typeof value === "string" && value.trim() ? value.trim() : "Prism update";
  return title.slice(0, 100);
}

async function sendDiscordMessage(destinationId: string, content: string, options: { type?: string; title?: string | null } = {}): Promise<JsonObject> {
  const normalizedDestinationId = destinationId.trim();
  const normalizedContent = content.trim();
  if (!normalizedDestinationId) {
    throw new Error("destinationId is required");
  }
  if (!normalizedContent) {
    throw new Error("content is required");
  }
  const destinationType = options.type?.trim()
    ? options.type.trim()
    : discordDestinationType(
        null,
        (await discordApiRequest<JsonObject>(`/channels/${encodeURIComponent(normalizedDestinationId)}`)).type,
      );
  if (destinationType === "discord-forum") {
    const message = await discordApiRequest<JsonObject>(
      `/channels/${encodeURIComponent(normalizedDestinationId)}/threads`,
      undefined,
      {
        method: "POST",
        body: JSON.stringify({
          name: normalizeDiscordForumPostTitle(options.title),
          message: { content: normalizedContent },
        }),
      },
    );
    return {
      adapter: "discord",
      destinationId: normalizedDestinationId,
      type: "discord-forum",
      threadId: typeof message.id === "string" ? message.id : null,
      threadName: typeof message.name === "string" ? message.name : options.title ?? null,
      messageCount: 1,
      messages: [{
        id: typeof message.id === "string" ? message.id : null,
        channelId: normalizedDestinationId,
      }],
    };
  }
  const sent: JsonObject[] = [];
  for (const part of splitDiscordMessage(normalizedContent)) {
    const message = await discordApiRequest<JsonObject>(
      `/channels/${encodeURIComponent(normalizedDestinationId)}/messages`,
      undefined,
      {
        method: "POST",
        body: JSON.stringify({ content: part }),
      },
    );
    sent.push({
      id: typeof message.id === "string" ? message.id : null,
      channelId: typeof message.channel_id === "string" ? message.channel_id : normalizedDestinationId,
    });
  }
  return {
    adapter: "discord",
    destinationId: normalizedDestinationId,
    messageCount: sent.length,
    messages: sent,
  };
}

function resolveMessageDestination(body: JsonObject): { adapter: string; destinationId: string; type: string | null; title: string | null } {
  const rawAdapter = typeof body.adapter === "string"
    ? body.adapter
    : typeof body.platform === "string"
      ? body.platform
      : "";
  const rawDestinationId = typeof body.destinationId === "string"
    ? body.destinationId
    : typeof body.destination_id === "string"
      ? body.destination_id
      : "";
  const trimmedDestinationId = rawDestinationId.trim();
  if (trimmedDestinationId.includes(":")) {
    const [prefix, ...rest] = trimmedDestinationId.split(":");
    const value = rest.join(":").trim();
    if ((prefix === "discord" || prefix === "telegram" || prefix === "buzz") && value) {
      return {
        adapter: prefix,
        destinationId: value,
        type: typeof body.type === "string" ? body.type.trim() || null : null,
        title: typeof body.title === "string" ? body.title.trim() || null : typeof body.postTitle === "string" ? body.postTitle.trim() || null : null,
      };
    }
  }
  return {
    adapter: rawAdapter.trim() || "discord",
    destinationId: trimmedDestinationId,
    type: typeof body.type === "string" ? body.type.trim() || null : null,
    title: typeof body.title === "string" ? body.title.trim() || null : typeof body.postTitle === "string" ? body.postTitle.trim() || null : null,
  };
}

function splitTelegramMessage(content: string): string[] {
  const maxLength = 4096;
  const chunks: string[] = [];
  let remaining = content;
  while (remaining.length > maxLength) {
    chunks.push(remaining.slice(0, maxLength));
    remaining = remaining.slice(maxLength);
  }
  if (remaining) {
    chunks.push(remaining);
  }
  return chunks;
}

async function sendTelegramMessage(
  destinationId: string,
  content: string,
  options: { replyToMessageId?: string | null } = {},
): Promise<JsonObject> {
  const normalizedDestinationId = destinationId.trim();
  const normalizedContent = content.trim();
  if (!normalizedDestinationId) {
    throw new Error("destinationId is required");
  }
  if (!normalizedContent) {
    throw new Error("content is required");
  }
  const sent: JsonObject[] = [];
  for (const part of splitTelegramMessage(normalizedContent)) {
    const message = await telegramApiRequest<JsonObject>("sendMessage", {
      chat_id: normalizedDestinationId,
      text: part,
      disable_web_page_preview: false,
      ...(options.replyToMessageId ? { reply_to_message_id: Number(options.replyToMessageId) } : {}),
    });
    sent.push({
      id: typeof message.message_id === "number" ? String(message.message_id) : null,
      chatId: normalizedDestinationId,
    });
  }
  return {
    adapter: "telegram",
    destinationId: normalizedDestinationId,
    messageCount: sent.length,
    messages: sent,
  };
}

async function sendAdapterMessage(adapter: string, destinationId: string, content: string, options: { type?: string | null; title?: string | null } = {}): Promise<JsonObject> {
  if (adapter === "discord") {
    return sendDiscordMessage(destinationId, content, { type: options.type ?? undefined, title: options.title ?? null });
  }
  if (adapter === "telegram") {
    return sendTelegramMessage(destinationId, content);
  }
  if (adapter === "buzz") {
    const accessPolicy = await resolveBuzzAccessPolicy({ channelId: destinationId.trim(), authorPubkey: "" });
    if (accessPolicy.mode === "off") {
      throw new Error(`Buzz channel is not assigned to an enabled Agent Profile: ${destinationId.trim() || "(empty)"}`);
    }
    const result = await buzzClient().sendMessage(destinationId, content);
    return {
      adapter: "buzz",
      destinationId: destinationId.trim(),
      messageCount: 1,
      messages: [{
        id: typeof result.event_id === "string"
          ? result.event_id
          : typeof result.id === "string"
            ? result.id
            : null,
        channelId: destinationId.trim(),
      }],
      event: result as JsonValue,
    };
  }
  throw new Error(`Unsupported adapter: ${adapter}`);
}

async function getTelegramBotUsername(): Promise<string | null> {
  if (telegramBotUsername !== null) {
    return telegramBotUsername || null;
  }
  try {
    const me = await telegramApiRequest<JsonObject>("getMe");
    telegramBotUsername = typeof me.username === "string" && me.username.trim() ? me.username.trim() : "";
    return telegramBotUsername || null;
  } catch (error) {
    console.warn(`[source-adapter] Telegram getMe failed: ${describeError(error)}`);
    telegramBotUsername = "";
    return null;
  }
}

function telegramChatFromUpdate(update: JsonObject): JsonObject | null {
  const candidateKeys = ["message", "channel_post", "edited_message", "edited_channel_post", "my_chat_member"];
  for (const key of candidateKeys) {
    const value = update[key];
    if (!value || typeof value !== "object" || Array.isArray(value)) {
      continue;
    }
    const record = value as JsonObject;
    const chat = record.chat;
    if (chat && typeof chat === "object" && !Array.isArray(chat)) {
      return chat as JsonObject;
    }
  }
  return null;
}

function telegramMessageFromUpdate(update: JsonObject): JsonObject | null {
  const message = update.message;
  return message && typeof message === "object" && !Array.isArray(message) ? message as JsonObject : null;
}

function telegramTextFromMessage(message: JsonObject): string {
  const text = typeof message.text === "string"
    ? message.text
    : typeof message.caption === "string"
      ? message.caption
      : "";
  return text.trim();
}

function telegramUserFromMessage(message: JsonObject): JsonObject | null {
  const user = message.from;
  return user && typeof user === "object" && !Array.isArray(user) ? user as JsonObject : null;
}

function telegramUserDisplayName(user: JsonObject | null): string {
  if (!user) {
    return "Unknown Telegram user";
  }
  const username = typeof user.username === "string" && user.username.trim() ? `@${user.username.trim()}` : "";
  const name = [user.first_name, user.last_name]
    .filter((entry): entry is string => typeof entry === "string" && entry.trim().length > 0)
    .join(" ")
    .trim();
  return name || username || String(user.id ?? "Unknown Telegram user");
}

function telegramChatTitle(chat: JsonObject): string {
  const title = typeof chat.title === "string" && chat.title.trim()
    ? chat.title.trim()
    : [chat.first_name, chat.last_name]
      .filter((entry): entry is string => typeof entry === "string" && entry.trim().length > 0)
      .join(" ")
      .trim();
  return title || (typeof chat.username === "string" && chat.username.trim() ? `@${chat.username.trim()}` : String(chat.id ?? "Telegram chat"));
}

function cleanTelegramPrompt(input: {
  text: string;
  botUsername: string | null;
  chatType: string;
}): string {
  const text = input.text.trim();
  if (!text) {
    return "";
  }
  if (input.chatType === "private") {
    return text;
  }

  const commandMatch = text.match(/^\/(prism|superprism)(?:@\w+)?(?:\s+|$)([\s\S]*)$/i);
  if (commandMatch) {
    return (commandMatch[2] ?? "").trim() || "Briefly introduce what Prism can do from this Telegram chat and mention that users can add a prompt after /prism.";
  }

  if (input.botUsername) {
    const escaped = input.botUsername.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const mention = new RegExp(`@${escaped}\\b`, "gi");
    if (mention.test(text)) {
      return text.replace(mention, "").trim();
    }
  }

  return "";
}

async function rememberTelegramChat(chat: JsonObject): Promise<boolean> {
  const idValue = chat.id;
  if (typeof idValue !== "number" && typeof idValue !== "string") {
    return false;
  }
  const id = String(idValue);
  const type = typeof chat.type === "string" ? chat.type : "unknown";
  if (type === "private" && !adapterConfig().telegramDmEnabled) {
    return false;
  }
  const title =
    typeof chat.title === "string" && chat.title.trim()
      ? chat.title.trim()
      : [chat.first_name, chat.last_name]
        .filter((entry): entry is string => typeof entry === "string" && entry.trim().length > 0)
        .join(" ")
        .trim() || null;
  const username = typeof chat.username === "string" && chat.username.trim() ? chat.username.trim() : null;
  const now = nowUtcIso();
  const chats = await loadKnownTelegramChats();
  chats[id] = {
    id,
    type,
    title,
    username,
    firstSeenAt: chats[id]?.firstSeenAt ?? now,
    lastSeenAt: now,
  };
  await saveKnownTelegramChats(chats);
  return true;
}

type TelegramPromptTransport = {
  chatId: string;
  chatType: string;
  chatTitle: string;
  authorId: string;
  authorName: string;
  userSourceMessageId: string | null;
  createdAt: string;
  sendTyping?: () => Promise<void>;
  sendThinkingMessage?: () => Promise<() => Promise<void>>;
  sendAssistantMessage: (content: string) => Promise<{ sourceMessageId: string | null }>;
};

async function sendSanitizedTelegramAssistantMessage(
  transport: TelegramPromptTransport,
  content: string,
): Promise<{ sourceMessageId: string | null; text: string; redactions: ReturnType<typeof sanitizePublicOutput>["redactions"] }> {
  const sanitized = sanitizePublicOutput(content);
  if (sanitized.redactions.length) {
    console.warn("[source-adapter] sanitized public Telegram reply", {
      chatId: transport.chatId,
      redactions: sanitized.redactions,
    });
  }
  const sent = await transport.sendAssistantMessage(sanitized.text);
  return { ...sent, text: sanitized.text, redactions: sanitized.redactions };
}

async function runTelegramPrompt(prompt: string, transport: TelegramPromptTransport): Promise<void> {
  const accessPolicy = await resolveTelegramAccessPolicy({
    chatId: transport.chatId,
    authorId: transport.authorId,
  });
  if (accessPolicy.mode === "off") {
    return;
  }
  if (accessPolicy.mode === "readonly" && promptLikelyRequiresWriteAccess(prompt)) {
    await sendSanitizedTelegramAssistantMessage(transport, readonlyWriteAccessMessage());
    return;
  }
  let interactionProfile: ExternalInteractionAuthorization["profile"] | null = null;
  try {
    interactionProfile = await referencedInteractionProfile(accessPolicy);
  } catch (error) {
    console.error("[source-adapter] Telegram interaction profile resolution failed", describeError(error));
    await sendSanitizedTelegramAssistantMessage(transport, "Prism's interaction profile is unavailable for this chat. Please try again later.");
    return;
  }

  const userLimit = checkDiscordRateLimit(
    `telegram:user:${transport.authorId}:${accessPolicy.mode}`,
    accessPolicy.rateLimit,
  );
  const chatLimit = checkDiscordRateLimit(
    `telegram:chat:${transport.chatId}:${accessPolicy.mode}`,
    {
      windowSeconds: accessPolicy.rateLimit.windowSeconds,
      maxRequests: Math.max(1, accessPolicy.rateLimit.maxRequests * 2),
    },
  );
  const blockedLimit = !userLimit.ok ? userLimit : !chatLimit.ok ? chatLimit : null;
  if (blockedLimit) {
    await sendSanitizedTelegramAssistantMessage(
      transport,
      `Prism is rate limited here. Try again in about ${blockedLimit.retryAfterSeconds} seconds.`,
    );
    return;
  }

  const contextKey = `telegram:${transport.chatId}`;
  let existing: JsonObject | null = null;
  try {
    existing = await lookupSourceSession("telegram", contextKey);
  } catch (error) {
    console.warn("[source-adapter] Telegram session lookup failed", describeError(error));
  }

  const session = await upsertSourceSession({
    source: "telegram",
    contextKey,
    title: `Telegram chat: ${transport.chatTitle}`,
    meta: {
      transport: "telegram",
      chatId: transport.chatId,
      chatType: transport.chatType,
      chatTitle: transport.chatTitle,
      accessPolicy,
      interactionProfileKey: interactionProfile?.key ?? null,
      interactionProfileVersion: interactionProfile?.version ?? null,
    },
    lastMessageAt: transport.createdAt,
  });

  await appendSessionMessage({
    sessionId: String(session.id),
    role: "user",
    source: "telegram",
    sourceMessageId: transport.userSourceMessageId,
    content: prompt,
    meta: {
      authorId: transport.authorId,
      authorName: transport.authorName,
      accessPolicy,
    },
    createdAt: transport.createdAt,
  });

  const existingMessages = Array.isArray(existing?.messages) ? existing.messages : [];
  const recentHistory = existingMessages
    .slice(-12)
    .filter((entry): entry is JsonObject => !!entry && typeof entry === "object" && !Array.isArray(entry))
    .map((entry) => ({
      role: typeof entry.role === "string" ? entry.role : "user",
      content: typeof entry.content === "string" ? entry.content : "",
    }))
    .filter((entry) => entry.content);

  const existingSession = existing?.session && typeof existing.session === "object" ? (existing.session as JsonObject) : {};
  const sessionMeta = session.meta && typeof session.meta === "object" ? (session.meta as JsonObject) : {};
  const existingMeta = externalSessionMeta(existingSession);
  const sessionRuntimeKey =
    (typeof existingSession.meta === "object" && existingSession.meta && typeof (existingSession.meta as JsonObject).runtimeKey === "string"
      ? String((existingSession.meta as JsonObject).runtimeKey)
      : null) ||
    (typeof sessionMeta.runtimeKey === "string" ? sessionMeta.runtimeKey : null);
  let runtimeContinuationId =
    (typeof existingSession.meta === "object" && existingSession.meta && typeof (existingSession.meta as JsonObject).runtimeContinuationId === "string"
      ? String((existingSession.meta as JsonObject).runtimeContinuationId)
      : typeof existingSession.meta === "object" && existingSession.meta && typeof (existingSession.meta as JsonObject).codexThreadId === "string"
        ? String((existingSession.meta as JsonObject).codexThreadId)
      : null) ||
    (typeof sessionMeta.runtimeContinuationId === "string"
      ? sessionMeta.runtimeContinuationId
      : typeof sessionMeta.codexThreadId === "string" ? sessionMeta.codexThreadId : null);
  if (
    (existingMeta.interactionProfileKey ?? null) !== (interactionProfile?.key ?? null)
    || (existingMeta.interactionProfileVersion ?? null) !== (interactionProfile?.version ?? null)
  ) runtimeContinuationId = null;
  const canSendAdapterMessages = accessPolicy.capabilities.includes("adapter.send_message");
  const gatewayCredentials = await resolveInteractiveGatewayCredentials({
    platform: "telegram",
    targetId: transport.chatId,
    userId: transport.authorId,
  });

  const stopTyping = startTypingHeartbeat(transport.sendTyping);
  const clearThinking = transport.sendThinkingMessage
    ? await transport.sendThinkingMessage().catch((error) => {
        console.warn("[source-adapter] Telegram thinking indicator failed", describeError(error));
        return async () => undefined;
      })
    : async () => undefined;
  try {
    const result = await runtimeRequest({
      prompt,
      sessionId: String(session.id),
      continuationId: runtimeContinuationId,
      recentHistory,
      credentials: gatewayCredentials,
      runtimeProfileKey: interactionProfile?.runtimeProfileKey ?? null,
      gatewayContext: {
        delegatedActorId: `telegram:${transport.authorId}`,
      },
      metadata: {
        transport: "telegram",
        sessionRuntimeKey,
        telegramChatId: transport.chatId,
        telegramChatType: transport.chatType,
        telegramAuthorId: transport.authorId,
        telegramAccessPolicy: accessPolicy,
        interactionProfileKey: interactionProfile?.key ?? null,
        interactionProfileVersion: interactionProfile?.version ?? null,
        requestedSkills: interactionProfile?.skills ?? [],
        allowedWorkflows: interactionProfile?.allowedWorkflows ?? [],
        memoryScope: interactionProfile?.memoryScope ?? null,
        requestOrigin: { sourceSessionId: String(session.id), sourceMessageId: transport.userSourceMessageId },
        policyInstructions: [
          communicationProfileInstructions(interactionProfile, accessPolicy),
          accessPolicy.mode !== "readonly" && accessPolicy.capabilities.includes("requests.create")
            ? `When creating a request with POST /agent/change-board/requests, include sourceSessionId ${String(session.id)}${transport.userSourceMessageId ? ` and sourceMessageId ${transport.userSourceMessageId}` : ""}; do not supply identity display fields.`
            : "",
        ].filter(Boolean).join("\n\n"),
        adapterCapabilities: {
          adapter: "communication",
          capabilities: canSendAdapterMessages ? ["list-destinations", "send-message"] : [],
          destinationTypes: canSendAdapterMessages ? ["discord-channel", "discord-forum", "telegram-chat", "telegram-channel"] : [],
        },
        availableOutputDestinations: canSendAdapterMessages
          ? await listAdapterDestinations().catch((error) => {
              console.warn("[source-adapter] Telegram destination discovery failed", describeError(error));
              return [];
            })
          : [],
      },
    });
    runtimeContinuationId = result.continuationId ?? runtimeContinuationId;

    if (
      (runtimeContinuationId && runtimeContinuationId !== sessionMeta.runtimeContinuationId) ||
      (result.runtimeKey && result.runtimeKey !== sessionMeta.runtimeKey)
    ) {
      await upsertSourceSession({
        source: "telegram",
        contextKey,
        title: String(session.title ?? `Telegram chat: ${transport.chatTitle}`),
        meta: {
          ...sessionMeta,
          transport: "telegram",
          chatId: transport.chatId,
          chatType: transport.chatType,
          chatTitle: transport.chatTitle,
          interactionProfileKey: interactionProfile?.key ?? null,
          interactionProfileVersion: interactionProfile?.version ?? null,
          requestedSkills: interactionProfile?.skills ?? [],
          runtimeContinuationId,
          runtimeKey: result.runtimeKey,
          runtimeProvider: result.provider,
        },
        lastMessageAt: nowUtcIso(),
      });
    }

    const sent = await sendSanitizedTelegramAssistantMessage(transport, result.responseText);
    await appendSessionMessage({
      sessionId: String(session.id),
      role: "assistant",
      source: "telegram",
      sourceMessageId: sent.sourceMessageId,
      content: sent.text,
      meta: { runtimeContinuationId, redactions: sent.redactions, accessPolicy },
      createdAt: nowUtcIso(),
    });
  } catch (error) {
    const errorMessage = describeError(error);
    const reply =
      "I hit a chat-engine error. This bridge can keep the Telegram chat and session state, but the model-backed reply path is not available right now. " +
      `Error: ${errorMessage}`;
    const sent = await sendSanitizedTelegramAssistantMessage(transport, reply);
    await appendSessionMessage({
      sessionId: String(session.id),
      role: "assistant",
      source: "telegram",
      sourceMessageId: sent.sourceMessageId,
      content: sent.text,
      meta: { runtimeContinuationId, failed: true, redactions: sent.redactions, accessPolicy },
      createdAt: nowUtcIso(),
    });
  } finally {
    await clearThinking().catch((error) => {
      console.warn("[source-adapter] Telegram thinking indicator cleanup failed", describeError(error));
    });
    stopTyping();
  }
}

async function handleTelegramChatUpdate(update: JsonObject): Promise<boolean> {
  const message = telegramMessageFromUpdate(update);
  if (!message) {
    return false;
  }
  const chat = message.chat;
  if (!chat || typeof chat !== "object" || Array.isArray(chat)) {
    return false;
  }
  const chatIdValue = chat.id;
  if (typeof chatIdValue !== "string" && typeof chatIdValue !== "number") {
    return false;
  }
  const chatId = String(chatIdValue);
  const chatType = typeof chat.type === "string" ? chat.type : "unknown";
  if (chatType === "private" && !adapterConfig().telegramDmEnabled) {
    return false;
  }
  const user = telegramUserFromMessage(message);
  const userIdValue = user?.id;
  if (typeof userIdValue !== "string" && typeof userIdValue !== "number") {
    return false;
  }
  const prompt = cleanTelegramPrompt({
    text: telegramTextFromMessage(message),
    botUsername: await getTelegramBotUsername(),
    chatType,
  });
  if (!prompt) {
    return false;
  }

  const accessPolicy = await resolveTelegramAccessPolicy({
    chatId,
    authorId: String(userIdValue),
  });
  if (accessPolicy.mode === "off") {
    return false;
  }

  const messageId = typeof message.message_id === "number" ? String(message.message_id) : null;
  const dateSeconds = typeof message.date === "number" ? message.date : null;
  const createdAt = dateSeconds ? new Date(dateSeconds * 1000).toISOString() : nowUtcIso();
  await enqueueDiscordPrompt(`telegram:${chatId}`, async () => {
    await runTelegramPrompt(prompt, {
      chatId,
      chatType,
      chatTitle: telegramChatTitle(chat),
      authorId: String(userIdValue),
      authorName: telegramUserDisplayName(user),
      userSourceMessageId: messageId,
      createdAt,
      sendTyping: async () => {
        await telegramApiRequest<JsonObject>("sendChatAction", {
          chat_id: chatId,
          action: "typing",
        });
      },
      sendThinkingMessage: async () => {
        const sent = await telegramApiRequest<JsonObject>("sendMessage", {
          chat_id: chatId,
          text: "🧠 Thinking...",
          ...(messageId ? { reply_to_message_id: Number(messageId) } : {}),
        });
        const sentMessageId = typeof sent.message_id === "number" ? sent.message_id : null;
        return async () => {
          if (sentMessageId === null) {
            return;
          }
          await telegramApiRequest<JsonObject>("deleteMessage", {
            chat_id: chatId,
            message_id: sentMessageId,
          });
        };
      },
      sendAssistantMessage: async (content) => {
        const sent = await sendTelegramMessage(chatId, content, { replyToMessageId: messageId });
        const messages = Array.isArray(sent.messages) ? sent.messages : [];
        const first = messages[0];
        const firstMessageId = first && typeof first === "object" && !Array.isArray(first) && typeof first.id === "string"
          ? first.id
          : null;
        return { sourceMessageId: firstMessageId };
      },
    });
  });
  return true;
}

async function pollTelegramDiscoveryOnce(): Promise<number> {
  const offset = await readTelegramOffset();
  const result = await telegramApiRequest<JsonValue[]>("getUpdates", {
    ...(offset !== null ? { offset } : {}),
    timeout: 0,
    allowed_updates: ["message", "channel_post", "edited_message", "edited_channel_post", "my_chat_member"],
  });
  if (!Array.isArray(result)) {
    return 0;
  }
  let nextOffset = offset;
  let seenChats = 0;
  for (const update of result) {
    if (!update || typeof update !== "object" || Array.isArray(update)) {
      continue;
    }
    const record = update as JsonObject;
    const updateId = typeof record.update_id === "number" ? record.update_id : null;
    if (updateId !== null) {
      nextOffset = Math.max(nextOffset ?? 0, updateId + 1);
    }
    const chat = telegramChatFromUpdate(record);
    if (chat && await rememberTelegramChat(chat)) {
      seenChats += 1;
    }
    await handleTelegramChatUpdate(record);
  }
  if (nextOffset !== null && nextOffset !== offset) {
    await saveTelegramOffset(nextOffset);
  }
  return seenChats;
}

function startTelegramDiscoveryPolling(): (() => void) | null {
  const config = adapterConfig();
  if (!config.telegramDiscoveryEnabled || !(process.env.TELEGRAM_BOT_TOKEN ?? "").trim()) {
    return null;
  }

  let stopped = false;
  let running = false;
  const poll = async () => {
    if (stopped || running) return;
    running = true;
    try {
      const seenChats = await pollTelegramDiscoveryOnce();
      if (seenChats > 0) {
        console.log(`[source-adapter] Telegram discovery saw ${seenChats} chat update(s)`);
      }
    } catch (error) {
      console.warn(`[source-adapter] Telegram discovery failed: ${describeError(error)}`);
    } finally {
      running = false;
    }
  };
  void poll();
  const timer = setInterval(() => void poll(), config.telegramPollIntervalSeconds * 1000);
  return () => {
    stopped = true;
    clearInterval(timer);
  };
}

async function postBatchToPrism(payload: JsonObject): Promise<JsonObject> {
  const config = adapterConfig();
  if (!config.prismApiBase) {
    throw new Error("PRISM_API_BASE is required for sync");
  }
  const response = await fetch(`${config.prismApiBase}${config.prismIngestPath}`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...((process.env.PRISM_API_KEY ?? "").trim() ? { "X-Prism-Api-Key": (process.env.PRISM_API_KEY ?? "").trim() } : {}),
    },
    body: JSON.stringify(payload),
  });
  if (!response.ok) {
    throw new Error(`Prism ingest failed: ${response.status} ${(await response.text()).slice(0, 200)}`);
  }
  return {
    status: response.status,
    url: `${config.prismApiBase}${config.prismIngestPath}`,
    body: (await response.json()) as JsonObject,
  };
}

async function normalizeDiscordMessage(input: {
  message: JsonObject;
  guildId: string;
  channel: JsonObject;
  threadParentId?: string | null;
  parentCategoryId?: string | null;
}): Promise<JsonObject> {
  const config = adapterConfig();
  const attachments = Array.isArray(input.message.attachments) ? (input.message.attachments.filter((item): item is JsonObject => !!item && typeof item === "object") as JsonObject[]) : [];
  const embeds = Array.isArray(input.message.embeds) ? (input.message.embeds.filter((item): item is JsonObject => !!item && typeof item === "object") as JsonObject[]) : [];
  const attachmentTexts: AttachmentText[] = [];
  for (const attachment of attachments.slice(0, config.discordAttachmentTextMaxFilesPerMessage)) {
    const extracted = await readAttachmentText(attachment, config);
    if (extracted) {
      attachmentTexts.push(extracted);
    }
  }
  const channelId = typeof input.channel.id === "string" ? input.channel.id : null;
  const messageId = typeof input.message.id === "string" ? input.message.id : null;
  return {
    source: "discord",
    guildId: input.guildId,
    channelId,
    threadId: [10, 11, 12].includes(Number(input.channel.type)) ? channelId : null,
    messageId,
    text: String(input.message.content ?? ""),
    renderedText: renderDiscordMessageText(String(input.message.content ?? ""), embeds, attachmentTexts, config),
    timestamp: typeof input.message.timestamp === "string" ? input.message.timestamp : null,
    author: buildMessageAuthor(input.message),
    metadata: {
      channelName: typeof input.channel.name === "string" ? input.channel.name : null,
      channelType: input.channel.type ?? null,
      parentChannelId: input.threadParentId ?? (typeof input.channel.parent_id === "string" ? input.channel.parent_id : null),
      parentCategoryId: input.parentCategoryId ?? null,
      messageUrl: channelId && messageId ? `https://discord.com/channels/${input.guildId}/${channelId}/${messageId}` : null,
      attachmentCount: attachments.length,
      attachments: attachments.map((attachment) => ({
        id: attachment.id ?? null,
        filename: attachment.filename ?? null,
        contentType: attachment.content_type ?? null,
        size: attachment.size ?? null,
        url: attachment.url ?? null,
      })),
      embeds: embeds.map((embed) => ({
        title: embed.title ?? null,
        description: embed.description ?? null,
        url: embed.url ?? null,
        type: embed.type ?? null,
      })),
      attachmentTexts,
    },
  };
}

async function fetchChannelMessages(channelId: string, since: Date, until: Date, maxMessages: number): Promise<JsonObject[]> {
  const collected: JsonObject[] = [];
  let before: string | undefined;
  while (collected.length < maxMessages) {
    const batch = await discordApiRequest<JsonValue[]>(`/channels/${channelId}/messages`, {
      limit: Math.min(100, maxMessages - collected.length),
      before,
    });
    if (!Array.isArray(batch) || batch.length === 0) {
      break;
    }
    let stop = false;
    for (const candidate of batch) {
      if (!candidate || typeof candidate !== "object" || Array.isArray(candidate)) {
        continue;
      }
      const timestampRaw = typeof candidate.timestamp === "string" ? candidate.timestamp : null;
      if (!timestampRaw) {
        continue;
      }
      const timestamp = parseIsoDate(timestampRaw);
      if (timestamp > until) {
        continue;
      }
      if (timestamp < since) {
        stop = true;
        break;
      }
      collected.push(candidate as JsonObject);
      if (collected.length >= maxMessages) {
        break;
      }
    }
    const oldest = batch.at(-1);
    before = oldest && typeof oldest === "object" && !Array.isArray(oldest) && typeof oldest.id === "string" ? oldest.id : undefined;
    if (stop || !before) {
      break;
    }
  }
  return collected;
}

async function fetchArchivedThreads(parentChannelId: string, isPrivate: boolean): Promise<JsonObject[]> {
  const payload = await discordApiRequest<JsonObject>(
    isPrivate ? `/channels/${parentChannelId}/threads/archived/private` : `/channels/${parentChannelId}/threads/archived/public`,
    { limit: 100 },
  );
  return Array.isArray(payload.threads) ? (payload.threads.filter((item): item is JsonObject => !!item && typeof item === "object") as JsonObject[]) : [];
}

async function computeSyncWindow(
  config: AdapterConfig,
  resetCheckpoint: boolean,
  windowHours = config.discordWindowHours,
): Promise<{ since: Date; until: Date; checkpoint: JsonObject | null }> {
  const until = new Date();
  if (resetCheckpoint) {
    return { since: new Date(until.getTime() - windowHours * 60 * 60 * 1000), until, checkpoint: null };
  }
  const checkpoint = await currentCheckpoint(config);
  if (!checkpoint || typeof checkpoint.cursorTimestamp !== "string" || !checkpoint.cursorTimestamp.trim()) {
    return { since: new Date(until.getTime() - windowHours * 60 * 60 * 1000), until, checkpoint };
  }
  let since = new Date(parseIsoDate(checkpoint.cursorTimestamp).getTime() - config.checkpointOverlapMinutes * 60 * 1000);
  if (since >= until) {
    since = new Date(until.getTime() - config.checkpointOverlapMinutes * 60 * 1000);
  }
  return { since, until, checkpoint };
}

async function updateCheckpoint(config: AdapterConfig, input: {
  since: Date;
  until: Date;
  messageCount: number;
  dryRun: boolean;
  state?: JsonObject;
}): Promise<JsonObject> {
  const checkpointRecord: JsonObject = {
    sourceKind: config.sourceKind,
    space: config.space,
    guildId: config.discordGuildId || null,
    cursorTimestamp: input.until.toISOString(),
    lastWindowSince: input.since.toISOString(),
    lastWindowUntil: input.until.toISOString(),
    lastMessageCount: input.messageCount,
    updatedAt: nowUtcIso(),
    ...(input.state ?? {}),
  };
  if (input.dryRun) {
    checkpointRecord.dryRun = true;
    return checkpointRecord;
  }
  const checkpoints = await loadCheckpoints();
  checkpoints[checkpointKey(config)] = checkpointRecord;
  await saveCheckpoints(checkpoints);
  return checkpointRecord;
}

async function collectDiscordBatch(resetCheckpoint = false): Promise<{ payload: JsonObject; summary: JsonObject; since: Date; until: Date }> {
  const config = adapterConfig();
  if (!config.discordGuildId) {
    throw new Error("DISCORD_GUILD_ID is required for discord sync");
  }
  const { since, until, checkpoint } = await computeSyncWindow(config, resetCheckpoint);
  const channelsPayload = await discordApiRequest<JsonValue[]>(`/guilds/${config.discordGuildId}/channels`);
  if (!Array.isArray(channelsPayload)) {
    throw new Error("Discord guild channels response was not a list");
  }
  const channels = channelsPayload.filter((item): item is JsonObject => !!item && typeof item === "object" && !Array.isArray(item));
  const channelById = new Map<string, JsonObject>();
  for (const channel of channels) {
    if (typeof channel.id === "string") {
      channelById.set(channel.id, channel);
    }
  }
  const textChannels = channels.filter((channel) => DISCORD_TEXT_CHANNEL_TYPES.has(Number(channel.type)));
  const parentChannels = channels.filter((channel) => DISCORD_PARENT_CHANNEL_TYPES.has(Number(channel.type)));
  const threadMap = new Map<string, JsonObject>();
  for (const channel of textChannels) {
    if ([10, 11, 12].includes(Number(channel.type)) && typeof channel.id === "string") {
      threadMap.set(channel.id, channel);
    }
  }
  if (config.discordIncludeArchivedThreads) {
    for (const parent of parentChannels) {
      if (typeof parent.id !== "string") {
        continue;
      }
      for (const isPrivate of [false, true]) {
        try {
          for (const thread of await fetchArchivedThreads(parent.id, isPrivate)) {
            if (typeof thread.id === "string") {
              threadMap.set(thread.id, thread);
            }
          }
        } catch (error) {
          if (!describeError(error).includes("403")) {
            throw error;
          }
        }
      }
    }
  }

  const targetChannels = [...textChannels, ...threadMap.values()].filter((channel, index, list) => {
    const id = typeof channel.id === "string" ? channel.id : null;
    return !!id && list.findIndex((entry) => entry.id === id) === index;
  });

  const normalizedMessages: JsonObject[] = [];
  const skippedChannels: JsonObject[] = [];
  for (const channel of targetChannels) {
    if (typeof channel.id !== "string") {
      continue;
    }
    try {
      const messages = await fetchChannelMessages(channel.id, since, until, config.discordMaxMessagesPerChannel);
      for (const message of messages) {
        const author = message.author && typeof message.author === "object" ? (message.author as JsonObject) : {};
        if (config.discordIgnoreBotMessages && Boolean(author.bot)) {
          continue;
        }
        const channelParentId = typeof channel.parent_id === "string" ? channel.parent_id : null;
        const parentChannel = channelParentId ? channelById.get(channelParentId) : null;
        const parentCategoryId = [10, 11, 12].includes(Number(channel.type))
          ? (parentChannel && typeof parentChannel.parent_id === "string" ? parentChannel.parent_id : null)
          : channelParentId;
        normalizedMessages.push(
          await normalizeDiscordMessage({
            message,
            guildId: config.discordGuildId,
            channel,
            threadParentId: channelParentId,
            parentCategoryId,
          }),
        );
      }
    } catch (error) {
      skippedChannels.push({
        channelId: channel.id,
        channelName: typeof channel.name === "string" ? channel.name : null,
        reason: describeError(error),
      });
    }
  }

  return {
    payload: {
      source: "discord",
      space: config.space,
      batchId: `discord-${config.discordGuildId}-${until.toISOString().replace(/[-:]/g, "").replace(/\.\d+Z$/, "Z")}`,
      messages: normalizedMessages,
    },
    summary: {
      guildId: config.discordGuildId,
      window: { since: since.toISOString(), until: until.toISOString() },
      checkpoint: { used: Boolean(checkpoint), value: checkpoint, path: checkpointPath() },
      channelCount: targetChannels.length,
      messageCount: normalizedMessages.length,
      skippedChannels,
    },
    since,
    until,
  };
}

async function collectBuzzBatch(resetCheckpoint = false): Promise<{
  payload: JsonObject;
  summary: JsonObject;
  since: Date;
  until: Date;
  checkpointState: JsonObject;
}> {
  const config = adapterConfig();
  const historyAllowlist = config.buzzHistoryChannelAllowlist.length > 0
    ? config.buzzHistoryChannelAllowlist
    : config.buzzChannelAllowlist;
  const client = buzzClient(historyAllowlist);
  const { since, until, checkpoint } = await computeSyncWindow(config, resetCheckpoint, config.buzzWindowHours);
  const migratedLegacyCheckpoint = Boolean(
    checkpoint
    && !Array.isArray(checkpoint.recentEventIds)
    && typeof checkpoint.cursorTimestamp === "string"
    && checkpoint.cursorTimestamp,
  );
  const channels = await client.listChannels();
  const collected: Array<{ channel: Awaited<ReturnType<typeof client.listChannels>>[number]; event: Awaited<ReturnType<typeof client.getMessages>>[number] }> = [];
  const skippedChannels: JsonObject[] = [];

  for (const channel of channels) {
    try {
      const events = await client.getMessages(channel.channelId, since);
      for (const event of events) {
        const timestamp = new Date(event.createdAt * 1000);
        if (timestamp >= since && timestamp <= until) {
          collected.push({ channel, event });
        }
      }
    } catch (error) {
      skippedChannels.push({
        channelId: channel.channelId,
        channelName: channel.name,
        reason: describeError(error),
      });
    }
  }

  const recentEventIds = migratedLegacyCheckpoint
    ? collected.map(({ event }) => event.id)
    : checkpoint && Array.isArray(checkpoint.recentEventIds)
      ? checkpoint.recentEventIds.filter((entry): entry is string => typeof entry === "string" && entry.length > 0)
      : [];
  const selected = selectUnseenBuzzEvents(collected, recentEventIds, config.buzzCheckpointEventLimit);
  const profiles = await client.getProfiles(selected.unseen.map(({ event }) => event.pubkey));
  const normalizedMessages = selected.unseen
    .sort((left, right) => left.event.createdAt - right.event.createdAt || left.event.id.localeCompare(right.event.id))
    .map(({ channel, event }) => normalizeBuzzMessage({
      event,
      channel,
      profile: profiles.get(event.pubkey) ?? null,
      relayUrl: config.buzzRelayUrl,
    }) as JsonObject);

  return {
    payload: {
      source: "buzz",
      space: config.space,
      batchId: `buzz-${until.toISOString().replace(/[-:]/g, "").replace(/\.\d+Z$/, "Z")}`,
      messages: normalizedMessages,
    },
    summary: {
      relayUrl: config.buzzRelayUrl,
      window: { since: since.toISOString(), until: until.toISOString() },
      checkpoint: { used: Boolean(checkpoint), value: checkpoint, path: checkpointPath() },
      channelCount: channels.length,
      allowlistedChannelIds: historyAllowlist,
      messageCount: normalizedMessages.length,
      duplicateEventCount: selected.duplicateCount,
      migratedLegacyCheckpoint,
      skippedChannels,
    },
    since,
    until,
    checkpointState: {
      recentEventIds: selected.recentEventIds,
    },
  };
}

function isAsyncChangeRequestCommand(prompt: string): boolean {
  return CHANGE_REQUEST_ASYNC_PATTERN.test(prompt.trim());
}

function buildAsyncChangeRequestAck(prompt: string): string {
  const normalized = prompt.trim().split(/\s+/).join(" ");
  return `Started: ${normalized}\n\nI’ll continue this change-request run in the background and post the result in this thread.`;
}

function promptLikelyRequiresWriteAccess(prompt: string): boolean {
  const normalized = prompt.trim();
  return WRITE_INTENT_PATTERN.test(normalized) && WRITE_TARGET_PATTERN.test(normalized);
}

function readonlyWriteAccessMessage(): string {
  return "This chat is set to read-only, and that request needs more permissions.";
}

function isBridgeThread(channel: TextBasedChannel): channel is AnyThreadChannel {
  return "isThread" in channel && typeof channel.isThread === "function" && channel.isThread() && channel.name.toLowerCase().startsWith(BRIDGE_THREAD_PREFIX);
}

function shouldHandleMessage(message: Message, clientUserId: string, guildId: string): boolean {
  if (!message.inGuild() || message.author.bot || message.guildId !== guildId) {
    return false;
  }
  return message.mentions.users.has(clientUserId);
}

function cleanPrompt(message: Message, botUserId: string): string {
  return message.content.replace(new RegExp(`<@!?${botUserId}>`, "g"), "").trim();
}

function cleanDiscordMessageContent(message: Message, botUserId?: string): string {
  const content = botUserId ? cleanPrompt(message, botUserId) : message.content.trim();
  return truncateText(content || "[no text content]", DISCORD_MESSAGE_MAX_LENGTH);
}

function summarizeDiscordContextMessage(message: Message, kind: string, botUserId?: string): DiscordContextMessage {
  const attachments = [...message.attachments.values()].slice(0, 5).map((attachment) => ({
    id: attachment.id,
    filename: attachment.name ?? attachment.id,
    contentType: attachment.contentType ?? null,
    size: attachment.size ?? null,
    url: attachment.url ?? null,
  }));
  const summary: DiscordContextMessage = {
    kind,
    id: message.id,
    channelId: message.channel.id,
    authorId: message.author.id,
    authorName: message.member?.displayName ?? message.author.displayName ?? message.author.username,
    authorBot: message.author.bot,
    content: cleanDiscordMessageContent(message, botUserId),
    createdAt: message.createdAt.toISOString(),
    url: message.url,
  };
  if (attachments.length) {
    summary.attachments = attachments;
  }
  return summary;
}

async function fetchReferencedMessage(message: Message): Promise<Message | null> {
  if (!message.reference?.messageId || typeof message.fetchReference !== "function") {
    return null;
  }
  return await message.fetchReference();
}

async function fetchThreadStarterMessage(channel: TextBasedChannel): Promise<Message | null> {
  if (!channel.isThread() || !("fetchStarterMessage" in channel) || typeof channel.fetchStarterMessage !== "function") {
    return null;
  }
  return await channel.fetchStarterMessage();
}

function sameDiscordMessage(left: DiscordContextMessage | undefined, right: DiscordContextMessage | undefined): boolean {
  return Boolean(left && right && left.id === right.id && left.channelId === right.channelId);
}

async function collectDiscordPromptContext(message: Message, botUserId: string): Promise<DiscordPromptContext | null> {
  const context: DiscordPromptContext = {};
  const fetchErrors: string[] = [];

  try {
    const replyTo = await fetchReferencedMessage(message);
    if (replyTo) {
      context.replyTo = summarizeDiscordContextMessage(replyTo, "reply_to", botUserId);
    }
  } catch (error) {
    fetchErrors.push(`reply_to:${describeError(error)}`);
  }

  try {
    const starter = await fetchThreadStarterMessage(message.channel);
    if (starter && starter.id !== message.id) {
      const threadStarter = summarizeDiscordContextMessage(starter, "thread_starter", botUserId);
      if (!sameDiscordMessage(context.replyTo, threadStarter)) {
        context.threadStarter = threadStarter;
      }
      const starterReplyTo = await fetchReferencedMessage(starter);
      if (starterReplyTo) {
        const summarizedStarterReply = summarizeDiscordContextMessage(starterReplyTo, "thread_starter_reply_to", botUserId);
        if (!sameDiscordMessage(context.replyTo, summarizedStarterReply) && !sameDiscordMessage(context.threadStarter, summarizedStarterReply)) {
          context.threadStarterReplyTo = summarizedStarterReply;
        }
      }
    }
  } catch (error) {
    fetchErrors.push(`thread_starter:${describeError(error)}`);
  }

  if (fetchErrors.length) {
    context.fetchErrors = fetchErrors.slice(0, 5);
  }
  return Object.keys(context).length ? context : null;
}

function formatDiscordContextMessage(label: string, message: DiscordContextMessage | undefined): string[] {
  if (!message) {
    return [];
  }
  const attachmentCount = Array.isArray(message.attachments) ? message.attachments.length : 0;
  return [
    `${label}:`,
    `- Author: ${message.authorName}${message.authorBot ? " (bot)" : ""}`,
    `- Created: ${message.createdAt}`,
    `- URL: ${message.url}`,
    `- Content: ${message.content}`,
    attachmentCount ? `- Attachments: ${attachmentCount}` : null,
  ].filter((line): line is string => Boolean(line));
}

function buildDiscordRuntimePrompt(prompt: string, context: DiscordPromptContext | null): string {
  if (!context) {
    return prompt;
  }
  const lines = [
    "Discord context for this turn:",
    ...formatDiscordContextMessage("Message being replied to", context.replyTo),
    ...formatDiscordContextMessage("Thread starter", context.threadStarter),
    ...formatDiscordContextMessage("Message the thread starter replied to", context.threadStarterReplyTo),
    "",
    "User message:",
    prompt,
  ];
  return lines.join("\n");
}

function roleIdsFromMessage(message: Message): string[] {
  return message.member?.roles.cache.map((role) => role.id) ?? [];
}

function roleIdsFromInteraction(interaction: ChatInputCommandInteraction): string[] {
  const roles = interaction.member && typeof interaction.member === "object" && "roles" in interaction.member
    ? interaction.member.roles
    : null;
  if (Array.isArray(roles)) {
    return roles.filter((role): role is string => typeof role === "string");
  }
  if (roles && typeof roles === "object" && "cache" in roles) {
    const cache = (roles as { cache?: { map?: (callback: (role: { id: string }) => string) => string[] } }).cache;
    if (cache && typeof cache.map === "function") {
      return cache.map((role) => role.id);
    }
  }
  return [];
}

async function ensureConversationThread(message: Message): Promise<TextBasedChannel | null> {
  if (message.channel.isThread()) {
    return message.channel;
  }
  if (!(message.channel instanceof TextChannel)) {
    return null;
  }
  if ("hasThread" in message && Boolean((message as Message & { hasThread?: boolean }).hasThread)) {
    const existingThread = (message as Message & { thread?: TextBasedChannel | null }).thread ?? null;
    if (existingThread) {
      if ("join" in existingThread && typeof existingThread.join === "function") {
        await existingThread.join().catch(() => {});
      }
      console.log("[discord-adapter] reusing existing message thread", {
        guildId: message.guildId,
        channelId: message.channel.id,
        messageId: message.id,
        threadId: "id" in existingThread ? existingThread.id : null,
      });
      return existingThread;
    }
  }
  try {
    const thread = await message.startThread({
      name: `Prism ${message.member?.displayName ?? message.author.displayName}`.slice(0, 100),
      autoArchiveDuration: ThreadAutoArchiveDuration.OneDay,
    });
    if ("join" in thread && typeof thread.join === "function") {
      await thread.join().catch(() => {});
    }
    console.log("[discord-adapter] created conversation thread", {
      guildId: message.guildId,
      channelId: message.channel.id,
      messageId: message.id,
      threadId: thread.id,
      threadName: thread.name,
    });
    return thread;
  } catch (error) {
    const existingThread = (message as Message & { thread?: TextBasedChannel | null }).thread ?? null;
    if (existingThread) {
      if ("join" in existingThread && typeof existingThread.join === "function") {
        await existingThread.join().catch(() => {});
      }
      console.warn("[discord-adapter] thread creation failed; using existing thread", {
        guildId: message.guildId,
        channelId: message.channel.id,
        messageId: message.id,
        threadId: "id" in existingThread ? existingThread.id : null,
        error: describeError(error),
      });
      return existingThread;
    }
    const botPermissions = message.guild?.members.me ? message.channel.permissionsFor(message.guild.members.me) : null;
    console.warn("[discord-adapter] thread creation failed", {
      guildId: message.guildId,
      channelId: message.channel.id,
      channelName: message.channel.name,
      canViewChannel: botPermissions?.has(PermissionFlagsBits.ViewChannel) ?? null,
      canSendMessages: botPermissions?.has(PermissionFlagsBits.SendMessages) ?? null,
      canCreatePublicThreads: botPermissions?.has(PermissionFlagsBits.CreatePublicThreads) ?? null,
      canSendMessagesInThreads: botPermissions?.has(PermissionFlagsBits.SendMessagesInThreads) ?? null,
      canReadMessageHistory: botPermissions?.has(PermissionFlagsBits.ReadMessageHistory) ?? null,
      error: describeError(error),
    });
    return null;
  }
}

async function sendReply(channel: TextBasedChannel, content: string): Promise<Message | null> {
  if (!("send" in channel) || typeof channel.send !== "function") {
    return null;
  }
  return (await channel.send(content)) as Message;
}

const DISCORD_MESSAGE_MAX_LENGTH = 2000;

function splitDiscordMessage(content: string, maxLength = DISCORD_MESSAGE_MAX_LENGTH): string[] {
  const normalized = content.replace(/\r\n/g, "\n").trim();
  if (!normalized) {
    return [""];
  }
  if (normalized.length <= maxLength) {
    return [normalized];
  }

  const chunks: string[] = [];
  let remaining = normalized;
  while (remaining.length > maxLength) {
    let splitAt = remaining.lastIndexOf("\n\n", maxLength);
    if (splitAt < Math.floor(maxLength * 0.5)) {
      splitAt = remaining.lastIndexOf("\n", maxLength);
    }
    if (splitAt < Math.floor(maxLength * 0.5)) {
      splitAt = remaining.lastIndexOf(" ", maxLength);
    }
    if (splitAt <= 0) {
      splitAt = maxLength;
    }
    const chunk = remaining.slice(0, splitAt).trim();
    if (chunk) {
      chunks.push(chunk);
    }
    remaining = remaining.slice(splitAt).trim();
  }
  if (remaining) {
    chunks.push(remaining);
  }
  return chunks.length ? chunks : [normalized.slice(0, maxLength)];
}

type DiscordPromptTransport = {
  guildId: string;
  channelId: string;
  threadId: string | null;
  channelName: string | null;
  threadName: string | null;
  authorId: string;
  authorName: string;
  authorRoleIds: string[];
  userSourceMessageId: string | null;
  createdAt: string;
  context: DiscordPromptContext | null;
  sendTyping?: () => Promise<void>;
  sendAssistantMessage: (content: string) => Promise<{ sourceMessageId: string | null }>;
};

type DiscordContextMessage = JsonObject & {
  id: string;
  channelId: string;
  authorId: string;
  authorName: string;
  authorBot: boolean;
  content: string;
  createdAt: string;
  url: string;
};

type DiscordPromptContext = JsonObject & {
  replyTo?: DiscordContextMessage;
  threadStarter?: DiscordContextMessage;
  threadStarterReplyTo?: DiscordContextMessage;
  fetchErrors?: string[];
};

function discordSourceAttachmentInstructions(): string {
  return [
    "When a Discord user asks to summarize, inspect, use, save, or promote an attachment from a Discord message link, use the Prism Agent API route POST /agent/source-attachments/resolve-and-ingest with x-service-token auth.",
    "Use intent summarize for read/summarize/inspect requests and intent promote-memory for save/add/promote-to-memory requests. Both create Memory inbox context for text-like attachments.",
    "Use intent workflow-input or request-artifact only when the user is operating on a tracked request/workflow and a requestId is available.",
    "If the user asks to promote an attachment to Knowledge, explain that source-backed Knowledge is usually better for canonical long-term docs and ask for confirmation before continuing.",
    "If the resolver returns multiple attachments, ask the user which attachment to use instead of guessing.",
    "Do not rely on raw Discord CDN URLs as durable storage.",
  ].join(" ");
}

async function sendSanitizedAssistantMessage(
  transport: DiscordPromptTransport,
  content: string,
): Promise<{ sourceMessageId: string | null; text: string; redactions: ReturnType<typeof sanitizePublicOutput>["redactions"] }> {
  const sanitized = sanitizePublicOutput(content);
  if (sanitized.redactions.length) {
    console.warn("[discord-adapter] sanitized public Discord reply", {
      guildId: transport.guildId,
      channelId: transport.channelId,
      threadId: transport.threadId,
      redactions: sanitized.redactions,
    });
  }
  const sent = await transport.sendAssistantMessage(sanitized.text);
  return { ...sent, text: sanitized.text, redactions: sanitized.redactions };
}

function startTypingHeartbeat(sendTyping: (() => Promise<void>) | undefined): () => void {
  if (!sendTyping) {
    return () => undefined;
  }
  let stopped = false;
  const tick = () => {
    void sendTyping().catch((error) => {
      console.warn("[discord-adapter] sendTyping failed", describeError(error));
    });
  };
  tick();
  const timer = setInterval(() => {
    if (!stopped) {
      tick();
    }
  }, 8_000);
  return () => {
    stopped = true;
    clearInterval(timer);
  };
}

async function runDiscordPrompt(prompt: string, transport: DiscordPromptTransport): Promise<void> {
  const accessPolicy = await resolveDiscordAccessPolicy({
    channelId: transport.channelId,
    threadId: transport.threadId,
    authorId: transport.authorId,
    roleIds: transport.authorRoleIds,
  });
  const routingStatus = discordAgentRoutingStatus(accessPolicy);
  if (routingStatus === "unavailable") {
    await sendSanitizedAssistantMessage(transport, unavailableDiscordAgentMessage);
    return;
  }
  if (routingStatus === "unconfigured") {
    await sendSanitizedAssistantMessage(transport, unconfiguredDiscordChannelMessage(transport.channelId));
    return;
  }
  if (routingStatus === "disabled") {
    await sendSanitizedAssistantMessage(
      transport,
      "Prism is not enabled for this Discord channel.",
    );
    return;
  }
  if (accessPolicy.mode === "readonly" && promptLikelyRequiresWriteAccess(prompt)) {
    await sendSanitizedAssistantMessage(transport, readonlyWriteAccessMessage());
    return;
  }
  let interactionProfile: ExternalInteractionAuthorization["profile"] | null = null;
  try {
    interactionProfile = await referencedInteractionProfile(accessPolicy);
  } catch (error) {
    console.error("[discord-adapter] interaction profile resolution failed", describeError(error));
    await sendSanitizedAssistantMessage(transport, "Prism's interaction profile is unavailable for this channel. Please try again later.");
    return;
  }
  const canSendAdapterMessages = accessPolicy.capabilities.includes("adapter.send_message");

  const userLimit = checkDiscordRateLimit(
    `discord:user:${transport.authorId}:${accessPolicy.mode}`,
    accessPolicy.rateLimit,
  );
  const channelLimit = checkDiscordRateLimit(
    `discord:channel:${transport.threadId ?? transport.channelId}:${accessPolicy.mode}`,
    {
      windowSeconds: accessPolicy.rateLimit.windowSeconds,
      maxRequests: Math.max(1, accessPolicy.rateLimit.maxRequests * 2),
    },
  );
  const blockedLimit = !userLimit.ok ? userLimit : !channelLimit.ok ? channelLimit : null;
  if (blockedLimit) {
    await sendSanitizedAssistantMessage(
      transport,
      `Prism is rate limited here. Try again in about ${blockedLimit.retryAfterSeconds} seconds.`,
    );
    return;
  }

  let existing: JsonObject | null = null;
  try {
    existing = await lookupDiscordSession(transport.channelId, transport.threadId);
  } catch (error) {
    console.warn("[discord-adapter] session lookup failed", describeError(error));
  }

  const session = await upsertDiscordSession({
    title: `Discord chat: ${prompt.slice(0, 80)}`,
    discordGuildId: transport.guildId,
    discordChannelId: transport.channelId,
    discordThreadId: transport.threadId,
    meta: {
      transport: "discord",
      channelName: transport.channelName,
      threadName: transport.threadName,
      discordContext: transport.context,
      accessPolicy,
      interactionProfileKey: interactionProfile?.key ?? null,
      interactionProfileVersion: interactionProfile?.version ?? null,
    },
    lastMessageAt: transport.createdAt,
  });

  await appendSessionMessage({
    sessionId: String(session.id),
    role: "user",
    source: "discord",
    sourceMessageId: transport.userSourceMessageId,
    content: prompt,
    meta: {
      authorId: transport.authorId,
      authorName: transport.authorName,
      authorRoleIds: transport.authorRoleIds,
      discordContext: transport.context,
      accessPolicy,
    },
    createdAt: transport.createdAt,
  });

  const existingMessages = Array.isArray(existing?.messages) ? existing.messages : [];
  const recentHistory = existingMessages
    .slice(-12)
    .filter((entry): entry is JsonObject => !!entry && typeof entry === "object" && !Array.isArray(entry))
    .map((entry) => ({
      role: typeof entry.role === "string" ? entry.role : "user",
      content: typeof entry.content === "string" ? entry.content : "",
    }))
    .filter((entry) => entry.content);

  const existingSession = existing?.session && typeof existing.session === "object" ? (existing.session as JsonObject) : {};
  const sessionMeta = session.meta && typeof session.meta === "object" ? (session.meta as JsonObject) : {};
  const existingMeta = externalSessionMeta(existingSession);
  const sessionRuntimeKey =
    (typeof existingSession.meta === "object" && existingSession.meta && typeof (existingSession.meta as JsonObject).runtimeKey === "string"
      ? String((existingSession.meta as JsonObject).runtimeKey)
      : null) ||
    (typeof sessionMeta.runtimeKey === "string" ? sessionMeta.runtimeKey : null);
  let runtimeContinuationId =
    (typeof existingSession.meta === "object" && existingSession.meta && typeof (existingSession.meta as JsonObject).runtimeContinuationId === "string"
      ? String((existingSession.meta as JsonObject).runtimeContinuationId)
      : typeof existingSession.meta === "object" && existingSession.meta && typeof (existingSession.meta as JsonObject).codexThreadId === "string"
        ? String((existingSession.meta as JsonObject).codexThreadId)
      : null) ||
    (typeof sessionMeta.runtimeContinuationId === "string"
      ? sessionMeta.runtimeContinuationId
      : typeof sessionMeta.codexThreadId === "string" ? sessionMeta.codexThreadId : null);
  if (
    (existingMeta.interactionProfileKey ?? null) !== (interactionProfile?.key ?? null)
    || (existingMeta.interactionProfileVersion ?? null) !== (interactionProfile?.version ?? null)
  ) runtimeContinuationId = null;
  const gatewayCredentials = await resolveInteractiveGatewayCredentials({
    platform: "discord",
    targetId: transport.channelId,
    threadId: transport.threadId,
    groupIds: transport.authorRoleIds,
    userId: transport.authorId,
  });

  const runAndSendRuntimeReply = async () => {
    const stopTyping = startTypingHeartbeat(transport.sendTyping);
    try {
      const runtimePrompt = buildDiscordRuntimePrompt(prompt, transport.context);
      const result = await runtimeRequest({
        prompt: runtimePrompt,
        sessionId: String(session.id),
        continuationId: runtimeContinuationId,
        recentHistory,
        credentials: gatewayCredentials,
        runtimeProfileKey: interactionProfile?.runtimeProfileKey ?? null,
        gatewayContext: {
          delegatedActorId: `discord:${transport.authorId}`,
        },
        metadata: {
          transport: "discord",
          sessionRuntimeKey,
          discordGuildId: transport.guildId,
          discordChannelId: transport.channelId,
          discordThreadId: transport.threadId,
          discordAuthorId: transport.authorId,
          discordAuthorRoleIds: transport.authorRoleIds,
          discordContext: transport.context,
          discordAccessPolicy: accessPolicy,
          interactionProfileKey: interactionProfile?.key ?? null,
          interactionProfileVersion: interactionProfile?.version ?? null,
          requestedSkills: interactionProfile?.skills ?? [],
          allowedWorkflows: interactionProfile?.allowedWorkflows ?? [],
          memoryScope: interactionProfile?.memoryScope ?? null,
          requestOrigin: { sourceSessionId: String(session.id), sourceMessageId: transport.userSourceMessageId },
          policyInstructions: [
            communicationProfileInstructions(interactionProfile, accessPolicy),
            accessPolicy.mode !== "readonly" && accessPolicy.capabilities.includes("requests.create")
              ? `When creating a request with POST /agent/change-board/requests, include sourceSessionId ${String(session.id)} and sourceMessageId ${transport.userSourceMessageId ?? "null"}; do not supply identity display fields.`
              : "",
          ].filter(Boolean).join("\n\n"),
          adapterCapabilities: {
            adapter: "communication",
            capabilities: canSendAdapterMessages ? ["list-destinations", "send-message"] : [],
            destinationTypes: canSendAdapterMessages ? ["discord-channel", "discord-forum", "telegram-chat", "telegram-channel"] : [],
            instructions: canSendAdapterMessages
              ? "Resolve the destination first. For a Discord forum, POST /messages with type=discord-forum and a title; the adapter also infers forum type when omitted."
              : null,
          },
          sourceAttachmentInstructions: discordSourceAttachmentInstructions(),
          availableOutputDestinations: canSendAdapterMessages
            ? await listAdapterDestinations().catch((error) => {
                console.warn("[discord-adapter] destination discovery failed", describeError(error));
                return [];
              })
            : [],
        },
      });
      const reply = result.responseText;
      runtimeContinuationId = result.continuationId ?? runtimeContinuationId;

      if (
        (runtimeContinuationId && runtimeContinuationId !== sessionMeta.runtimeContinuationId) ||
        (result.runtimeKey && result.runtimeKey !== sessionMeta.runtimeKey)
      ) {
        await upsertDiscordSession({
          title: String(session.title ?? `Discord chat: ${prompt.slice(0, 80)}`),
          discordGuildId: transport.guildId,
          discordChannelId: transport.channelId,
          discordThreadId: transport.threadId,
          meta: {
            ...sessionMeta,
            transport: "discord",
            channelName: transport.channelName,
            threadName: transport.threadName,
            interactionProfileKey: interactionProfile?.key ?? null,
            interactionProfileVersion: interactionProfile?.version ?? null,
            runtimeContinuationId,
            runtimeKey: result.runtimeKey,
            runtimeProvider: result.provider,
          },
          lastMessageAt: nowUtcIso(),
        });
      }

      const sent = await sendSanitizedAssistantMessage(transport, reply);
      await appendSessionMessage({
        sessionId: String(session.id),
        role: "assistant",
        source: "discord",
        sourceMessageId: sent.sourceMessageId,
        content: sent.text,
        meta: { inThread: Boolean(transport.threadId), runtimeContinuationId, redactions: sent.redactions, accessPolicy },
        createdAt: nowUtcIso(),
      });
    } catch (error) {
      const errorMessage = describeError(error);
      console.error("[discord-adapter] runtime request failed", {
        sessionId: String(session.id),
        runtimeKey: sessionMeta.runtimeKey ?? null,
        guildId: transport.guildId,
        channelId: transport.channelId,
        threadId: transport.threadId,
        error: errorMessage,
      });
      const reply =
        "I hit a chat-engine error. This bridge can keep the Discord thread and session state, but the model-backed reply path is not available right now. " +
        `Error: ${errorMessage}`;
      const sent = await sendSanitizedAssistantMessage(transport, reply);
      await appendSessionMessage({
        sessionId: String(session.id),
        role: "assistant",
        source: "discord",
        sourceMessageId: sent.sourceMessageId,
        content: sent.text,
        meta: { inThread: Boolean(transport.threadId), runtimeContinuationId, failed: true, redactions: sent.redactions, accessPolicy },
        createdAt: nowUtcIso(),
      });
    } finally {
      stopTyping();
    }
  };

  if (isAsyncChangeRequestCommand(prompt) && accessPolicy.capabilities.includes("workflows.run_existing")) {
    const ack = buildAsyncChangeRequestAck(prompt);
    const sent = await sendSanitizedAssistantMessage(transport, ack);
    await appendSessionMessage({
      sessionId: String(session.id),
      role: "assistant",
      source: "discord",
      sourceMessageId: sent.sourceMessageId,
      content: sent.text,
      meta: { inThread: Boolean(transport.threadId), runtimeContinuationId, asyncAck: true, redactions: sent.redactions, accessPolicy },
      createdAt: nowUtcIso(),
    });
    void runAndSendRuntimeReply();
    return;
  }

  await runAndSendRuntimeReply();
}

async function enqueueDiscordPrompt(queueKey: string, run: () => Promise<void>): Promise<void> {
  const previous = discordPromptQueues.get(queueKey) ?? Promise.resolve();
  const next = previous.catch(() => undefined).then(run);
  discordPromptQueues.set(
    queueKey,
    next.finally(() => {
      if (discordPromptQueues.get(queueKey) === next) {
        discordPromptQueues.delete(queueKey);
      }
    }),
  );
  return next;
}

async function handleDiscordChatMessage(message: Message): Promise<void> {
  if (!bridgeClient?.user) {
    return;
  }
  const guildId = (process.env.DISCORD_GUILD_ID ?? "").trim();
  if (!guildId || !shouldHandleMessage(message, bridgeClient.user.id, guildId)) {
    return;
  }
  const prompt = cleanPrompt(message, bridgeClient.user.id);
  if (!prompt) {
    return;
  }
  const sourceThreadId = message.channel.isThread() ? message.channel.id : null;
  const sourceChannelId = message.channel.isThread() ? message.channel.parentId : message.channel.id;
  if (!sourceChannelId) {
    return;
  }
  const sourcePolicy = await resolveDiscordAccessPolicy({
    channelId: sourceChannelId,
    threadId: sourceThreadId,
    authorId: message.author.id,
    roleIds: roleIdsFromMessage(message),
  });
  const routingStatus = discordAgentRoutingStatus(sourcePolicy);
  if (routingStatus === "unavailable") {
    await message.reply({ content: unavailableDiscordAgentMessage, allowedMentions: { repliedUser: false } });
    return;
  }
  if (routingStatus === "unconfigured") {
    await message.reply({
      content: unconfiguredDiscordChannelMessage(sourceChannelId),
      allowedMentions: { repliedUser: false },
    });
    return;
  }
  if (routingStatus === "disabled") {
    return;
  }
  const targetChannel = (await ensureConversationThread(message)) ?? message.channel;
  const threadId = targetChannel.isThread() ? targetChannel.id : null;
  const channelId = targetChannel.isThread() ? targetChannel.parentId : targetChannel.id;
  if (!channelId) {
    return;
  }
  const context = await collectDiscordPromptContext(message, bridgeClient.user.id);
  console.log("[discord-adapter] handling mention prompt", {
    guildId: message.guildId,
    messageId: message.id,
    sourceChannelId: message.channel.id,
    targetChannelId: "id" in targetChannel ? targetChannel.id : null,
    targetIsThread: targetChannel.isThread(),
    threadId,
    channelId,
  });
  await enqueueDiscordPrompt(threadId ?? channelId, async () => {
    await runDiscordPrompt(prompt, {
      guildId: message.guildId!,
      channelId,
      threadId,
      channelName: "name" in message.channel ? message.channel.name : null,
      threadName: targetChannel.isThread() ? targetChannel.name : null,
      authorId: message.author.id,
      authorName: message.member?.displayName ?? message.author.displayName,
      authorRoleIds: roleIdsFromMessage(message),
      userSourceMessageId: message.id,
      createdAt: message.createdAt.toISOString(),
      context,
      sendTyping:
        "sendTyping" in targetChannel && typeof targetChannel.sendTyping === "function"
          ? async () => {
              await targetChannel.sendTyping();
            }
          : undefined,
      sendAssistantMessage: async (content) => {
        const parts = splitDiscordMessage(content);
        let firstMessageId: string | null = null;
        for (const part of parts) {
          const sent = await sendReply(targetChannel, part);
          if (!firstMessageId && sent?.id) {
            firstMessageId = sent.id;
          }
        }
        return { sourceMessageId: firstMessageId };
      },
    });
  });
}

type PromotionMessage = {
  id: string;
  authorName: string;
  authorId: string;
  content: string;
  createdAt: string;
  url: string;
  bot: boolean;
};

function slugifyDocTitle(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80) || `discord-doc-${new Date().toISOString().slice(0, 10)}`;
}

function memoryInboxArtifactUrl(pathname: string): string | null {
  const filename = path.basename(pathname.trim());
  const artifactId = filename.replace(/\.json$/i, "");
  if (!artifactId || artifactId === filename) {
    return null;
  }
  return `${prismArtifactBaseUrl()}/artifacts/${encodeURIComponent(artifactId)}`;
}

function discordMessageUrl(guildId: string, channelId: string, messageId: string): string {
  return `https://discord.com/channels/${guildId}/${channelId}/${messageId}`;
}

function truncateText(value: string, maxChars: number): string {
  if (value.length <= maxChars) {
    return value;
  }
  return `${value.slice(0, maxChars - 20).trimEnd()}\n...[truncated]`;
}

async function collectPromotionMessages(interaction: ChatInputCommandInteraction): Promise<PromotionMessage[]> {
  const channel = interaction.channel;
  if (!channel || !interaction.guildId || !("messages" in channel)) {
    throw new Error("This command must be used in a readable Discord text channel or thread.");
  }
  const cutoffTimestamp = interaction.createdTimestamp;
  const fetched = await channel.messages.fetch({ limit: PROMOTE_DOC_MESSAGE_LIMIT });
  return [...fetched.values()]
    .filter((message) => message.content.trim() && message.createdTimestamp <= cutoffTimestamp)
    .sort((left, right) => left.createdTimestamp - right.createdTimestamp)
    .map((message) => ({
      id: message.id,
      authorName: message.member?.displayName ?? message.author.displayName ?? message.author.username,
      authorId: message.author.id,
      content: message.content.trim(),
      createdAt: message.createdAt.toISOString(),
      url: discordMessageUrl(interaction.guildId!, message.channel.id, message.id),
      bot: message.author.bot,
    }));
}

function promotionTranscript(messages: PromotionMessage[]): string {
  return truncateText(
    messages
      .map((message) => `[${message.createdAt}] ${message.authorName}${message.bot ? " (bot)" : ""}: ${message.content}`)
      .join("\n\n"),
    PROMOTE_DOC_TRANSCRIPT_MAX_CHARS,
  );
}

function fallbackPromotedMarkdown(title: string, messages: PromotionMessage[], summary: string): string {
  const transcript = promotionTranscript(messages);
  return [
    `# ${title}`,
    "",
    "## Summary",
    "",
    summary || "Promoted from a Discord discussion.",
    "",
    "## Draft",
    "",
    "This document was promoted from Discord. Review and edit the draft before treating it as canonical.",
    "",
    "## Source Conversation",
    "",
    "```text",
    transcript,
    "```",
  ].join("\n");
}

function cleanMarkdownResponse(value: string): string {
  const trimmed = value.trim();
  const fence = trimmed.match(/^```(?:markdown|md)?\s*([\s\S]*?)\s*```$/i);
  return (fence ? fence[1] : trimmed).trim();
}

async function draftPromotedMarkdown(input: {
  title: string;
  messages: PromotionMessage[];
  guildId: string;
  channelId: string;
  threadId: string | null;
}): Promise<string> {
  const transcript = promotionTranscript(input.messages);
  const prompt = [
    "Create a clean Markdown document from this Discord discussion.",
    "",
    `Title: ${input.title}`,
    "",
    "Requirements:",
    "- Return Markdown only, with no surrounding code fence.",
    "- Preserve concrete decisions, procedures, scripts, and open questions from the discussion.",
    "- Do not invent details not present in the transcript.",
    "- If the discussion is about a script, produce a usable script/template section.",
    "- Include a short Source Notes section at the end mentioning that it was promoted from Discord.",
    "",
    "Discord transcript:",
    transcript,
  ].join("\n");

  try {
    const result = await runtimeRequest({
      prompt,
      sessionId: `discord-promote-doc:${input.threadId ?? input.channelId}`,
      continuationId: null,
      recentHistory: [],
      metadata: {
        source: "discord-promote-doc",
        guildId: input.guildId,
        channelId: input.channelId,
        threadId: input.threadId,
        messageCount: input.messages.length,
      },
    });
    return cleanMarkdownResponse(result.responseText);
  } catch (error) {
    console.warn("[discord-adapter] promote-doc markdown draft fallback", describeError(error));
    return fallbackPromotedMarkdown(input.title, input.messages, "Promoted from a Discord discussion.");
  }
}

function sanitizePromotedDocument(content: string, context: { guildId: string | null; channelId: string; threadId: string | null }) {
  const sanitized = sanitizePublicOutput(content);
  if (sanitized.redactions.length) {
    console.warn("[discord-adapter] sanitized promoted Discord document", {
      guildId: context.guildId,
      channelId: context.channelId,
      threadId: context.threadId,
      redactions: sanitized.redactions,
    });
  }
  return sanitized.text.trim();
}

async function writePromotedKnowledgeDoc(input: {
  title: string;
  content: string;
  interaction: ChatInputCommandInteraction;
  messages: PromotionMessage[];
  channelId: string;
  threadId: string | null;
}): Promise<{ path: string; metadataPath: string | null; slug: string }> {
  const now = new Date().toISOString();
  const slug = slugifyDocTitle(input.title);
  const filename = `${slug}.md`;
  const sourceUrls = input.messages.slice(-5).map((message) => message.url);
  const metadata = {
    title: input.title,
    slug,
    kind: "guide",
    summary: `Discord-promoted draft from ${input.messages.length} message(s).`,
    tags: ["memory", "workflow"],
    owners: [interactionDisplayName(input.interaction)],
    status: "draft",
    audience: "internal",
    stability: "evolving",
    updated: now,
    entities: [],
    related_docs: [],
    triaged_at: now,
    source_system: "discord",
    source_type: "promoted_doc",
    source_id: input.threadId ?? input.channelId,
    external_refs: [
      {
        system: "discord",
        type: input.threadId ? "thread" : "channel",
        id: input.threadId ?? input.channelId,
        url: sourceUrls[sourceUrls.length - 1] ?? null,
        relationship: "source",
      },
      ...sourceUrls.map((url, index) => ({
        system: "discord",
        type: "message",
        id: input.messages[Math.max(0, input.messages.length - sourceUrls.length + index)]?.id ?? null,
        url,
        relationship: "evidence",
      })),
    ],
  };

  const response = await fetch(`${prismApiBaseUrl()}/knowledge/inbox`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Prism-Api-Key": prismApiKey(),
    },
    body: JSON.stringify({
      filename,
      content: input.content,
      metadata,
    }),
  });
  const payload = (await response.json().catch(() => null)) as JsonObject | null;
  if (!response.ok) {
    throw new Error(`PRISM_KNOWLEDGE_INBOX_FAILED:${response.status}:${String(payload?.error ?? "").slice(0, 300)}`);
  }
  const pathValue = typeof payload?.path === "string" ? payload.path.trim() : "";
  if (!pathValue) {
    throw new Error("PRISM_KNOWLEDGE_INBOX_FAILED:missing_path");
  }
  const metadataPath = typeof payload?.metadata_path === "string" ? payload.metadata_path : null;
  return {
    path: pathValue,
    metadataPath,
    slug,
  };
}

async function writePromotedMemoryArtifact(input: {
  title: string;
  content: string;
  interaction: ChatInputCommandInteraction;
  messages: PromotionMessage[];
  channelId: string;
  threadId: string | null;
}): Promise<{ path: string; artifactUrl: string | null }> {
  const now = new Date().toISOString();
  const response = await fetch(`${prismApiBaseUrl()}/memory/inbox`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Prism-Api-Key": prismApiKey(),
    },
    body: JSON.stringify({
      source: "discord",
      ts: now,
      type: "promoted_doc",
      content: input.content,
      author: interactionDisplayName(input.interaction),
      url: input.messages[input.messages.length - 1]?.url ?? null,
      participants: [...new Set(input.messages.map((message) => message.authorName))],
      participant_count: new Set(input.messages.map((message) => message.authorId)).size,
      metadata: {
        title: input.title,
        slug: slugifyDocTitle(input.title),
        source_system: "discord",
        source_type: "promoted_doc",
        source_id: input.threadId ?? input.channelId,
        discord_channel_id: input.channelId,
        discord_thread_id: input.threadId,
        promoted_by: interactionDisplayName(input.interaction),
        promoted_at: now,
        message_count: input.messages.length,
        external_refs: input.messages.slice(-5).map((message) => ({
          system: "discord",
          type: "message",
          id: message.id,
          url: message.url,
          relationship: "evidence",
        })),
      },
    }),
  });
  const payload = (await response.json().catch(() => null)) as JsonObject | null;
  if (!response.ok) {
    throw new Error(`PRISM_MEMORY_INBOX_FAILED:${response.status}:${String(payload?.error ?? "").slice(0, 300)}`);
  }
  const pathValue = typeof payload?.path === "string" ? payload.path.trim() : "";
  if (!pathValue) {
    throw new Error("PRISM_MEMORY_INBOX_FAILED:missing_path");
  }
  return {
    path: pathValue,
    artifactUrl: memoryInboxArtifactUrl(pathValue),
  };
}

function interactionDisplayName(interaction: ChatInputCommandInteraction): string {
  return interaction.member && "displayName" in interaction.member
    ? String(interaction.member.displayName)
    : interaction.user.displayName || interaction.user.username;
}

function canPromoteDiscordDoc(sourcePolicy: ResolvedDiscordAccessPolicy): boolean {
  return sourcePolicy.mode === "full" || sourcePolicy.capabilities.includes(PROMOTE_DOC_CAPABILITY);
}

async function handlePromoteDocCommand(interaction: ChatInputCommandInteraction): Promise<void> {
  if (!interaction.channel || !interaction.channel.isTextBased()) {
    await interaction.reply({ content: "This command must be used in a text channel or thread.", ephemeral: true });
    return;
  }
  const channel = interaction.channel;
  const threadId = channel.isThread() ? channel.id : null;
  const channelId = channel.isThread() ? channel.parentId : channel.id;
  if (!channelId) {
    await interaction.reply({ content: "I could not resolve the channel for this command.", ephemeral: true });
    return;
  }
  const sourcePolicy = await resolveDiscordAccessPolicy({
    channelId,
    threadId,
    authorId: interaction.user.id,
    roleIds: roleIdsFromInteraction(interaction),
  });
  if (!canPromoteDiscordDoc(sourcePolicy)) {
    await interaction.reply({ content: "This Discord target is not approved for Prism document promotion.", ephemeral: true });
    return;
  }

  const title = interaction.options.getString("title", true).trim();
  if (!title) {
    await interaction.reply({ content: "Provide a non-empty document title.", ephemeral: true });
    return;
  }
  const userLimit = checkDiscordRateLimit(
    `discord:promote-doc:user:${interaction.user.id}:${sourcePolicy.mode}`,
    sourcePolicy.rateLimit,
  );
  const channelLimit = checkDiscordRateLimit(
    `discord:promote-doc:channel:${threadId ?? channelId}:${sourcePolicy.mode}`,
    {
      windowSeconds: sourcePolicy.rateLimit.windowSeconds,
      maxRequests: Math.max(1, sourcePolicy.rateLimit.maxRequests * 2),
    },
  );
  const blockedLimit = !userLimit.ok ? userLimit : !channelLimit.ok ? channelLimit : null;
  if (blockedLimit) {
    await interaction.reply({
      content: `Prism document promotion is rate limited here. Try again in about ${blockedLimit.retryAfterSeconds} seconds.`,
      ephemeral: true,
    });
    return;
  }

  const lane = interaction.options.getString("lane") === "knowledge" ? "knowledge" : "memory";
  await interaction.deferReply();
  try {
    await interaction.editReply({ content: `Promoting **${title}** from recent Discord context to ${lane}...` });

    const messages = await collectPromotionMessages(interaction);
    if (!messages.length) {
      await interaction.editReply({ content: "I could not find recent message content to promote." });
      return;
    }
    const draftedContent = await draftPromotedMarkdown({
      title,
      messages,
      guildId: interaction.guildId!,
      channelId,
      threadId,
    });
    const content = sanitizePromotedDocument(draftedContent, { guildId: interaction.guildId, channelId, threadId });
    if (!content) {
      await interaction.editReply({ content: "The promoted document was empty after sanitization." });
      return;
    }
    if (lane === "knowledge") {
      const result = await writePromotedKnowledgeDoc({
        title,
        content,
        interaction,
        messages,
        channelId,
        threadId,
      });

      await interaction.editReply({
        content: [
          `Promoted **${title}** to Prism Knowledge inbox.`,
          `Slug: \`${result.slug}\``,
          `Knowledge inbox path: \`${result.path}\``,
          result.metadataPath ? `Metadata path: \`${result.metadataPath}\`` : null,
          "A knowledge view link will be available after review/indexing promotes this inbox entry.",
        ].filter(Boolean).join("\n"),
      });
      return;
    }

    const result = await writePromotedMemoryArtifact({
      title,
      content,
      interaction,
      messages,
      channelId,
      threadId,
    });
    await interaction.editReply({
      content: [
        `Promoted **${title}** to Prism Memory.`,
        result.artifactUrl ? `Shareable artifact: ${result.artifactUrl}` : `Memory inbox path: \`${result.path}\``,
        "Use `lane:knowledge` next time only for reusable or evergreen content.",
      ].join("\n"),
    });
  } catch (error) {
    await interaction.editReply({ content: `Could not promote document: ${describeError(error)}` });
  }
}

function discordCommandDefinitions() {
  return [
    new SlashCommandBuilder().setName("prism-ping").setDescription("Simple adapter health check."),
    new SlashCommandBuilder().setName("prism-health").setDescription("Show Prism Discord adapter health."),
    new SlashCommandBuilder()
      .setName("prism-chat")
      .setDescription("Chat with Prism/Codex in this channel.")
      .addStringOption((option) => option.setName("prompt").setDescription("What Prism should do or answer.").setRequired(true)),
    new SlashCommandBuilder().setName("prism-start-cr").setDescription("Start the latest actionable change request."),
    new SlashCommandBuilder()
      .setName("prism-continue-cr")
      .setDescription("Continue work on a specific change request.")
      .addIntegerOption((option) => option.setName("id").setDescription("Change request id.").setRequired(true)),
    new SlashCommandBuilder()
      .setName("prism-promote-doc")
      .setDescription("Promote recent Discord context into a Prism Memory document.")
      .addStringOption((option) => option.setName("title").setDescription("Document title.").setRequired(true))
      .addStringOption((option) =>
        option
          .setName("lane")
          .setDescription("Where to promote this document.")
          .setRequired(false)
          .addChoices(
            { name: "memory", value: "memory" },
            { name: "knowledge", value: "knowledge" },
          ),
      ),
    new SlashCommandBuilder().setName("prism-join").setDescription("Join your current voice channel."),
    new SlashCommandBuilder().setName("prism-record").setDescription("Start recording the current meeting."),
    new SlashCommandBuilder().setName("prism-stoprecord").setDescription("Stop recording the current meeting."),
    new SlashCommandBuilder()
      .setName("prism-recap")
      .setDescription("Ask Prism for a recap of the latest recording or meeting context.")
      .addStringOption((option) => option.setName("prompt").setDescription("Optional steering for the recap.").setRequired(false)),
    new SlashCommandBuilder().setName("prism-rollcall").setDescription("Show who is currently in the meeting voice channel."),
  ].map((command) => command.toJSON());
}

function voiceTranscriptionConfigured(): boolean {
  return Boolean(
    (process.env.VOICE_TRANSCRIPTION_BASE_URL ?? "").trim()
    && (process.env.VOICE_TRANSCRIPTION_API_KEY ?? "").trim(),
  );
}

function voiceTranscriptionSetupMessage(): string {
  return [
    "Voice transcription is not configured for this Prism deployment.",
    "Set `VOICE_TRANSCRIPTION_BASE_URL` and `VOICE_TRANSCRIPTION_API_KEY` on the `discord-adapter` service, then redeploy it before using `/prism-record` or `/prism-stoprecord`.",
  ].join("\n");
}

async function handleVoiceCommand(interaction: ChatInputCommandInteraction, action: "join" | "record" | "stoprecord" | "recap" | "rollcall"): Promise<void> {
  if (!voiceManager) {
    await interaction.reply({ content: "Voice manager is not available in this runtime.", ephemeral: true });
    return;
  }
  if ((action === "record" || action === "stoprecord" || action === "recap") && !voiceTranscriptionConfigured()) {
    await interaction.reply({ content: voiceTranscriptionSetupMessage(), ephemeral: true });
    return;
  }
  try {
    await interaction.deferReply({ ephemeral: true });
    let content = "";
    let publicContent: string | null = null;
    switch (action) {
      case "join":
        content = await voiceManager.join(interaction);
        break;
      case "record":
        content = await voiceManager.startRecording(interaction);
        break;
      case "stoprecord": {
        await interaction.editReply({ content: "Stopping the recording and processing the transcript. This can take a few minutes." });
        const result = await voiceManager.stopRecording(interaction);
        content = result.privateMessage;
        publicContent = result.publicMessage ?? null;
        break;
      }
      case "recap":
        await interaction.editReply({ content: "Building a recap from the recording so far. This can take a minute." });
        content = await voiceManager.recap(interaction, interaction.options.getString("prompt", false));
        break;
      case "rollcall":
        content = await voiceManager.rollcall(interaction);
        break;
    }
    await interaction.editReply({ content });
    if (publicContent && interaction.channel && interaction.channel.isSendable()) {
      await interaction.channel.send(publicContent);
    }
  } catch (error) {
    if (interaction.deferred || interaction.replied) {
      await interaction.editReply({ content: describeError(error) });
      return;
    }
    await interaction.reply({ content: describeError(error), ephemeral: true });
  }
}

async function registerDiscordCommands(client: Client): Promise<void> {
  const config = adapterConfig();
  if (!config.discordRegisterCommands) {
    return;
  }
  const token = (process.env.DISCORD_BOT_TOKEN ?? "").trim();
  const applicationId = config.discordApplicationId || client.application?.id || client.user?.id;
  if (!token || !applicationId) {
    console.warn("[discord-adapter] command registration skipped: missing token or application id");
    return;
  }
  const rest = new REST({ version: "10" }).setToken(token);
  const body = discordCommandDefinitions();
  console.log(
    "[discord-adapter] command payload",
    JSON.stringify(
      body.map((command) => ({
        name: command.name,
        nameLength: command.name.length,
        descriptionLength: command.description.length,
      })),
    ),
  );
  if (config.discordCommandGuildId) {
    await rest.put(Routes.applicationGuildCommands(applicationId, config.discordCommandGuildId), { body });
    console.log(`[discord-adapter] registered ${body.length} guild commands for ${config.discordCommandGuildId}`);
    return;
  }
  await rest.put(Routes.applicationCommands(applicationId), { body });
  console.log(`[discord-adapter] registered ${body.length} global commands`);
}

async function handleDiscordInteraction(interaction: Interaction): Promise<void> {
  if (!interaction.isChatInputCommand() || !interaction.inGuild()) {
    return;
  }
  switch (interaction.commandName) {
    case "prism-ping":
      await interaction.reply({ content: "pong", ephemeral: true });
      return;
    case "prism-health": {
      const health = await healthPayload(interaction);
      const discord = health.discord as JsonObject;
      const textChannel = (health.textChannel ?? {}) as JsonObject;
      const voiceChannel = (health.voiceChannel ?? {}) as JsonObject;
      await interaction.reply({
        content: [
          `ok=${health.ok} ready=${discord.discordReady ? "true" : "false"} user=${String(discord.discordUserTag ?? "unknown")}`,
          `text_channel=${String(textChannel.name ?? "unknown")} view=${String(textChannel.canViewChannel ?? "n/a")} send=${String(textChannel.canSendMessages ?? "n/a")} threads=${String(textChannel.canSendMessagesInThreads ?? "n/a")} history=${String(textChannel.canReadMessageHistory ?? "n/a")}`,
          `voice_channel=${String(voiceChannel.name ?? "none")} view=${String(voiceChannel.canViewChannel ?? "n/a")} connect=${String(voiceChannel.canConnect ?? "n/a")} speak=${String(voiceChannel.canSpeak ?? "n/a")} vad=${String(voiceChannel.canUseVoiceActivity ?? "n/a")}`,
          `voice_transcription=${String((health.voice as JsonObject).transcriptionConfigured ?? "false")}`,
        ].join("\n"),
        ephemeral: true,
      });
      return;
    }
    case "prism-chat":
      await handleSlashPrompt(interaction, interaction.options.getString("prompt", true));
      return;
    case "prism-start-cr":
      await handleSlashPrompt(interaction, "start latest change request");
      return;
    case "prism-continue-cr":
      await handleSlashPrompt(interaction, `continue work on CR #${interaction.options.getInteger("id", true)}`);
      return;
    case "prism-promote-doc":
      await handlePromoteDocCommand(interaction);
      return;
    case "prism-join":
      await handleVoiceCommand(interaction, "join");
      return;
    case "prism-record":
      await handleVoiceCommand(interaction, "record");
      return;
    case "prism-stoprecord":
      await handleVoiceCommand(interaction, "stoprecord");
      return;
    case "prism-recap":
      await handleVoiceCommand(interaction, "recap");
      return;
    case "prism-rollcall":
      await handleVoiceCommand(interaction, "rollcall");
      return;
    default:
      await interaction.reply({ content: "Unknown command.", ephemeral: true });
  }
}

async function handleSlashPrompt(interaction: ChatInputCommandInteraction, prompt: string): Promise<void> {
  if (!interaction.channel || !interaction.channel.isTextBased()) {
    await interaction.reply({ content: "This command must be used in a text channel or thread.", ephemeral: true });
    return;
  }
  const channel = interaction.channel;
  const threadId = channel.isThread() ? channel.id : null;
  const channelId = channel.isThread() ? channel.parentId : channel.id;
  if (!channelId) {
    await interaction.reply({ content: "I could not resolve the channel for this command.", ephemeral: true });
    return;
  }
  await interaction.deferReply();
  let followupCount = 0;
  await runDiscordPrompt(prompt, {
    guildId: interaction.guildId!,
    channelId,
    threadId,
    channelName: "name" in channel ? channel.name : null,
    threadName: channel.isThread() ? channel.name : null,
    authorId: interaction.user.id,
    authorName: interaction.member && "displayName" in interaction.member ? String(interaction.member.displayName) : interaction.user.displayName,
    authorRoleIds: roleIdsFromInteraction(interaction),
    userSourceMessageId: interaction.id,
    createdAt: interaction.createdAt.toISOString(),
    context: null,
    sendTyping: async () => {},
    sendAssistantMessage: async (content) => {
      const parts = splitDiscordMessage(content);
      let firstMessageId: string | null = null;
      for (const part of parts) {
        if (followupCount === 0) {
          followupCount += 1;
          await interaction.editReply({ content: part });
          const reply = await interaction.fetchReply();
          if (!firstMessageId) {
            firstMessageId = reply.id;
          }
          continue;
        }
        const followup = await interaction.followUp({ content: part });
        followupCount += 1;
        if (!firstMessageId) {
          firstMessageId = followup.id;
        }
      }
      return { sourceMessageId: firstMessageId };
    },
  });
}

async function startDiscordBridge(): Promise<void> {
  const config = adapterConfig();
  const token = (process.env.DISCORD_BOT_TOKEN ?? "").trim();
  if (config.sourceKind !== "discord" || !config.discordChatEnabled || !token) {
    console.log("[discord-adapter] Discord bridge disabled or token missing");
    return;
  }
  bridgeClient = new Client({
    intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMessages, GatewayIntentBits.MessageContent, GatewayIntentBits.GuildVoiceStates],
  });
  voiceManager = new DiscordVoiceManager({
    client: bridgeClient,
    dataRoot: dataRoot(),
    publicBaseUrl: sourceAdapterPublicBaseUrl,
    describeError,
  });
  await voiceManager.init();
  bridgeClient.once(Events.ClientReady, (client) => {
    discordReady = true;
    discordUserTag = client.user.tag;
    console.log(`[discord-adapter] connected as ${client.user.tag}`);
    void registerDiscordCommands(client).catch((error) => {
      console.error("[discord-adapter] command registration failed", describeError(error), error);
    });
  });
  bridgeClient.on(Events.MessageCreate, (message) => {
    void handleDiscordChatMessage(message).catch((error) => {
      console.error("[discord-adapter] message handling failed", describeError(error));
    });
  });
  bridgeClient.on(Events.InteractionCreate, (interaction) => {
    void handleDiscordInteraction(interaction).catch((error) => {
      console.error("[discord-adapter] interaction handling failed", describeError(error));
    });
  });
  bridgeClient.on(Events.VoiceStateUpdate, (oldState, newState) => {
    if (!voiceManager) {
      return;
    }
    void voiceManager.handleVoiceStateUpdate(oldState, newState).catch((error) => {
      console.error("[discord-adapter] voice state handling failed", describeError(error));
    });
  });
  bridgeClient.on(Events.ShardDisconnect, () => {
    discordReady = false;
  });

  for (let attempt = 1; attempt <= 5; attempt += 1) {
    try {
      await bridgeClient.login(token);
      return;
    } catch (error) {
      console.error(`[discord-adapter] login attempt ${attempt} failed`, describeError(error));
      if (attempt === 5) {
        throw error;
      }
      await sleep(2_000 * attempt);
    }
  }
}

async function healthPayload(interaction?: ChatInputCommandInteraction): Promise<JsonObject> {
  const payload: JsonObject = {
    ok: true,
    service: "source-adapter",
    timestamp: nowUtcIso(),
    config: adapterConfig(),
    checkpoint: await currentCheckpoint(adapterConfig()),
    dataRoot: dataRoot(),
    discord: {
      discordReady,
      discordUserTag,
    },
    buzz: {
      enabled: adapterConfig().buzzEnabled,
      privateKeyConfigured: Boolean((process.env.BUZZ_PRIVATE_KEY ?? "").trim()),
      publicKeyConfigured: Boolean(adapterConfig().buzzPublicKey),
      allowlistedChannelCount: adapterConfig().buzzChannelAllowlist.length,
      cliPath: (process.env.BUZZ_CLI_PATH ?? "buzz").trim() || "buzz",
      interaction: {
        enabled: adapterConfig().buzzInteractionEnabled,
        routing: "source-policy",
        legacyProfileKey: adapterConfig().buzzInteractionProfileKey || null,
        displayName: adapterConfig().buzzInteractionDisplayName,
        pollSeconds: adapterConfig().buzzInteractionPollSeconds,
        ...buzzInteractionStatus,
      },
    },
    voice: {
      transcriptionConfigured: voiceTranscriptionConfigured(),
    },
  };
  if (!interaction?.guild || !interaction.channel) {
    return payload;
  }
  const me = interaction.guild.members.me ?? (await interaction.guild.members.fetchMe().catch(() => null));
  const textPermissions = me && "permissionsFor" in interaction.channel
    ? interaction.channel.permissionsFor(me)
    : null;
  payload.textChannel = {
    id: "id" in interaction.channel ? interaction.channel.id : null,
    name: "name" in interaction.channel ? String(interaction.channel.name ?? "unknown") : "unknown",
    canViewChannel: textPermissions?.has(PermissionFlagsBits.ViewChannel) ?? null,
    canSendMessages: textPermissions?.has(PermissionFlagsBits.SendMessages) ?? null,
    canCreatePublicThreads: textPermissions?.has(PermissionFlagsBits.CreatePublicThreads) ?? null,
    canSendMessagesInThreads: textPermissions?.has(PermissionFlagsBits.SendMessagesInThreads) ?? null,
    canReadMessageHistory: textPermissions?.has(PermissionFlagsBits.ReadMessageHistory) ?? null,
  };
  const member = await interaction.guild.members.fetch(interaction.user.id).catch(() => null);
  const voiceChannel = member?.voice.channel;
  if (!voiceChannel) {
    payload.voiceChannel = {
      name: null,
      canViewChannel: null,
      canConnect: null,
      canSpeak: null,
      canUseVoiceActivity: null,
    };
    return payload;
  }
  const voicePermissions = me ? voiceChannel.permissionsFor(me) : null;
  payload.voiceChannel = {
    id: voiceChannel.id,
    name: voiceChannel.name,
    canViewChannel: voicePermissions?.has(PermissionFlagsBits.ViewChannel) ?? null,
    canConnect: voicePermissions?.has(PermissionFlagsBits.Connect) ?? null,
    canSpeak: voicePermissions?.has(PermissionFlagsBits.Speak) ?? null,
    canUseVoiceActivity: voicePermissions?.has(PermissionFlagsBits.UseVAD) ?? null,
  };
  return payload;
}

async function runSync(dryRun: boolean, resetCheckpoint: boolean): Promise<JsonObject> {
  const config = adapterConfig();
  const collected = config.sourceKind === "buzz"
    ? await collectBuzzBatch(resetCheckpoint)
    : config.sourceKind === "discord"
      ? await collectDiscordBatch(resetCheckpoint)
      : null;
  if (!collected) {
    throw new Error(`Sync is not implemented for SOURCE_KIND=${config.sourceKind}`);
  }
  const { payload, summary, since, until } = collected;
  const posted = dryRun ? null : await postBatchToPrism(payload);
  const checkpointState = "checkpointState" in collected
    && collected.checkpointState
    && typeof collected.checkpointState === "object"
    && !Array.isArray(collected.checkpointState)
    ? collected.checkpointState as JsonObject
    : undefined;
  const checkpoint = await updateCheckpoint(config, {
    since,
    until,
    messageCount: Number(summary.messageCount ?? 0),
    dryRun,
    state: checkpointState,
  });
  return {
    ok: true,
    service: "source-adapter",
    timestamp: nowUtcIso(),
    dryRun,
    resetCheckpoint,
    summary,
    checkpoint,
    posted,
  };
}

function requireAdapterToken(request: Request): void {
  const expected = (process.env.SOURCE_ADAPTER_TOKEN ?? "").trim();
  if (!expected) {
    return;
  }
  if ((request.header("X-Adapter-Token") ?? "") !== expected) {
    throw new Error("Unauthorized");
  }
}

async function main(): Promise<void> {
  await fs.mkdir(dataRoot(), { recursive: true });
  await startDiscordBridge();
  const stopTelegramDiscovery = startTelegramDiscoveryPolling();
  const stopBuzzInteractions = startBuzzInteractionPolling();

  const app = express();
  app.use(express.json({ limit: "2mb" }));

  app.get("/health", async (_request: Request, response: Response) => {
    response.json(await healthPayload());
  });

  app.get("/capabilities", (_request: Request, response: Response) => {
    const buzzChannelAdminConfigured = Boolean((process.env.BUZZ_CHANNEL_ADMIN_TOKEN ?? "").trim());
    const buzzHistoryConfigured = Boolean((process.env.INTERNAL_SERVICE_TOKEN ?? "").trim())
      && adapterConfig().buzzHistoryChannelAllowlist.length > 0;
    response.json({
      ok: true,
      adapter: "communication",
      adapters: [
        "discord",
        (process.env.TELEGRAM_BOT_TOKEN ?? "").trim() ? "telegram" : null,
        adapterConfig().buzzEnabled ? "buzz" : null,
        "external-http",
      ].filter(Boolean),
      capabilities: [
        "list-destinations",
        "send-message",
        "fetch-attachment",
        "external-interactions",
        ...((process.env.DISCORD_BOT_TOKEN ?? "").trim() && adapterConfig().discordGuildId
          ? ["search-discord-history"]
          : []),
        ...(buzzChannelAdminConfigured ? ["manage-buzz-channels"] : []),
        ...(buzzHistoryConfigured ? ["read-buzz-channel-history"] : []),
      ],
      destinationTypes: [
        "discord-channel",
        "discord-forum",
        "telegram-chat",
        "telegram-channel",
        ...(adapterConfig().buzzEnabled ? ["buzz-channel"] : []),
      ],
      routes: {
        attachmentsFetch: "/attachments/fetch",
        attachmentsResolve: "/attachments/resolve",
        destinations: "/destinations",
        guildChannels: "/guild/channels",
        messages: "/messages",
        ...((process.env.DISCORD_BOT_TOKEN ?? "").trim() && adapterConfig().discordGuildId ? {
          discordHistorySearch: "/history/discord/search",
          discordHistoryContext: "/history/discord/context",
        } : {}),
        ...(buzzChannelAdminConfigured ? {
          buzzChannels: "/buzz/channels",
          buzzChannel: "/buzz/channels/:channelId",
          buzzChannelAccess: "/buzz/channels/:channelId/access",
          buzzChannelArchive: "/buzz/channels/:channelId/archive",
          buzzChannelMembers: "/buzz/channels/:channelId/members",
        } : {}),
        ...(buzzHistoryConfigured ? {
          agentBuzzChannelMessages: "/agent/buzz/channels/:channelId/messages",
        } : {}),
        externalSessions: "/interactions/:key/sessions",
        externalSessionMessages: "/interactions/:key/sessions/:sessionId/messages",
      },
    });
  });

  app.post("/interactions/:key/sessions", async (request: Request, response: Response) => {
    const requestId = randomUUID();
    try {
      const interfaceKey = request.params.key.trim().toLowerCase();
      const authorization = await authorizeExternalInteraction(request, interfaceKey, requestId);
      const rateLimit = checkExternalInteractionRateLimit(
        authorization.interface.key,
        authorization.profile.rateLimit,
      );
      if (!rateLimit.ok) {
        response.setHeader("retry-after", String(rateLimit.retryAfterSeconds));
        throw new ExternalInteractionHttpError(429, "EXTERNAL_INTERACTION_RATE_LIMITED");
      }
      const externalSessionId = randomUUID();
      const contextKey = `${authorization.interface.key}:${externalSessionId}`;
      const now = nowUtcIso();
      const subject = safeExternalHeader(request.header("x-prism-external-subject"), 300) || null;
      const session = await upsertSourceSession({
        source: "external",
        contextKey,
        title: `${authorization.interface.name} session`,
        meta: {
          transport: "external-http",
          externalInterfaceKey: authorization.interface.key,
          externalSessionId,
          externalSubject: subject,
          interactionProfileKey: authorization.profile.key,
          interactionProfileVersion: authorization.profile.version,
          requestedSkills: authorization.profile.skills,
          runtimeKey: authorization.profile.runtimeProfileKey,
          accessMode: authorization.profile.mode,
          memoryScope: externalInteractionMemoryScope(authorization),
        },
        lastMessageAt: now,
      });
      const origin = request.header("origin");
      if (origin) response.setHeader("access-control-allow-origin", origin);
      response.status(201).json({
        ok: true,
        requestId,
        sessionId: String(session.id),
        interface: {
          key: authorization.interface.key,
          name: authorization.interface.name,
        },
        profile: {
          key: authorization.profile.key,
          name: authorization.profile.name,
          version: authorization.profile.version,
          mode: authorization.profile.mode,
          personaName: authorization.profile.persona.name,
        },
      });
    } catch (error) {
      const status = error instanceof ExternalInteractionHttpError ? error.status : 500;
      const message = error instanceof ExternalInteractionHttpError ? error.message : "EXTERNAL_INTERACTION_SESSION_FAILED";
      response.status(status).json({ ok: false, requestId, error: message });
    }
  });

  app.post("/interactions/:key/sessions/:sessionId/messages", async (request: Request, response: Response) => {
    const requestId = randomUUID();
    try {
      const interfaceKey = request.params.key.trim().toLowerCase();
      const sessionId = request.params.sessionId.trim();
      const authorization = await authorizeExternalInteraction(request, interfaceKey, requestId);
      const body = request.body && typeof request.body === "object" ? request.body as JsonObject : {};
      const content = typeof body.content === "string"
        ? body.content.trim()
        : typeof body.message === "string"
          ? body.message.trim()
          : "";
      if (!content) throw new ExternalInteractionHttpError(400, "EXTERNAL_INTERACTION_MESSAGE_REQUIRED");
      if (content.length > 100_000) throw new ExternalInteractionHttpError(413, "EXTERNAL_INTERACTION_MESSAGE_TOO_LARGE");

      const sessionPayload = await appApiRequest(`/agent/agent-sessions/${encodeURIComponent(sessionId)}?limit=25`);
      const session = sessionPayload.session && typeof sessionPayload.session === "object" && !Array.isArray(sessionPayload.session)
        ? sessionPayload.session as JsonObject
        : {};
      const sessionMeta = externalSessionMeta(session);
      if (session.source !== "external" || sessionMeta.externalInterfaceKey !== authorization.interface.key) {
        throw new ExternalInteractionHttpError(404, "EXTERNAL_INTERACTION_SESSION_NOT_FOUND");
      }

      const rateLimit = checkExternalInteractionRateLimit(
        authorization.interface.key,
        authorization.profile.rateLimit,
      );
      if (!rateLimit.ok) {
        response.setHeader("retry-after", String(rateLimit.retryAfterSeconds));
        throw new ExternalInteractionHttpError(429, "EXTERNAL_INTERACTION_RATE_LIMITED");
      }

      const existingMessages = Array.isArray(sessionPayload.messages) ? sessionPayload.messages : [];
      const recentHistory = existingMessages
        .slice(-12)
        .flatMap((entry): Array<{ role: string; content: string }> => {
          if (!entry || typeof entry !== "object" || Array.isArray(entry)) return [];
          const record = entry as JsonObject;
          return typeof record.content === "string" && record.content
            ? [{ role: typeof record.role === "string" ? record.role : "user", content: record.content }]
            : [];
        });
      const sourceMessageId = typeof body.messageId === "string"
        ? body.messageId.trim().slice(0, 200) || null
        : typeof body.message_id === "string"
          ? body.message_id.trim().slice(0, 200) || null
          : null;
      const now = nowUtcIso();
      await appendSessionMessage({
        sessionId,
        role: "user",
        source: "external",
        sourceMessageId,
        content,
        meta: {
          requestId,
          externalInterfaceKey: authorization.interface.key,
          externalSubject: safeExternalHeader(request.header("x-prism-external-subject"), 300) || null,
          interactionProfileKey: authorization.profile.key,
          interactionProfileVersion: authorization.profile.version,
          requestedSkills: authorization.profile.skills,
        },
        createdAt: now,
      });

      const profileChanged = sessionMeta.interactionProfileKey !== authorization.profile.key
        || sessionMeta.interactionProfileVersion !== authorization.profile.version;
      const continuationId = profileChanged
        ? null
        : typeof sessionMeta.runtimeContinuationId === "string"
          ? sessionMeta.runtimeContinuationId
          : null;
      const result = await runtimeRequest({
        prompt: content,
        sessionId,
        continuationId,
        recentHistory,
        credentials: authorization.credentials,
        runtimeProfileKey: authorization.profile.runtimeProfileKey,
        gatewayContext: { delegatedActorId: `external:${authorization.interface.key}` },
        metadata: {
          transport: "external-http",
          externalInterfaceKey: authorization.interface.key,
          externalSubject: safeExternalHeader(request.header("x-prism-external-subject"), 300) || null,
          interactionProfileKey: authorization.profile.key,
          interactionProfileVersion: authorization.profile.version,
          externalAccessMode: authorization.profile.mode,
          allowedWorkflows: authorization.profile.allowedWorkflows,
          memoryScope: externalInteractionMemoryScope(authorization),
          requestOrigin: { sourceSessionId: sessionId, sourceMessageId },
          policyInstructions: [
            externalInteractionPolicyInstructions(authorization),
            authorization.profile.mode !== "readonly"
              ? `When creating a request with POST /agent/change-board/requests, include sourceSessionId ${sessionId}${sourceMessageId ? ` and sourceMessageId ${sourceMessageId}` : ""}; do not supply identity display fields.`
              : "",
          ].filter(Boolean).join("\n\n"),
          credentialPolicy: authorization.profile.mode === "full" ? "trusted-source" : "none",
        },
      });
      const sanitized = sanitizePublicOutput(result.responseText);
      const updatedMeta: JsonObject = {
        ...sessionMeta,
        transport: "external-http",
        externalInterfaceKey: authorization.interface.key,
        interactionProfileKey: authorization.profile.key,
        interactionProfileVersion: authorization.profile.version,
        runtimeContinuationId: result.continuationId,
        runtimeKey: result.runtimeKey ?? authorization.profile.runtimeProfileKey,
        runtimeProvider: result.provider,
        accessMode: authorization.profile.mode,
        memoryScope: externalInteractionMemoryScope(authorization),
      };
      await upsertSourceSession({
        source: "external",
        contextKey: String(sessionMeta.contextKey),
        title: typeof session.title === "string" ? session.title : `${authorization.interface.name} session`,
        meta: updatedMeta,
        lastMessageAt: nowUtcIso(),
      });
      await appendSessionMessage({
        sessionId,
        role: "assistant",
        source: "external",
        sourceMessageId: null,
        content: sanitized.text,
        meta: {
          requestId,
          runtimeContinuationId: result.continuationId,
          interactionProfileKey: authorization.profile.key,
          interactionProfileVersion: authorization.profile.version,
          redactions: sanitized.redactions as unknown as JsonValue,
        },
        createdAt: nowUtcIso(),
      });
      const origin = request.header("origin");
      if (origin) response.setHeader("access-control-allow-origin", origin);
      response.json({
        ok: true,
        requestId,
        sessionId,
        message: { role: "assistant", content: sanitized.text },
        profile: { key: authorization.profile.key, version: authorization.profile.version },
      });
    } catch (error) {
      const described = describeError(error);
      const status = error instanceof ExternalInteractionHttpError
        ? error.status
        : described.startsWith("APP_API_REQUEST_FAILED:404:") ? 404 : 502;
      const message = error instanceof ExternalInteractionHttpError
        ? error.message
        : status === 404 ? "EXTERNAL_INTERACTION_SESSION_NOT_FOUND" : "EXTERNAL_INTERACTION_RUNTIME_FAILED";
      response.status(status).json({ ok: false, requestId, error: message });
    }
  });

  app.get("/destinations", async (request: Request, response: Response) => {
    try {
      requireAdapterToken(request);
      response.json({
        ok: true,
        adapter: "communication",
        destinations: await listAdapterDestinations(),
      });
    } catch (error) {
      const message = describeError(error);
      response.status(message === "Unauthorized" ? 401 : 500).json({ ok: false, error: message });
    }
  });

  app.post("/history/discord/search", async (request: Request, response: Response) => {
    try {
      requireAdapterToken(request);
      const config = adapterConfig();
      const token = (process.env.DISCORD_BOT_TOKEN ?? "").trim();
      if (!token || !config.discordGuildId) throw new Error("Discord history search is not configured");
      response.json(await searchDiscordHistory({
        token,
        guildId: config.discordGuildId,
        search: parseDiscordHistorySearchInput(request.body),
      }));
    } catch (error) {
      if (error instanceof DiscordHistoryError) {
        response.status(error.status).json({ ok: false, code: error.code, error: error.message, ...error.details });
        return;
      }
      const message = describeError(error);
      response.status(message === "Unauthorized" ? 401 : message.includes("not configured") ? 503 : 500).json({ ok: false, error: message });
    }
  });

  app.post("/history/discord/context", async (request: Request, response: Response) => {
    try {
      requireAdapterToken(request);
      const config = adapterConfig();
      const token = (process.env.DISCORD_BOT_TOKEN ?? "").trim();
      if (!token || !config.discordGuildId) throw new Error("Discord history search is not configured");
      response.json(await fetchDiscordHistoryContext({
        token,
        guildId: config.discordGuildId,
        context: parseDiscordHistoryContextInput(request.body),
      }));
    } catch (error) {
      if (error instanceof DiscordHistoryError) {
        response.status(error.status).json({ ok: false, code: error.code, error: error.message, ...error.details });
        return;
      }
      const message = describeError(error);
      response.status(message === "Unauthorized" ? 401 : message.includes("not configured") ? 503 : 500).json({ ok: false, error: message });
    }
  });

  app.get("/guild/channels", async (request: Request, response: Response) => {
    try {
      requireAdapterToken(request);
      response.json({
        ok: true,
        adapter: "discord",
        guild: await inspectDiscordGuildChannels(),
      });
    } catch (error) {
      const message = describeError(error);
      response.status(message === "Unauthorized" ? 401 : 500).json({ ok: false, error: message });
    }
  });

  app.post("/messages", async (request: Request, response: Response) => {
    try {
      requireAdapterToken(request);
      const body = request.body && typeof request.body === "object" ? request.body as JsonObject : {};
      const { adapter, destinationId, type, title } = resolveMessageDestination(body);
      const content = typeof body.content === "string" ? body.content : "";
      response.json({
        ok: true,
        result: await sendAdapterMessage(adapter, destinationId, content, { type, title }),
      });
    } catch (error) {
      const message = describeError(error);
      response.status(message === "Unauthorized" ? 401 : 500).json({ ok: false, error: message });
    }
  });

  app.get("/buzz/channels", async (request: Request, response: Response) => {
    try {
      requireBuzzChannelAdminToken(request);
      const channels = await (await buzzClient()).listVisibleChannels();
      response.json({ ok: true, channels });
    } catch (error) {
      const message = describeError(error);
      response.status(buzzChannelAdminStatus(message)).json({ ok: false, error: message });
    }
  });

  app.get("/agent/buzz/channels/:channelId/messages", async (request: Request, response: Response) => {
    try {
      requireInternalServiceToken(request);
      const config = adapterConfig();
      if (config.buzzHistoryChannelAllowlist.length === 0) {
        throw new Error("BUZZ_HISTORY_NOT_CONFIGURED");
      }
      const channelId = buzzChannelUuid(request.params.channelId);
      if (!config.buzzHistoryChannelAllowlist.includes(channelId)) {
        throw new Error("BUZZ_HISTORY_CHANNEL_FORBIDDEN");
      }
      const now = new Date();
      const since = parseBuzzHistorySince(request.query.since, config.buzzHistoryMaxLookbackSeconds, now);
      const limit = parseBuzzHistoryLimit(request.query.limit, config.buzzHistoryMaxMessages);
      const includeOwnMessages = `${request.query.includeOwn ?? request.query.include_own ?? "false"}` === "true";
      const client = await buzzClient();
      const channels = await client.listChannels();
      const channel = channels.find((candidate) => candidate.channelId === channelId);
      if (!channel) throw new Error("Buzz history channel is not configured or visible");
      const initialEvents = await client.getMessages(channelId, since, {
        limit: config.buzzHistoryMaxMessages,
        includeOwnMessages: true,
      });
      const rootEventIds = [...new Set(initialEvents.map((event) => buzzThreadRootId(event, initialEvents)))]
        .slice(0, Math.min(config.buzzHistoryMaxMessages, 25));
      const expandedThreads = await Promise.all(rootEventIds.map(async (rootEventId) =>
        client.getThread(channelId, rootEventId, config.buzzHistoryMaxMessages).catch((error) => {
          console.warn("[buzz-adapter] direct history thread expansion failed", {
            channelId,
            rootEventId,
            error: describeError(error),
          });
          return [];
        })));
      const eventById = new Map<string, BuzzEvent>();
      for (const event of [...initialEvents, ...expandedThreads.flat()]) eventById.set(event.id.toLowerCase(), event);
      const allEvents = [...eventById.values()];
      const events = allEvents
        .filter((event) => event.createdAt * 1000 <= now.getTime())
        .filter((event) => event.createdAt * 1000 >= since.getTime())
        .filter((event) => includeOwnMessages || event.pubkey.toLowerCase() !== config.buzzPublicKey)
        .sort((left, right) => left.createdAt - right.createdAt || left.id.localeCompare(right.id));
      const limitedEvents = events.slice(-limit);
      const profiles = await client.getProfiles(limitedEvents.map((event) => event.pubkey)).catch((error) => {
        console.warn("[buzz-adapter] direct history profile lookup failed", {
          channelId,
          error: describeError(error),
        });
        return new Map();
      });
      const messages = limitedEvents.map((event) => {
        const normalized = normalizeBuzzMessage({
          event,
          channel,
          profile: profiles.get(event.pubkey) ?? null,
          relayUrl: config.buzzRelayUrl,
        }) as JsonObject;
        const threadRootEventId = buzzThreadRootId(event, allEvents);
        const replyToEventId = buzzEventDirectReplyId(event);
        return {
          ...normalized,
          threadId: threadRootEventId === event.id.toLowerCase() ? null : threadRootEventId,
          metadata: {
            ...parseStringRecord(normalized.metadata),
            threadRootEventId,
            replyToEventId,
          },
        } as JsonObject;
      });
      response.json({
        ok: true,
        source: "buzz",
        channel: {
          id: channel.channelId,
          name: channel.name,
          description: channel.description,
        },
        window: { since: since.toISOString(), until: now.toISOString() },
        includeOwnMessages,
        expandedThreadCount: rootEventIds.length,
        count: messages.length,
        messages,
      });
    } catch (error) {
      const message = describeError(error);
      response.status(buzzHistoryStatus(message)).json({ ok: false, error: message });
    }
  });

  app.post("/buzz/channels", async (request: Request, response: Response) => {
    try {
      requireBuzzChannelAdminToken(request);
      const body = parseStringRecord(request.body);
      const name = typeof body.name === "string" ? body.name.trim() : "";
      const channelType = body.channelType ?? body.channel_type ?? body.type;
      const visibility = body.visibility;
      if (!name) throw new Error("name is required");
      if (channelType !== "stream" && channelType !== "forum") throw new Error("channelType must be stream or forum");
      if (visibility !== "open" && visibility !== "private") throw new Error("visibility must be open or private");
      const ttlValue = body.ttlSeconds ?? body.ttl_seconds;
      const ttlSeconds = ttlValue === undefined || ttlValue === null ? null : Number(ttlValue);
      const shouldRegister = body.registerPrism !== false && body.register_prism !== false;
      const mode = buzzChannelAccessMode(body.mode);
      const agentProfileKey = typeof body.agentProfileKey === "string"
        ? body.agentProfileKey.trim().toLowerCase()
        : typeof body.agent_profile_key === "string"
          ? body.agent_profile_key.trim().toLowerCase()
          : typeof body.interactionProfileKey === "string"
            ? body.interactionProfileKey.trim().toLowerCase()
            : typeof body.interaction_profile_key === "string"
              ? body.interaction_profile_key.trim().toLowerCase()
              : (process.env.BUZZ_CHANNEL_ADMIN_PROFILE_KEY ?? "admin-agent").trim().toLowerCase();
      const created = await (await buzzClient()).createChannel({
        name,
        channelType,
        visibility,
        description: typeof body.description === "string" ? body.description : null,
        ttlSeconds,
      });
      const channelId = buzzChannelUuid(created.channel_id ?? created.channelId);
      let binding: JsonObject | null = null;
      if (shouldRegister) {
        binding = await registerBuzzChannelBinding({ channelId, mode, agentProfileKey });
      }
      response.status(201).json({ ok: true, channelId, created, registered: shouldRegister, binding });
    } catch (error) {
      const message = describeError(error);
      response.status(buzzChannelAdminStatus(message)).json({ ok: false, error: message });
    }
  });

  app.patch("/buzz/channels/:channelId", async (request: Request, response: Response) => {
    try {
      requireBuzzChannelAdminToken(request);
      const channelId = buzzChannelUuid(request.params.channelId);
      const body = parseStringRecord(request.body);
      const client = await buzzClient([channelId]);
      const results: JsonObject = {};
      const hasMetadata = body.name !== undefined || body.description !== undefined
        || body.ttlSeconds !== undefined || body.ttl_seconds !== undefined
        || body.clearTtl !== undefined || body.clear_ttl !== undefined;
      if (hasMetadata) {
        results.metadata = await client.updateChannel(channelId, {
          name: typeof body.name === "string" ? body.name : undefined,
          description: typeof body.description === "string" ? body.description : undefined,
          ttlSeconds: body.ttlSeconds !== undefined || body.ttl_seconds !== undefined
            ? Number(body.ttlSeconds ?? body.ttl_seconds)
            : undefined,
          clearTtl: body.clearTtl === true || body.clear_ttl === true,
        }) as JsonValue;
      }
      if (typeof body.topic === "string") {
        results.topic = await client.setChannelTopic(channelId, body.topic) as JsonValue;
      }
      if (typeof body.purpose === "string") {
        results.purpose = await client.setChannelPurpose(channelId, body.purpose) as JsonValue;
      }
      if (Object.keys(results).length === 0) throw new Error("at least one channel field is required");
      response.json({ ok: true, channelId, results });
    } catch (error) {
      const message = describeError(error);
      response.status(buzzChannelAdminStatus(message)).json({ ok: false, error: message });
    }
  });

  app.put("/buzz/channels/:channelId/access", async (request: Request, response: Response) => {
    try {
      requireBuzzChannelAdminToken(request);
      const channelId = buzzChannelUuid(request.params.channelId);
      const body = parseStringRecord(request.body);
      const mode = buzzChannelAccessMode(body.mode);
      const agentProfileKey = typeof body.agentProfileKey === "string"
        ? body.agentProfileKey.trim().toLowerCase()
        : typeof body.agent_profile_key === "string"
          ? body.agent_profile_key.trim().toLowerCase()
          : typeof body.interactionProfileKey === "string"
            ? body.interactionProfileKey.trim().toLowerCase()
            : typeof body.interaction_profile_key === "string"
              ? body.interaction_profile_key.trim().toLowerCase()
              : (process.env.BUZZ_CHANNEL_ADMIN_PROFILE_KEY ?? "admin-agent").trim().toLowerCase();
      const binding = await registerBuzzChannelBinding({ channelId, mode, agentProfileKey });
      response.json({ ok: true, channelId, mode, agentProfileKey, binding });
    } catch (error) {
      const message = describeError(error);
      response.status(buzzChannelAdminStatus(message)).json({ ok: false, error: message });
    }
  });

  app.post("/buzz/channels/:channelId/archive", async (request: Request, response: Response) => {
    try {
      requireBuzzChannelAdminToken(request);
      const channelId = buzzChannelUuid(request.params.channelId);
      const body = parseStringRecord(request.body);
      if (typeof body.archived !== "boolean") throw new Error("archived must be a boolean");
      const result = await (await buzzClient([channelId])).setChannelArchived(channelId, body.archived);
      response.json({ ok: true, channelId, archived: body.archived, result });
    } catch (error) {
      const message = describeError(error);
      response.status(buzzChannelAdminStatus(message)).json({ ok: false, error: message });
    }
  });

  app.get("/buzz/channels/:channelId/members", async (request: Request, response: Response) => {
    try {
      requireBuzzChannelAdminToken(request);
      const channelId = buzzChannelUuid(request.params.channelId);
      const members = await (await buzzClient([channelId])).listChannelMembers(channelId);
      response.json({ ok: true, channelId, members });
    } catch (error) {
      const message = describeError(error);
      response.status(buzzChannelAdminStatus(message)).json({ ok: false, error: message });
    }
  });

  app.post("/buzz/channels/:channelId/members", async (request: Request, response: Response) => {
    try {
      requireBuzzChannelAdminToken(request);
      const channelId = buzzChannelUuid(request.params.channelId);
      const body = parseStringRecord(request.body);
      const pubkey = buzzChannelPubkey(body.pubkey);
      const role = typeof body.role === "string" ? body.role.trim().toLowerCase() : "member";
      if (!["owner", "admin", "member", "guest", "bot"].includes(role)) {
        throw new Error("role must be owner, admin, member, guest, or bot");
      }
      const result = await (await buzzClient([channelId])).addChannelMember(channelId, pubkey, role as BuzzChannelMemberRole);
      response.status(201).json({ ok: true, channelId, pubkey, role, result });
    } catch (error) {
      const message = describeError(error);
      response.status(buzzChannelAdminStatus(message)).json({ ok: false, error: message });
    }
  });

  app.delete("/buzz/channels/:channelId/members/:pubkey", async (request: Request, response: Response) => {
    try {
      requireBuzzChannelAdminToken(request);
      const channelId = buzzChannelUuid(request.params.channelId);
      const pubkey = buzzChannelPubkey(request.params.pubkey);
      const result = await (await buzzClient([channelId])).removeChannelMember(channelId, pubkey);
      response.json({ ok: true, channelId, pubkey, result });
    } catch (error) {
      const message = describeError(error);
      response.status(buzzChannelAdminStatus(message)).json({ ok: false, error: message });
    }
  });

  app.post("/attachments/fetch", async (request: Request, response: Response) => {
    try {
      requireAdapterToken(request);
      const body = request.body && typeof request.body === "object" ? request.body as JsonObject : {};
      const platform = typeof body.platform === "string" ? body.platform.trim().toLowerCase() : "discord";
      if (platform !== "discord") {
        response.status(400).json({ ok: false, error: "Unsupported attachment platform" });
        return;
      }
      const channelId = typeof body.channelId === "string"
        ? body.channelId.trim()
        : typeof body.channel_id === "string"
          ? body.channel_id.trim()
          : "";
      const messageId = typeof body.messageId === "string"
        ? body.messageId.trim()
        : typeof body.message_id === "string"
          ? body.message_id.trim()
          : "";
      const attachmentId = typeof body.attachmentId === "string"
        ? body.attachmentId.trim()
        : typeof body.attachment_id === "string"
          ? body.attachment_id.trim()
          : "";
      if (!channelId || !messageId || !attachmentId) {
        response.status(400).json({ ok: false, error: "channelId, messageId, and attachmentId are required" });
        return;
      }

      const fetched = await fetchDiscordAttachment({ channelId, messageId, attachmentId });
      response.setHeader("content-type", fetched.contentType);
      response.setHeader("content-length", String(fetched.body.byteLength));
      response.setHeader("content-disposition", `attachment; filename="${fetched.filename.replace(/[\x00-\x1F\x7F"\\]/g, "_")}"`);
      response.setHeader("x-prism-attachment-metadata", Buffer.from(JSON.stringify(fetched.metadata), "utf8").toString("base64url"));
      response.send(fetched.body);
    } catch (error) {
      const message = describeError(error);
      const status =
        message === "Unauthorized" ? 401
        : message === "ATTACHMENT_NOT_FOUND" ? 404
        : message.startsWith("ATTACHMENT_TOO_LARGE:") ? 413
        : 500;
      response.status(status).json({ ok: false, error: message });
    }
  });

  app.post("/attachments/resolve", async (request: Request, response: Response) => {
    try {
      requireAdapterToken(request);
      const body = request.body && typeof request.body === "object" ? request.body as JsonObject : {};
      const platform = typeof body.platform === "string" ? body.platform.trim().toLowerCase() : "discord";
      if (platform !== "discord") {
        response.status(400).json({ ok: false, error: "Unsupported attachment platform" });
        return;
      }
      const channelId = typeof body.channelId === "string"
        ? body.channelId.trim()
        : typeof body.channel_id === "string"
          ? body.channel_id.trim()
          : "";
      const messageId = typeof body.messageId === "string"
        ? body.messageId.trim()
        : typeof body.message_id === "string"
          ? body.message_id.trim()
          : "";
      if (!channelId || !messageId) {
        response.status(400).json({ ok: false, error: "channelId and messageId are required" });
        return;
      }

      const result = await resolveDiscordMessageAttachments({ channelId, messageId });
      response.json({ ok: true, platform, channelId, messageId, ...result });
    } catch (error) {
      const message = describeError(error);
      const status = message === "Unauthorized" ? 401 : message.includes("Discord API failed: 404") ? 404 : 500;
      response.status(status).json({ ok: false, error: message });
    }
  });

  app.post("/sync", async (request: Request, response: Response) => {
    try {
      requireAdapterToken(request);
      const dryRun = `${request.query.dry_run ?? "false"}` === "true";
      const resetCheckpoint = `${request.query.reset_checkpoint ?? "false"}` === "true";
      response.json(await runSync(dryRun, resetCheckpoint));
    } catch (error) {
      const message = describeError(error);
      response.status(message === "Unauthorized" ? 401 : 500).json({ ok: false, error: message });
    }
  });

  app.post("/buzz/interactions/poll", async (request: Request, response: Response) => {
    try {
      requireAdapterToken(request);
      if (buzzInteractionStatus.running) {
        response.status(409).json({ ok: false, error: "BUZZ_INTERACTION_POLL_IN_PROGRESS" });
        return;
      }
      buzzInteractionStatus.running = true;
      try {
        response.json(await runBuzzInteractionPoll());
      } finally {
        buzzInteractionStatus.running = false;
      }
    } catch (error) {
      const message = describeError(error);
      buzzInteractionStatus.lastError = message;
      response.status(message === "Unauthorized" ? 401 : 500).json({ ok: false, error: message });
    }
  });

  app.post("/buzz/commands", async (request: Request, response: Response) => {
    try {
      requireAdapterToken(request);
      const body = request.body && typeof request.body === "object" ? request.body as JsonObject : {};
      const args = Array.isArray(body.args) ? body.args : [];
      const result = await buzzClient([]).executeCommand(args);
      console.log("[buzz-adapter] authenticated command executed", {
        command: typeof args[0] === "string" ? args[0] : null,
        operation: typeof args[1] === "string" ? args[1] : null,
      });
      response.json({ ok: true, result });
    } catch (error) {
      const message = describeError(error);
      const status = message === "Unauthorized" ? 401 : message.startsWith("Buzz command args") || message.startsWith("Unsupported Buzz command") || message.includes("managed by the adapter") ? 400 : 502;
      response.status(status).json({ ok: false, error: message });
    }
  });

  app.get("/recordings/:sessionId/:fileName", async (request: Request, response: Response) => {
    try {
      requireAdapterToken(request);
      if (!voiceManager) {
        response.status(503).json({ ok: false, error: "VOICE_MANAGER_UNAVAILABLE" });
        return;
      }
      const sessionId = Array.isArray(request.params.sessionId) ? request.params.sessionId[0] : request.params.sessionId;
      const fileName = Array.isArray(request.params.fileName) ? request.params.fileName[0] : request.params.fileName;
      const resolved = await voiceManager.resolveRecordingDownload(sessionId, fileName);
      if (!resolved) {
        response.status(404).json({ ok: false, error: "RECORDING_NOT_FOUND" });
        return;
      }
      response.type(resolved.contentType);
      response.sendFile(resolved.filePath);
    } catch (error) {
      const message = describeError(error);
      response.status(message === "Unauthorized" ? 401 : 500).json({ ok: false, error: message });
    }
  });

  app.post("/recordings/:sessionId/recover", async (request: Request, response: Response) => {
    try {
      requireAdapterToken(request);
      if (!voiceManager) {
        response.status(503).json({ ok: false, error: "VOICE_MANAGER_UNAVAILABLE" });
        return;
      }
      const sessionId = Array.isArray(request.params.sessionId) ? request.params.sessionId[0] : request.params.sessionId;
      const metadata = await voiceManager.recoverRecordingSession(sessionId);
      response.json({ ok: true, metadata });
    } catch (error) {
      const message = describeError(error);
      response.status(message === "Unauthorized" ? 401 : 500).json({ ok: false, error: message });
    }
  });

  const port = Number(process.env.PORT ?? "8789");
  app.listen(port, () => {
    console.log(`[source-adapter] listening on ${port}`);
  });

  const shutdown = async () => {
    stopTelegramDiscovery?.();
    stopBuzzInteractions?.();
    if (bridgeClient) {
      await bridgeClient.destroy();
      bridgeClient = null;
    }
    voiceManager = null;
    process.exit(0);
  };
  process.on("SIGINT", () => void shutdown());
  process.on("SIGTERM", () => void shutdown());
}

void main().catch((error) => {
  console.error("[source-adapter] fatal", describeError(error));
  process.exit(1);
});
