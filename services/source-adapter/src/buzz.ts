import { execFile } from "node:child_process";
import { promisify } from "node:util";
import {
  finalizeEvent,
  nip19,
  Relay,
  type Event,
  type EventTemplate,
  type VerifiedEvent,
} from "nostr-tools";
import { useWebSocketImplementation } from "nostr-tools/relay";
import { WebSocket } from "undici";

const execFileAsync = promisify(execFile);

useWebSocketImplementation(WebSocket);

const BUZZ_TYPING_INTERVAL_MS = 3_000;
const BUZZ_TYPING_CONNECT_TIMEOUT_MS = 10_000;

export type BuzzChannel = {
  channelId: string;
  name: string;
  description: string | null;
  createdAt: number | null;
};

export type BuzzChannelCreateInput = {
  name: string;
  channelType: "stream" | "forum";
  visibility: "open" | "private";
  description?: string | null;
  ttlSeconds?: number | null;
};

export type BuzzChannelUpdateInput = {
  name?: string | null;
  description?: string | null;
  ttlSeconds?: number | null;
  clearTtl?: boolean;
};

export type BuzzChannelMemberRole = "owner" | "admin" | "member" | "guest" | "bot";

export type BuzzEvent = {
  id: string;
  pubkey: string;
  createdAt: number;
  kind: number;
  content: string;
  tags: unknown[][];
};

export type BuzzProfile = {
  pubkey: string;
  displayName: string | null;
  about: string | null;
};

export type BuzzMessageSendOptions = {
  replyTo?: string | null;
};

export type BuzzMessageReadOptions = {
  limit?: number;
  includeOwnMessages?: boolean;
};

export type BuzzTypingHandle = {
  stop: () => Promise<void>;
};

export type BuzzTypingRelay = {
  onauth: ((event: EventTemplate) => Promise<VerifiedEvent>) | undefined;
  connect: (options?: { timeout?: number; abort?: AbortSignal }) => Promise<void>;
  auth: (signAuthEvent: (event: EventTemplate) => Promise<VerifiedEvent>) => Promise<string>;
  publish: (event: Event) => Promise<string>;
  close: () => void;
};

export type BuzzTypingRelayFactory = (url: string) => BuzzTypingRelay;

export type BuzzCliConfig = {
  relayUrl: string;
  privateKey: string;
  publicKey: string;
  channelAllowlist: string[];
  maxMessagesPerChannel: number;
  ignoreOwnMessages: boolean;
  command?: string;
  timeoutMs?: number;
};

export type BuzzCommandRunner = (args: string[], env: NodeJS.ProcessEnv) => Promise<string>;

const BUZZ_REMOTE_COMMANDS = new Set([
  "agents", "messages", "channels", "canvas", "reactions", "emoji", "dms", "users",
  "workflows", "feed", "social", "notes", "repos", "patches", "issues", "pr", "media",
  "upload", "mem", "moderation",
]);

export function normalizeBuzzCommandArgs(value: unknown): string[] {
  if (!Array.isArray(value) || value.length === 0 || value.length > 64) {
    throw new Error("Buzz command args must contain between 1 and 64 entries");
  }
  const args = value.map((entry) => {
    if (typeof entry !== "string" || !entry.trim() || entry.length > 8_000 || entry.includes("\0")) {
      throw new Error("Buzz command args must be non-empty bounded strings");
    }
    return entry;
  });
  if (!BUZZ_REMOTE_COMMANDS.has(args[0])) {
    throw new Error(`Unsupported Buzz command: ${args[0]}`);
  }
  if (args.some((entry) => ["--private-key", "--relay", "--auth-tag"].includes(entry)
    || entry.startsWith("--private-key=")
    || entry.startsWith("--relay=")
    || entry.startsWith("--auth-tag="))) {
    throw new Error("Buzz connection and signing arguments are managed by the adapter");
  }
  return args;
}

