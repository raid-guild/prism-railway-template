# Federated Prism Workspaces

Future feature spec for running one canonical Prism Memory Core instance with multiple specialized Prism workspace instances.

## Problem

Communities may want several groups to create their own workflows, skills, tasks, hooks, bots, and request boards while still sharing the same durable community memory and knowledge base.

The current template can support this by deploying multiple instances, but the setup is easy to misconfigure:

- duplicate Discord or Telegram memory collection
- duplicate voice recording or source sync tasks
- unclear ownership of memory, knowledge, and generated artifacts
- unclear handoff path between specialized instances
- source adapter policies that are copied by hand
- agents asking for admin routes or local files when they should use instance APIs

## Proposed Shape

Use separate template instances before building multi-tenant workspaces into one site service.

```text
Prism Memory Core
  owns canonical memory collection
  owns knowledge sync and indexes
  owns durable community artifacts
  exposes read/query APIs to workspace instances

Prism Workspace Instance
  owns a specialized request board
  owns custom skills, workflows, tasks, hooks, and source policies
  may own a Discord or Telegram bot identity for that vertical
  reads from Prism Memory Core
  may keep its own closed local memory for sensitive work
  does not run default memory collectors unless explicitly enabled
```

## Instance Profiles

Add a lightweight template profile concept rather than full multi-workspace tenancy.

```env
PRISM_INSTANCE_PROFILE=collector
```

Collector profile defaults:

- memory collection tasks enabled or easy to enable
- source adapter sync guidance visible
- memory repair/rebuild guidance visible
- Discord voice recording available when configured
- canonical `PRISM_MEMORY_BASE_URL` points to local memory service

```env
PRISM_INSTANCE_PROFILE=workspace
```

Workspace profile defaults:

- built-in memory collection tasks disabled
- source sync/collector setup guidance hidden or labeled collector-only
- `PRISM_MEMORY_BASE_URL` expected to point at the Memory Core instance
- custom skills/workflows/tasks/hooks enabled
- communication adapter chat optional
- output delivery optional

## Handoff Lanes

Use three separate lanes instead of making one system do everything.

### Shared Memory/Knowledge

Use for durable context:

- meeting summaries
- proposal reports
- decisions
- artifacts
- source links
- long-term knowledge

Do not use memory as the primary orchestration bus. Polling memory for events creates ambiguity and duplicate work.

### Confidential Local Memory

Use for sensitive workspace-specific context that should not automatically enter the shared community memory:

- invoicing
- budgets
- client concerns
- internal operations
- private planning notes
- role-specific working memory

This pattern is valid and should be explicit: a workspace instance can run its own Prism Memory service with a closed API and a narrower trust boundary. The Memory Core does not need direct access to the raw local memory.

When something should become shared community knowledge, promote it deliberately rather than syncing all memory by default.

Promotion examples:

- private budget notes -> public budget announcement
- client delivery concern -> sanitized risk note
- internal invoice state -> high-level treasury update
- private project planning -> approved community update

Promotion should be treated as a workflow, not a background sync:

1. Agent drafts a promotion candidate from local memory.
2. Sanitizer removes secrets, private names, credentials, client-only details, and sensitive amounts when needed.
3. Human or policy gate approves the promoted version.
4. Approved payload is written to Memory Core as a summary, artifact, or knowledge event.
5. Raw source artifacts remain local unless explicitly shared.

Payload sketch:

```json
{
  "sourceInstance": "finance-prism",
  "event": "memory.promoted",
  "visibility": "public",
  "summary": "April budget update approved for community sharing.",
  "promotedAt": "2026-05-29T18:00:00.000Z",
  "sourceRefs": [
    {
      "type": "local-artifact",
      "id": "budget-review-2026-04",
      "redacted": true
    }
  ],
  "redactionNotes": [
    "Removed client-specific concerns.",
    "Collapsed invoice line items into public totals."
  ],
  "artifacts": [
    {
      "name": "public-budget-update.md",
      "contentType": "text/markdown"
    }
  ]
}
```

### Hooks

Use for explicit instance-to-instance handoff.

Example:

```text
governance-prism finishes proposal review
  -> triggers content-prism hook
  -> content-prism creates a request to draft announcement
  -> hook payload includes summary, source URLs, artifact IDs, and suggested workflow
```

Payload sketch:

```json
{
  "sourceInstance": "governance-prism",
  "event": "proposal.reviewed",
  "summary": "Proposal review completed.",
  "memoryRefs": [
    {
      "type": "artifact",
      "id": "proposal-review-123"
    }
  ],
  "artifacts": [
    {
      "name": "proposal-review.md",
      "url": "https://..."
    }
  ],
  "suggestedWorkflow": "draft-discord-announcement"
}
```

