import assert from "node:assert/strict";
import test from "node:test";
import { nip19, verifyEvent, type Event, type EventTemplate, type VerifiedEvent } from "nostr-tools";
import {
  BuzzCliClient,
  buildBuzzTypingEvent,
  buzzInteractionCursorTimestamp,
  buzzConversationRootFromThread,
  buzzEventDirectReplyId,
  buzzEventReplyIds,
  buzzEventRootIds,
  buzzEventMentionsPubkey,
  buzzMentionPrompt,
  buzzThreadHasReplyFrom,
  buzzThreadHasDirectReplyFrom,
  buzzThreadRootId,
  buzzWebSocketUrl,
  normalizeBuzzMessage,
  normalizeBuzzCommandArgs,
  parseBuzzPrivateKey,
  parseBuzzChannelAllowlist,
  selectUnseenBuzzEvents,
  startBuzzTyping,
  type BuzzEvent,
  type BuzzCommandRunner,
  type BuzzTypingRelay,
} from "./buzz.js";

const channelId = "a419a6ec-07ef-4d55-b071-635bc1b4dd4f";
const ownPubkey = "d".repeat(64);
const humanPubkey = "5".repeat(64);

function clientWithRunner(runner: BuzzCommandRunner, overrides: Partial<ConstructorParameters<typeof BuzzCliClient>[0]> = {}) {
  return new BuzzCliClient({
    relayUrl: "https://buzz.example.test",
    privateKey: "1".repeat(64),
    publicKey: ownPubkey,
    channelAllowlist: [channelId],
    maxMessagesPerChannel: 100,
    ignoreOwnMessages: true,
    ...overrides,
  }, runner);
}

test("parseBuzzChannelAllowlist normalizes and deduplicates values", () => {
  assert.deepEqual(
    parseBuzzChannelAllowlist(` ${channelId.toUpperCase()},${channelId}\nother `),
    [channelId, "other"],
  );
});

test("full Buzz command proxy accepts remote commands but owns connection credentials", () => {
  assert.deepEqual(normalizeBuzzCommandArgs(["messages", "get", "--channel", channelId]), [
    "messages", "get", "--channel", channelId,
  ]);
  assert.throws(() => normalizeBuzzCommandArgs(["pack", "inspect"]), /Unsupported Buzz command/);
  assert.throws(() => normalizeBuzzCommandArgs(["messages", "get", "--private-key=secret"]), /managed by the adapter/);
});

test("full Buzz command proxy returns structured CLI output", async () => {
  const client = clientWithRunner(async (args) => JSON.stringify({ args }));
  assert.deepEqual(await client.executeCommand(["channels", "list"]), { args: ["channels", "list"] });
});

test("listChannels returns only allowlisted visible channels", async () => {
  const client = clientWithRunner(async () => JSON.stringify([
    { channel_id: channelId, name: "prism-lab", description: "Pilot" },
    { channel_id: "open-channel", name: "general" },
  ]));

  assert.deepEqual(await client.listChannels(), [{
    channelId,
    name: "prism-lab",
    description: "Pilot",
    createdAt: null,
  }]);
});

test("stale ceiling entries do not hide other visible channels or abort discovery", async () => {
  const client = clientWithRunner(async () => "[]");
  assert.deepEqual(await client.listChannels(), []);
});

test("an empty infrastructure ceiling discovers every visible channel", async () => {
  const client = clientWithRunner(async () => JSON.stringify([
    { channel_id: channelId, name: "prism-lab" },
    { channel_id: "open-channel", name: "general" },
  ]), { channelAllowlist: [] });
  assert.deepEqual((await client.listChannels()).map((channel) => channel.channelId), ["open-channel", channelId]);
});

test("listVisibleChannels is not constrained by the message allowlist", async () => {
  const otherChannelId = "b419a6ec-07ef-4d55-b071-635bc1b4dd4f";
  const client = clientWithRunner(async () => JSON.stringify([
    { channel_id: channelId, name: "prism-lab" },
    { channel_id: otherChannelId, name: "new-room" },
  ]));

  assert.deepEqual((await client.listVisibleChannels()).map((channel) => channel.channelId), [
    otherChannelId,
    channelId,
  ]);
});

