# Recording Transcript Review Publish

This workflow handles completed recording transcripts from browser capture,
Discord-native recording, uploaded media, or future source adapters.

The default flow is deterministic and runs as part of hook ingestion:

- read the recording hook payload
- use the precomputed meeting summary and Memory artifact URL when present
- require the recording source to provide a completed summary; do not invoke an
  agent to summarize a raw transcript in this workflow
- promote the meeting summary to Prism Memory when the Memory write path is
  configured and the payload has not already done so
- prepare the standard summary, transcript-reference, Memory-result, and
  downstream-plan artifacts
- optionally create and auto-start one instance-owned downstream workflow
  request
- close without an operator gate

The recorder service owns capture and transcription. This workflow owns meeting
meaning, summary shape, and downstream publishing. Do not publish raw private
transcripts directly unless the payload or workspace policy explicitly says that
automatic publication is allowed.

## Downstream Handoff Contract

This template workflow should not know about workspace-specific publishing
systems. Its job is to create durable recording artifacts and a generic
downstream handoff that instance-specific workflows, skills, hooks, or adapters
can consume.

When the payload includes external session/resource hints, scheduled event
metadata, source links, or workspace policy flags, create a
`downstream-publish-plan.json` artifact with:

- candidate external session/resource identifiers and URLs from the payload
- matching evidence from source event metadata, channel, title, and time window
- summary/transcript artifacts recommended for downstream publication
- shareable summary URLs from Prism Memory when Memory promotion succeeds
- whether raw transcript sharing is allowed or should stay private
- whether a follow-up instance workflow or hook should be triggered

Request artifacts are private workflow evidence. Do not put service-token-only
request artifact content URLs or internal Railway URLs into Portal resources,
Discord announcements, email, or other user-facing output. Use the shareable
Prism Memory artifact URL for the meeting summary. Keep raw transcript links
private unless the payload or workspace policy explicitly allows transcript
sharing and a shareable transcript artifact exists.

If an instance has a custom post-recording workflow for publishing, recurrence,
or agenda behavior, keep that behavior there or in an instance custom skill.
Configure the built-in hook request template with:

```json
{
  "constraints": {
    "recordingWorkflow": {
      "downstreamWorkflowKey": "instance-post-recording-publish",
      "autoStartDownstream": true
    }
  }
}
```

The built-in request copies its deterministic artifacts into one idempotently
created child request. The child owns all instance-specific external writes.
When no downstream workflow is configured, the built-in request simply records
the generic artifacts and closes.

## Memory Contract

Promote `meeting-summary.md` to Prism Memory by default with source provenance,
participants, timestamps, tags, action items, and links back to request artifacts.
Do not promote the raw transcript by default. If Memory credentials are missing
or the write fails, save `memory-ingest-plan.json` or `memory-ingest-error.json`
so the request still contains the proposed Memory record.

When Memory promotion succeeds, save both the Memory inbox path and the
shareable Memory artifact URL in `memory-ingest-result.json`. Downstream steps
should use that URL as the public summary link.

## Default Summary Contract

Use the Prism recording summary schema:

- `title`
- `tldr`
- `summary`
- `actionItems`
- `notableQuotes`
- `tags`

The hook payload must include `summary.markdown` or a usable `summary.json`.
Browser capture and source adapters should generate this first-pass summary
before triggering the hook. If it is absent, deterministic processing writes a
blocked artifact, keeps the transcript private, and does not create a child
request.
