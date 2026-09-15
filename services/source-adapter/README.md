# Source Adapter Service

Generic source-ingestion adapter for Prism memory.

Runtime note:

- voice capture is currently validated on `@discordjs/voice` `0.19.x`, which requires a Node 22 runtime for deployment parity
- Discord voice recording is validated locally and on Railway using volume-backed Ogg capture, `ffmpeg` FLAC conversion, Whisper-compatible voice transcription, Codex runtime summaries, and Prism Memory inbox writes

Deploy this directory separately for each upstream source you want to ingest:

- `discord-adapter`
- `slack-adapter`
- `telegram-adapter`
- `buzz-adapter`

This service should own source-specific collection and normalization, then post normalized batches into `prism-memory`.

Current behavior:

- `GET /health` for service health and config visibility
- `POST /sync` runs a Discord REST sync and posts a normalized batch to `prism-memory`
- `GET /capabilities`, `GET /destinations`, `POST /messages`, `POST /attachments/resolve`, and `POST /attachments/fetch` expose the adapter output interface for agent-authored delivery and attachment handoff
- `POST /history/discord/search` and `POST /history/discord/context` expose protected, read-only Discord native history operations for the Site service
- `POST /interactions/:key/sessions` and `POST /interactions/:key/sessions/:sessionId/messages` expose operator-configured server-to-server chat interfaces
- `GET /guild/channels` exposes a protected guild channel inventory for instance setup and Prism Memory bucket mapping
- optional live Discord mention/thread chat forwarding to `codex-runtime`
- slash commands can now route into the same Discord session/Codex path as mentions
- Discord sync keeps message text, Discord embed summary text, and text-like attachment body text for small `.md`/`.txt`/similar files
- sync checkpoints are persisted under `SOURCE_ADAPTER_DATA_ROOT`
- `POST /sync?dry_run=true` collects and summarizes without posting or advancing checkpoints
- `POST /sync?reset_checkpoint=true` ignores the saved cursor and re-runs the full configured window
- Discord history search reuses `DISCORD_BOT_TOKEN`, `DISCORD_GUILD_ID`, and `SOURCE_ADAPTER_TOKEN`; it introduces no search-specific environment variables
- `GET /destinations` lists Discord text channels and known Telegram chats as output destinations
- `POST /messages` sends text to a resolved Discord channel id or Telegram chat id; requires `X-Adapter-Token` when `SOURCE_ADAPTER_TOKEN` is configured
- `POST /attachments/resolve` lists attachments on a Discord message by channel id and message id; requires `X-Adapter-Token` when `SOURCE_ADAPTER_TOKEN` is configured
- `POST /attachments/fetch` fetches a Discord message attachment by channel id, message id, and attachment id; requires `X-Adapter-Token` when `SOURCE_ADAPTER_TOKEN` is configured
- `POST /recordings/:sessionId/recover` finalizes a known unfinished recording session from the volume; requires `X-Adapter-Token`
- this service is now being consolidated onto a TypeScript/`discord.js` runtime so Discord-facing code can absorb voice and meeting commands later without a Python split

Recommended envs:

- `SOURCE_KIND=discord`
- `SOURCE_SPACE=community`
- `SOURCE_SYNC_MODE=manual`
- `PRISM_API_BASE=https://your-prism-memory.up.railway.app`
- `PRISM_ARTIFACT_PUBLIC_BASE_URL=https://your-prism-memory.up.railway.app`
- `PRISM_API_KEY=...`
- `PRISM_INGEST_PATH=/ingest/messages`
- `SOURCE_ADAPTER_DATA_ROOT=./services/source-adapter/data`
- `SOURCE_CHECKPOINT_OVERLAP_MINUTES=5`

Discord-specific envs you can add later:

