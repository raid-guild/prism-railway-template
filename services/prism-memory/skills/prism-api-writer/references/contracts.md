# Ingest Contracts

Memory inbox example:

```json
{
  "source": "codex-agent",
  "ts": "2026-04-15T18:00:00Z",
  "type": "summary",
  "content": "Key decisions from the guild ops sync...",
  "bucket_hint": "guildhq",
  "author": "codex",
  "participants": ["alice", "bob"],
  "participant_count": 2,
  "metadata": {
    "source_system": "portal",
    "source_type": "contribution_request",
    "source_id": "abc123",
    "source_version": "2026-04-15T18:00:00Z",
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

Memory inbox metadata is optional, but external systems should include it when
they want Prism to build deterministic signals and objectives. Useful fields:

- `source_system`
- `source_type`
- `source_id`
- `source_version`
- `objective_keys`
- `throughline_keys`
- `related_request_number`
- `task_key`
- `workflow_key`
- `hook_key`
- `artifact_id`
- `knowledge_slug`
- `external_refs`

Knowledge inbox example:

```json
{
  "filename": "ops-playbook.md",
  "content": "# Ops Playbook\n\nBody...",
  "metadata": {
    "title": "Ops Playbook",
    "slug": "ops-playbook",
    "kind": "guide",
    "summary": "How to run core guild ops.",
    "tags": ["operations", "workflow"],
    "owners": ["ops-team"],
    "status": "active",
    "audience": "internal",
    "stability": "evolving",
    "updated": "2026-04-15T18:00:00Z",
    "entities": [],
    "related_docs": [],
    "triaged_at": "2026-04-15T18:00:00Z"
  }
}
```

Knowledge source example:

```json
{
  "repo_url": "https://github.com/org/handbook",
  "branch": "main",
  "label": "Community Handbook",
  "content_policy": "markdown-only",
  "docs_roots": ["docs"],
  "default_kind": "reference",
  "default_tags": ["knowledge", "general"]
}
```