function hexToBytes(value: string): Uint8Array {
  return Uint8Array.from(value.match(/.{2}/g) ?? [], (byte) => Number.parseInt(byte, 16));
}

export function parseBuzzPrivateKey(value: string): Uint8Array {
  const normalized = value.trim();
  if (/^[0-9a-f]{64}$/i.test(normalized)) {
    return hexToBytes(normalized);
  }
  if (normalized.toLowerCase().startsWith("nsec1")) {
    const decoded = nip19.decode(normalized);
    if (decoded.type === "nsec") {
      return decoded.data;
    }
  }
  throw new Error("BUZZ_PRIVATE_KEY must be a 64-character hex key or nsec");
}

export function buzzWebSocketUrl(relayUrl: string): string {
  const url = new URL(relayUrl.trim());
  if (url.protocol === "http:") url.protocol = "ws:";
  if (url.protocol === "https:") url.protocol = "wss:";
  if (url.protocol !== "ws:" && url.protocol !== "wss:") {
    throw new Error("BUZZ_RELAY_URL must use http(s) or ws(s)");
  }
  url.pathname = url.pathname.replace(/\/+$/, "");
  url.search = "";
  url.hash = "";
  return url.toString().replace(/\/$/, "");
}

export function buildBuzzTypingEvent(input: {
  privateKey: Uint8Array;
  channelId: string;
  replyTo?: string | null;
  createdAt?: number;
}): VerifiedEvent {
  const tags: string[][] = [["h", input.channelId]];
  if (input.replyTo) {
    tags.push(["e", input.replyTo, "", "reply"]);
  }
  return finalizeEvent({
    kind: 20_002,
    created_at: input.createdAt ?? Math.floor(Date.now() / 1000),
    tags,
    content: "",
  }, input.privateKey);
}

function waitForAbort(signal: AbortSignal): Promise<never> {
  return new Promise((_, reject) => {
    if (signal.aborted) {
      reject(signal.reason ?? new Error("typing stopped"));
      return;
    }
    signal.addEventListener("abort", () => {
      reject(signal.reason ?? new Error("typing stopped"));
    }, { once: true });
  });
}

function waitForDelay(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve) => {
    if (signal.aborted) {
      resolve();
      return;
    }
    const timer = setTimeout(resolve, ms);
    signal.addEventListener("abort", () => {
      clearTimeout(timer);
      resolve();
    }, { once: true });
  });
}

async function runBuzzTypingLoop(input: {
  relayUrl: string;
  privateKey: Uint8Array;
  channelId: string;
  replyTo?: string | null;
  signal: AbortSignal;
  relayFactory: BuzzTypingRelayFactory;
  intervalMs: number;
}): Promise<void> {
  const relay = input.relayFactory(input.relayUrl);
  const closeRelay = () => relay.close();
  input.signal.addEventListener("abort", closeRelay, { once: true });
  try {
    let markAuthStarted: (() => void) | null = null;
    const authStarted = new Promise<void>((resolve) => {
      markAuthStarted = resolve;
    });
    const signAuthEvent = async (template: EventTemplate): Promise<VerifiedEvent> => {
      markAuthStarted?.();
      markAuthStarted = null;
      return finalizeEvent(template, input.privateKey);
    };
    relay.onauth = signAuthEvent;
    await relay.connect({ timeout: BUZZ_TYPING_CONNECT_TIMEOUT_MS, abort: input.signal });
    await Promise.race([authStarted, waitForAbort(input.signal)]);
    await relay.auth(signAuthEvent);

    while (!input.signal.aborted) {
      await relay.publish(buildBuzzTypingEvent({
        privateKey: input.privateKey,
        channelId: input.channelId,
        replyTo: input.replyTo,
      }));
      await waitForDelay(input.intervalMs, input.signal);
    }
  } finally {
    input.signal.removeEventListener("abort", closeRelay);
    relay.close();
  }
}