- `DISCORD_BOT_TOKEN`
- `DISCORD_GUILD_ID`
- `DISCORD_CHAT_ENABLED=true`
- `DISCORD_REGISTER_COMMANDS=true`
- `DISCORD_COMMAND_GUILD_ID=<optional guild for fast command registration during dev>`
- `DISCORD_APPLICATION_ID=<optional explicit app id>`
- `DISCORD_ACCESS_POLICY_JSON=<optional fallback Discord chat access policy>`
- `DISCORD_RATE_LIMIT_WINDOW_SECONDS=60`
- `DISCORD_RATE_LIMIT_MAX_REQUESTS=6`
- `DISCORD_SYNC_WINDOW_HOURS=24`
- `DISCORD_MAX_MESSAGES_PER_CHANNEL=200`
- `DISCORD_INCLUDE_ARCHIVED_THREADS=false`
- `DISCORD_IGNORE_BOT_MESSAGES=false`
- `DISCORD_ATTACHMENT_TEXT_ENABLED=true`
- `DISCORD_EMBED_TEXT_ENABLED=true`
- `DISCORD_ATTACHMENT_TEXT_MAX_BYTES=200000`
- `DISCORD_ATTACHMENT_TEXT_MAX_CHARS=12000`
- `DISCORD_ATTACHMENT_TEXT_MAX_FILES_PER_MESSAGE=3`
- `DISCORD_ATTACHMENT_FETCH_MAX_BYTES=52428800`
- `SOURCE_ADAPTER_PUBLIC_BASE_URL=https://your-discord-adapter.up.railway.app`
- `VOICE_FFMPEG_SEGMENT_SECONDS=180`
- `VOICE_CHAT_MAX_MESSAGES=200`
- `VOICE_CHAT_IGNORE_BOT_MESSAGES=true`
- `VOICE_DAVE_ENCRYPTION=true`
- `VOICE_RECORDING_WARNING_MINUTES=50`
- `VOICE_RECORDING_MAX_MINUTES=60`
- `VOICE_TRANSCRIPTION_BASE_URL=https://api.venice.ai/api/v1/audio/transcriptions`
- `VOICE_TRANSCRIPTION_API_KEY=...`
- `VOICE_TRANSCRIPTION_MODEL=nvidia/parakeet-tdt-0.6b-v3`
- `VOICE_TRANSCRIPTION_LANGUAGE=en`
- `VOICE_TRANSCRIPTION_RESPONSE_FORMAT=json`
- `VOICE_TRANSCRIPTION_TIMESTAMPS=true`
- `DISCORD_RECORDING_COMPLETE_HOOK_KEY=recording-transcript-completed`
- `DISCORD_RECORDING_COMPLETE_HOOK_ENABLED=<optional true|false override; defaults to true>`
- `DISCORD_RECORDING_COMPLETE_HOOK_TIMEOUT_MS=10000`
- `DISCORD_RECORDING_SUMMARY_ENABLED=<optional true|false; defaults to true>`
- `DISCORD_RECORDING_SUMMARY_MEMORY_INGEST_ENABLED=<optional true|false; defaults to true>`
- `DISCORD_RECORDING_TRANSCRIPT_MEMORY_INGEST_ENABLED=<optional true|false; defaults to false>`
- `DISCORD_RECORDING_COMPLETE_HOOK_INCLUDE_TRANSCRIPT_BODY=<optional true|false; defaults to false when a summary exists>`
- `PRISM_ARTIFACT_PUBLIC_BASE_URL=<public Prism Memory artifact base URL, required for shareable summary/transcript artifact links>`

The Discord recorder fetches the editable Prism skill
`recording-summary-profile` from the Site service and layers that guidance into
final meeting summaries and in-meeting recaps. If the skill cannot be fetched,
the recorder falls back to its generic summary prompt.

Discord-native summary generation and summary Memory ingest default to enabled.
Set `DISCORD_RECORDING_SUMMARY_ENABLED=false` or
`DISCORD_RECORDING_SUMMARY_MEMORY_INGEST_ENABLED=false` only when an instance
needs to opt out. Older `DISCORD_LEGACY_RECORDING_*` flags are ignored.
- `N8N_WEBHOOK_URL=https://your-n8n.example/webhook/transcribe` only if the legacy webhook handoff is still needed

Discord historical search calls Discord's native guild message search rather
than replaying `/sync` or backfilling the guild into Prism Memory. The bot needs
`VIEW_CHANNEL` and `READ_MESSAGE_HISTORY` for returned channels, and the Discord
application needs the privileged `MESSAGE_CONTENT` intent. Search and context
routes use `X-Adapter-Token`, do not advance collection checkpoints, and do not
write to Prism Memory.

