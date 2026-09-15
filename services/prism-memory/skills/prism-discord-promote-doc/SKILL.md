---
name: prism-discord-promote-doc
description: Promote a Discord channel or thread discussion into a Prism Memory knowledge inbox document with a shareable artifact link.
---

# Prism Discord Promote Doc

Use this skill when an operator wants to turn the current Discord discussion into
a reusable Prism Memory document.

## Preferred Path

Use the Discord slash command when available:

```text
/prism-promote-doc title:"Document Title"
```

This defaults to the memory lane. Use knowledge only for reusable or evergreen
content:

```text
/prism-promote-doc title:"Document Title" lane:knowledge
```

The source adapter will:

1. read recent messages from the current Discord channel or thread
2. ask Codex Runtime to draft clean Markdown when available
3. fall back to a transcript-style Markdown document if needed
4. sanitize public-output secrets from the draft
5. write the result to `POST /memory/inbox` by default
6. write to `POST /knowledge/inbox` only for `lane:knowledge`
7. reply with the Prism artifact link for memory lane, or the inbox path for
   knowledge lane

## Manual API Fallback

If the slash command is unavailable but the agent has Prism Memory write access,
use `prism-api-writer`.

For ordinary session artifacts, follow-up drafts, or chat snapshots, write to
`POST /memory/inbox`.

For reusable guides, templates, policies, or evergreen docs, write to
`POST /knowledge/inbox`.

For knowledge entries, use metadata like:

```json
{
  "title": "Fireside Host Script",
  "slug": "fireside-host-script",
  "kind": "guide",
  "summary": "Discord-promoted draft from a follow-up discussion.",
  "tags": ["memory", "workflow"],
  "owners": ["operator-name"],
  "status": "draft",
  "audience": "internal",
  "stability": "evolving",
  "updated": "2026-06-02T00:00:00Z",
  "entities": [],
  "related_docs": [],
  "triaged_at": "2026-06-02T00:00:00Z",
  "source_system": "discord",
  "source_type": "promoted_doc",
  "source_id": "discord-channel-or-thread-id",
  "external_refs": [
    {
      "system": "discord",
      "type": "thread",
      "id": "discord-thread-id",
      "url": "https://discord.com/channels/...",
      "relationship": "source"
    }
  ]
}
```

## Rules

- Use Prism Memory `memory/inbox` for most promoted Discord docs.
- Use Prism Memory `knowledge/inbox` only for reusable or evergreen content.
- The slash command requires Discord access mode `full` or the explicit
  `memory.promote_doc` capability.
- Use an allowed knowledge status. Default to `draft` for a newly promoted
  knowledge document because it came from chat and may still need operator
  editing.
- Do not promise a knowledge view link until the knowledge inbox entry has been
  reviewed/indexed.
- Preserve Discord source references so future readers can inspect provenance.
- Do not assume anything about external systems. If another system needs this
  document, return the Prism link so that system can attach or reference it in
  its own workflow.
