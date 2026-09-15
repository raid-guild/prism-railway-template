import { createHash } from "node:crypto";

const DISCORD_EPOCH_MS = 1_420_070_400_000n;
const SNOWFLAKE_INCREMENT_BITS = 22n;

type JsonRecord = Record<string, unknown>;

export type DiscordHistorySearchInput = {
  query: string;
  channelIds: string[];
  authorIds: string[];
  mentions: string[];
  from: string | null;
  to: string | null;
  has: string[];
  sortBy: "timestamp" | "relevance";
  sortOrder: "asc" | "desc";
  includeNsfw: boolean;
  limit: number;
  cursor: string | null;
};

export type DiscordHistoryContextInput = {
  channelId: string;
  messageId: string;
  before: number;
  after: number;
};

export class DiscordHistoryError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
    readonly details: JsonRecord = {},
  ) {
    super(message);
  }
}

function record(value: unknown): JsonRecord {
  return value && typeof value === "object" && !Array.isArray(value) ? value as JsonRecord : {};
}

function stringValue(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function stringArray(value: unknown, field: string, maximum: number): string[] {
  if (value === undefined || value === null) return [];
  if (!Array.isArray(value)) throw new DiscordHistoryError(400, "INVALID_SEARCH", `${field} must be an array`);
  const values = value.map(stringValue).filter(Boolean);
  if (values.length > maximum) throw new DiscordHistoryError(400, "INVALID_SEARCH", `${field} supports at most ${maximum} values`);
  if (values.some((entry) => !/^\d{1,30}$/.test(entry))) {
    throw new DiscordHistoryError(400, "INVALID_SEARCH", `${field} must contain Discord snowflakes`);
  }
  return [...new Set(values)];
}

function integer(value: unknown, fallback: number, minimum: number, maximum: number, field: string): number {
  const parsed = value === undefined || value === null || value === "" ? fallback : Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < minimum || parsed > maximum) {
    throw new DiscordHistoryError(400, "INVALID_SEARCH", `${field} must be an integer from ${minimum} to ${maximum}`);
  }
  return parsed;
}

function isoTimestamp(value: unknown, field: string): string | null {
  if (value === undefined || value === null || value === "") return null;
  const parsed = new Date(String(value));
  if (!Number.isFinite(parsed.getTime())) throw new DiscordHistoryError(400, "INVALID_SEARCH", `${field} must be an ISO timestamp`);
  return parsed.toISOString();
}

export function parseDiscordHistorySearchInput(value: unknown): DiscordHistorySearchInput {
  const input = record(value);
  const query = stringValue(input.query);
  if (!query) throw new DiscordHistoryError(400, "INVALID_SEARCH", "query is required");
  if (query.length > 1_024) throw new DiscordHistoryError(400, "INVALID_SEARCH", "query must not exceed 1024 characters");
  const from = isoTimestamp(input.from, "from");
  const to = isoTimestamp(input.to, "to");
  if (from && to && new Date(from).getTime() >= new Date(to).getTime()) {
    throw new DiscordHistoryError(400, "INVALID_SEARCH", "from must be earlier than to");
  }
  const sortBy = stringValue(input.sortBy ?? input.sort_by) || "relevance";
  if (sortBy !== "timestamp" && sortBy !== "relevance") {
    throw new DiscordHistoryError(400, "INVALID_SEARCH", "sortBy must be timestamp or relevance");
  }
  const sortOrder = stringValue(input.sortOrder ?? input.sort_order) || "desc";
  if (sortOrder !== "asc" && sortOrder !== "desc") {
    throw new DiscordHistoryError(400, "INVALID_SEARCH", "sortOrder must be asc or desc");
  }
  const allowedHas = new Set(["image", "sound", "video", "file", "sticker", "embed", "link", "poll", "snapshot"]);
  const rawHas = input.has === undefined || input.has === null
    ? []
    : Array.isArray(input.has) ? input.has.map(stringValue).filter(Boolean) : (() => { throw new DiscordHistoryError(400, "INVALID_SEARCH", "has must be an array"); })();
  if (rawHas.some((entry) => !allowedHas.has(entry.replace(/^-/, "")))) {
    throw new DiscordHistoryError(400, "INVALID_SEARCH", "has contains an unsupported Discord filter");
  }
  return {
    query,
    channelIds: stringArray(input.channelIds ?? input.channel_ids, "channelIds", 500),
    authorIds: stringArray(input.authorIds ?? input.author_ids, "authorIds", 100),
    mentions: stringArray(input.mentions, "mentions", 100),
    from,
    to,
    has: [...new Set(rawHas)],
    sortBy,
    sortOrder,
    includeNsfw: input.includeNsfw === true || input.include_nsfw === true,
    limit: integer(input.limit, 25, 1, 25, "limit"),
    cursor: stringValue(input.cursor) || null,
  };
}

