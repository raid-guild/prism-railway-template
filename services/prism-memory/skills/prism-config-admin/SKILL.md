---
name: prism-config-admin
description: Inspect and update Prism Memory space configuration, then run backfill or memory/knowledge ops through the Prism Memory API. Use when a user wants to configure Prism behavior by chat instead of editing `space.json` manually.
---

# Prism Config Admin

Use this skill for chat-driven Prism Memory configuration and operational runs.

## Required auth

Send:

```text
X-Prism-Api-Key: <ops-key>
```

This skill requires an ops-capable Prism key.

When changing config or triggering ops, also send:

```text
X-Prism-Actor: codex
X-Prism-Reason: <short reason>
```

## Core workflow

1. Read current config first with `GET /config/space`.
2. Prefer `PATCH /config/space` for narrow changes.
3. Use `PUT /config/space` only when replacing the full config intentionally.
4. For config reads, summarize by default instead of dumping the entire file.
5. If the user asks for a specific section such as `agentic_ingest`, `discord`, `knowledge`, or `memory`, show only that section plus one short explanation.
6. Only show full raw JSON when the user explicitly asks for the full config.
7. After config changes, tell the user exactly what changed.
8. Only run backfill or memory/knowledge ops when the user asks for it or when the change clearly requires recomputation.
9. Include a short audit reason for every config or ops call.

## Endpoints

- Read space config:
  `GET /config/space`
- Read config status:
  `GET /config/status`
- Patch space config:
  `PATCH /config/space`
- Read recent config/ops audit:
  `GET /ops/audit/recent`
- Replace space config:
  `PUT /config/space`
- Run normal memory pipeline:
  `POST /ops/memory/run`
- Run memory backfill:
  `POST /ops/memory/backfill?days=...&force=true`
- Run generated state rebuild:
  `POST /ops/state/run?date=YYYY-MM-DD&force=true`
- Run generated state backfill:
  `POST /ops/state/backfill?days=...&force=true`
- Curate throughline state:
  `PATCH /state/throughlines/{throughline_key}`
- Merge duplicate throughlines:
  `POST /state/throughlines/{throughline_key}/merge`
- Hide/delete a generated throughline:
  `DELETE /state/throughlines/{throughline_key}`
- Run knowledge pipeline:
  `POST /ops/knowledge/run`

## Rules

- Do not guess config shape without reading current config first.
- Prefer minimal recursive patches over full replacements.
- When changing optional features, preserve unrelated config.
- Prefer `enabled=true|false` plus `scope=bot_only|scoped|all` in new config writes.
- Treat legacy `mode` fields as backward-compatible input only.
- Treat `space.json.state.objectives` as policy/config, not living objective state.
- Do not write current objectives, signals, throughlines, summaries, or daily status into `space.json`; rebuild generated state through `/ops/state/*` and use `/state/throughlines/*` curation routes for throughline edits.
- For agentic ingest:
  - default to `enabled=false`
  - use `scope=bot_only` for first experiments
  - treat “enable bot-only agentic ingest” as a direct patch request:
    - `enabled=true`
    - `scope=bot_only`
  - treat provider settings as optional unless the user explicitly wants it enabled now
- For backfills:
  - explain blast radius in days
  - default to the narrowest day range that satisfies the request

## References

- Load [references/endpoints.md](references/endpoints.md) for request patterns.
- Load [references/examples.md](references/examples.md) for safe patch examples.
