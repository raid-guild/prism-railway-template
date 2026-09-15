# Browser Media Capture And Ingest

Status: future feature spec

## Purpose

Prism currently has platform-specific recording and transcription paths, most
notably Discord voice recording and adapter-owned transcription/summary logic.
That works when the source platform is Discord and the adapter can preserve
speaker/channel metadata, but it does not generalize cleanly to Zoom, Google
Meet, Microsoft Teams, browser tabs, livestreams, uploaded media, or future
Portal session recordings.

Add a Prism-owned browser capture and media-ingest flow that can record
operator-selected browser media, store the recording as durable artifacts,
produce rolling transcript and summary artifacts, and hand those artifacts to a
hook that can create or link a request workflow.

## Core Idea

Create an operator-facing Capture surface in Prism Site:

```text
Admin opens Prism Site /capture
        |
        v
browser records tab/screen audio, mic, optional video
        |
        v
site stores chunks, metadata, and transcript artifacts
        |
        v
capture pipeline transcribes chunks and updates rolling summary artifacts
        |
        v
media-ingest hook creates/links request workflow with transcript artifacts
        |
        +-- Prism Memory
        +-- request artifacts
        +-- Portal session/resource publishing
        +-- Discord/Telegram delivery when approved
```

The browser recorder should be one capture source. The same media-ingest hook
contract should also handle Discord recorder output, uploaded audio/video files,
Telegram voice notes, or future meeting bot recordings.

## Non-Goals

- Do not replace the Discord recorder immediately. It still has better native
  Discord metadata when recording Discord voice.
- Do not make Portal own raw private meeting recordings in the first slice.
- Do not build a headless Zoom/Meet/Teams bot for the first slice.
- Do not move platform credentials or recording policy into the communication
  adapter.
- Do not auto-ingest raw transcripts into long-term memory without review unless
  the workspace policy explicitly allows it.

## UI Placement

Add a top-level Prism Site nav item:

```text
Requests | Prism Console | Capture | Tasks | Skills | Workflows | Hooks | Settings
```

Capture is an operator action surface, not a settings page. It should be
available when a meeting or browser session is happening, even before there is a
request to attach to.

The page should support two entry modes:

- standalone capture: record first, then create a media-ingest request
- attach to request: select an existing request and attach the recording

Initial page shape:

```text
Capture

Source
- tab/screen audio
- microphone
- optional screen video

Attach
- no request yet
- existing request selector

Metadata
- title
- source platform
- session date
- operator notes

[Start Capture]
```

After stopping:

```text
Capture finalized
- capture-manifest.json
- capture-metadata.json
- operator-notes.md
- rolling-transcript.json
- rolling-summary.md

[Trigger media-ingest hook]
[Attach/link request]
```

## Browser Capture Model

The first browser implementation should use native browser APIs:

- `navigator.mediaDevices.getDisplayMedia()` for operator-selected tab, window,
  or screen capture, including tab/system audio where the browser/OS allows it.
- `navigator.mediaDevices.getUserMedia()` for microphone capture.
- Web Audio API to mix tab/system audio and microphone audio when both are
  enabled.
- `MediaRecorder` to write chunks or a final `.webm` recording.

Browser capture requires an interactive user gesture and browser permission
picker. A Discord slash command cannot start it directly.

The browser flow should use chunked upload from the start. Browser chunks are for
capture reliability and upload safety; transcription chunks are provider-specific
and may be derived later.

Default capture settings:

```text
format preference: audio/webm;codecs=opus
fallbacks: audio/ogg;codecs=opus, audio/mp4, audio/webm, browser default
audioBitsPerSecond: 32000-64000
upload chunk length: 300 seconds
max recording length: 3600 seconds
```

At 32-64 kbps, a 5-minute WebM/Opus speech chunk should normally be far below a
25 MB transcription upload limit. Still, the server should treat byte size as
authoritative and rechunk/transcode when provider limits require it.

Use browser capability detection before constructing the recorder:

```ts
const candidates = [
  "audio/webm;codecs=opus",
  "audio/ogg;codecs=opus",
  "audio/mp4",
  "audio/webm",
];

const mimeType = candidates.find((type) => MediaRecorder.isTypeSupported(type));
```

Persist the selected MIME type, bit rate, chunk duration, and capture source
settings in `capture-metadata.json`.

## Slash Commands And Remote Triggers

Slash commands can orchestrate capture, but they cannot perform browser capture.

Example:

```text
/capture start title:"Weekly sync"
```

The command can:

- optionally create or identify a Prism request
- create a pending capture record
- reply with a private/admin link to `/capture?request=<id>`
- remind the admin that browser permission is required

The admin still opens Prism Site and starts recording manually.

## Live Rolling Recap

Because capture chunks are uploaded while a session is still active, Prism can
support a rolling recap mode for people who join late.

This is not strict live transcription. It is chunk-latency transcription and
summary:

```text
browser closes 5-minute audio chunk
        |
        v
site stores chunk
        |
        v
media-ingest transcribes closed chunk
        |
        v
rolling transcript and rolling summary update
        |
        v
operator or newcomer asks Prism for recap so far
```

For a one-hour meeting with 5-minute chunks, the recap is usually behind by one
chunk plus transcription time. If a workspace wants lower latency, expose a
"live recap" mode that uses shorter chunks, such as 60 seconds, at the cost of
more artifacts and transcription calls.

The recap response should include coverage:

```text
Recap so far:
- topics covered
- decisions made
- open questions
- action items

Coverage: 00:00-25:00 transcribed. Latest chunk is still processing.
```

Speaker labels in rolling recap should be conservative. Use diarized labels like
`Speaker 1` until the platform or an operator confirms real names.

## Default Summary Contract

Use the current Discord-native meeting synthesis prompt as the default summary
contract, but move ownership out of the source adapter. Browser capture and
Discord-native recording should hand transcript artifacts to the same synthesis
workflow shape.

Default synthesis behavior:

- act as a meeting synthesis assistant for Prism
- return valid JSON only, with no markdown fences or commentary
- summarize the transcript
- extract action items, notable quotes, and tags
- handle mixed transcript sources, including spoken segments and platform chat
  messages
- include meeting metadata in the prompt: title/name, source location, started
  time, ended time, participants, and operator notes when available
- cap direct transcript context to a bounded window, with long meetings handled
  by rolling or hierarchical summaries

Default JSON schema:

```json
{
  "title": "descriptive title",
  "tldr": "short summary",
  "summary": "detailed summary",
  "actionItems": [
    {
      "name": "string",
      "description": "string",
      "assignedTo": "string or null",
      "dueDate": "YYYY-MM-DD or null",
      "params": {}
    }
  ],
  "notableQuotes": [
    {
      "author": "string",
      "quote": "string",
      "paraphrase": "string"
    }
  ],
  "tags": ["tag-1", "tag-2", "tag-3"]
}
```

Default markdown rendering should stay stable across browser and Discord
recordings:

- heading from `title`
- session/source metadata
- TL;DR
- Summary
- Action Items
- Notable Quotes

This contract is intentionally generic. Instance-specific steering should live
in workflow config, hook payload fields, or workspace policy, not hard-coded in
the recorder.

## Headless Browser And Meeting Bots

A hosted headless browser is not the first-choice solution for Zoom, Meet, or
Teams recording. It usually requires platform login, meeting access, audio device
plumbing, waiting-room handling, browser permission workarounds, and
platform-specific reliability work.

If hands-off meeting capture becomes important, treat it as a separate meeting
bot integration:

```text
Prism meeting bot joins meeting
records media
uploads artifact
triggers media-ingest workflow
```

That should be evaluated per platform after browser capture and the shared
media-ingest contract are stable.

## Responsibility Split

### Prism Site

Owns:

- `/capture` UI
- capture session records
- upload endpoints
- request artifact creation
- hook/workflow kickoff
- review and operator controls
- settings for enablement, limits, and workflow keys

### Communication Adapter / Source Adapter

Owns:

- platform-specific event and message transport
- fetching attachments or voice output when explicitly requested
- sending approved messages back to Discord, Telegram, or email
- backward-compatible legacy recorder integration during migration

Adapters should not own transcript meaning, summary prompts, memory routing, or
public/private publication policy.

### Prism Workflows

Own:

- transcription
- optional diarization
- speaker-label reconciliation
- summary generation
- public/private safety review
- memory ingest decisions
- Portal publish handoff
- output delivery requests

### Prism Memory

Owns durable memory and knowledge outputs after review:

- transcript artifacts when approved
- summaries
- session notes
- extracted topics, decisions, follow-ups, and links

### Portal

Portal should consume approved outputs, not own raw capture in the first slice:

- public session pages
- event resources
- edited recap pages
- transcript excerpts
- approved audio/video embeds

Portal can later include a "Record session" button that deep-links into Prism
Capture or calls Prism capture APIs behind the scenes.

## Capture Pipeline And Media-Ingest Hook

Transcription and first-pass summary generation happen as part of the capture
pipeline, not inside the built-in request workflow. Hook ingestion
deterministically prepares the standard request artifacts after useful summary
and transcript references already exist.

Create a reusable hook, `recording-transcript-completed`, that accepts compact
recording summary payloads and creates or links a request workflow. The default
workflow is `recording-transcript-review-publish`.

Inputs:

- capture id
- capture manifest id
- capture metadata
- source platform and source ids when available
- transcript artifact ids
- rolling/final summary artifact id
- summary Memory artifact URL
- optional existing request id
- operator notes
- memory/Portal/publishing intent

Artifacts:

- `capture-manifest.json`
- transcript-ready capture chunk refs such as `chunks/chunk-0001.webm`
- optional assembled `recording.webm` when retention policy allows it
- `capture-metadata.json`
- `operator-notes.md`
- `transcripts/chunk-0001.json`
- `rolling-transcript.json`
- `rolling-summary.md`
- `transcript.json`
- `transcript.md`
- `diarization.json` when available
- `speaker-map.json` when operator reconciles labels
- `summary.md`
- `summary.json`
- summary Memory artifact URL
- `memory-ingest-plan.json` only when automatic summary promotion is unavailable
- optional `portal-publish-plan.json`

Flow:

```text
capture-start
  -> capture-chunk-upload
  -> transcribe closed chunks
  -> update rolling transcript
  -> update rolling summary
  -> capture-finalize
  -> generate final summary from editable recording-summary-profile
  -> promote summary to Prism Memory
  -> trigger recording-transcript-completed hook
  -> request review workflow
  -> portal-publish / delivery / follow-up workflow
```

The capture pipeline should promote the meeting summary to Prism Memory by
default and keep raw transcript text private. The workflow should decide whether
raw transcript, cleaned transcript, Portal publication, outbound delivery, or
follow-up actions are appropriate.

### Hook Payloads

Capture should trigger hooks rather than hard-wire transcription into the upload
route. Chunk uploads may trigger internal capture-pipeline work for rolling
transcription, while finalization should trigger the external media-ingest hook.

On chunk upload:

```json
{
  "event": "capture.chunk_uploaded",
  "captureId": "...",
  "requestId": "...",
  "chunkIndex": 4,
  "artifactId": "...",
  "durationSeconds": 300,
  "mimeType": "audio/webm;codecs=opus",
  "liveRecap": true
}
```

On finalize:

```json
{
  "event": "capture.finalized",
  "source": "browser-capture",
  "captureId": "...",
  "requestId": "...",
  "manifestArtifactId": "...",
  "durationSeconds": 3600,
  "audioOnly": true,
  "memoryIngest": "review"
}
```

The hook should create a request when one is not already linked, or attach the
capture transcript artifacts to an existing request when `requestId` is provided.
For v1, memory ingest should remain review-gated and never automatic.

### Capture Session Files Versus Request Artifacts

For v1, raw browser chunks should be capture-session files first, not always
first-class request artifacts. Rolling transcription needs the chunks to be
visible to the media-ingest worker as each chunk closes, but operators do not
need every raw media chunk cluttering the request artifact list.

