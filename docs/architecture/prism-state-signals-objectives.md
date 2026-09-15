# Prism State: Signals, Objectives, And Throughlines

Status: draft

This spec captures the proposed direction for Prism Memory state after the first
`state/projects` experiment. The current project state builder is useful as a
proof of concept, but it couples identity to Discord buckets and channel naming.
That does not fit Prism's more generic source adapter model, Portal integration,
or future knowledge graph views.

Related spec:

- [External System Memory Handoff](./external-system-memory-handoff.md)

## Goals

- make Prism state source-agnostic across Discord, Portal, console, tasks,
  hooks, meetings, requests, and future adapters
- preserve deterministic behavior when Codex Runtime is unavailable
- let Codex Runtime enrich state with labels, summaries, decisions, and action
  items without making model output the only source of truth
- provide better inputs for rolling memory, Memory Explorer, knowledge graph
  views, and Portal enrichment
- avoid daily human curation as a required operating model

## Non-Goals

- do not make Portal a second Prism Memory database
- do not require operators to curate active projects every day
- do not make Discord channels or threads the canonical identity for work
- do not require Codex Runtime for the core state builder to succeed
- do not add a heavy evaluation process before the data model is proven

## Current State

Prism Memory currently has a generated state layer:

```text
state/
  current/
    projects.json
  latest.json
```

`ProjectStateBuilder` reads raw bucket records and derives project records from:

- bucket and channel name prefix rules from `space.json`
- existing project aliases and tags
- cross-channel alias mentions
- recent activity windows

This works for communities where projects map cleanly to Discord channels, such
as `raid-*` channels. It breaks down when work moves through requests, Portal
sessions, task runs, hooks, console conversations, meetings, or generic source
adapter records.

The proposed direction keeps `state/` as the generated state layer, but changes
the domain from channel-derived projects to source-agnostic signals,
objectives, and throughlines.

## Concepts

### Signal

A signal is a single extracted fact or event from a source record. Signals are
small, explainable, and evidence-backed.

Examples:

- a message mentions request `#26`
- a Portal contribution request changed status
- a Codex task run failed
- a meeting summary produced an action item
- a PR URL appeared in a Discord thread
- a knowledge document was added or updated

Signal identity should be deterministic where possible.

Example:

```json
{
  "signal_id": "sig_request_26_2026-06-02T18-20-00Z",
  "kind": "change_request_ref",
  "anchor": "request:26",
  "source": "discord",
  "source_record_id": "discord:1374448934436733089:1234567890",
  "occurred_at": "2026-06-02T18:20:00Z",
  "confidence_score": 1,
  "confidence_reasons": ["explicit request number reference"],
  "evidence": {
    "url": "https://discord.com/channels/...",
    "text": "Can we move request #26 beyond the approval gate?"
  }
}
```

### Objective

An objective is a durable cluster of work people are trying to get done.
Objectives are built from signals and stable anchors.

Examples:

- `runtime-reliability`
- `discord-approval-flow`
- `portal-prism-integration`
- `memory-explorer-usefulness`

Objectives answer: what are we trying to accomplish?

Example:

```json
{
  "objective_key": "runtime-reliability",
  "title": "Runtime reliability",
  "status": "active",
  "anchors": ["pr:20", "topic:codex-runtime", "request:runtime-response-jobs"],
  "signal_ids": ["sig_1", "sig_2", "sig_3"],
  "activity_score": 0.88,
  "attention_score": 0.72,
  "confidence_score": 0.94,
  "score_reasons": [
    "3 signals in the last 24 hours",
    "recent failed runtime response path",
    "explicit PR reference"
  ],
  "summary": "Long-running Codex Runtime requests are being moved to durable response jobs with progress feedback.",
  "last_signal_at": "2026-06-02T18:20:00Z",
  "last_enriched_at": "2026-06-02T18:25:00Z",
  "enrichment_status": "fresh"
}
```

### Throughline

A throughline is a longer-running narrative that connects objectives, sessions,
requests, artifacts, and decisions over time.

