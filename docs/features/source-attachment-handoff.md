# Source Attachment Handoff

Status: first slice in progress

## Purpose

Operators and contributors often attach useful files in Discord while working
with Prism: meeting transcripts, draft Markdown, screenshots, images for a
creative workflow, or media that should be available to a skill. Prism needs a
controlled way to fetch those attachments and turn them into request artifacts,
memory inbox items, or workflow inputs without copying every attachment during
passive collection.

Discord is the first target because that is where the current need exists. The
contract should stay platform-shaped so Telegram can implement the same flow
later.

## Design Principles

- Collect attachment metadata by default, not file bytes.
- Fetch file bytes only through an explicit operator action, workflow step, or
  trusted source policy.
- Keep source-specific auth and URL-expiry handling inside the communication
  adapter.
- Keep durable artifact records and memory promotion decisions in the site and
  Prism Memory services.
- Keep external media bucket credentials out of the Discord adapter. Codex
  Runtime may continue to spool media to its configured S3-compatible bucket
  for imagegen, Remotion, and similar workflows.
- Preserve provenance for every fetched attachment.
- Do not treat Discord CDN URLs as durable storage.

## Use Cases

- A contributor uploads a `.txt` or `.md` meeting transcript in Discord and asks
  Prism to add it to the memory inbox.
- A contributor uploads an image and asks Prism to use it in an imagegen,
  Remotion, or workflow step.
- A workflow receives a request that points at an attached file and needs to
  create a durable request artifact before the agent can use it.
- A future Telegram chat sends a file that should follow the same handoff path.

## Passive Collection Behavior

Collection should store attachment metadata in collected message payloads:

- platform
- guild/server id when available
- channel/thread/chat id
- message id
- attachment id or platform file id
- filename
- content type
- size
- image dimensions when available
- original source URL when available, marked as non-durable
- timestamp

Collection should not download file bytes by default. This keeps storage,
privacy, and retention behavior predictable while still allowing later agents to
discover that an attachment exists.

## Explicit Handoff Flow

The first durable flow should be:

1. Operator asks Prism to use or ingest an attached file.
2. Site or Codex Runtime resolves the source message and attachment id from
   command context, thread context, or a provided message URL.
3. Communication adapter validates access policy and fetches the attachment
   from the source platform.
4. Site stores the file as a request artifact or writes it into the appropriate
   Prism Memory inbox path.
5. Codex Runtime may spool the file to its external media bucket only when the
   workflow needs a durable external URL for media tooling.
6. Prism records provenance linking the artifact or inbox item back to the
   source message and attachment.

For text and Markdown transcripts, the default explicit action should create a
memory inbox item when the user says to add it to memory. Otherwise it should
remain a request artifact.

For images and other media, the default explicit action should create a request
artifact or workflow input. It should not become Memory or Knowledge unless the
operator explicitly asks for that.

## Adapter Contract

Add an authenticated attachment capability to the communication adapter:

```http
GET /capabilities
```

should include:

```json
{
  "capabilities": ["list-destinations", "send-message", "fetch-attachment"]
}
```

Proposed fetch route:

```http
POST /attachments/fetch
```

Request:

```json
{
  "platform": "discord",
  "messageId": "123",
  "channelId": "456",
  "attachmentId": "789",
  "purpose": "request-artifact"
}
```

Response options:

- `mode: "bytes"` for small files returned directly by the adapter.
- `mode: "download-url"` for a short-lived internal URL that site/runtime can
  fetch.

The first implementation can choose one mode, but the response should include
metadata either way:

```json
{
  "ok": true,
  "platform": "discord",
  "attachment": {
    "id": "789",
    "messageId": "123",
    "channelId": "456",
    "filename": "fireside-host-script.md",
    "contentType": "text/markdown",
    "size": 4812,
    "sourceUrl": "https://cdn.discordapp.com/...",
    "sourceUrlDurable": false
  },
  "mode": "download-url",
  "downloadUrl": "http://communication-adapter.internal/attachments/download/..."
}
```

Adapter routes should use `COMMUNICATION_ADAPTER_TOKEN`, not the site service
token.

## Site Contract

The site should expose an agent/admin path that creates durable Prism-owned
records from a source attachment:

```http
POST /agent/source-attachments/ingest
```