Agents should use the Site-owned source-neutral routes instead of calling these
adapter routes directly:

```text
GET  /agent/source-history/capabilities
POST /agent/source-history/search
POST /agent/source-history/context
```

Telegram-specific envs:

- `TELEGRAM_BOT_TOKEN=<optional Telegram bot token>`
- `TELEGRAM_DISCOVERY_ENABLED=true`
- `TELEGRAM_DM_ENABLED=false`
- `TELEGRAM_POLL_INTERVAL_SECONDS=10`

Buzz-specific envs (deploy as a separate `buzz-adapter` service):

- `SOURCE_KIND=buzz`
- `BUZZ_ENABLED=true`
- `BUZZ_RELAY_URL=https://your-buzz-relay.example`
- `BUZZ_PRIVATE_KEY=<dedicated service identity; Railway secret>`
- `BUZZ_PUBLIC_KEY=<64-character public key>`
- `BUZZ_CHANNEL_ALLOWLIST=<optional comma-separated emergency ceiling for interactive/output channels>`
- `BUZZ_HISTORY_CHANNEL_ALLOWLIST=<comma-separated channels intentionally collected into Prism Memory>`
- `BUZZ_SYNC_WINDOW_HOURS=24`
- `BUZZ_MAX_MESSAGES_PER_CHANNEL=500`
- `BUZZ_IGNORE_OWN_MESSAGES=true`
- `BUZZ_CLI_TIMEOUT_SECONDS=30`
- `BUZZ_CHECKPOINT_EVENT_LIMIT=10000`
- `BUZZ_INTERACTION_ENABLED=false`
- `BUZZ_INTERACTION_PROFILE_KEY=<legacy single-profile fallback label; channel routing uses Site policy>`
- `BUZZ_INTERACTION_DISPLAY_NAME=Prism`
- `BUZZ_INTERACTION_POLL_SECONDS=5`
- `BUZZ_INTERACTION_LOOKBACK_SECONDS=3600`
- `BUZZ_HISTORY_CHANNEL_ALLOWLIST=<comma-separated channel UUIDs>`
- `BUZZ_HISTORY_MAX_LOOKBACK_SECONDS=7200`
- `BUZZ_HISTORY_MAX_MESSAGES=100`
- `BUZZ_CHANNEL_ADMIN_TOKEN=<separate Gateway-leased channel-management secret>`
- `BUZZ_CHANNEL_ADMIN_PROFILE_KEY=admin-agent`

Buzz collection and delivery use the checksum-pinned official Buzz `0.5.0`
CLI installed by this service's Dockerfile. Enabled Agent Profile bindings are
the source of truth for interactive channels and output destinations.
`BUZZ_CHANNEL_ALLOWLIST` is optional and acts only as an emergency ceiling;
stale or invisible entries do not abort the listener. History ingestion uses
`BUZZ_HISTORY_CHANNEL_ALLOWLIST`, falling back to the legacy ceiling only for
compatibility. Sync uses the shared checkpoint file under
`SOURCE_ADAPTER_DATA_ROOT`, retains recent Nostr event IDs to make overlap and
retry idempotent, and posts normalized `buzz` batches to Prism Memory.

When interaction polling is enabled, the adapter responds only to events in a
channel with an enabled Agent Profile binding that contain a Nostr `p` tag for
`BUZZ_PUBLIC_KEY`. The resolved binding supplies agent identity, access mode,
and policy; legacy source-adapter policy remains a compatibility fallback.
Authorized human replies in that Buzz reply chain continue the same
conversation without mentioning Prism again. Unmapped Buzz channels default to
`off`. `readonly` receives no Gateway credentials,
`run-approved` receives no Gateway credentials and carries the profile workflow
allowlist, and `full` receives credentials selected by the shared source policy.
Sessions are isolated by profile, channel, and the root Buzz event.

Replies and typing indicators are attached to the conversation's original
channel event. This keeps Buzz conversations to one visible reply level even
when a person directly replies to Prism or continues from another reply. The
full linear thread is still supplied as runtime context, and a durable
event-to-root index on the adapter volume preserves Prism session continuity
across restarts. Before delivery, the adapter checks whether Prism already
replied directly to a root event to prevent duplicates after a crash. Operators
can trigger a protected diagnostic poll with `POST /buzz/interactions/poll`
using `X-Adapter-Token`.