test("channel management methods map to the pinned Buzz CLI", async () => {
  const calls: string[][] = [];
  const client = clientWithRunner(async (args) => {
    calls.push(args);
    if (args[1] === "members") return JSON.stringify([humanPubkey]);
    return JSON.stringify({ ok: true, channel_id: channelId });
  });

  await client.createChannel({
    name: "delivery",
    channelType: "forum",
    visibility: "private",
    description: "Delivery coordination",
    ttlSeconds: 3600,
  });
  await client.updateChannel(channelId, { name: "shipping", clearTtl: true });
  await client.setChannelTopic(channelId, "Q3 delivery");
  await client.setChannelPurpose(channelId, "Coordinate releases");
  await client.setChannelArchived(channelId, true);
  assert.deepEqual(await client.listChannelMembers(channelId), [humanPubkey]);
  await client.addChannelMember(channelId, humanPubkey, "admin");
  await client.removeChannelMember(channelId, humanPubkey);

  assert.deepEqual(calls, [
    ["channels", "create", "--name", "delivery", "--type", "forum", "--visibility", "private", "--description", "Delivery coordination", "--ttl", "3600"],
    ["channels", "update", "--channel", channelId, "--name", "shipping", "--no-ttl"],
    ["channels", "topic", "--channel", channelId, "--topic", "Q3 delivery"],
    ["channels", "purpose", "--channel", channelId, "--purpose", "Coordinate releases"],
    ["channels", "archive", "--channel", channelId],
    ["channels", "members", "--channel", channelId],
    ["channels", "add-member", "--channel", channelId, "--pubkey", humanPubkey, "--role", "admin"],
    ["channels", "remove-member", "--channel", channelId, "--pubkey", humanPubkey],
  ]);
});

test("channel management validates identifiers before invoking Buzz", async () => {
  let called = false;
  const client = clientWithRunner(async () => {
    called = true;
    return "{}";
  });

  await assert.rejects(() => client.setChannelArchived("not-a-uuid", true), /UUID/);
  await assert.rejects(() => client.addChannelMember(channelId, "bad", "member"), /64-character/);
  assert.equal(called, false);
});

test("getMessages supplies the lower-bound cursor and ignores the adapter identity", async () => {
  let capturedArgs: string[] = [];
  const client = clientWithRunner(async (args) => {
    capturedArgs = args;
    return JSON.stringify([
      { id: "own", pubkey: ownPubkey, created_at: 100, kind: 9, content: "ignore", tags: [] },
      { id: "human", pubkey: humanPubkey, created_at: 101, kind: 9, content: "keep", tags: [["h", channelId]] },
    ]);
  });

  const messages = await client.getMessages(channelId, new Date(90_000));
  assert.equal(capturedArgs.at(-1), "90");
  assert.deepEqual(messages.map((message) => message.id), ["human"]);
});

test("getMessages supports bounded direct history including adapter messages", async () => {
  let capturedArgs: string[] = [];
  const client = clientWithRunner(async (args) => {
    capturedArgs = args;
    return JSON.stringify([
      { id: "own", pubkey: ownPubkey, created_at: 100, kind: 9, content: "Prism reply", tags: [["h", channelId]] },
      { id: "human", pubkey: humanPubkey, created_at: 101, kind: 9, content: "Steering", tags: [["h", channelId]] },
    ]);
  });

  const messages = await client.getMessages(channelId, new Date(90_000), {
    limit: 25,
    includeOwnMessages: true,
  });

  assert.deepEqual(capturedArgs.slice(-4), ["--limit", "25", "--since", "90"]);
  assert.deepEqual(messages.map((message) => message.id), ["own", "human"]);
});

