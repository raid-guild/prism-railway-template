# Compatibility-only legacy agent step

This file remains available for instance-customized workflows created before the deterministic recording handoff migration. The built-in workflow no longer references or runs this step. New and migrated instances must use deterministic hook processing and should not add this agent step back to the built-in manifest.

# Synthesize

Read the request context and the `hook-payload.json` artifact. The payload should
contain a completed recording summary or transcript references from browser
capture, Discord-native recording, uploaded media, or another source adapter.

Use the summary, transcript references, and metadata to create durable request
artifacts. Prefer source facts from the payload over assumptions. If the payload
already includes `summary.markdown`, `summary.json`, `summary.artifactUrl`, or
`summary.memoryPath`, reuse those fields instead of re-summarizing the full
transcript.

## Required Outputs

Create `meeting-summary.md` with kind `meeting-summary`.

If `hook-payload.json` already includes summary markdown, use that as the
starting content and only adjust it when source evidence clearly requires it.
If the payload includes only a compact TL;DR and a shareable summary URL, create
a lightweight artifact that records the TL;DR, URL, source metadata, and the
fact that full transcript text was omitted from the hook payload.

Use this structure:

- title
- source/session metadata
- TL;DR
- summary
- decisions
- action items
- open questions
- notable quotes
- source artifacts and links

Create `meeting-summary.json` with kind `meeting-summary-json`.

Use this schema:

```json
{
  "title": "descriptive title",
  "tldr": "short summary",
  "summary": "detailed summary",
  "decisions": ["decision"],
  "actionItems": [
    {
      "name": "string",
      "description": "string",
      "assignedTo": "string or null",
      "dueDate": "YYYY-MM-DD or null",
      "params": {}
    }
  ],
  "openQuestions": ["question"],
  "notableQuotes": [
    {
      "author": "string",
      "quote": "string",
      "paraphrase": "string"
    }
  ],
  "tags": ["tag-1", "tag-2", "tag-3"],
  "source": {
    "kind": "browser-capture or discord-native or other",
    "sessionId": "string or null",
    "startedAt": "ISO timestamp or null",
    "endedAt": "ISO timestamp or null"
  }
}
```

Promote the summary to Prism Memory by default when the Memory write path is
configured. Promote `meeting-summary.md`, not the raw transcript.

Use this Memory payload shape:

```json
{
  "source": "recording-transcript-workflow",
  "type": "meeting_summary",
  "bucket_hint": "meetings",
  "content": "meeting-summary.md body",
  "author": "Prism Recording Workflow",
  "ts": "recording ended timestamp or current timestamp",
  "metadata": {
    "source_system": "browser-capture or discord-native or other",
    "source_type": "meeting_summary",
    "source_id": "recording/session id",
    "request_id": "current request id if available",
    "discord": "discord metadata if present",
    "portal_session": "portal target/result if present",
    "action_items": [],
    "tags": [],
    "visibility": "internal"
  }
}
```

Save `memory-ingest-result.json` with kind `memory-ingest-result` when the write
succeeds. Include the Memory path and a shareable Memory artifact URL.

If the Memory write response only returns a path like
`inbox/memory/incoming/20260709_160214Z-recording-transcript-workflow-9020a433.json`,
derive the shareable URL from the final filename without `.json`:

```json
{
  "ok": true,
  "memoryPath": "inbox/memory/incoming/20260709_160214Z-recording-transcript-workflow-9020a433.json",
  "memoryArtifactUrl": "https://<prism-memory-public-base>/artifacts/20260709_160214Z-recording-transcript-workflow-9020a433",
  "summaryArtifact": {
    "id": "request-artifact-id",
    "name": "meeting-summary.md",
    "shareableUrl": "https://<prism-memory-public-base>/artifacts/20260709_160214Z-recording-transcript-workflow-9020a433"
  },
  "rawTranscriptIngestSkipped": true
}
```

Prefer `PRISM_ARTIFACT_PUBLIC_BASE_URL` or `PRISM_MEMORY_PUBLIC_BASE_URL` for
the base URL when available; otherwise use `PRISM_MEMORY_BASE_URL`. Do not use
`PRISM_AGENT_API_BASE_URL`, `APP_API_BASE_URL`, `site.railway.internal`, or
`/agent/change-board/.../artifacts/.../content` URLs as shareable links.

If Memory credentials or routes are unavailable, create `memory-ingest-plan.json`
with kind `memory-ingest-plan` and include:

- the exact summary artifact that should be promoted
- the proposed Memory payload
- the reason it was not written
- that raw transcript ingest is intentionally skipped by default

Create `downstream-publish-plan.json` with kind `downstream-publish-plan`.

This template workflow should not call workspace-specific publishing systems.
Instead, produce a generic handoff plan that an instance custom workflow, custom
skill, or secondary hook can consume.

Include:

- whether downstream publishing is recommended
- candidate external session/resource ids and URLs from the payload
- matching evidence from source event metadata, channel, title, and time window
- whether a follow-up instance workflow or hook should run
- which summary/transcript artifacts should be shared
- shareable summary links, preferring `memoryArtifactUrl` from
  `memory-ingest-result.json`
- what should remain private
- whether raw transcript sharing is explicitly allowed
- any source metadata that would help an instance-specific workflow reconcile
  duplicates

In the handoff plan, keep private request artifact API URLs separate from
shareable links. Downstream Portal, Discord, Telegram, or email notifications
should use the Memory artifact URL for the summary. Raw transcripts stay private
unless policy explicitly allows sharing and a shareable transcript artifact has
been created.

For Discord-native recordings, inspect `discord.scheduledEventID`,
`discord.scheduledEvent`, `discord.channelID`, `discord.channelName`,
`recording.startedAt`, and `recording.endedAt` and include those fields in the
handoff plan. Do not assume a workspace-specific API, session model, recurrence
model, or agenda creation capability exists in the template.

## Rules

- Do not invent attendees, owners, decisions, links, or quotes.
- Browser capture usually has weak speaker identity. Use `Speaker 1`, `Speaker 2`,
  or `Unknown` unless the payload gives confirmed names.
- If a summary is already present in the payload, treat it as a draft. Correct it
  only with transcript evidence.
- Do not promote the raw transcript to Prism Memory by default.
- Do not send Discord, Telegram, or email notifications directly unless the
  payload or workspace policy explicitly enables delivery.
- Do not publish internal service URLs such as `site.railway.internal` or
  service-token-only `/agent/*` artifact URLs to Portal, Discord, Telegram,
  email, or other user-facing systems.
- Workspace-specific publishing behavior belongs in instance custom workflows,
  skills, hooks, or adapters, not in this template workflow.
- If the transcript is missing, empty, or unsafe to summarize, create
  `recording-synthesis-blocked.md` explaining the blocker and finish with a clear
  blocked summary.
- Otherwise finish with a concise summary of the artifacts created and the
  recommended next action.