Portal has a similar concept called threads. Prism should avoid using `thread`
for this layer because Discord and chat systems already use that term. The
Prism-side name should be `throughline`.

Throughlines answer: what ongoing story connects this work?

Example:

```json
{
  "throughline_key": "source-agnostic-coordination",
  "title": "Source-agnostic coordination",
  "summary": "Prism is moving coordination away from Discord-specific assumptions toward source-agnostic memory, requests, sessions, and Portal surfaces.",
  "status": "active",
  "objective_keys": [
    "runtime-reliability",
    "discord-approval-flow",
    "portal-prism-integration"
  ],
  "last_signal_at": "2026-06-02T18:20:00Z"
}
```

## Proposed State Layout

```text
state/
  current/
    signals.json
    objectives.json
    throughlines.json
    activity_graph.json
    projects.json
  latest.json
```

`projects.json` remains during migration for compatibility, but new consumers
should prefer objectives.

`state/latest.json` should remain the summary entry point. It can report each
state domain:

```json
{
  "generated_at": "2026-06-02T18:30:00Z",
  "domains": {
    "signals": {
      "source_path": "state/current/signals.json",
      "summary": "42 signals extracted from 8 sources."
    },
    "objectives": {
      "source_path": "state/current/objectives.json",
      "summary": "5 active, 3 watching, 12 inactive."
    },
    "throughlines": {
      "source_path": "state/current/throughlines.json",
      "summary": "3 active throughlines."
    }
  }
}
```

## `space.json` Role

`space.json` should hold policy and defaults, not living objective state.

Good `space.json` responsibilities:

- enable or disable the state domains
- configure activity windows
- configure deterministic extraction rules
- configure source-specific hints such as Discord bucket defaults
- configure optional Codex enrichment policy
- configure allowed tags or objective key namespaces when a space wants them

Bad `space.json` responsibilities:

- storing the current list of active objectives
- storing daily status
- storing model-generated summaries
- storing source records or evidence
- making Discord channel ids the canonical identity for work

Example direction:

```json
{
  "state": {
    "objectives": {
      "enabled": true,
      "activity_windows": {
        "active_days": 7,
        "watching_days": 30
      },
      "signals": {
        "request_refs": true,
        "artifact_refs": true,
        "task_refs": true,
        "workflow_refs": true,
        "pr_refs": true,
        "url_refs": true,
        "explicit_objective_keys": true
      },
      "enrichment": {
        "enabled": false,
        "changed_only": true
      }
    }
  }
}
```

## Pipeline Placement

The state work should happen after collection and before rolling memory.

```text
collect
  -> extract signals
  -> build objectives
  -> enrich changed objectives
  -> build throughlines
  -> digest
  -> rolling memory
  -> seeds
  -> backup
```

Collection should stay boring: ingest source records, normalize them, and write
raw bucket records. Signal extraction and objective building should be separate
pipeline stages.

## Deterministic Signal Extraction

The first signal pass should be deterministic. It should extract known anchors
from raw records and metadata:

- change request ids and numbers
- artifact ids
- task keys and task run ids
- workflow keys
- hook keys
- PR and issue URLs
- repository paths and commit refs
- knowledge document slugs
- meeting session ids
- meeting summary action items
- Portal source ids
- Discord channel/thread/message ids
- explicit tags
- explicit objective keys

The extractor should prefer structured metadata over text parsing. Text parsing
is still useful for references like `request #26`, PR URLs, artifact links, and
the `## Action Items` section of older meeting summaries.

## Objective Building

Objectives should be built from deterministic anchors and signal history.

Objective keys are emergent in the first implementation. There is no central
registry of allowed objective keys. A key may come from an explicit source hint,
such as `metadata.objective_keys`, or from a deterministic anchor such as a
request number, PR reference, task key, external ref, or knowledge doc slug.

This means early objective keys may be literal, such as `request-26`. That is
acceptable for the first slice because it keeps identity deterministic and
avoids requiring daily curation. Not every anchor should become an objective:
bare PR references, URLs, doc-level knowledge anchors, and meeting action items
are evidence signals unless an explicit objective key or existing objective
match connects them to work. A later slice may add objective metadata upserts,
aliases, merge suggestions, or Portal-owned throughline links to make emergent
objectives more human-readable without moving living state into `space.json`.

