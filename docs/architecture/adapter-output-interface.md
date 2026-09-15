# Adapter Output Interface

Prism adapters can expose a small internal delivery interface so agent-authored tasks can resolve output destinations without task-runner knowing source-specific details.

## Auth

Adapter delivery routes require the adapter token:

```bash
X-Adapter-Token: $COMMUNICATION_ADAPTER_TOKEN
```

If Codex Runtime agents should call the adapter directly, wire these env vars into `codex-runtime`:

```text
COMMUNICATION_ADAPTER_BASE_URL=http://${{discord-adapter.RAILWAY_PRIVATE_DOMAIN}}:${{discord-adapter.PORT}}
COMMUNICATION_ADAPTER_TOKEN=${{discord-adapter.SOURCE_ADAPTER_TOKEN}}
```

Scheduled tasks should usually store resolved destinations in `outputConfig.outputDestinations` and let `task-runner` deliver the returned content. Direct adapter calls are for explicit one-off sends or agent workflows that need to post immediately.

## Routes

### `GET /capabilities`

Returns adapter capabilities and supported destination types.

```json
{
  "ok": true,
  "adapter": "communication",
  "adapters": ["discord", "telegram"],
  "capabilities": ["list-destinations", "send-message", "fetch-attachment"],
  "destinationTypes": ["discord-channel", "discord-forum", "telegram-chat", "telegram-channel"],
  "routes": {
    "attachmentsFetch": "/attachments/fetch",
    "attachmentsResolve": "/attachments/resolve",
    "destinations": "/destinations",
    "messages": "/messages"
  }
}
```

### `POST /attachments/fetch`

Fetches a source attachment that belongs to a specific source message. The
first implementation supports Discord and returns the attachment bytes directly
with source metadata in the `x-prism-attachment-metadata` response header.

Example:

```bash
curl -fsSL \
  -X POST \
  -H "content-type: application/json" \
  -H "X-Adapter-Token: $COMMUNICATION_ADAPTER_TOKEN" \
  "$COMMUNICATION_ADAPTER_BASE_URL/attachments/fetch" \
  -d '{
    "platform": "discord",
    "channelId": "456",
    "messageId": "123",
    "attachmentId": "789",
    "purpose": "request-artifact"
  }' \
  -o attachment.bin
```

The adapter re-fetches the message through the platform API and only downloads
an attachment found on that message. Callers should treat any source CDN URL as
non-durable and store the returned bytes in a Prism-owned artifact or memory
surface.

### `POST /attachments/resolve`

Returns attachment candidates for a source message without downloading file
bytes. This is useful when an operator gives Prism a Discord message URL and the
agent needs to choose or ask about the attached file.

```bash
curl -fsSL \
  -X POST \
  -H "content-type: application/json" \
  -H "X-Adapter-Token: $COMMUNICATION_ADAPTER_TOKEN" \
  "$COMMUNICATION_ADAPTER_BASE_URL/attachments/resolve" \
  -d '{
    "platform": "discord",
    "channelId": "456",
    "messageId": "123"
  }'
```

Response:

```json
{
  "ok": true,
  "platform": "discord",
  "channelId": "456",
  "messageId": "123",
  "message": {
    "id": "123",
    "channelId": "456",
    "messageUrl": "https://discord.com/channels/...",
    "text": "Please use this transcript."
  },
  "attachments": [
    {
      "id": "789",
      "filename": "transcript.md",
      "contentType": "text/markdown",
      "size": 4812,
      "textLike": true
    }
  ]
}
```

### `GET /destinations`

Returns known destinations the adapter can address.

Example:

```bash
curl -fsSL \
  -H "X-Adapter-Token: $COMMUNICATION_ADAPTER_TOKEN" \
  "$COMMUNICATION_ADAPTER_BASE_URL/destinations"
```