export function parseDiscordHistoryContextInput(value: unknown): DiscordHistoryContextInput {
  const input = record(value);
  const channelId = stringValue(input.channelId ?? input.channel_id);
  const messageId = stringValue(input.messageId ?? input.message_id);
  if (!/^\d{1,30}$/.test(channelId) || !/^\d{1,30}$/.test(messageId)) {
    throw new DiscordHistoryError(400, "INVALID_CONTEXT", "channelId and messageId must be Discord snowflakes");
  }
  return {
    channelId,
    messageId,
    before: integer(input.before, 5, 0, 25, "before"),
    after: integer(input.after, 5, 0, 25, "after"),
  };
}

export function timestampToDiscordSnowflake(value: string, upperBoundary = false): string {
  const timestamp = BigInt(new Date(value).getTime());
  if (timestamp < DISCORD_EPOCH_MS) return "0";
  const base = (timestamp - DISCORD_EPOCH_MS) << SNOWFLAKE_INCREMENT_BITS;
  return (upperBoundary ? base + ((1n << SNOWFLAKE_INCREMENT_BITS) - 1n) : base).toString();
}

function queryFingerprint(input: Omit<DiscordHistorySearchInput, "cursor">): string {
  return createHash("sha256").update(JSON.stringify(input)).digest("base64url").slice(0, 20);
}

function cursorOffset(input: DiscordHistorySearchInput): number {
  if (!input.cursor) return 0;
  try {
    const decoded = record(JSON.parse(Buffer.from(input.cursor, "base64url").toString("utf8")));
    const expected = queryFingerprint({ ...input, cursor: undefined } as unknown as Omit<DiscordHistorySearchInput, "cursor">);
    if (decoded.fingerprint !== expected) throw new Error("mismatch");
    return integer(decoded.offset, 0, 0, 9_975, "cursor offset");
  } catch {
    throw new DiscordHistoryError(400, "INVALID_CURSOR", "cursor is invalid for this search");
  }
}

function nextCursor(input: DiscordHistorySearchInput, offset: number, resultCount: number): string | null {
  const nextOffset = offset + resultCount;
  if (resultCount < input.limit || nextOffset > 9_975) return null;
  const fingerprint = queryFingerprint({ ...input, cursor: undefined } as unknown as Omit<DiscordHistorySearchInput, "cursor">);
  return Buffer.from(JSON.stringify({ offset: nextOffset, fingerprint }), "utf8").toString("base64url");
}

export function discordSearchParams(input: DiscordHistorySearchInput): URLSearchParams {
  const params = new URLSearchParams({
    content: input.query,
    limit: String(input.limit),
    offset: String(cursorOffset(input)),
    sort_by: input.sortBy,
    sort_order: input.sortOrder,
    include_nsfw: String(input.includeNsfw),
  });
  for (const value of input.channelIds) params.append("channel_id", value);
  for (const value of input.authorIds) params.append("author_id", value);
  for (const value of input.mentions) params.append("mentions", value);
  for (const value of input.has) params.append("has", value);
  if (input.from) params.set("min_id", timestampToDiscordSnowflake(input.from));
  if (input.to) params.set("max_id", timestampToDiscordSnowflake(input.to, true));
  return params;
}

function normalizedAuthor(value: unknown) {
  const author = record(value);
  return {
    id: stringValue(author.id) || null,
    name: stringValue(author.global_name ?? author.username) || "unknown",
    username: stringValue(author.username) || null,
    bot: author.bot === true,
  };
}

function normalizedAttachment(value: unknown) {
  const attachment = record(value);
  return {
    id: stringValue(attachment.id) || null,
    filename: stringValue(attachment.filename) || null,
    contentType: stringValue(attachment.content_type) || null,
    size: typeof attachment.size === "number" ? attachment.size : null,
    url: stringValue(attachment.url) || null,
  };
}

function normalizeDiscordHistoryMessage(
  messageValue: unknown,
  guildId: string,
  channelNames: Map<string, string>,
  threadIds: Set<string> = new Set(),
) {
  const message = record(messageValue);
  const channelId = stringValue(message.channel_id);
  const messageId = stringValue(message.id);
  return {
    source: "discord",
    guildId,
    channelId,
    channelName: channelNames.get(channelId) ?? null,
    threadId: threadIds.has(channelId) ? channelId : null,
    messageId,
    author: normalizedAuthor(message.author),
    timestamp: stringValue(message.timestamp) || null,
    editedTimestamp: stringValue(message.edited_timestamp) || null,
    text: typeof message.content === "string" ? message.content : "",
    url: channelId && messageId ? `https://discord.com/channels/${guildId}/${channelId}/${messageId}` : null,
    attachments: Array.isArray(message.attachments) ? message.attachments.map(normalizedAttachment) : [],
    embeds: Array.isArray(message.embeds) ? message.embeds : [],
  };
}

