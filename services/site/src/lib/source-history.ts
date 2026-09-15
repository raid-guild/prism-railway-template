import {
  loadConfig,
  readSourceAdapterPolicy,
  resolveSourceAdapterPolicy,
  type SourceAdapterPolicySettings,
} from "@/lib/app-core"

type JsonRecord = Record<string, unknown>

export class SourceHistoryError extends Error {
  constructor(readonly status: number, readonly code: string, message: string, readonly details: JsonRecord = {}) {
    super(message)
  }
}

function record(value: unknown): JsonRecord {
  return value && typeof value === "object" && !Array.isArray(value) ? value as JsonRecord : {}
}

function stringValue(value: unknown) {
  return typeof value === "string" ? value.trim() : ""
}

function stringArray(value: unknown) {
  return Array.isArray(value) ? value.filter((entry): entry is string => typeof entry === "string").map((entry) => entry.trim()).filter(Boolean) : []
}

export function communicationAdapterConfig() {
  return {
    baseUrl: (process.env.COMMUNICATION_ADAPTER_BASE_URL ?? process.env.SOURCE_ADAPTER_BASE_URL ?? "").trim().replace(/\/+$/, ""),
    token: (process.env.COMMUNICATION_ADAPTER_TOKEN ?? process.env.SOURCE_ADAPTER_TOKEN ?? "").trim(),
  }
}

function requireAdapterConfig(override?: { baseUrl: string; token: string }) {
  const config = override ?? communicationAdapterConfig()
  if (!config.baseUrl || !config.token) {
    throw new SourceHistoryError(503, "SOURCE_HISTORY_NOT_CONFIGURED", "Communication adapter is not configured")
  }
  return config
}

function discordTargetAllowed(policy: SourceAdapterPolicySettings, channelId: string) {
  const platform = policy.platforms.discord
  const targetMode = platform?.targets[channelId]?.mode
  return targetMode ? targetMode !== "off" : platform?.defaultMode !== "off"
}

export function authorizeSourceHistoryRequest(value: unknown, policy: SourceAdapterPolicySettings) {
  const body = record(value)
  const source = stringValue(body.source).toLowerCase()
  if (!source) throw new SourceHistoryError(400, "INVALID_SOURCE_HISTORY_REQUEST", "source is required")
  if (source !== "discord") {
    throw new SourceHistoryError(501, "SOURCE_HISTORY_UNAVAILABLE", `${source} history search is not implemented`)
  }
  if (body.includeNsfw === true || body.include_nsfw === true) {
    throw new SourceHistoryError(403, "SOURCE_HISTORY_SCOPE_FORBIDDEN", "Age-restricted Discord history search is disabled")
  }

  const channelIds = stringArray(body.channelIds ?? body.channel_ids)
  if (channelIds.some((channelId) => !/^\d{1,30}$/.test(channelId))) {
    throw new SourceHistoryError(400, "INVALID_SOURCE_HISTORY_REQUEST", "channelIds must contain Discord snowflakes")
  }

  const sourceContext = record(body.sourceContext ?? body.source_context)
  const sourceTargetId = stringValue(sourceContext.targetId ?? sourceContext.target_id)
  const sourceThreadId = stringValue(sourceContext.threadId ?? sourceContext.thread_id)
  if (sourceTargetId) {
    const resolved = resolveSourceAdapterPolicy(policy, {
      platform: "discord",
      targetId: sourceTargetId,
      threadId: sourceThreadId || null,
      groupIds: stringArray(sourceContext.groupIds ?? sourceContext.group_ids),
      userId: stringValue(sourceContext.userId ?? sourceContext.user_id),
    })
    if (resolved.mode === "off") {
      throw new SourceHistoryError(403, "SOURCE_HISTORY_SCOPE_FORBIDDEN", "The source context cannot search history")
    }
    const defaultScope = [sourceThreadId || sourceTargetId]
    const allowedScopes = new Set(resolved.historyScopes.length ? resolved.historyScopes : defaultScope)
    const requested = channelIds.length ? channelIds : defaultScope
    if (requested.some((channelId) => !allowedScopes.has(channelId))) {
      throw new SourceHistoryError(403, "SOURCE_HISTORY_SCOPE_FORBIDDEN", "Requested channels exceed the source context history scope")
    }
    return { ...body, source, channelIds: [...new Set(requested)], includeNsfw: false }
  }

  if (channelIds.some((channelId) => !discordTargetAllowed(policy, channelId))) {
    throw new SourceHistoryError(403, "SOURCE_HISTORY_SCOPE_FORBIDDEN", "At least one requested Discord channel is disabled by source policy")
  }
  return { ...body, source, channelIds: [...new Set(channelIds)], includeNsfw: false }
}