test("sendMessage rejects a destination outside the allowlist before invoking Buzz", async () => {
  let called = false;
  const client = clientWithRunner(async () => {
    called = true;
    return "{}";
  });
  await assert.rejects(() => client.sendMessage("general", "hello"), /not allowlisted/);
  assert.equal(called, false);
});

test("an empty infrastructure ceiling permits policy-authorized destinations", async () => {
  let called = false;
  const client = clientWithRunner(async () => {
    called = true;
    return JSON.stringify({ event_id: "reply" });
  }, { channelAllowlist: [] });
  await client.sendMessage("policy-bound-channel", "hello");
  assert.equal(called, true);
});

test("sendMessage creates a threaded reply when replyTo is provided", async () => {
  let capturedArgs: string[] = [];
  const client = clientWithRunner(async (args) => {
    capturedArgs = args;
    return JSON.stringify({ event_id: "reply" });
  });
  const rootEventId = "a".repeat(64);

  await client.sendMessage(channelId, "hello", { replyTo: rootEventId });

  assert.deepEqual(capturedArgs.slice(-2), ["--reply-to", rootEventId]);
});

test("working reactions use the Buzz CLI add and remove commands", async () => {
  const calls: string[][] = [];
  const client = clientWithRunner(async (args) => {
    calls.push(args);
    return JSON.stringify({ event_id: "reaction" });
  });
  const rootEventId = "a".repeat(64);

  await client.addReaction(rootEventId, "💬");
  await client.removeReaction(rootEventId, "💬");

  assert.deepEqual(calls, [
    ["reactions", "add", "--event", rootEventId, "--emoji", "💬"],
    ["reactions", "remove", "--event", rootEventId, "--emoji", "💬"],
  ]);
});

test("Buzz typing events match the built-in agent event shape", () => {
  const rootEventId = "a".repeat(64);
  const event = buildBuzzTypingEvent({
    privateKey: parseBuzzPrivateKey("1".repeat(64)),
    channelId,
    replyTo: rootEventId,
    createdAt: 1_700_000_000,
  });

  assert.equal(verifyEvent(event), true);
  assert.equal(event.kind, 20_002);
  assert.equal(event.content, "");
  assert.equal(event.created_at, 1_700_000_000);
  assert.deepEqual(event.tags, [
    ["h", channelId],
    ["e", rootEventId, "", "reply"],
  ]);
});

test("Buzz typing accepts nsec keys and normalizes relay WebSocket URLs", () => {
  const privateKey = parseBuzzPrivateKey("2".repeat(64));
  assert.deepEqual(parseBuzzPrivateKey(nip19.nsecEncode(privateKey)), privateKey);
  assert.equal(
    buzzWebSocketUrl("https://buzz.example.test/path/?ignored=yes"),
    "wss://buzz.example.test/path",
  );
});

