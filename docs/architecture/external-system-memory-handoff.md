# External System Memory Handoff

Status: draft

This spec defines how external systems such as Portal should hand activity to
Prism Memory and how Prism-derived state can be handed back without tightly
coupling the systems.

The initial target is Portal, but the contract should also work for other
coordination surfaces, CMSs, CRMs, forums, issue trackers, and custom community
apps.

Related spec:

- [Prism State: Signals, Objectives, And Throughlines](./prism-state-signals-objectives.md)

## Goals

- let external systems feed Prism Memory through a stable, source-agnostic
  contract
- let agents use Prism Memory to enrich external systems through explicit skills
- preserve clear ownership between Prism Memory and external applications
- avoid making external systems mirror Prism's internal state model
- support deterministic signal extraction, objective building, and future
  knowledge graph views

## Ownership Boundary

Prism owns memory intelligence:

- inbox records
- raw source records
- signals
- objectives
- throughlines
- rolling memory
- knowledge docs
- artifacts and evidence links

External systems own their product data:

- Portal sessions/events
- Portal contribution requests
- Portal modules
- Portal profiles and roles
- Portal notifications
- CMS pages and editorial presentation
- other system-specific lifecycle and permissions

The integration boundary is:

```text
external system event
  -> Prism inbox record
  -> Prism signals/objectives/throughlines
  -> agent skill reads Prism
  -> agent skill updates external system
```

External systems should not directly mutate Prism objective state. They may send
hints that Prism turns into signals.

## Write Into Prism

External systems should write normalized inbox records to Prism Memory. The
record should describe what happened, include a human-readable content body, and
provide structured metadata for deterministic extraction.

Recommended write shape:

```json
{
  "source": "portal",
  "type": "contribution_request.updated",
  "ts": "2026-06-02T18:20:00Z",
  "bucket_hint": "coordination",
  "author": "alice",
  "url": "https://portal.example.com/contribution-requests/abc123",
  "participants": ["alice", "bob"],
  "content": "Contribution request updated: Improve Discord approval flow moved to Triage.",
  "metadata": {
    "source_system": "portal",
    "source_type": "contribution_request",
    "source_id": "abc123",
    "source_version": "2026-06-02T18:19:59Z",
    "status": "triage",
    "tags": ["workflow", "discord", "approval"],
    "objective_keys": ["discord-approval-flow"],
    "throughline_keys": ["source-agnostic-coordination"],
    "related_request_number": 26,
    "external_refs": [
      {
        "system": "portal",
        "type": "contribution_request",
        "id": "abc123",
        "url": "https://portal.example.com/contribution-requests/abc123",
        "relationship": "coordinates"
      }
    ]
  }
}
```

### Required Fields

- `source`: stable external system key, such as `portal`
- `type`: event or record type, such as `session.summary`
- `ts`: occurrence timestamp
- `content`: human-readable summary or body

### Recommended Fields

- `bucket_hint`: broad Prism Memory bucket suggestion
- `author`: actor who caused the event
- `url`: canonical external URL
- `participants`: people involved
- `metadata.source_system`
- `metadata.source_type`
- `metadata.source_id`
- `metadata.source_version`
- `metadata.tags`
- `metadata.objective_keys`
- `metadata.throughline_keys`
- `metadata.external_refs`

`source_id` should be stable across updates. `source_version` should change when
the external record changes, using an updated timestamp, revision id, or content
hash.

## Portal Event Types

The first useful Portal event types are:

- `contribution_request.created`
- `contribution_request.updated`
- `contribution_request.status_changed`
- `session.created`
- `session.updated`
- `session.summary`
- `module.updated`
- `notification.sent`
- `profile.updated`

Avoid sending every minor CMS edit at first. Prefer events that change
coordination state, produce useful evidence, or should influence memory.

## Session And Meeting Handoff

Portal sessions and meeting summaries should be treated as high-value source
records.

Recommended session summary shape:

```json
{
  "source": "portal",
  "type": "session.summary",
  "ts": "2026-06-02T19:00:00Z",
  "bucket_hint": "meetings",
  "author": "portal",
  "url": "https://portal.example.com/sessions/session456",
  "participants": ["alice", "bob", "carol"],
  "content": "Session summary markdown or plain text.",
  "metadata": {
    "source_system": "portal",
    "source_type": "session",
    "source_id": "session456",
    "title": "Runtime Reliability Working Session",
    "objective_keys": ["runtime-reliability"],
    "throughline_keys": ["source-agnostic-coordination"],
    "decisions": [
      "Use response jobs for long-running Codex Runtime requests."
    ],
    "action_items": [
      {
        "title": "Add console progress updates",
        "owner": "alice",
        "due": null
      }
    ],
    "notable_quotes": [
      {
        "speaker": "bob",
        "text": "The user needs to know the run is still moving."
      }
    ]
  }
}
```

If a source adapter already generated a meeting summary, Portal should prefer
linking or forwarding that structured summary rather than asking Prism to
reprocess the full transcript.

## Read From Prism

External systems should read Prism-derived context through explicit API routes
or through a maintainer skill.

Useful Prism read targets:

- latest rolling memory
- current objectives
- current throughlines
- signals filtered by external ref
- knowledge search
- artifact content
- state latest summary

External systems should store only the small subset they need for display,
coordination, filtering, or notifications.

Recommended Portal field:

```json
{
  "prism": {
    "objectiveKeys": ["runtime-reliability"],
    "throughlineKeys": ["source-agnostic-coordination"],
    "artifactIds": ["knowledge-doc--runtime~long-running-jobs"],
    "knowledgeSlugs": ["runtime/long-running-jobs"],
    "lastEnrichedAt": "2026-06-02T18:25:00Z",
    "summary": "Short Prism-derived context.",
    "evidenceUrls": [
      "https://prism-memory.example.com/knowledge/view/runtime/long-running-jobs"
    ]
  }
}
```

This field is a cache and presentation aid. Prism remains the source of truth for
memory state.

## Portal Maintainer Skill

The Portal maintainer skill is the preferred write-back mechanism. It should
make controlled, auditable Portal updates from Prism Memory.

The skill should be able to:

- read Prism state, memory, knowledge, and artifacts
- read Portal records
- compare Portal records against Prism objectives and throughlines
- update lightweight `prism` fields on Portal records
- attach relevant Prism artifacts or knowledge links
- draft notifications from objective changes
- create follow-up contribution requests from accepted meeting action items
- leave audit notes for meaningful updates

The skill should not:

- bulk rewrite Portal content without an explicit request
- change Portal permissions or roles unless explicitly asked
- convert every Prism objective into a Portal record
- treat model-generated summaries as reviewed editorial copy by default

## Idempotency And Sync

External writes should be idempotent.

Recommended event identity:

```text
<source_system>:<source_type>:<source_id>:<source_version>:<event_type>
```

If `source_version` is not available, use a content hash of the normalized event.

Prism should deduplicate repeated events with the same identity. Portal should be
able to resend the latest state without creating duplicate signals.

For write-back, the Portal maintainer skill should record:

- source objective or throughline keys used
- Prism artifact ids or knowledge slugs attached
- update timestamp
- agent/session id when available
- short change summary

## Backfill

External systems should be able to backfill important records into Prism using
the same inbox contract.

Portal backfill candidates:

- active contribution requests
- recent sessions and summaries
- active module pages
- recent notifications or digests
- relevant profile/role changes

Backfill should start bounded, such as the last 30-60 days, and should use the
same stable `source_id` and `source_version` fields as forward events.

## Access And Safety

External systems should use Prism Memory write credentials only for inbox writes.
They should not receive Prism ops credentials unless they are explicitly running
operations.

Agents that update Portal should use a Portal-specific credential with scoped
permissions. The Portal skill should document which routes it can read and write.

Recommended split:

- Portal service writes Prism inbox records with a Prism write key.
- Portal maintainer skill reads Prism with a Prism read key.
- Portal maintainer skill writes Portal with a Portal API token.
- Operators run Prism reindex/backfill with a Prism ops key.

## Open Questions

- Should Prism expose a first-class `GET /state/objectives?externalRef=...`
  route for Portal lookups?
- Should Portal maintain explicit throughline records, or only reference Prism
  throughline keys on existing records?
- Which Portal updates require human review before publishing?
- Should notification drafts be written to Portal as drafts only, with a human
  publish step?
- How should user/profile identities map between Portal, Discord, and Prism
  Memory participants?