```json
{
  "ok": true,
  "adapter": "communication",
  "destinations": [
    {
      "adapter": "discord",
      "platform": "discord",
      "id": "discord:1234567890",
      "destinationId": "1234567890",
      "type": "discord-channel",
      "name": "updates",
      "label": "#updates"
    },
    {
      "adapter": "discord",
      "platform": "discord",
      "id": "discord:2345678901",
      "destinationId": "2345678901",
      "type": "discord-forum",
      "name": "announcements",
      "label": "Forum / announcements"
    },
    {
      "adapter": "telegram",
      "platform": "telegram",
      "id": "telegram:-1001234567890",
      "destinationId": "-1001234567890",
      "type": "telegram-chat",
      "name": "RaidGuild Updates",
      "label": "Telegram / RaidGuild Updates"
    }
  ]
}
```

Telegram destinations are discovered from Bot API updates. A group/channel is
listed after the bot has been added and has seen at least one update from that
chat. Private DMs are disabled by default.

### `POST /messages`

Sends a text message to a resolved destination.

Example:

```bash
curl -fsSL \
  -X POST \
  -H "content-type: application/json" \
  -H "X-Adapter-Token: $COMMUNICATION_ADAPTER_TOKEN" \
  "$COMMUNICATION_ADAPTER_BASE_URL/messages" \
  -d '{"destinationId":"discord:1234567890","content":"Test message"}'
```

```json
{
  "destinationId": "telegram:-1001234567890",
  "content": "Daily brief..."
}
```

For compatibility, Discord callers may still send a bare Discord channel id.
Multi-platform callers should prefer platform-qualified ids or send an explicit
`adapter` field:

```json
{
  "adapter": "telegram",
  "destinationId": "-1001234567890",
  "content": "Daily brief..."
}
```

Discord forum destinations create a new forum post/thread. Include `type:
"discord-forum"` and a `title` or `postTitle`; if omitted, the adapter uses a
generic title.

```json
{
  "adapter": "discord",
  "type": "discord-forum",
  "destinationId": "2345678901",
  "title": "Weekly community brief",
  "content": "Daily brief..."
}
```

Response:

```json
{
  "ok": true,
  "result": {
    "adapter": "discord",
    "destinationId": "1234567890",
    "messageCount": 1,
    "messages": [{ "id": "9876543210", "channelId": "1234567890" }]
  }
}
```

## Task Output Config

Chat-assisted task creation should resolve human labels like `#updates` once, then store the resolved destination on the task.

```json
{
  "summary": true,
  "outputDestinations": [
    {
      "adapter": "discord",
      "type": "discord-channel",
      "id": "discord:1234567890",
      "label": "#updates"
    },
    {
      "adapter": "discord",
      "type": "discord-forum",
      "id": "discord:2345678901",
      "label": "Forum / announcements",
      "title": "Weekly community brief"
    },
    {
      "adapter": "telegram",
      "type": "telegram-chat",
      "id": "telegram:-1001234567890",
      "label": "Telegram / RaidGuild Updates"
    }
  ]
}
```

At scheduled run time, Codex returns the content. The task-runner delivers that content to each configured destination and records delivery results in the task run output snapshot.

## Future Workflow Notification Delivery

Workflow notification policy does not belong in the adapter. A scheduled Prism
task or agent reads the Site workflow-event feed, decides which events are
notification-worthy, resolves the intended recipient, and hands an outbound
message to the adapter.

The adapter should grow into the shared outbound and inbound communications
boundary. Future message submission should support a caller-provided stable
idempotency key and Prism correlation metadata such as `workflowEventId`,
`requestId`, and a notification policy key. Durable acceptance at this boundary
allows a workflow-event consumer to checkpoint after adapter handoff without
requiring a notification outbox in Site.

The adapter should eventually own transport selection, provider credentials,
retry and rate-limit behavior, provider message ids, delivery outcomes, inbound
normalization, and reply correlation. It should not decide which workflow events
matter or which organizational policy selects a recipient.

The current `/messages` route is synchronous and does not promise durable,
idempotent acceptance. Until that contract is added, a workflow-event processor
must treat delivery as at-least-once, verify each response, advance its cursor
only through the last contiguous successful event, and tolerate possible
duplicates after a crash.

See [Workflow Event Notifications](../features/workflow-event-notifications.md)
for the current cursor and task-processing design.