Recommended default:

- store raw chunks under a capture session storage area
- create request artifacts for `capture-manifest.json`, `capture-metadata.json`,
  `operator-notes.md`, transcripts, summaries, and review outputs
- include chunk refs in `capture-manifest.json`
- optionally promote raw chunks or an assembled recording to artifacts only when
  retention policy, debugging, or an operator request requires it

## Transcription Provider Constraints

The first transcription target is expected to be hosted Whisper-compatible
transcription, likely Venice AI if that remains the configured provider. Venice
AI explicitly accepts WebM, so browser WebM/Opus chunks can be sent directly when
they are under the upload limit.

Known planning constraints:

- max single upload: 25 MB
- rate limit: 60 requests per minute
- accepted format includes WebM

The transcription worker should:

1. read `capture-manifest.json`
2. inspect chunk MIME type and byte size
3. send WebM/Opus chunks directly when they are under 25 MB
4. use `ffmpeg` only when a chunk must be split, normalized, or converted for a
   non-Venice provider
5. enforce `< 25 MB` per upload after transcoding
6. process sequentially or with low concurrency
7. stitch transcript segments with offsets
8. update rolling transcript and rolling summary artifacts while the capture is
   active

With 5-minute capture chunks and speech bitrates around 32-64 kbps, most chunks
should be small enough without additional splitting. The worker should still
split by byte size if a chunk exceeds the provider limit.

## Speaker Metadata

Browser capture will usually not preserve reliable speaker identity. The first
slice should handle this explicitly:

- store source metadata when available
- run diarization when configured
- label speakers as `Speaker 1`, `Speaker 2`, etc. by default
- allow operator reconciliation after transcription
- do not claim named speakers unless the source provided identity or an operator
  confirmed the mapping

Discord-native recording can continue to preserve richer Discord session
metadata when available.

## Settings

Start with env-backed settings:

```text
PRISM_CAPTURE_ENABLED=true
PRISM_CAPTURE_MAX_BYTES=...
PRISM_CAPTURE_MAX_DURATION_SECONDS=...
PRISM_CAPTURE_UPLOAD_CHUNK_SECONDS=300
PRISM_CAPTURE_AUDIO_BITS_PER_SECOND=64000
PRISM_CAPTURE_HOOK_KEY=recording-transcript-completed
PRISM_CAPTURE_ALLOWED_MODES=tab-audio,mic,screen-video
PRISM_CAPTURE_DEFAULT_MEMORY_MODE=review
PRISM_CAPTURE_LIVE_RECAP_ENABLED=true
PRISM_CAPTURE_RAW_RETENTION=until-transcript
PRISM_TRANSCRIBE_MAX_UPLOAD_BYTES=25000000
PRISM_TRANSCRIBE_TARGET_FORMAT=webm
```

Later add a Settings UI panel for:

- enable/disable browser capture
- max upload size and max duration
- upload chunk length and low-latency recap mode
- default media-ingest hook key
- default artifact retention policy
- allowed capture modes
- transcription provider defaults
- transcription max upload bytes and target format
- diarization enabled/disabled
- memory ingest behavior: never, review first, auto-ingest summaries
- raw media retention: until transcript, configurable days, keep, or manual
- consent/disclaimer text shown before recording, deferred for v1
- optional Portal publish defaults

## Consent And Safety

The Capture UI should make recording state obvious:

- visible recording timer
- clear source labels
- explicit stop button
- artifact visibility and retention note

For public or community-facing outputs, route through the existing public-output
safety and publishing workflows before sending or publishing.

Consent/disclaimer copy is important, but it is deferred for the v1 validation
slice.

## Retention

Default raw media retention should be temporary. Once transcript artifacts and
summary artifacts exist and pass review, Prism should be allowed to delete raw
capture chunks unless the workspace or operator explicitly chooses to keep them.

Recommended default:

```text
raw media: keep until transcript is produced and reviewed
transcripts/summaries/metadata: durable request artifacts
memory ingest: review-gated
```

This keeps the valuable text artifacts durable while reducing long-term storage
and privacy risk from raw meeting audio.