Trusted service callers can read current Buzz history without advancing the
collection checkpoint through `GET
/agent/buzz/channels/:channelId/messages?since=<ISO-or-Unix-seconds>&limit=50`.
The route requires `x-service-token`, only permits channels in
`BUZZ_HISTORY_CHANNEL_ALLOWLIST`, defaults to the configured maximum lookback,
and excludes Prism-authored messages unless `includeOwn=true` is supplied.
The adapter expands the relevant Buzz threads and returns explicit `threadId`,
`metadata.threadRootEventId`, and `metadata.replyToEventId` correlation. This is
a read-through relay query; it does not post to Prism Memory or mutate the
normal `/sync` checkpoint.

When `BUZZ_CHANNEL_ADMIN_TOKEN` is configured, `/capabilities` advertises
`manage-buzz-channels`. The protected `/buzz/channels` routes create and update
channels, archive/unarchive them, and manage members. They require
`X-Buzz-Admin-Token`; the ordinary adapter token is not accepted. Permanent
deletion is intentionally not exposed. Agent Profile bindings remain the
canonical way to make a channel interactive and visible to Prism operations.

While Prism processes an accepted interaction, the adapter publishes the same
thread-scoped, ephemeral kind `20002` typing indicator used by built-in Buzz
agents. It refreshes every three seconds and stops when the reply is sent or the
runtime fails. Typing publication is best-effort and never blocks the runtime
response path. The adapter also adds the managed-agent `💬` working reaction to
the triggering message before invoking the runtime and removes it after the
reply or failure.

Telegram uses the Bot API directly. When `TELEGRAM_BOT_TOKEN` is set, the
adapter polls `getUpdates` to discover groups/channels where the bot is present.
Telegram does not provide a global "list every group this bot has joined" API, so
a Telegram group appears in `GET /destinations` after the bot receives an update
from that group. Private DMs are ignored by default and are not listed unless
`TELEGRAM_DM_ENABLED=true`.

The same poller can bridge Telegram group chat into Prism's selected runtime. In groups and
channels the bot responds to `/prism`, `/prism ...`, `/superprism`,
`/superprism ...`, or messages that mention the bot username. Access is still
controlled by the site-owned source adapter policy; Telegram defaults to `off`,
so an operator must allow a chat or user before the bot will answer. Telegram
shows a temporary `🧠 Thinking...` reply during model-backed runs and removes it
when the final response is posted.

Destination examples:

```json
{
  "id": "discord:1374448934436733089",
  "adapter": "discord",
  "platform": "discord",
  "destinationId": "1374448934436733089",
  "type": "discord-channel",
  "label": "#so-dev"
}
```

```json
{
  "id": "discord:1037470101718450288",
  "adapter": "discord",
  "platform": "discord",
  "destinationId": "1037470101718450288",
  "type": "discord-forum",
  "label": "Forum / project-updates"
}
```

```json
{
  "id": "telegram:-1001234567890",
  "adapter": "telegram",
  "platform": "telegram",
  "destinationId": "-1001234567890",
  "type": "telegram-chat",
  "label": "Telegram / RaidGuild Updates"
}
```

`POST /messages` accepts either a platform-qualified destination id or an
explicit adapter:

```json
{
  "destinationId": "telegram:-1001234567890",
  "content": "Hello from Prism"
}
```

```json
{
  "adapter": "telegram",
  "destinationId": "-1001234567890",
  "content": "Hello from Prism"
}
```

For Discord forum destinations, include `type:"discord-forum"` and a `title` or
`postTitle` to create a new forum post/thread:

```json
{
  "adapter": "discord",
  "type": "discord-forum",
  "destinationId": "1037470101718450288",
  "title": "Weekly project update",
  "content": "Hello from Prism"
}
```

Chat bridge envs:

- `PRISM_AGENT_API_BASE_URL=https://your-site.up.railway.app`
- `PRISM_AGENT_SERVICE_TOKEN=...`
- `APP_API_BASE_URL=https://your-api.up.railway.app`
- `APP_API_SERVICE_TOKEN=...`

