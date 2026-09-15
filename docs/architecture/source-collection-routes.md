# Source Collection Routes

Future feature spec for separating live communication adapters from source-specific Prism Memory collection.

## Problem

The source adapter currently has two responsibilities mixed together:

- live communication transport, such as Discord bot chat, output destinations, and voice recording
- historical/source collection, such as `POST /sync` collecting Discord REST messages and posting them to Prism Memory

That was acceptable when the adapter effectively meant "Discord adapter." It becomes confusing as the service starts supporting multiple communication platforms such as Discord and Telegram.

Telegram also has different collection semantics from Discord. Discord can inspect guild channels and backfill recent messages with REST APIs. Telegram bots generally cannot list all groups or freely backfill arbitrary group history; they mostly receive updates after the bot is added.

## Goal

Make route names and task patterns explicit about what platform and source type they operate on.

The service can remain one deployable communication adapter, but collection routes should be source-specific:

```text
POST /collections/discord/messages
POST /collections/telegram/messages
```

This keeps the model consistent without pretending all platforms have identical collection behavior.

## Terms

### Communication Adapter

Live transport and delivery:

- list destinations
- send messages
- receive bot mentions/replies
- route allowed prompts to Prism agent APIs
- enforce source adapter access policy
- capture voice recordings when supported

Examples:

```text
GET /destinations
POST /messages
POST /telegram/webhook
Discord gateway events
```

### Collection Route

Source-specific ingestion job that collects or replays events into Prism Memory:

- Discord historical message collection
- Telegram update replay from known bot updates
- future X mentions collection
- future GitHub issue collection if kept adapter-side

Collection routes should be called by tasks, scripts, or operators. They should not be implied by normal chat participation.

## Proposed Route Shape

### Discord Messages

```http
POST /collections/discord/messages
```

Query/body options:

```json
{
  "dryRun": true,
  "resetCheckpoint": false,
  "since": "2026-05-20T00:00:00.000Z",
  "until": "2026-05-21T00:00:00.000Z",
  "channelIds": ["123"],
  "maxMessagesPerChannel": 200
}
```

Behavior:

- inspect Discord guild channels
- fetch messages from text channels and optionally threads
- normalize messages
- post to Prism Memory `/ingest/messages`
- update Discord collection checkpoint

This replaces the generic `POST /sync` naming over time.

### Telegram Messages

```http
POST /collections/telegram/messages
```

Query/body options:

```json
{
  "dryRun": true,
  "resetCheckpoint": false,
  "chatIds": ["-1001234567890"]
}
```

Behavior:

- use locally persisted Telegram updates/chats seen by the bot
- collect only what the bot has received since it started participating
- normalize updates into Prism Memory message shape
- post to Prism Memory `/ingest/messages`
- update Telegram collection checkpoint

Important: Telegram collection is not a Discord-style historical backfill. It should be documented as "seen updates" unless a future Telegram integration adds a richer source.

## Compatibility

Keep existing route initially:

```text
POST /sync
```

Compatibility behavior:

- `POST /sync` continues to run Discord message collection.
- It should log or return a deprecation hint pointing to `/collections/discord/messages`.
- Built-in tasks should move to the explicit route.

Avoid creating alias drift indefinitely. Once templates and docs use the new route, remove or archive `/sync` in a future breaking cleanup.

## Task Naming

Avoid generic names like "source adapter sync" once multiple platforms exist.

Prefer:

- `discord-message-collection`
- `telegram-update-collection`
- `github-issue-collection`
- `x-mention-collection`

Task descriptions should state:

- platform
- collection scope
- checkpoint behavior
- whether the task can backfill
- where it writes

## Prism Memory Ingest Shape

Collection routes should normalize into platform-neutral message records while preserving platform metadata.

Example:

```json
{
  "source": "discord",
  "space": "community",
  "bucket": "ops",
  "messages": [
    {
      "id": "discord:channel:message",
      "platform": "discord",
      "channelId": "123",
      "channelName": "ops",
      "authorId": "456",
      "authorName": "sam",
      "content": "message text",
      "createdAt": "2026-05-21T12:00:00.000Z",
      "url": "https://discord.com/channels/..."
    }
  ]
}
```

Telegram should use the same top-level shape with Telegram-specific metadata:

```json
{
  "id": "telegram:-1001234567890:42",
  "platform": "telegram",
  "chatId": "-1001234567890",
  "chatTitle": "RaidGuild Updates",
  "authorId": "456",
  "authorName": "sam",
  "content": "message text",
  "createdAt": "2026-05-21T12:00:00.000Z"
}
```

## Access And Safety

Collection is not the same as live chat access.

The source adapter policy controls bot interaction and write capability:

```text
platforms.discord.targets
platforms.telegram.targets
```

Collection routes should have their own operational constraints:

- service-token auth
- dry-run support
- checkpoint visibility
- explicit platform route
- no DMs by default for Telegram
- no accidental cross-platform "collect everything" behavior

## Implementation Phases

### Phase 1: Route Rename

- Add `POST /collections/discord/messages`.
- Internally call the existing Discord sync implementation.
- Keep `POST /sync` as temporary compatibility.
- Update task authoring docs and built-in task definitions.

### Phase 2: Telegram Seen-Updates Collection

- Persist Telegram updates needed for later collection.
- Add `POST /collections/telegram/messages`.
- Document that this is not historical backfill.

### Phase 3: Task Cleanup

- Rename built-in "source sync" style tasks to source-specific task names.
- Ensure task output and run summaries mention platform and route.

### Phase 4: Prism Memory Repair/Replay

- Add repair/replay docs for Discord and Telegram separately.
- Keep Discord bucket reclassification separate from Telegram chat classification.

### Phase 5: Remove Generic Sync

- Remove or archive `POST /sync` after templates and skills use explicit collection routes.