## First Slice

1. Add `/capture` page behind admin session.
2. Record tab/screen audio plus microphone with native browser APIs.
3. Upload 5-minute WebM/Opus chunks to Site.
4. Transcribe closed chunks directly with Venice WebM upload.
5. Save/update `capture-manifest.json`, `capture-metadata.json`,
   `rolling-transcript.json`, `rolling-summary.md`, and
   `operator-notes.md`.
6. Expose a "recap so far" view that reads rolling transcript and summary
   artifacts.
7. Trigger `recording-transcript-completed` on finalize with compact summary,
   summary Memory URL, and private transcript references.
8. The hook creates or links a request workflow for review and downstream
   routing.
9. Review before Portal publication or raw transcript sharing.

## Migration From Adapter-Owned Transcription

Keep existing adapter-owned transcription/summary behavior during migration.
Mark it as legacy once `recording-transcript-completed` and the shared recording
workflow can process the same transcript artifacts.

Target migration:

1. Adapter captures or fetches audio bytes.
2. Adapter hands bytes or source URL to Site.
3. Site stores capture/session files and kicks off the same capture pipeline or
   `recording-transcript-completed` hook.
4. Capture pipeline produces transcript/summary artifacts and a summary Memory
   artifact URL.
5. Adapter only delivers approved outputs back to source platforms.

This creates one shared pattern for Discord recorder output, browser captures,
uploaded files, Telegram voice notes, and future Portal session recordings.

## Current Decisions

- Browser capture should default to WebM/Opus.
- Venice AI accepts WebM, so direct upload should be the default when chunks are
  under 25 MB.
- Raw chunks should be capture-session files by default, with durable request
  artifacts for manifests, transcripts, summaries, notes, and review outputs.
- Rolling transcription needs closed chunks to be visible to the media-ingest
  worker as they arrive. This is useful enough for v1 validation.
- Raw media retention should be temporary by default: keep raw chunks until
  transcript/review unless configured otherwise.
- Summary Memory ingest should happen automatically by default; raw transcript
  Memory ingest remains disabled unless explicitly allowed.
- Request linkage should happen through `recording-transcript-completed`.
  Capture can run first, then the hook creates or links the request with
  transcript artifacts.
- Default summary generation should reuse the existing Discord-native synthesis
  schema: title, TL;DR, summary, action items, notable quotes, and tags.
- Recorder services should not own hard-coded recap steering. They should load
  the editable `recording-summary-profile` skill/config and layer optional
  operator notes on top before generating the first-pass recap.
- Hook payloads should omit full transcript bodies by default once a summary
  exists. They should pass summary content, the summary Memory artifact URL,
  private transcript references, source metadata, and policy flags instead.
- Browser capture dispatch can include transcript bodies for debugging or
  fallback workflows with `CAPTURE_DISPATCH_INCLUDE_TRANSCRIPT_BODY=true`, but
  this should not be the default for normal post-meeting hooks.
- The built-in hook key is `recording-transcript-completed`.
- The built-in workflow key is `recording-transcript-review-publish`.
- The built-in workflow has no agent synthesis step or operator gate. Hook
  ingestion reuses precomputed summaries and Memory artifact URLs, creates the
  standard artifacts, and closes the generic request.
- Instances may set
  `constraints.recordingWorkflow.downstreamWorkflowKey` on the hook request
  template. The built-in processor then idempotently creates a child request,
  copies the standard artifacts, and optionally auto-starts that instance-owned
  workflow. Portal, outbound delivery, recurrence, and other workspace policy
  remain in the child workflow.
- Consent/disclaimer copy is deferred for v1.

## Open Questions

- Which service should run `ffmpeg`: site, task-runner, codex-runtime, or a
  future media worker? The existing comms/source adapter already uses ffmpeg for
  native Discord recording, which is useful precedent, but the shared
  media-ingest path may eventually deserve a media worker.
- How should rolling summaries be compacted for long meetings: full transcript
  in context, chunk summaries with a rolling global summary, or a hierarchical
  summary tree?