The adapter sends chat, summary, recap, and promoted-document model calls to
`POST /agent/runtime/invoke`; Site resolves the current default runtime profile.

## External HTTP Interactions

External interaction paths are disabled until an operator creates an
interaction profile and interface through Prism Console, generates an inbound
credential in **Settings > Interfaces**, and enables the interface. The adapter
authenticates every session and message against Site; external clients never
receive the Site service token.

Create a session:

```bash
curl -fsSL \
  -X POST \
  -H "Authorization: Bearer $PRISM_INTERFACE_KEY" \
  "$COMMUNICATION_ADAPTER_BASE_URL/interactions/docs-assistant/sessions"
```

Send a message with the returned `sessionId`:

```bash
curl -fsSL \
  -X POST \
  -H "content-type: application/json" \
  -H "Authorization: Bearer $PRISM_INTERFACE_KEY" \
  "$COMMUNICATION_ADAPTER_BASE_URL/interactions/docs-assistant/sessions/$SESSION_ID/messages" \
  -d '{"content":"How do I create a Prism workflow?"}'
```

The first slice accepts API keys from trusted application backends. Do not put a
long-lived interface key in browser JavaScript. `readonly` and `run-approved`
interactions receive no Gateway credentials; deliberately configured `full`
interfaces follow the normal trusted-source credential lease path. Responses
pass through the public-output sanitizer, and conversations reuse Site agent
sessions. `readonly` remains an operating policy rather than a tool-free public
sandbox until a restricted Runtime is available.

`run-approved` currently records the operator-owned workflow allowlist and
applies restrictive Runtime instructions, but it does not yet expose the
deterministic workflow-start endpoint. Enforceable Prism Memory scoping is the
next planned interaction change; deterministic allowlisted workflow execution
follows it. Browser-direct and CORS authentication flows are outside this
server-to-server interface.

Interaction profiles may also configure advisory Prism Memory knowledge-source
IDs, buckets, and additional instructions. The adapter includes them in trusted
Runtime policy instructions and session metadata. They improve model behavior
but are explicitly `instructions-only`; Prism Memory does not yet enforce them
as an authorization boundary.

The profile rate limit is aggregate per external interface and counts both
session creation and message requests. Creating additional sessions does not
create additional rate-limit capacity. A trusted application that legitimately
handles many concurrent sessions should configure an appropriate interface
limit; `x-prism-external-subject` remains audit attribution and is not trusted
as the primary limiter key.

Recording completion hooks reuse the agent API base/token when possible. The
default hook key is `recording-transcript-completed`:

```text
POST ${PRISM_AGENT_API_BASE_URL:-$APP_API_BASE_URL}/agent/hooks/<hook-key>/trigger
```

with `x-service-token: ${PRISM_AGENT_SERVICE_TOKEN:-$APP_API_SERVICE_TOKEN}`.
Use `PRISM_HOOKS_BASE_URL` or `PRISM_HOOK_SERVICE_TOKEN` only when the hook
service is different from the normal Prism agent API. Hook delivery is
best-effort: missing config, timeouts, or non-2xx responses are logged but do
not fail the recording, transcript, summary, Prism Memory ingest, or Discord
completion message.

Payload shape:

```json
{
  "source": "discord-source-adapter",
  "event": "discord.recording.completed",
  "occurredAt": "2026-05-26T18:30:00.000Z",
  "discord": {
    "guildID": "123",
    "channelID": "456",
    "channelName": "Voice",
    "threadID": null,
    "messageID": null,
    "scheduledEventID": "789",
    "recordingStartedAt": "2026-05-26T18:00:00.000Z",
    "recordingEndedAt": "2026-05-26T18:30:00.000Z"
  },
  "artifacts": {
    "artifactID": "prism-artifact-id",
    "recordingURL": "https://...",
    "transcriptURL": "https://...",
    "summaryURL": "https://...",
    "summaryText": "Short summary text when available"
  },
  "participants": [
    {
      "discordUserID": "111",
      "username": "example",
      "displayName": "Example"
    }
  ],
  "metadata": {
    "adapterInstance": "source-adapter",
    "confidence": "direct",
    "notes": []
  }
}
```