async function discordRequest(input: {
  token: string;
  pathname: string;
  params?: URLSearchParams;
  fetchImpl?: typeof fetch;
}) {
  const url = new URL(`https://discord.com/api/v10${input.pathname}`);
  if (input.params) url.search = input.params.toString();
  const response = await (input.fetchImpl ?? fetch)(url, {
    headers: { Authorization: `Bot ${input.token}`, "User-Agent": "prism-source-adapter/0.1" },
  });
  const payload = await response.json().catch(() => null);
  if (response.status === 202) {
    const details = record(payload);
    throw new DiscordHistoryError(503, "DISCORD_SEARCH_INDEXING", "Discord is indexing guild history", {
      retryable: true,
      retryAfterSeconds: Number(details.retry_after ?? 2),
      documentsIndexed: Number(details.documents_indexed ?? 0),
    });
  }
  if (response.status === 429) {
    const details = record(payload);
    throw new DiscordHistoryError(429, "DISCORD_RATE_LIMITED", "Discord history search is rate limited", {
      retryable: true,
      retryAfterSeconds: Number(details.retry_after ?? response.headers.get("retry-after") ?? 1),
    });
  }
  if (!response.ok) {
    const details = record(payload);
    const code = response.status === 403 ? "DISCORD_HISTORY_FORBIDDEN" : "DISCORD_HISTORY_FAILED";
    throw new DiscordHistoryError(response.status, code, stringValue(details.message) || `Discord API returned ${response.status}`);
  }
  return payload;
}

export async function searchDiscordHistory(input: {
  token: string;
  guildId: string;
  search: DiscordHistorySearchInput;
  fetchImpl?: typeof fetch;
}) {
  const offset = cursorOffset(input.search);
  const payload = record(await discordRequest({
    token: input.token,
    pathname: `/guilds/${input.guildId}/messages/search`,
    params: discordSearchParams(input.search),
    fetchImpl: input.fetchImpl,
  }));
  const channels = [...(Array.isArray(payload.threads) ? payload.threads : []), ...(Array.isArray(payload.channels) ? payload.channels : [])];
  const channelNames = new Map(channels.flatMap((value): Array<[string, string]> => {
    const channel = record(value);
    const id = stringValue(channel.id);
    return id ? [[id, stringValue(channel.name) || id]] : [];
  }));
  const threadIds = new Set((Array.isArray(payload.threads) ? payload.threads : []).flatMap((value): string[] => {
    const id = stringValue(record(value).id);
    return id ? [id] : [];
  }));
  const messages = (Array.isArray(payload.messages) ? payload.messages : []).flatMap((entry) => Array.isArray(entry) ? entry : [entry]);
  const results = messages.map((message) => normalizeDiscordHistoryMessage(message, input.guildId, channelNames, threadIds));
  return {
    ok: true,
    source: "discord",
    coverage: {
      guildId: input.guildId,
      mode: "native-search",
      scope: input.search.channelIds.length ? "requested-channels" : "bot-visible-channels",
      complete: true,
      limitations: ["bot-visible-channels-only"],
    },
    totalResults: typeof payload.total_results === "number" ? payload.total_results : results.length,
    results,
    nextCursor: nextCursor(input.search, offset, results.length),
  };
}

export async function fetchDiscordHistoryContext(input: {
  token: string;
  guildId: string;
  context: DiscordHistoryContextInput;
  fetchImpl?: typeof fetch;
}) {
  const selected = await discordRequest({ token: input.token, pathname: `/channels/${input.context.channelId}/messages/${input.context.messageId}`, fetchImpl: input.fetchImpl });
  const before = input.context.before
    ? await discordRequest({
      token: input.token,
      pathname: `/channels/${input.context.channelId}/messages`,
      params: new URLSearchParams({ before: input.context.messageId, limit: String(input.context.before) }),
      fetchImpl: input.fetchImpl,
    })
    : [];
  const after = input.context.after
    ? await discordRequest({
      token: input.token,
      pathname: `/channels/${input.context.channelId}/messages`,
      params: new URLSearchParams({ after: input.context.messageId, limit: String(input.context.after) }),
      fetchImpl: input.fetchImpl,
    })
    : [];
  const messages = [...(Array.isArray(before) ? before : []), selected, ...(Array.isArray(after) ? after : [])]
    .map((message) => normalizeDiscordHistoryMessage(message, input.guildId, new Map()))
    .sort((left, right) => String(left.timestamp).localeCompare(String(right.timestamp)) || left.messageId.localeCompare(right.messageId));
  return { ok: true, source: "discord", selectedMessageId: input.context.messageId, messages };
}