export function authorizeSourceHistoryContext(value: unknown, policy: SourceAdapterPolicySettings) {
  const body = record(value)
  const source = stringValue(body.source).toLowerCase()
  if (source !== "discord") {
    throw new SourceHistoryError(source ? 501 : 400, source ? "SOURCE_HISTORY_UNAVAILABLE" : "INVALID_SOURCE_HISTORY_REQUEST", source ? `${source} history context is not implemented` : "source is required")
  }
  const channelId = stringValue(body.channelId ?? body.channel_id)
  if (!/^\d{1,30}$/.test(channelId)) throw new SourceHistoryError(400, "INVALID_SOURCE_HISTORY_REQUEST", "channelId must be a Discord snowflake")
  const sourceContext = record(body.sourceContext ?? body.source_context)
  const sourceTargetId = stringValue(sourceContext.targetId ?? sourceContext.target_id)
  if (sourceTargetId) {
    authorizeSourceHistoryRequest({ source, channelIds: [channelId], sourceContext }, policy)
    return { ...body, source, channelId, before: boundedContext(body.before), after: boundedContext(body.after), sourceContext }
  }
  if (!discordTargetAllowed(policy, channelId)) throw new SourceHistoryError(403, "SOURCE_HISTORY_SCOPE_FORBIDDEN", "Discord channel is disabled by source policy")
  return { ...body, source, channelId, before: boundedContext(body.before), after: boundedContext(body.after) }
}

function boundedContext(value: unknown) {
  const parsed = value === undefined || value === null ? 5 : Number(value)
  if (!Number.isSafeInteger(parsed) || parsed < 0 || parsed > 10) {
    throw new SourceHistoryError(400, "INVALID_SOURCE_HISTORY_REQUEST", "context before/after must be integers from 0 to 10")
  }
  return parsed
}

export async function communicationAdapterRequest(
  pathname: string,
  body?: JsonRecord,
  fetchImpl: typeof fetch = fetch,
  configOverride?: { baseUrl: string; token: string },
) {
  const config = requireAdapterConfig(configOverride)
  const response = await fetchImpl(`${config.baseUrl}${pathname}`, {
    method: body ? "POST" : "GET",
    headers: { "content-type": "application/json", "X-Adapter-Token": config.token },
    ...(body ? { body: JSON.stringify(body) } : {}),
  })
  const payload = await response.json().catch(() => null) as JsonRecord | null
  if (!response.ok) {
    throw new SourceHistoryError(
      response.status,
      stringValue(payload?.code) || "SOURCE_HISTORY_PROVIDER_FAILED",
      stringValue(payload?.error) || `Communication adapter returned ${response.status}`,
      payload ?? {},
    )
  }
  return payload ?? {}
}

export async function sourceHistoryCapabilities(
  fetchImpl: typeof fetch = fetch,
  configOverride?: { baseUrl: string; token: string },
) {
  let adapterCapabilities: string[] = []
  try {
    const payload = await communicationAdapterRequest("/capabilities", undefined, fetchImpl, configOverride)
    adapterCapabilities = stringArray(payload.capabilities)
  } catch (error) {
    if (!(error instanceof SourceHistoryError) || error.code !== "SOURCE_HISTORY_NOT_CONFIGURED") throw error
  }
  return {
    ok: true,
    sources: {
      discord: adapterCapabilities.includes("search-discord-history")
        ? { mode: "native-search", coverage: "provider-history", supportsQuery: true, supportsContext: true, limitations: ["bot-visible-channels-only", "age-restricted-channels-disabled"] }
        : { mode: "unavailable", coverage: "not-configured", supportsQuery: false, supportsContext: false },
      buzz: adapterCapabilities.includes("read-buzz-channel-history")
        ? { mode: "bounded-read-through", coverage: "configured-lookback", supportsQuery: false, supportsContext: true }
        : { mode: "unavailable", coverage: "not-configured", supportsQuery: false, supportsContext: false },
      telegram: { mode: "unavailable", coverage: "bot-seen-history-not-retained", supportsQuery: false, supportsContext: false },
      email: { mode: "unavailable", coverage: "not-configured", supportsQuery: false, supportsContext: false },
    },
  }
}

export function currentSourceAdapterPolicy() {
  return readSourceAdapterPolicy(loadConfig())
}