Discord chat access policy defaults to `readonly`. The preferred configuration is
site-owned and can be changed from the admin Settings tab without rebuilding:

- `GET /agent/source-adapter-policy`
- `PATCH /agent/source-adapter-policy`

The source adapter refreshes this policy from the site service and falls back to
env/default configuration if the site route is unavailable. Use `targets` for
platform conversation surfaces, `groups` for platform permission groups, and
`users` for platform users. For Discord, targets are channel/thread IDs and
groups are role IDs:

```json
{
  "platforms": {
    "discord": {
      "defaultMode": "readonly",
      "defaultRateLimit": { "windowSeconds": 60, "maxRequests": 6 },
      "targets": {
        "123456789012345678": { "mode": "run-approved" },
        "234567890123456789": { "mode": "full", "rateLimit": { "windowSeconds": 60, "maxRequests": 12 } }
      },
      "groups": {
        "345678901234567890": { "mode": "full" }
      },
      "users": {
        "456789012345678901": { "mode": "full" }
      }
    }
  }
}
```

Telegram uses the same modes. Its default mode is `off`; targets are Telegram
chat/group/channel IDs and users are Telegram user IDs. Telegram does not have a
role/group equivalent in this adapter yet:

```json
{
  "platforms": {
    "telegram": {
      "defaultMode": "off",
      "defaultRateLimit": { "windowSeconds": 60, "maxRequests": 6 },
      "targets": {
        "-1001234567890": { "mode": "readonly" },
        "-1002345678901": { "mode": "run-approved" }
      },
      "groups": {},
      "users": {
        "12345678": { "mode": "full" }
      }
    }
  }
}
```

Buzz also defaults to `off`. Targets are Buzz channel UUIDs, users are Nostr
hex public keys, and there is no group/role context yet. Pair the access mode
with a Site interaction profile; a missing profile or mode mismatch fails
closed:

```json
{
  "platforms": {
    "buzz": {
      "defaultMode": "off",
      "defaultRateLimit": { "windowSeconds": 60, "maxRequests": 6 },
      "targets": {
        "<lab-channel-uuid>": {
          "mode": "readonly",
          "interactionProfileKey": "buzz-prism-readonly"
        },
        "<ops-channel-uuid>": {
          "mode": "full",
          "interactionProfileKey": "buzz-prism-ops",
          "skills": ["veydrift-commander", "prism-api-reader"]
        }
      },
      "groups": {},
      "users": {}
    }
  }
}
```

Target-scoped `skills` are passed through Site's runtime invocation contract and
loaded on every new or resumed interaction from that target. For Buzz, the
adapter also supplies up to two hours of recent channel activity (including
Prism-authored receipts) together with the current thread, bounded to the 20
most recent distinct messages. This context is read directly from Buzz and does
not wait for the Prism Memory collector.

`DISCORD_ACCESS_POLICY_JSON` remains as an emergency/bootstrap fallback:

```json
{
  "defaultMode": "readonly",
  "defaultRateLimit": { "windowSeconds": 60, "maxRequests": 6 },
  "targets": {
    "123456789012345678": { "mode": "run-approved" },
    "234567890123456789": { "mode": "full", "rateLimit": { "windowSeconds": 60, "maxRequests": 12 } }
  },
  "groups": {
    "345678901234567890": { "mode": "full" }
  },
  "users": {
    "456789012345678901": { "mode": "full" }
  }
}
```

Modes:

- `off`: ignore prompts in that platform scope
- `readonly`: answer/read context only
- `run-approved`: run existing approved tasks/workflows, but do not author new custom assets
- `full`: trusted behavior, still subject to Prism/runtime safeguards

Discord and Telegram replies are sanitized before posting publicly. The sanitizer
redacts common internal Railway URLs, service hosts, token-looking values, private
keys, and local filesystem paths.

Readonly Discord and Telegram surfaces also apply a lightweight write-intent
preflight before the selected runtime is called. Obvious create/update/send/run requests
get a short policy reply instead of model-generated instructions for working
around the access level.

Notes:

- keep source-specific auth and traversal logic here, not inside `prism-memory`
- keep shared model/runtime behavior behind Site runtime profiles, not in this adapter
- deploy multiple copies of this same directory if you want one adapter service per source
- the current implementation uses `discord.js` plus the Discord HTTP API for Discord and Telegram Bot API polling for Telegram
- the stored checkpoint is a sync cursor, not a per-channel high-water mark; the overlap window reduces the chance of missing late-arriving reads across runs
- the adapter does not crawl pasted links; it only preserves the embed text Discord already provides (`title`, `description`, `url`)

Current slash commands:

- `/prism-ping`
- `/prism-health`
- `/prism-chat prompt:<text>`
- `/prism-start-cr`
- `/prism-continue-cr id:<number>`
- `/prism-promote-doc title:<text> lane:<memory|knowledge>`
- `/prism-join`
- `/prism-record`
- `/prism-stoprecord`
- `/prism-recap prompt:<optional text>`
- `/prism-rollcall`

`/prism-promote-doc` writes new Prism assets, so it requires Discord access mode
`full` or the explicit `memory.promote_doc` capability. It defaults to the memory
lane and returns a shareable artifact link there; `lane:knowledge` writes to the
knowledge inbox and returns the inbox paths until review/indexing promotes the
entry.

Current voice command status:

- `/prism-join` joins the caller's current voice channel
- `/prism-join` does not start recording; the response explicitly tells the caller to run `/prism-record` when capture should begin
- `/prism-record` starts a volume-backed recording session under `/data/recordings/<session-id>/raw`
- `/prism-record` eagerly subscribes to current non-bot channel participants, then uses Discord speaking events as a backup for continued capture
- `/prism-record` persists wall-clock voice timing events for stream start, Discord speaking start, first audio chunk, and stream end so future transcripts can be stitched against the meeting clock
- `/prism-stoprecord` stops the session, runs `ffmpeg`, and writes FLAC chunks under `/data/recordings/<session-id>/flac`
- `/prism-rollcall` inspects the active/current voice channel and lists non-bot participants
- if `VOICE_TRANSCRIPTION_API_KEY` is set, `/prism-stoprecord` sends FLAC chunks to the configured Whisper-compatible transcription endpoint and writes transcript artifacts under `/data/recordings/<session-id>/transcript`
- voice transcript offsets are derived from persisted wall-clock audio chunk times when available, then fall back to the older per-speaker chunk offsets
- recordings warn at `VOICE_RECORDING_WARNING_MINUTES` and stop automatically at `VOICE_RECORDING_MAX_MINUTES`; set `VOICE_RECORDING_MAX_MINUTES=0` to disable the automatic stop
- `/prism-stoprecord` only auto-recovers unfinished sessions from the caller's current voice channel and younger than `VOICE_RECOVERY_MAX_AGE_HOURS`; use `POST /recordings/:sessionId/recover` for explicit older recovery
- `/prism-stoprecord` also fetches messages posted in the Discord voice channel during the recording window and stitches them into the merged transcript timeline as `chat` segments
- if the adapter restarts during recording, `/prism-stoprecord` can recover the newest unfinished session for the guild from `/data/recordings/<session-id>/session.json` and `/raw/*.ogg`
- when summary generation is enabled, `/prism-stoprecord` generates a meeting
  summary, promotes the summary to Prism Memory when configured, and triggers
  the Prism Site hook `recording-transcript-completed` with a compact
  `recording.summary.completed` payload: source metadata, participants, summary
  content, Memory artifact URL, and private transcript references
- full transcript bodies are omitted from the hook payload when a summary exists;
  set `DISCORD_RECORDING_COMPLETE_HOOK_INCLUDE_TRANSCRIPT_BODY=true` only for
  debugging or explicit fallback workflows