export function startBuzzTyping(input: {
  relayUrl: string;
  privateKey: string;
  channelId: string;
  replyTo?: string | null;
  relayFactory?: BuzzTypingRelayFactory;
  intervalMs?: number;
  onError?: (error: unknown) => void;
}): BuzzTypingHandle {
  const controller = new AbortController();
  const done = runBuzzTypingLoop({
    relayUrl: buzzWebSocketUrl(input.relayUrl),
    privateKey: parseBuzzPrivateKey(input.privateKey),
    channelId: input.channelId,
    replyTo: input.replyTo,
    signal: controller.signal,
    relayFactory: input.relayFactory ?? ((url) => new Relay(url, { enableReconnect: false })),
    intervalMs: input.intervalMs ?? BUZZ_TYPING_INTERVAL_MS,
  }).catch((error) => {
    if (!controller.signal.aborted) input.onError?.(error);
  });
  return {
    stop: async () => {
      controller.abort();
      await done;
    },
  };
}

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}

function stringValue(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function numberValue(value: unknown): number | null {
  const parsed = typeof value === "number" ? value : Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function parseJsonArray(output: string, commandLabel: string): unknown[] {
  let parsed: unknown;
  try {
    parsed = JSON.parse(output);
  } catch (error) {
    throw new Error(`Buzz CLI returned invalid JSON for ${commandLabel}: ${error instanceof Error ? error.message : String(error)}`);
  }
  if (!Array.isArray(parsed)) {
    throw new Error(`Buzz CLI returned a non-array response for ${commandLabel}`);
  }
  return parsed;
}

function parseJsonObject(output: string, commandLabel: string): Record<string, unknown> {
  let parsed: unknown;
  try {
    parsed = JSON.parse(output);
  } catch (error) {
    throw new Error(`Buzz CLI returned invalid JSON for ${commandLabel}: ${error instanceof Error ? error.message : String(error)}`);
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error(`Buzz CLI returned a non-object response for ${commandLabel}`);
  }
  return parsed as Record<string, unknown>;
}

function normalizedChannelId(value: string): string {
  const normalized = value.trim().toLowerCase();
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(normalized)) {
    throw new Error("channelId must be a UUID");
  }
  return normalized;
}

function normalizedPubkey(value: string): string {
  const normalized = value.trim().toLowerCase();
  if (!/^[0-9a-f]{64}$/.test(normalized)) {
    throw new Error("pubkey must be a 64-character hex value");
  }
  return normalized;
}

function parseBuzzChannels(payload: unknown[]): BuzzChannel[] {
  return payload.flatMap((candidate): BuzzChannel[] => {
    const channel = record(candidate);
    const channelId = stringValue(channel.channel_id ?? channel.channelId ?? channel.id).toLowerCase();
    if (!channelId) return [];
    return [{
      channelId,
      name: stringValue(channel.name) || channelId,
      description: stringValue(channel.description) || null,
      createdAt: numberValue(channel.created_at ?? channel.createdAt),
    }];
  });
}

export function parseBuzzChannelAllowlist(value: string | undefined): string[] {
  return [...new Set((value ?? "")
    .split(/[\s,]+/)
    .map((entry) => entry.trim().toLowerCase())
    .filter(Boolean))];
}

export function assertBuzzConfig(config: BuzzCliConfig): void {
  if (!config.relayUrl) throw new Error("BUZZ_RELAY_URL is required when Buzz is enabled");
  if (!config.privateKey) throw new Error("BUZZ_PRIVATE_KEY is required when Buzz is enabled");
}

export class BuzzCliClient {
  private readonly runner: BuzzCommandRunner;

  constructor(readonly config: BuzzCliConfig, runner?: BuzzCommandRunner) {
    assertBuzzConfig(config);
    this.runner = runner ?? (async (args, env) => {
      const result = await execFileAsync(config.command || "buzz", args, {
        env,
        timeout: config.timeoutMs ?? 30_000,
        maxBuffer: 16 * 1024 * 1024,
        encoding: "utf8",
      });
      return result.stdout;
    });
  }

  private async run(args: string[]): Promise<string> {
    return this.runner(args, {
      ...process.env,
      BUZZ_RELAY_URL: this.config.relayUrl,
      BUZZ_PRIVATE_KEY: this.config.privateKey,
    });
  }

  async executeCommand(value: unknown): Promise<unknown> {
    const args = normalizeBuzzCommandArgs(value);
    const output = await this.run(args);
    try {
      return JSON.parse(output);
    } catch {
      return output.trim();
    }
  }

  ensureAllowedChannel(channelId: string): string {
    const normalized = channelId.trim().toLowerCase();
    if (!normalized || (this.config.channelAllowlist.length > 0 && !this.config.channelAllowlist.includes(normalized))) {
      throw new Error(`Buzz channel is not allowlisted: ${channelId || "(empty)"}`);
    }
    return normalized;
  }

  async listVisibleChannels(): Promise<BuzzChannel[]> {
    const payload = parseJsonArray(await this.run(["channels", "list"]), "channels list");
    return parseBuzzChannels(payload).sort((left, right) => left.name.localeCompare(right.name));
  }

  async listChannels(): Promise<BuzzChannel[]> {
    const channels = await this.listVisibleChannels();
    if (this.config.channelAllowlist.length === 0) return channels;
    const allowlist = new Set(this.config.channelAllowlist);
    return channels.filter((channel) => allowlist.has(channel.channelId));
  }

  async createChannel(input: BuzzChannelCreateInput): Promise<Record<string, unknown>> {
    const name = input.name.trim();
    if (!name) throw new Error("name is required");
    const args = [
      "channels", "create",
      "--name", name,
      "--type", input.channelType,
      "--visibility", input.visibility,
    ];
    const description = input.description?.trim() ?? "";
    if (description) args.push("--description", description);
    if (input.ttlSeconds !== undefined && input.ttlSeconds !== null) {
      if (!Number.isSafeInteger(input.ttlSeconds) || input.ttlSeconds <= 0) {
        throw new Error("ttlSeconds must be a positive integer");
      }
      args.push("--ttl", String(input.ttlSeconds));
    }
    return parseJsonObject(await this.run(args), "channels create");
  }

  async updateChannel(channelId: string, input: BuzzChannelUpdateInput): Promise<Record<string, unknown>> {
    const args = ["channels", "update", "--channel", normalizedChannelId(channelId)];
    if (input.name !== undefined && input.name !== null) {
      const name = input.name.trim();
      if (!name) throw new Error("name cannot be empty");
      args.push("--name", name);
    }
    if (input.description !== undefined && input.description !== null) {
      args.push("--description", input.description.trim());
    }
    if (input.ttlSeconds !== undefined && input.ttlSeconds !== null) {
      if (!Number.isSafeInteger(input.ttlSeconds) || input.ttlSeconds <= 0) {
        throw new Error("ttlSeconds must be a positive integer");
      }
      args.push("--ttl", String(input.ttlSeconds));
    }
    if (input.clearTtl) args.push("--no-ttl");
    if (args.length === 4) throw new Error("at least one channel field is required");
    return parseJsonObject(await this.run(args), "channels update");
  }

  async setChannelTopic(channelId: string, topic: string): Promise<Record<string, unknown>> {
    return parseJsonObject(await this.run([
      "channels", "topic", "--channel", normalizedChannelId(channelId), "--topic", topic.trim(),
    ]), "channels topic");
  }

  async setChannelPurpose(channelId: string, purpose: string): Promise<Record<string, unknown>> {
    return parseJsonObject(await this.run([
      "channels", "purpose", "--channel", normalizedChannelId(channelId), "--purpose", purpose.trim(),
    ]), "channels purpose");
  }

  async setChannelArchived(channelId: string, archived: boolean): Promise<Record<string, unknown>> {
    const command = archived ? "archive" : "unarchive";
    return parseJsonObject(await this.run([
      "channels", command, "--channel", normalizedChannelId(channelId),
    ]), `channels ${command}`);
  }

  async listChannelMembers(channelId: string): Promise<string[]> {
    const payload = parseJsonArray(await this.run([
      "channels", "members", "--channel", normalizedChannelId(channelId),
    ]), "channels members");
    return payload.flatMap((value): string[] => {
      const pubkey = typeof value === "string" ? value.trim().toLowerCase() : "";
      return /^[0-9a-f]{64}$/.test(pubkey) ? [pubkey] : [];
    });
  }

  async addChannelMember(channelId: string, pubkey: string, role?: BuzzChannelMemberRole | null): Promise<Record<string, unknown>> {
    const args = [
      "channels", "add-member",
      "--channel", normalizedChannelId(channelId),
      "--pubkey", normalizedPubkey(pubkey),
    ];
    if (role) args.push("--role", role);
    return parseJsonObject(await this.run(args), "channels add-member");
  }

  async removeChannelMember(channelId: string, pubkey: string): Promise<Record<string, unknown>> {
    return parseJsonObject(await this.run([
      "channels", "remove-member",
      "--channel", normalizedChannelId(channelId),
      "--pubkey", normalizedPubkey(pubkey),
    ]), "channels remove-member");
  }

  async getMessages(
    channelId: string,
    since: Date,
    options: BuzzMessageReadOptions = {},
  ): Promise<BuzzEvent[]> {
    const allowedChannelId = this.ensureAllowedChannel(channelId);
    const limit = Math.max(
      1,
      Math.min(this.config.maxMessagesPerChannel, Math.trunc(options.limit ?? this.config.maxMessagesPerChannel)),
    );
    const ignoreOwnMessages = options.includeOwnMessages === undefined
      ? this.config.ignoreOwnMessages
      : !options.includeOwnMessages;
    const args = [
      "messages", "get",
      "--channel", allowedChannelId,
      "--limit", String(limit),
      "--since", String(Math.max(0, Math.floor(since.getTime() / 1000))),
    ];
    const payload = parseJsonArray(await this.run(args), "messages get");
    return payload.flatMap((candidate): BuzzEvent[] => {
      const event = record(candidate);
      const id = stringValue(event.id ?? event.event_id);
      const pubkey = stringValue(event.pubkey).toLowerCase();
      const createdAt = numberValue(event.created_at ?? event.createdAt);
      if (!id || !pubkey || createdAt === null) return [];
      if (ignoreOwnMessages && this.config.publicKey && pubkey === this.config.publicKey.toLowerCase()) {
        return [];
      }
      return [{
        id,
        pubkey,
        createdAt,
        kind: numberValue(event.kind) ?? 9,
        content: typeof event.content === "string" ? event.content : "",
        tags: Array.isArray(event.tags) ? event.tags.filter(Array.isArray) : [],
      }];
    });
  }

  async getProfiles(pubkeys: string[]): Promise<Map<string, BuzzProfile>> {
    const unique = [...new Set(pubkeys.map((pubkey) => pubkey.trim().toLowerCase()).filter(Boolean))];
    if (unique.length === 0) return new Map();
    const args = ["users", "get", ...unique.flatMap((pubkey) => ["--pubkey", pubkey])];
    const payload = parseJsonArray(await this.run(args), "users get");
    return new Map(payload.flatMap((candidate): Array<[string, BuzzProfile]> => {
      const profile = record(candidate);
      const pubkey = stringValue(profile.pubkey).toLowerCase();
      if (!pubkey) return [];
      return [[pubkey, {
        pubkey,
        displayName: stringValue(profile.display_name ?? profile.displayName ?? profile.name) || null,
        about: stringValue(profile.about) || null,
      }]];
    }));
  }

  async getThread(channelId: string, eventId: string, limit = 100): Promise<BuzzEvent[]> {
    const allowedChannelId = this.ensureAllowedChannel(channelId);
    const normalizedEventId = eventId.trim().toLowerCase();
    if (!/^[0-9a-f]{64}$/.test(normalizedEventId)) {
      throw new Error("eventId must be a 64-character lowercase hex value");
    }
    const payload = parseJsonArray(await this.run([
      "messages", "thread",
      "--channel", allowedChannelId,
      "--event", normalizedEventId,
      "--limit", String(Math.max(1, Math.min(1000, Math.trunc(limit)))),
    ]), "messages thread");
    return payload.flatMap((candidate): BuzzEvent[] => {
      const event = record(candidate);
      const id = stringValue(event.id ?? event.event_id);
      const pubkey = stringValue(event.pubkey).toLowerCase();
      const createdAt = numberValue(event.created_at ?? event.createdAt);
      if (!id || !pubkey || createdAt === null) return [];
      return [{
        id,
        pubkey,
        createdAt,
        kind: numberValue(event.kind) ?? 9,
        content: typeof event.content === "string" ? event.content : "",
        tags: Array.isArray(event.tags) ? event.tags.filter(Array.isArray) : [],
      }];
    });
  }

  async sendMessage(
    channelId: string,
    content: string,
    options: BuzzMessageSendOptions = {},
  ): Promise<Record<string, unknown>> {
    const allowedChannelId = this.ensureAllowedChannel(channelId);
    const normalizedContent = content.trim();
    if (!normalizedContent) throw new Error("content is required");
    const args = [
      "messages", "send",
      "--channel", allowedChannelId,
      "--content", normalizedContent,
    ];
    const replyTo = options.replyTo?.trim().toLowerCase() ?? "";
    if (replyTo) {
      if (!/^[0-9a-f]{64}$/.test(replyTo)) {
        throw new Error("replyTo must be a 64-character lowercase hex value");
      }
      args.push("--reply-to", replyTo);
    }
    const output = await this.run(args);
    try {
      return record(JSON.parse(output));
    } catch (error) {
      throw new Error(`Buzz CLI returned invalid JSON for messages send: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  async addReaction(eventId: string, emoji: string): Promise<void> {
    const normalizedEventId = eventId.trim().toLowerCase();
    if (!/^[0-9a-f]{64}$/.test(normalizedEventId)) {
      throw new Error("eventId must be a 64-character lowercase hex value");
    }
    const normalizedEmoji = emoji.trim();
    if (!normalizedEmoji) throw new Error("emoji is required");
    await this.run([
      "reactions", "add",
      "--event", normalizedEventId,
      "--emoji", normalizedEmoji,
    ]);
  }

  async removeReaction(eventId: string, emoji: string): Promise<void> {
    const normalizedEventId = eventId.trim().toLowerCase();
    if (!/^[0-9a-f]{64}$/.test(normalizedEventId)) {
      throw new Error("eventId must be a 64-character lowercase hex value");
    }
    const normalizedEmoji = emoji.trim();
    if (!normalizedEmoji) throw new Error("emoji is required");
    await this.run([
      "reactions", "remove",
      "--event", normalizedEventId,
      "--emoji", normalizedEmoji,
    ]);
  }

  startTypingIndicator(channelId: string, replyTo?: string | null): BuzzTypingHandle {
    const allowedChannelId = this.ensureAllowedChannel(channelId);
    const normalizedReplyTo = replyTo?.trim().toLowerCase() ?? "";
    if (normalizedReplyTo && !/^[0-9a-f]{64}$/.test(normalizedReplyTo)) {
      throw new Error("replyTo must be a 64-character lowercase hex value");
    }
    return startBuzzTyping({
      relayUrl: this.config.relayUrl,
      privateKey: this.config.privateKey,
      channelId: allowedChannelId,
      replyTo: normalizedReplyTo || null,
      onError: (error) => {
        console.warn("[buzz-adapter] typing indicator unavailable", {
          channelId: allowedChannelId,
          error: error instanceof Error ? error.message : String(error),
        });
      },
    });
  }
}

export function buzzEventMentionsPubkey(event: BuzzEvent, publicKey: string): boolean {
  const normalizedPublicKey = publicKey.trim().toLowerCase();
  if (!/^[0-9a-f]{64}$/.test(normalizedPublicKey)) return false;
  return event.tags.some((tag) =>
    tag.length >= 2
    && tag[0] === "p"
    && typeof tag[1] === "string"
    && tag[1].trim().toLowerCase() === normalizedPublicKey
  );
}

export function buzzEventReplyIds(event: BuzzEvent): string[] {
  const references = event.tags.flatMap((tag): Array<{ id: string; marker: string }> => {
    if (tag.length < 2 || tag[0] !== "e" || typeof tag[1] !== "string") return [];
    const id = tag[1].trim().toLowerCase();
    if (!/^[0-9a-f]{64}$/.test(id)) return [];
    return [{ id, marker: typeof tag[3] === "string" ? tag[3].trim().toLowerCase() : "" }];
  });
  return [...new Set([
    ...references.filter((reference) => reference.marker === "reply").map((reference) => reference.id),
    ...references.filter((reference) => reference.marker === "root").map((reference) => reference.id),
    ...references.map((reference) => reference.id),
  ])];
}

export function buzzEventRootIds(event: BuzzEvent): string[] {
  return [...new Set(event.tags.flatMap((tag): string[] => {
    if (tag.length < 4 || tag[0] !== "e" || tag[3] !== "root" || typeof tag[1] !== "string") return [];
    const id = tag[1].trim().toLowerCase();
    return /^[0-9a-f]{64}$/.test(id) ? [id] : [];
  }))];
}

export function buzzEventDirectReplyId(event: BuzzEvent): string | null {
  const markedReply = event.tags.find((tag) =>
    tag.length >= 4
    && tag[0] === "e"
    && tag[3] === "reply"
    && typeof tag[1] === "string"
    && /^[0-9a-f]{64}$/.test(tag[1].trim().toLowerCase())
  );
  if (markedReply && typeof markedReply[1] === "string") return markedReply[1].trim().toLowerCase();
  return buzzEventReplyIds(event)[0] ?? null;
}

export function buzzThreadRootId(event: BuzzEvent, events: BuzzEvent[]): string {
  const explicitRoot = buzzEventRootIds(event)[0];
  if (explicitRoot) return explicitRoot;
  const byId = new Map(events.map((candidate) => [candidate.id.toLowerCase(), candidate]));
  let current = event;
  const visited = new Set<string>();
  while (!visited.has(current.id.toLowerCase())) {
    visited.add(current.id.toLowerCase());
    const parentId = buzzEventDirectReplyId(current);
    if (!parentId) return current.id.toLowerCase();
    const parent = byId.get(parentId);
    if (!parent) return parentId;
    current = parent;
  }
  return event.id.toLowerCase();
}

export function buzzMentionPrompt(content: string, displayName: string): string {
  const normalized = content.trim();
  const name = displayName.trim();
  if (!name) return normalized;
  const escapedName = name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return normalized
    .replace(new RegExp(`^@${escapedName}(?:\\s*[:,.-]?\\s*)`, "i"), "")
    .trim();
}

export function buzzThreadHasReplyFrom(
  events: BuzzEvent[],
  publicKey: string,
  rootEventId: string,
): boolean {
  const normalizedPublicKey = publicKey.trim().toLowerCase();
  const normalizedRootId = rootEventId.trim().toLowerCase();
  return events.some((event) =>
    event.id.toLowerCase() !== normalizedRootId
    && event.pubkey.toLowerCase() === normalizedPublicKey
  );
}

export function buzzThreadHasDirectReplyFrom(
  events: BuzzEvent[],
  publicKey: string,
  targetEventId: string,
): boolean {
  const normalizedPublicKey = publicKey.trim().toLowerCase();
  const normalizedTargetId = targetEventId.trim().toLowerCase();
  return events.some((event) =>
    event.pubkey.toLowerCase() === normalizedPublicKey
    && buzzEventReplyIds(event).includes(normalizedTargetId)
  );
}

export function buzzConversationRootFromThread(
  events: BuzzEvent[],
  event: BuzzEvent,
  publicKey: string,
): string | null {
  const normalizedPublicKey = publicKey.trim().toLowerCase();
  const completeThread = events.some((candidate) => candidate.id.toLowerCase() === event.id.toLowerCase())
    ? events
    : [...events, event];
  const prismParticipated = completeThread.some((candidate) =>
    candidate.pubkey.toLowerCase() === normalizedPublicKey
    || buzzEventMentionsPubkey(candidate, normalizedPublicKey)
  );
  if (!prismParticipated) return null;

  const explicitRoot = completeThread.flatMap(buzzEventRootIds)[0];
  if (explicitRoot) return explicitRoot;
  const root = [...completeThread]
    .sort((left, right) => left.createdAt - right.createdAt || left.id.localeCompare(right.id))
    .find((candidate) => buzzEventReplyIds(candidate).length === 0);
  return root?.id.toLowerCase() ?? buzzThreadRootId(event, completeThread);
}

export function normalizeBuzzMessage(input: {
  event: BuzzEvent;
  channel: BuzzChannel;
  profile?: BuzzProfile | null;
  relayUrl: string;
}): Record<string, unknown> {
  const displayName = input.profile?.displayName || `${input.event.pubkey.slice(0, 12)}…`;
  return {
    source: "buzz",
    channelId: input.channel.channelId,
    threadId: null,
    messageId: input.event.id,
    text: input.event.content,
    renderedText: input.event.content,
    timestamp: new Date(input.event.createdAt * 1000).toISOString(),
    author: {
      id: input.event.pubkey,
      username: input.event.pubkey,
      displayName,
      bot: false,
    },
    metadata: {
      channelName: input.channel.name,
      channelType: "buzz-channel",
      relayUrl: input.relayUrl,
      nostrEventId: input.event.id,
      nostrKind: input.event.kind,
      authorPubkey: input.event.pubkey,
      tags: input.event.tags,
    },
  };
}

export function selectUnseenBuzzEvents(
  events: Array<{ channel: BuzzChannel; event: BuzzEvent }>,
  recentEventIds: string[],
  retainedEventLimit = 10_000,
): {
  unseen: Array<{ channel: BuzzChannel; event: BuzzEvent }>;
  duplicateCount: number;
  recentEventIds: string[];
} {
  const seen = new Set(recentEventIds.filter(Boolean));
  const unseen: Array<{ channel: BuzzChannel; event: BuzzEvent }> = [];
  let duplicateCount = 0;
  for (const entry of events) {
    if (seen.has(entry.event.id)) {
      duplicateCount += 1;
      continue;
    }
    seen.add(entry.event.id);
    unseen.push(entry);
  }
  return {
    unseen,
    duplicateCount,
    recentEventIds: [...seen].slice(-Math.max(1, retainedEventLimit)),
  };
}

export function buzzInteractionCursorTimestamp(
  pollStartedTimestamp: number,
  deferredTimestamps: number[],
): number {
  const normalizedPollStart = Math.max(0, Math.trunc(pollStartedTimestamp));
  if (deferredTimestamps.length === 0) return normalizedPollStart;
  return Math.max(0, Math.min(...deferredTimestamps.map((timestamp) => Math.trunc(timestamp))));
}