Throughlines are also emergent, but they have a direct curation layer. Agents and
operators can influence initial grouping by sending explicit `throughline_keys`
in source metadata. Optional objective enrichment can also suggest
`suggested_throughline_keys`; those suggestions should create throughline
records and attach the enriched objective and its signals. After generation, an
ops-authenticated curation API can edit titles, summaries, kind, aliases,
owners, tags, objective membership, pinned/archive status, and hidden/deleted
state. It can also merge duplicate throughlines. These curation edits are stored
outside generated state and reapplied during later ingestion and backfill runs.

Throughline lifecycle should be deterministic. A throughline is `active` when it
has an active attached objective or recent signal, `watching` when its latest
signal/objective is still inside the watching window, and `inactive` when it has
aged out. `archived` should remain an explicit operator state, not an automatic
decay outcome in the first implementation.

High-confidence objective membership:

- explicit `objective_keys` metadata
- explicit request/artifact/task/workflow reference already associated with an
  objective
- same source session or meeting summary explicitly attached to an objective
- same Portal contribution request linked to an objective

Medium-confidence membership:

- explicit tag match
- repeated references to the same named topic near known anchors
- source thread or channel already dominated by one objective

Low-confidence membership:

- semantic topic similarity
- Codex-suggested merge without deterministic evidence

Low-confidence membership should be recorded as a suggestion, not silently
merged into canonical state.

## Scoring

Scoring should be simple and explainable.

Recommended scores:

- `activity_score`: freshness and recent volume
- `confidence_score`: confidence that signals belong to the objective
- `attention_score`: whether the objective needs human or agent attention

Example score reasons:

- `3 signals in the last 24 hours`
- `explicit request #26 reference`
- `pending approval gate`
- `failed task run`
- `new meeting action item`
- `stale for 14 days`

Avoid opaque model-only scores. If a score exists, it should include reasons.

## Codex Runtime Enrichment

Codex Runtime enrichment is optional but important for usefulness. The first
implementation reuses the existing `agentic_ingest` provider and env toggle. If
`AGENTIC_INGEST_ENABLED=true` and the configured provider is reachable, changed
objectives can be enriched after deterministic objective building. The provider
client should support OpenAI-compatible `/v1/chat/completions` endpoints and
fall back to Codex Runtime `/v1/responses/jobs` when chat completions is not
available. If the toggle is off or the provider is unavailable, deterministic
state still writes normally.

The rule is:

```text
Codex can decide labels and narrative. Deterministic signals decide identity.
```

Codex enrichment may produce:

- title
- summary
- action items
- decisions
- notable quotes
- open questions
- related objective suggestions
- throughline suggestions
- status explanation

Codex enrichment should not be required for:

- extracting anchors
- creating signal records
- keeping objective activity windows current
- writing `state/latest.json`

Enrichment should run only for changed objectives:

```json
{
  "objective_key": "runtime-reliability",
  "last_signal_at": "2026-06-02T18:20:00Z",
  "last_enriched_at": "2026-06-01T18:20:00Z",
  "enrichment_status": "stale"
}
```

If `last_signal_at > last_enriched_at`, enqueue enrichment. If Codex Runtime is
unavailable, mark enrichment as failed or stale and continue with deterministic
state.

Meeting summaries are a useful precedent. The source adapter already takes a
bounded transcript and produces structured summary output. Objective enrichment
should use similarly bounded inputs:

- recent signals for one objective
- existing objective state
- meeting summaries and artifacts, not full raw transcripts when summaries exist
- previous enrichment output

## Portal Boundary

Portal should work with Prism without becoming tightly coupled to Prism Memory.

Prism owns:

- raw source records
- signals
- objective state
- throughline state
- rolling memory
- knowledge docs
- evidence links

Portal owns:

- sessions/events
- contribution requests
- profiles and roles
- modules
- notifications
- CMS presentation
- human coordination surfaces