- the adapter creates the reusable recording summary with the editable `recording-summary-profile` skill; the Prism workflow `recording-transcript-review-publish` reuses it for business synthesis and downstream Memory/Portal/delivery work
- `/prism-recap` routes through the existing Prism/Codex chat path and asks for a recap from the latest relevant recording transcript workflow or artifacts for the Discord context
- adapter summary generation can be disabled with `DISCORD_RECORDING_SUMMARY_ENABLED=false`
- direct summary promotion to Prism Memory can be disabled with `DISCORD_RECORDING_SUMMARY_MEMORY_INGEST_ENABLED=false`
- Discord should only receive a short completion notice; durable transcript/summary artifacts live in Prism workflow/request artifacts or the local recording volume
- if `N8N_WEBHOOK_URL` is set, the adapter POSTs meeting metadata to `n8n` after stop
- FLAC chunks can be fetched from `GET /recordings/:sessionId/:fileName` with `X-Adapter-Token`

## Local voice development

Use the full local stack when testing voice summaries:

```bash
npm run dev:all
```

`scripts/dev-all.sh` starts the configured runtime adapter and Site. The source
adapter calls Site, which routes summary and recap jobs through the selected
runtime profile.

For a smaller manual test, start Site and one configured runtime adapter first.
For Codex Runtime:

```bash
CODEX_HOME="$HOME/.codex" PORT=3030 npm run dev --workspace @prism-railway/codex-runtime
```

Then start `source-adapter` with Site agent access:

```bash
PRISM_AGENT_API_BASE_URL=http://127.0.0.1:3100 \
PRISM_AGENT_SERVICE_TOKEN=local-service-token \
npm run dev --workspace @prism-railway/source-adapter
```

Expected success signal after `/prism-record` and `/prism-stoprecord`:

- `Speakers with audio: 1` or higher
- transcript markdown under `data/recordings/<session-id>/transcript/transcript.md`
- summary markdown under `data/recordings/<session-id>/transcript/summary.md`
- Prism Memory inbox paths in the Discord completion message when local `prism-memory` is running

## Railway voice deployment notes

The verified Railway path uses:

- `SOURCE_ADAPTER_DATA_ROOT=/data` with a mounted volume
- `DISCORD_BOT_TOKEN` and `DISCORD_GUILD_ID`

### Guild Channel Inventory

Use the protected inventory endpoint when configuring a new instance:

```bash
curl -fsSL \
  -H "X-Adapter-Token: $COMMUNICATION_ADAPTER_TOKEN" \
  "$COMMUNICATION_ADAPTER_BASE_URL/guild/channels"
```

The response includes `mappingCandidates` and groups Discord categories with child text/thread channels. Use `mappingCandidates[].id` or `categories[].id` as the default keys for the instance-specific `discord.category_to_bucket` mapping in Prism Memory. Do not map every child channel ID; child channels inherit through their category. Use channel IDs only for truly uncategorized channel exceptions. Do not copy category IDs from another community.
- `VOICE_TRANSCRIPTION_BASE_URL=https://api.venice.ai/api/v1/audio/transcriptions`
- `VOICE_TRANSCRIPTION_API_KEY`
- `VOICE_TRANSCRIPTION_LANGUAGE=en`
- `VOICE_CHAT_MAX_MESSAGES=200`
- `VOICE_CHAT_IGNORE_BOT_MESSAGES=true`
- `VOICE_DAVE_ENCRYPTION=true`
- `VOICE_RECORDING_WARNING_MINUTES=50`
- `VOICE_RECORDING_MAX_MINUTES=60`
- `PRISM_AGENT_API_BASE_URL=https://your-site.up.railway.app` or the private Site URL
- `PRISM_AGENT_SERVICE_TOKEN`
- `PRISM_API_BASE=https://prism-memory-production.up.railway.app` or a verified reachable private URL
- `PRISM_ARTIFACT_PUBLIC_BASE_URL=https://prism-memory-production.up.railway.app`
- `PRISM_API_KEY`

If `/prism-stoprecord` reports `Speakers with audio: 0`, check Railway logs for `eager receiver subscribe` and `received first opus chunk`. If voice-channel chat stitching is missing, check for `voice chat transcript messages` or `voice chat transcript skipped` in logs and confirm the bot can read message history in that voice channel. If summary or Prism ingest is skipped, check logs for the detailed fetch cause and verify the runtime/memory service health URLs from outside Railway first.

After changing `DISCORD_BOT_TOKEN` or accidentally exposing it in logs/tool output, rotate the Discord bot token in the Discord developer portal and update Railway before the next deploy.