test("Buzz typing authenticates, refreshes, and closes without delaying the caller", async () => {
  const published: Event[] = [];
  let closed = false;
  let authTemplate: EventTemplate | null = null;
  const relay: BuzzTypingRelay = {
    onauth: undefined,
    async connect() {
      authTemplate = {
        kind: 22_242,
        created_at: 1_700_000_000,
        tags: [["relay", "wss://buzz.example.test"], ["challenge", "test"]],
        content: "",
      };
      await this.onauth?.(authTemplate);
    },
    async auth(signAuthEvent) {
      assert.ok(authTemplate);
      const event = await signAuthEvent(authTemplate);
      assert.equal(verifyEvent(event), true);
      return event.id;
    },
    async publish(event) {
      published.push(event);
      return event.id;
    },
    close() {
      closed = true;
    },
  };

  const typing = startBuzzTyping({
    relayUrl: "https://buzz.example.test",
    privateKey: "1".repeat(64),
    channelId,
    replyTo: "a".repeat(64),
    relayFactory: () => relay,
    intervalMs: 5,
  });
  const deadline = Date.now() + 1_000;
  while (published.length < 2 && Date.now() < deadline) {
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
  await typing.stop();

  assert.ok(published.length >= 2);
  assert.ok(published.every((event) => event.kind === 20_002 && verifyEvent(event)));
  assert.equal(closed, true);
});

test("getThread preserves own replies for duplicate-delivery detection", async () => {
  const rootEventId = "a".repeat(64);
  const client = clientWithRunner(async () => JSON.stringify([
    { id: rootEventId, pubkey: humanPubkey, created_at: 100, kind: 9, content: "@Prism hello", tags: [] },
    { id: "b".repeat(64), pubkey: ownPubkey, created_at: 101, kind: 9, content: "Hi", tags: [["e", rootEventId, "", "reply"]] },
  ]));

  const thread = await client.getThread(channelId, rootEventId);

  assert.equal(thread.length, 2);
  assert.equal(buzzThreadHasReplyFrom(thread, ownPubkey, rootEventId), true);
  assert.equal(buzzThreadHasDirectReplyFrom(thread, ownPubkey, rootEventId), true);
});

test("Buzz reply correlation follows a mention-started conversation", () => {
  const rootEventId = "a".repeat(64);
  const assistantEventId = "b".repeat(64);
  const followupEventId = "c".repeat(64);
  const root: BuzzEvent = {
    id: rootEventId,
    pubkey: humanPubkey,
    createdAt: 100,
    kind: 9,
    content: "@Prism hello",
    tags: [["h", channelId], ["p", ownPubkey]],
  };
  const assistant: BuzzEvent = {
    id: assistantEventId,
    pubkey: ownPubkey,
    createdAt: 101,
    kind: 9,
    content: "Hi",
    tags: [["h", channelId], ["e", rootEventId, "", "reply"]],
  };
  const followup: BuzzEvent = {
    id: followupEventId,
    pubkey: humanPubkey,
    createdAt: 102,
    kind: 9,
    content: "One more thing",
    tags: [["h", channelId], ["e", assistantEventId, "", "reply"]],
  };

  assert.deepEqual(buzzEventReplyIds(followup), [assistantEventId]);
  assert.equal(buzzConversationRootFromThread([root, assistant, followup], followup, ownPubkey), rootEventId);
  assert.equal(buzzThreadHasDirectReplyFrom([root, assistant, followup], ownPubkey, followupEventId), false);
});

test("Buzz reply correlation recognizes a Prism-authored thread root", () => {
  const rootEventId = "a".repeat(64);
  const assistantReplyId = "b".repeat(64);
  const followupEventId = "c".repeat(64);
  const root: BuzzEvent = {
    id: rootEventId, pubkey: ownPubkey, createdAt: 100, kind: 9, content: "Autopilot update", tags: [["h", channelId]],
  };
  const assistant: BuzzEvent = {
    id: assistantReplyId, pubkey: ownPubkey, createdAt: 101, kind: 9, content: "Answer", tags: [["h", channelId], ["e", rootEventId, "", "reply"]],
  };
  const followup: BuzzEvent = {
    id: followupEventId,
    pubkey: humanPubkey,
    createdAt: 102,
    kind: 9,
    content: "Why did you do that?",
    tags: [["h", channelId], ["e", rootEventId, "", "root"], ["e", assistantReplyId, "", "reply"]],
  };

  assert.deepEqual(buzzEventRootIds(followup), [rootEventId]);
  assert.equal(buzzEventDirectReplyId(followup), assistantReplyId);
  assert.equal(buzzThreadRootId(followup, [root, assistant, followup]), rootEventId);
  assert.equal(buzzConversationRootFromThread([root, assistant, followup], followup, ownPubkey), rootEventId);
});

test("Buzz reply correlation flattens a deeply nested follow-up to the channel root", () => {
  const rootEventId = "a".repeat(64);
  const assistantEventId = "b".repeat(64);
  const firstFollowupId = "c".repeat(64);
  const nestedAssistantId = "d".repeat(64);
  const nestedFollowupId = "e".repeat(64);
  const events: BuzzEvent[] = [
    { id: rootEventId, pubkey: humanPubkey, createdAt: 100, kind: 9, content: "@Prism hello", tags: [["h", channelId], ["p", ownPubkey]] },
    { id: assistantEventId, pubkey: ownPubkey, createdAt: 101, kind: 9, content: "Hi", tags: [["h", channelId], ["e", rootEventId, "", "reply"]] },
    { id: firstFollowupId, pubkey: humanPubkey, createdAt: 102, kind: 9, content: "More", tags: [["h", channelId], ["e", assistantEventId, "", "reply"]] },
    { id: nestedAssistantId, pubkey: ownPubkey, createdAt: 103, kind: 9, content: "Answer", tags: [["h", channelId], ["e", firstFollowupId, "", "reply"]] },
    { id: nestedFollowupId, pubkey: humanPubkey, createdAt: 104, kind: 9, content: "Again", tags: [["h", channelId], ["e", nestedAssistantId, "", "reply"]] },
  ];

  assert.equal(buzzConversationRootFromThread(events, events.at(-1)!, ownPubkey), rootEventId);
});

test("Buzz mention detection requires the adapter public-key tag", () => {
  const event = {
    id: "a".repeat(64),
    pubkey: humanPubkey,
    createdAt: 100,
    kind: 9,
    content: "@Prism hello",
    tags: [["h", channelId], ["p", ownPubkey.toUpperCase()]],
  };

  assert.equal(buzzEventMentionsPubkey(event, ownPubkey), true);
  assert.equal(buzzEventMentionsPubkey({ ...event, tags: [["h", channelId]] }, ownPubkey), false);
  assert.equal(buzzMentionPrompt(event.content, "Prism"), "hello");
  assert.equal(buzzMentionPrompt("@Prism: please help", "Prism"), "please help");
});

test("normalizeBuzzMessage produces the Prism ingest contract", () => {
  const normalized = normalizeBuzzMessage({
    relayUrl: "https://buzz.example.test",
    channel: { channelId, name: "prism-lab", description: null, createdAt: null },
    profile: { pubkey: humanPubkey, displayName: "Dekan", about: null },
    event: {
      id: "event-id",
      pubkey: humanPubkey,
      createdAt: 1_785_264_695,
      kind: 9,
      content: "hello Prism",
      tags: [["h", channelId]],
    },
  });

  assert.equal(normalized.source, "buzz");
  assert.equal(normalized.channelId, channelId);
  assert.equal(normalized.messageId, "event-id");
  assert.equal(normalized.text, "hello Prism");
  assert.deepEqual(normalized.author, {
    id: humanPubkey,
    username: humanPubkey,
    displayName: "Dekan",
    bot: false,
  });
});

test("selectUnseenBuzzEvents makes checkpoint overlap idempotent", () => {
  const channel = { channelId, name: "prism-lab", description: null, createdAt: null };
  const event = (id: string, createdAt: number) => ({
    id,
    pubkey: humanPubkey,
    createdAt,
    kind: 9,
    content: id,
    tags: [["h", channelId]],
  });
  const selected = selectUnseenBuzzEvents([
    { channel, event: event("already-seen", 1) },
    { channel, event: event("new-event", 2) },
  ], ["already-seen"], 2);

  assert.deepEqual(selected.unseen.map((entry) => entry.event.id), ["new-event"]);
  assert.equal(selected.duplicateCount, 1);
  assert.deepEqual(selected.recentEventIds, ["already-seen", "new-event"]);
});

test("Buzz interaction cursor does not skip messages received during a slow runtime call", () => {
  const pollStartedTimestamp = 1_785_864_300;

  assert.equal(buzzInteractionCursorTimestamp(pollStartedTimestamp, []), pollStartedTimestamp);
  assert.equal(
    buzzInteractionCursorTimestamp(pollStartedTimestamp, [pollStartedTimestamp - 10, pollStartedTimestamp - 4]),
    pollStartedTimestamp - 10,
  );
});