Portal should write to Prism through the memory inbox, not by directly mutating
objective state.

Example Portal inbox record:

```json
{
  "source": "portal",
  "type": "contribution_request.created",
  "ts": "2026-06-02T18:20:00Z",
  "bucket_hint": "coordination",
  "author": "alice",
  "url": "https://portal.example.com/contribution-requests/abc123",
  "participants": ["alice", "bob"],
  "content": "Contribution request opened: Improve Discord approval flow.",
  "metadata": {
    "source_system": "portal",
    "source_type": "contribution_request",
    "source_id": "abc123",
    "status": "triage",
    "tags": ["workflow", "discord", "approval"],
    "objective_keys": ["discord-approval-flow"]
  }
}
```

Portal may provide hints:

- `objective_keys`
- `tags`
- `source_type`
- `source_id`
- `status`
- `participants`
- `related_request_number`

Prism should turn those hints into signals and objective state.

## Portal Maintainer Skill

The larger integration goal is an agent that uses Prism Memory to maintain and
enrich Portal through a Portal skill.

The Portal skill should:

- read Prism Memory latest state, objectives, throughlines, knowledge docs, and
  artifacts
- read Portal sessions, contribution requests, modules, profiles, and
  notifications
- update Portal with Prism-derived context, links, and summaries
- create follow-up Portal contribution requests from meeting action items when
  explicitly appropriate
- leave audit notes or artifacts for meaningful changes

The skill should update Portal from Prism. It should not make Portal a parallel
memory database.

Lightweight Portal fields are enough for the first integration:

```json
{
  "prism": {
    "objectiveKeys": ["runtime-reliability"],
    "throughlineKeys": ["source-agnostic-coordination"],
    "artifactIds": ["knowledge-doc--runtime~long-running-jobs"],
    "knowledgeSlugs": ["runtime/long-running-jobs"],
    "lastEnrichedAt": "2026-06-02T18:25:00Z",
    "summary": "Short Prism-derived context."
  }
}
```

## Memory Explorer And Knowledge Graph

Signals, objectives, and throughlines should give Memory Explorer better
visualization primitives.

Useful graph nodes:

- objective
- throughline
- request
- task
- workflow
- hook
- artifact
- knowledge doc
- meeting/session
- Portal record
- Discord thread/channel/message
- participant
- tag

Useful graph edges:

- `mentions`
- `belongs_to`
- `derived_from`
- `discussed_in`
- `created_artifact`
- `blocked_by`
- `approved_by`
- `summarized_by`
- `related_to`

The graph does not need to be the first implementation. The state files should
make the graph possible later.

## Incremental Migration

1. Add a deterministic signal extractor.
2. Write `state/current/signals.json`.
3. Add an objective builder that consumes signals.
4. Write `state/current/objectives.json`.
5. Update `state/latest.json` to include signals and objectives.
6. Keep `state/current/projects.json` during compatibility period.
7. Add optional Codex enrichment for changed objectives.
8. Add throughline suggestions and `state/current/throughlines.json`.
9. Update rolling memory to consume objectives before projects.
10. Update Memory Explorer to browse objectives and graph-ready links.
11. Add Portal inbox event examples and, later, a Portal maintainer skill.

## Backfill And Reindexing

Existing instances need a way to build useful objective state from records that
already exist. Otherwise new instances get the model from day one, while current
instances such as `prism-stack` only become useful after new activity arrives.

Backfill and reindexing should operate only on derived state. They should not
delete raw bucket records, inbox records, knowledge docs, meeting artifacts, or
request artifacts.

### Modes

Forward-only mode is the default and safest behavior. Normal pipeline runs
extract signals and update objectives only from newly collected activity.

Bounded backfill mode rebuilds derived state over a selected date range:

```text
community_memory.pipeline state --from-date 2026-05-01 --to-date 2026-06-02 --force
```

Full reindex mode rebuilds derived state across all available source records:

```text
community_memory.pipeline state --from-date <first-date> --to-date <last-date> --force
```

For live instances, bounded backfill should be the preferred first operation.
A 30-60 day window is likely enough to produce useful current objectives without
trying to reinterpret every historical conversation.

