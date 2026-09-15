---
name: prism-api-writer
description: Write to the Prism Memory API using a write-scoped API key. Use when an agent is allowed to submit memory inbox items or knowledge inbox documents, but should not directly run pipeline ops unless separately authorized.
---

# Prism API Writer

Use this skill only with a write-capable Prism Memory API key.

This skill is for structured writes into Prism Memory. It does not own indexing, digesting, or promotion logic.

## Required auth

Send:

```text
X-Prism-Api-Key: <write-key>
```

Do not assume the key can run ops endpoints.

## Write endpoints

- Memory inbox:
  `POST /memory/inbox`
- Knowledge inbox:
  `POST /knowledge/inbox`
- Knowledge source create:
  `POST /knowledge/sources`
- Knowledge source update:
  `PATCH /knowledge/sources/{source-id}`
- Knowledge source sync:
  `POST /knowledge/sources/{source-id}/sync`

## Repo-backed knowledge workflow

For handbook, docs, or policy repos that should be re-synced later:

1. inspect the repo first
2. check `GET /knowledge/sources`
3. reuse an existing source when `repo_url + branch` already match
4. otherwise create a source
5. sync the source

Use `knowledge/inbox` only for manual Prism-authored docs. Do not send repo files from GitHub directly to `knowledge/inbox`.

## Memory inbox contract

Required:

- `source`
- `ts`
- `type`
- `content`

Optional:

- `bucket`
- `bucket_hint`
- `author`
- `url`
- `participants`
- `participant_count`
- `metadata`

Use `metadata` for source-agnostic state hints such as `source_system`, `source_type`, `source_id`, `source_version`, `objective_keys`, `throughline_keys`, and `external_refs`.

Use memory inbox for:

- conversation summaries
- notable decisions or action items extracted by an agent
- meeting summaries that should remain memory artifacts rather than canonical docs

## Knowledge inbox contract

Send:

- `filename`
- `content`
- `metadata`

Metadata minimum:

- `title`
- `slug`
- `kind`
- `summary`
- `tags`
- `owners`
- `status`
- `audience`
- `stability`
- `updated`
- `entities`
- `related_docs`
- `triaged_at`

## Artifact mappings

Use these defaults unless the deployed corpus has a stronger convention:

- reusable workflow or playbook: `kind: "guide"`
- mandatory or governance workflow: `kind: "policy"`
- reusable template: `kind: "reference"`

## Safety

- Do not call `/ops/*` from this skill.
- Do not overwrite canonical docs directly.
- If `/knowledge/inbox` rejects metadata, fix the metadata rather than weakening validation.
- For repo-backed handbook sync, use `knowledge/sources`, not `knowledge/inbox`.
- Before creating a source, check for an existing `repo_url + branch` match and reuse it.

## References

- Load [references/contracts.md](references/contracts.md) for payload examples.
- Load [references/metadata.md](references/metadata.md) for metadata shaping rules.
