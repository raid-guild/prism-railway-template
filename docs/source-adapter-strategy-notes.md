# Source Adapter Strategy Notes

These notes capture the current direction for evolving Prism beyond the
Discord-only adapter without committing to an implementation yet.

## Problem

The stack currently deploys `services/source-adapter` as `discord-adapter`.
That service does three related but distinct jobs:

- chat transport: bot identity, commands, mentions, threads, and Codex chat
- source collection: Discord channel traversal and normalized message ingest
- output delivery: destination discovery and message posting for tasks

This works for Discord, but the naming and service shape raise questions as we
add Slack, Telegram, WhatsApp, or community-specific sources that are not chat
platforms at all.

## Working Vocabulary

Use these boundaries for now:

- `adapter`: a transport-facing service for a chat or messaging platform
- `source adapter`: the generic service implementation that can be configured
  for one transport provider
- `provider`: the concrete platform, such as Discord, Slack, Telegram, or
  WhatsApp
- `materializer`: source-specific API logic that turns external records into
  durable markdown or knowledge artifacts
- `task`: scheduled or manual orchestration that can call adapters,
  materializers, skills, workflows, or Codex prompts

## Current Direction

Keep a single source-adapter codebase, but deploy one instance per provider or
community surface.

```text
services/source-adapter
  -> discord-adapter instance
  -> slack-adapter instance
  -> telegram-adapter instance
```

Each instance owns its provider credentials, webhook/event handling, sync
checkpoints, and provider-specific API calls. This avoids one giant service with
every platform credential and runtime dependency loaded at once.

The important abstraction is the HTTP contract, not a single long-running
process that multiplexes all transports.

## Adapter Responsibilities

Adapters should own:

- provider auth and bot identity
- channel, thread, room, or conversation discovery
- provider-specific message traversal and sync checkpoints
- normalizing chat messages into Prism Memory ingest batches
- live chat bridge calls to `codex-runtime`
- slash commands or platform-native commands
- destination discovery for task outputs
- message delivery to resolved destinations
- provider-specific media or voice capture when the platform requires it

Adapters should not own:

- model orchestration beyond forwarding requests to `codex-runtime`
- long-term knowledge indexing
- custom business logic for every community API
- proposal/forum/document materialization that is unrelated to chat transport
- workflow execution state

## Common Adapter Interface

The provider-specific implementation can vary, but each adapter should expose a
small common shape.

Readiness and discovery:

```text
GET /health
GET /capabilities
GET /destinations
```

Collection:

```text
POST /sync
POST /sync?dry_run=true
POST /sync?reset_checkpoint=true
```

Output:

```text
POST /messages
```

The existing `docs/adapter-output-interface.md` is the current contract for
destination discovery and task delivery. Keep expanding that contract carefully
instead of adding Discord-only task-runner behavior.

## Provider Model

The adapter can be configured with a `SOURCE_KIND` or future `SOURCE_PROVIDER`.

Examples:

```text
SOURCE_KIND=discord
SOURCE_KIND=slack
SOURCE_KIND=telegram
```

Early implementations can dispatch internally by provider:

```text
src/providers/discord/*
src/providers/slack/*
src/providers/telegram/*
```

The shared layer should stay small:

- HTTP server and auth middleware
- normalized ingest payload builders
- checkpoint storage helpers
- destination and delivery response types
- common error and health response helpers

Avoid trying to force all providers into the exact same internal collector
shape. Slack and Discord have different threading, permissions, rate limits,
and event models.

## Why Not One Instance For Every Platform?

A single multi-provider instance is attractive in theory, but creates practical
overhead:

- every platform secret must live in one service
- every platform dependency ships in one runtime
- provider failures share one blast radius
- health and deploy status get harder to interpret
- per-community setup becomes more confusing

Separate instances keep Railway templates understandable:

```text
discord-adapter
slack-adapter
telegram-adapter
```

They can still all use the same source directory and common interface.

## Chat Sources vs Materializers

Discord, Slack, Telegram, and WhatsApp are chat sources. They belong in
adapters because the platform APIs, permissions, and bot identity are the core
problem.

DAO proposals, Snapshot proposals, forums, Notion exports, and custom APIs are
not transport adapters by default. Those are better modeled as materializers or
skills invoked by tasks:

```text
scheduled task
  -> source-specific skill/script
  -> external API
  -> local checkpoint
  -> markdown, task output, or knowledge event
```

If the output should become durable searchable knowledge, promote it into the
materialized knowledge source path described in
`docs/custom-source-strategy.md`.

## Task And Workflow Interaction

Tasks should be able to use adapters through the common interface:

- resolve destination labels at creation time
- store destination ids in task output config
- run Codex or a script on schedule
- deliver returned content through `POST /messages`
- record delivery results in task run history

Workflows can also use adapters, but should treat them as capabilities rather
than hardcoded Discord behavior. A workflow step can say:

```text
Publish the approved brief to the configured community updates destination.
```

The skill/runtime layer can resolve whether that destination is Discord, Slack,
or another adapter.

## Open Questions

- Should `SOURCE_KIND` be renamed to `SOURCE_PROVIDER` for clarity?
- Should adapter registrations live in `site` so the UI can show available
  transports and destinations?
- Should `/destinations` support search/filter query params for large
  communities?
- How should adapters expose permission errors so task creation can warn before
  schedules are enabled?
- Do live chat sessions need a provider-neutral session id shape in `site`?
- Should provider-specific commands be declared through `/capabilities`?
- What is the smallest useful Slack proof of concept: outbound messages only,
  sync only, or both?

## Near-Term Next Steps

1. Keep `services/source-adapter` as the shared codebase.
2. Treat `discord-adapter` as the first provider instance, not the permanent
   service concept.
3. Keep task delivery pointed at the adapter output interface.
4. Avoid adding community API materializers to the chat adapter.
5. Add provider-module boundaries before adding Slack or Telegram code.
6. Document adapter registration in `site` only after we need UI discovery.

## Current Preference

Use one adapter codebase with one deployed instance per provider. Keep provider
specifics inside provider modules. Keep non-chat source logic in skills,
materializers, or workflows. Standardize on HTTP contracts between services so
the rest of Prism can work with Discord today and other transports later.