### Inputs

Backfill should read available durable sources:

- raw bucket records under `buckets/*/raw/YYYY-MM-DD/*.json`
- meeting summaries and meeting transcript metadata
- knowledge activity events
- knowledge document metadata
- Prism request and artifact metadata when accessible
- task, workflow, hook, and run history when persisted
- Portal inbox records once Portal integration exists

The first implementation can start with raw bucket records and knowledge
activity, then add richer sources as the state builder expands.

Meeting summary action items should be emitted as `meeting_action_item` signals.
New source-adapter summaries should preserve structured `metadata.action_items`
in the Memory inbox payload. Backfill should also parse the rendered
`## Action Items` markdown section so older summaries can still contribute
signals. Action items raise objective attention when attached to an explicit
objective, but should not create standalone objectives by themselves.

Knowledge source sync events should become generated signals as well as rolling
memory `knowledge_events`. A GitHub source sync that adds, changes, or removes a
doc should produce anchors such as:

```text
knowledge:sources/<source-id>/<doc-slug>
knowledge-source:<source-id>
```

This lets source-backed knowledge changes participate in objectives and future
knowledge graph views without copying the whole document body into memory.
Doc-level `knowledge:<slug>` anchors should not create standalone objectives
unless an explicit objective key is present. Otherwise large source syncs can
flood the objective list with one objective per document. Source-level anchors
such as `knowledge-source:<source-id>` may still become emergent objectives.

### Idempotency

Backfill must be idempotent. Running the same backfill twice should not duplicate
signals or create divergent objective keys.

Signal ids should be deterministic from stable inputs such as:

- source system
- source record id or path
- signal kind
- anchor
- occurred timestamp
- content hash when no stable source id exists

Example:

```text
sig:<source>:<record-id-or-hash>:<kind>:<anchor>
```

Objective keys should also be stable. Explicit objective keys win. If no explicit
key exists, the builder should derive from durable anchors such as request ids,
task keys, PR urls, or normalized topic labels.

### State Index Metadata

Reindex operations should write metadata so operators can tell what happened.

Example:

```json
{
  "state_index": {
    "version": 1,
    "last_reindexed_at": "2026-06-02T18:40:00Z",
    "window_start": "2026-05-01",
    "window_end": "2026-06-02",
    "mode": "bounded_backfill",
    "source_counts": {
      "discord": 1200,
      "portal": 24,
      "meetings": 8,
      "knowledge": 17
    },
    "output_counts": {
      "signals": 312,
      "objectives": 9,
      "throughlines": 3
    }
  }
}
```

This metadata can live in `state/latest.json` and, if needed, a dedicated
`state/index_state.json` file for checkpointing larger runs.

### Safety

Reindexing should preserve manually supplied objective metadata when possible.
For example, if an operator or Portal skill has supplied a better title,
description, alias list, or external reference, the builder should merge that
metadata instead of replacing the whole objective record.

Generated fields can be refreshed:

- signal ids
- scores
- status
- last signal timestamps
- derived summaries
- enrichment freshness

Manual or external fields should be preserved:

- explicit objective key
- preferred title
- aliases
- owners
- external refs
- archived flag
- manually pinned throughline membership

When there is a conflict, generated state should record a warning or suggestion
instead of silently overwriting manual state.

## Live Instance Validation

For a live instance such as `prism-stack`, validation should prove that the new
state layer works without relying on Codex Runtime or Portal being present.

### 1. Confirm The Instance Has The New Routes

```bash
curl -fsSL \
  -H "X-Prism-Api-Key: $PRISM_API_READ_KEY" \
  "$PRISM_MEMORY_BASE_URL/state/latest"
```

After deployment, these routes should also be available:

```text
GET /state/signals
GET /state/objectives
GET /state/throughlines
POST /ops/state/run
```

### 2. Send A Controlled Inbox Record

Use a harmless Portal-like inbox record with explicit objective and throughline
hints.