### Chat/Bot Surfaces

Use for human-facing coordination:

- asking a specialized bot to start a workflow
- posting a handoff message in Discord or Telegram
- asking for review or approval

Do not rely on bot-to-bot chat as a reliable system bus. It risks loops, missed messages, platform permission failures, and duplicated memory collection.

## Missing Pieces

### Profile-Aware Bootstrap

- seed default tasks differently for collector vs workspace
- disable collector tasks by default in workspace profile
- mark collector-only settings guidance in the UI
- expose profile in Settings

### Shared Memory Read Contract

- document the expected read-only envs for workspace instances
- clarify which endpoints are safe for workspace agents
- support read-only Prism Memory API keys if needed
- show Memory Core health/status in workspace Settings

### Handoff Hook Convention

- standard payload fields for `sourceInstance`, `event`, `summary`, `memoryRefs`, `artifacts`, and `suggestedWorkflow`
- optional source request refs
- optional destination workflow key
- replay/retry story for hook payload artifacts

### Promotion Workflow Convention

- standard workflow for turning private local memory into approved public memory
- artifact convention for `promotion-candidate.md`, `redaction-report.md`, and `promoted-summary.md`
- clear distinction between source refs that are private and promoted artifacts that are public
- optional output to Discord, Telegram, GitHub, or another public surface after approval
- optional Memory Core write hook with a narrow token that can only create promoted memory/knowledge events

### Instance Identity

- stable instance slug/name
- public or private base URL
- default bot identity label
- source adapter policy per instance
- branding per instance

### Artifact References Across Instances

- request artifacts are local to the workspace instance today
- handoffs need durable URLs or copied artifacts
- Memory Core artifacts should be referenced by stable artifact IDs/URLs
- workspace-local artifacts should not be assumed readable by other instances unless intentionally exposed

### Permissions And Trust

- service-token hooks are enough for first implementation
- later slices may need per-instance tokens, per-hook tokens, or signed payloads
- output adapter sends should remain explicit and policy-gated
- avoid giving every workspace instance write access to every other instance
- avoid giving Memory Core blanket read access to private workspace memories
- prefer narrow promote-only credentials for writing sanitized updates to Memory Core

### Source Adapter Duplication Controls

- make collector tasks visibly disabled in workspace profile
- warn when Discord sync is configured in multiple instances for the same guild
- separate chat bot access from memory collection
- make Telegram and Discord destination discovery clearly non-collecting

### Observability

- show which instance created a handoff request
- show hook payload artifacts on request detail
- show external memory refs in request artifacts or details
- include source instance and event in execution logs

## Non-Goals For First Slice

- full multi-tenant workspace model in one database
- cross-instance request board aggregation
- bot-to-bot messaging protocol
- automatic memory-event polling as orchestration
- shared global skill registry

## Suggested First Slice

1. Add `PRISM_INSTANCE_PROFILE`.
2. Update bootstrap/default task seeding so workspace instances do not enable collector tasks by default.
3. Update Settings guidance for collector vs workspace.
4. Document how a workspace instance points at a Memory Core `PRISM_MEMORY_BASE_URL`.
5. Add a standard handoff hook payload convention.
6. Add a small “trigger another Prism instance hook” skill or workflow guidance.

## Suggested Promotion Slice

1. Add a built-in “promote local memory” workflow template.
2. Add a Memory Core hook for approved promoted summaries.
3. Add sanitizer guidance for secrets, credentials, client names, private financial details, and internal concerns.
4. Store a redaction report as a local request artifact.
5. Write only the approved summary/artifact to Memory Core.
6. Show promoted Memory Core refs on the source request after successful promotion.

## Open Questions

- Should workspace instances be allowed to write knowledge events back to Memory Core?
- Should Memory Core expose a read-only API key distinct from the current Prism API key?
- Should hooks support per-hook tokens before cross-instance use is encouraged?
- Should a workspace instance copy handoff artifacts locally or only reference source artifacts?
- Should source adapter policies be exportable/importable between instances?
- Should the template include an explicit “workspace-only” Railway template variant?
- Should promoted memory use the same Memory Core write API as collectors, or a separate promote-only hook?
- Should private source refs be visible to Memory Core as opaque provenance, or omitted entirely?
- Should promotion approval require a human gate by default?
- Should promoted artifacts support later takedown or correction if private information slips through?