Request:

```json
{
  "platform": "discord",
  "messageId": "123",
  "channelId": "456",
  "attachmentId": "789",
  "requestId": "optional-change-request-id",
  "lane": "request-artifact",
  "purpose": "workflow-input"
}
```

Possible lanes:

- `request-artifact`
- `memory-inbox`
- `knowledge-inbox`
- `workflow-input`

The site should:

- enforce request/admin/service auth,
- call the adapter fetch route,
- store the file using the artifact storage helper when creating request
  artifacts,
- call Prism Memory when writing memory or knowledge inbox entries,
- write provenance metadata,
- return artifact or inbox links.

## Codex Runtime Media Spooling

Codex Runtime can keep external S3-compatible media bucket access for workflows
that need public or shareable media URLs. The runtime should use that bucket
only after an explicit handoff has created or authorized the source attachment.

Expected runtime pattern:

1. Ask site to ingest or fetch the source attachment.
2. Receive a request artifact reference or short-lived internal download URL.
3. Upload to the configured external media bucket only if the active skill or
   workflow requires external media access.
4. Register the external media URL back as request artifact metadata.

This avoids moving bucket credentials into the adapter while preserving the
existing imagegen and Remotion workflows.

## Collection Policy

Add future source policy support for trusted auto-fetch rules:

```json
{
  "attachments": {
    "mode": "metadata",
    "maxBytes": 10485760,
    "allowedMimeTypes": [
      "text/plain",
      "text/markdown",
      "application/pdf",
      "image/png",
      "image/jpeg"
    ],
    "autoFetchMimeTypes": ["text/plain", "text/markdown"],
    "requireMentionOrCommand": true
  }
}
```

Suggested default:

- `mode: "metadata"`
- no video auto-fetch
- text/Markdown fetch only on explicit request
- images fetch only on explicit request
- optional trusted-channel override for transcript intake channels

## First Slice

- Store Discord attachment metadata during message collection.
- Add communication adapter attachment fetch support for Discord.
- Add a site agent route to ingest a fetched attachment as a request artifact.
- Preserve Discord provenance in artifact metadata.
- Update `change-request-ops` and `prism-workflow-author` skill guidance so
  agents know to use explicit attachment handoff instead of raw Discord CDN
  URLs.
- Add a small operator-facing Discord path for "use the attached file in this
  request" or "add the attached transcript to memory inbox" by making the
  Discord chat bridge give Codex explicit attachment handoff instructions.

## First Slice Progress

- Implemented `POST /attachments/fetch` on the communication adapter for
  Discord attachments.
- Implemented `POST /attachments/resolve` on the communication adapter for
  message-level attachment discovery.
- Implemented `POST /agent/source-attachments/ingest` on the site service for
  `request-artifact`, `workflow-input`, and `memory-inbox` lanes.
- Implemented `POST /agent/source-attachments/resolve-and-ingest` on the site
  service so agents can use Discord message URLs and intent labels directly.
- Implemented memory inbox promotion for fetched text-like attachments as
  `session_attachment` memory artifacts.
- Updated built-in request/workflow skills to prefer attachment handoff over
  raw Discord CDN URLs.
- Updated the Discord chat bridge runtime metadata so Codex knows to call the
  site resolver route for attachment summarize/use/promote requests. The adapter
  does not parse attachment intent itself.

Still pending:

- policy-driven auto-fetch rules.

## Deferred

- Telegram implementation.
- Auto-fetch policy enforcement.
- Direct upload to Prism-owned S3/R2 artifact storage.
- OCR or image description for memory indexing.
- Bulk attachment range selection.
- Attachment retention and deletion UI.
- Knowledge inbox attachment review UI.
- Video/audio attachment ingest beyond existing voice recording flows.

## Open Questions

- Should the first operator command be a new slash command, natural-language
  intent through `/prism-chat`, or both?
- Should text/Markdown files attached in configured meeting-transcript channels
  be auto-fetched into memory inbox, or should they still require an explicit
  mention?
- Should source attachment ingestion require full source access, or should it
  have a narrower capability such as `attachments.fetch`?
- Should request artifacts record both original source metadata and any external
  bucket URL produced by Codex Runtime, or should bucket URLs create separate
  linked artifacts?