```bash
curl -fsSL \
  -X POST \
  -H "content-type: application/json" \
  -H "X-Prism-Api-Key: $PRISM_API_WRITE_KEY" \
  "$PRISM_MEMORY_BASE_URL/memory/inbox" \
  -d '{
    "source": "portal",
    "type": "contribution_request.updated",
    "ts": "2026-06-02T18:20:00Z",
    "bucket_hint": "coordination",
    "author": "validation",
    "url": "https://portal.example.com/contribution-requests/validation",
    "content": "Validation record: move request #26 through Triage. See PR #20.",
    "metadata": {
      "source_system": "portal",
      "source_type": "contribution_request",
      "source_id": "validation-objective-state",
      "source_version": "2026-06-02T18:20:00Z",
      "objective_keys": ["validation-objective-state"],
      "throughline_keys": ["validation-throughline"],
      "related_request_number": 26,
      "external_refs": [
        {
          "system": "portal",
          "type": "contribution_request",
          "id": "validation-objective-state",
          "url": "https://portal.example.com/contribution-requests/validation",
          "relationship": "coordinates"
        }
      ]
    }
  }'
```

### 3. Run Collection And State

The full memory run will collect inbox entries and then run state builders:

```bash
curl -fsSL \
  -X POST \
  -H "X-Prism-Api-Key: $PRISM_API_OPS_KEY" \
  "$PRISM_MEMORY_BASE_URL/ops/memory/run?date=2026-06-02&force=true"
```

If collection has already happened and only generated state needs to be rebuilt,
run the state-only operation:

```bash
curl -fsSL \
  -X POST \
  -H "X-Prism-Api-Key: $PRISM_API_OPS_KEY" \
  "$PRISM_MEMORY_BASE_URL/ops/state/run?date=2026-06-02&force=true"
```

For a bounded live backfill, rebuild generated state without rerunning digests,
memory, or seeds:

```bash
curl -fsSL \
  -X POST \
  -H "X-Prism-Api-Key: $PRISM_API_OPS_KEY" \
  "$PRISM_MEMORY_BASE_URL/ops/state/backfill?days=60&force=true"
```

### 4. Verify Outputs

```bash
curl -fsSL \
  -H "X-Prism-Api-Key: $PRISM_API_READ_KEY" \
  "$PRISM_MEMORY_BASE_URL/state/objectives?objective_key=validation-objective-state"
```

Expected result:

- an objective with `objective_key` of `validation-objective-state`
- anchors including `request:26`, `pr:20`, and the Portal external ref
- status `active`
- `enrichment_status` set to `disabled`

```bash
curl -fsSL \
  -H "X-Prism-Api-Key: $PRISM_API_READ_KEY" \
  "$PRISM_MEMORY_BASE_URL/state/throughlines"
```

Expected result:

- a throughline with `throughline_key` of `validation-throughline`
- `objective_keys` including `validation-objective-state`

### 5. Validate No Model Dependency

The validation should pass with Codex Runtime disabled or unreachable. Codex
enrichment is not part of the first deterministic slice.

### 6. Validate Existing Data

Run state for today's date and inspect counts:

```bash
curl -fsSL \
  -X POST \
  -H "X-Prism-Api-Key: $PRISM_API_OPS_KEY" \
  "$PRISM_MEMORY_BASE_URL/ops/state/run?force=true"
```

Then check:

```bash
curl -fsSL \
  -H "X-Prism-Api-Key: $PRISM_API_READ_KEY" \
  "$PRISM_MEMORY_BASE_URL/state/latest"
```

The `domains` section should include `signals`, `objectives`, and
`throughlines`. Existing instances may show low counts until source records
contain explicit hints or recognizable request/PR/task/workflow references.

## Open Questions

- Should throughlines be generated only by enrichment at first, or should Portal
  be allowed to provide explicit throughline keys?
- What is the minimum useful objective key derivation when no explicit key
  exists?
- Should objective summaries live only in `objectives.json`, or should they also
  be emitted as knowledge docs after review?
- How much Portal context should the Prism enrichment step receive before the
  Portal maintainer skill exists?
- Which state API routes should replace or sit beside `/state/projects`?
