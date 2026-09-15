# Discord Promote Doc

Status: first slice in progress

## Purpose

Operators need a low-friction way to turn a useful Discord discussion into a
shareable Prism Memory document. A common case is a meeting that identifies a
follow-up artifact, such as a fireside chat host script, followed by a Discord
thread where the agent and humans work out the actual draft. When the draft is
good enough, the operator should be able to promote the current Discord context
into Prism Memory and copy a stable link into another system such as Portal.

This feature creates the Prism artifact and returns the link. Any external
system can attach or reference that link in its own workflow.

## Command Shape

Use a dedicated Discord slash command:

```text
/prism-promote-doc title:"Fireside Host Script"
```

The command should run in the current Discord channel or thread. It defaults to
the memory lane because most promoted Discord context is a session artifact,
follow-up artifact, or useful snapshot rather than evergreen knowledge.

Use the knowledge lane only for reusable or evergreen content:

```text
/prism-promote-doc title:"Fireside Host Script" lane:knowledge
```

Avoid nested slash command shapes such as `/prism promote-doc ...`; previous
parameter parsing was less reliable, and the source adapter already uses
top-level commands such as `/prism-chat`, `/prism-record`, and
`/prism-continue-cr`.

## First Slice

- Register `/prism-promote-doc`.
- Gather recent messages from the current Discord channel or thread.
- Ask Codex Runtime to turn that context into clean Markdown when available.
- Fall back to a deterministic transcript-style Markdown document if Codex
  Runtime is unavailable.
- Require Discord access mode `full` or the explicit `memory.promote_doc`
  capability because the command authors new Prism assets.
- Apply the configured Discord rate limit before writing to Prism.
- Sanitize public-output secrets from the generated document before writing it
  to a shareable Prism surface.
- Write the result to Prism Memory `POST /memory/inbox` by default.
- Write to `POST /knowledge/inbox` only when `lane:knowledge` is selected.
- Include metadata with Discord source refs, source channel/thread ids, source
  message ids, author, owners, tags, and triage fields.
- Reply in Discord with a shareable Prism Memory artifact link for the default
  memory lane.
- Reply with the knowledge inbox path and slug for `lane:knowledge`; a
  human-readable knowledge view link is only available after review/indexing
  promotes the inbox entry.

The first slice writes memory artifacts by default. Knowledge inbox is reserved
for reusable docs, templates, guides, policies, or other content expected to
remain useful beyond the current session/thread.

## Metadata

The generated memory artifact should include source metadata and a shareable
Prism artifact link.

When using `lane:knowledge`, the generated knowledge inbox entry should include:

- `title`
- `slug`
- `kind`: usually `guide`
- `summary`
- `tags`: use allowed Prism Knowledge tags such as `memory` and `workflow`
- `owners`: include the Discord user display name when available
- `status`: `draft`
- `audience`: `internal`
- `stability`: `evolving`
- `updated`
- `entities`
- `related_docs`
- `triaged_at`
- `source_system`: `discord`
- `source_type`: `promoted_doc`
- `source_id`: channel or thread id
- `external_refs`: Discord channel/thread/message URLs

## Deferred

- External-system attachment flows.
- Message range selection.
- Reply-to-message promotion.
- Operator review UI for pending promoted docs.
- Automatic knowledge promotion/index run after inbox write.
- Cross-linking promoted docs to generated objectives and throughlines.
