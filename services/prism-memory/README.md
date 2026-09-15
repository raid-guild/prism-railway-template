# Prism Memory Service

Starter FastAPI service for:

- memory retrieval
- knowledge retrieval
- memory artifact browsing
- authenticated ops endpoints
- volume-backed runtime state

Recommended Railway settings:

- mount a persistent volume
- keep the service as the sole owner of that volume
- trigger background work through `/ops/*` from cron services

## Artifact Endpoints

`GET /memory/dates?limit=180` returns the bounded newest-first index of available rolling-memory snapshots. Use it with `GET /memory/date/{date}` for timeline navigation.

Prism Memory serves memory inbox artifacts directly so services can link to durable transcript and summary pages without teaching the site about the memory filesystem layout.

- `GET /artifacts/{id}` returns a human-readable HTML page for a single artifact. This route is intended for links posted back to Discord.
- `GET /api/artifacts` returns an authenticated JSON list. Filters: `type`, `source`, `status`, `limit`.
- `GET /api/artifacts/{id}` returns authenticated JSON metadata, content, and raw payload.
- `GET /api/artifacts/{id}/raw` returns the authenticated raw JSON artifact.

Artifact support covers:

- `inbox/memory/{incoming,processed,rejected}/*.json`, including Discord voice transcripts and summaries written through `POST /memory/inbox`
- `knowledge/kb/docs/**/*.md`
- `knowledge/kb/metadata/**/*.json`
- knowledge inbox files under `inbox/knowledge/*` and `knowledge/kb/triage/*`

## Knowledge Sources

Prism Knowledge now supports file-backed repo sources for deterministic handbook sync.

- Source records live under:
  - `knowledge/sources/<source-id>.json`
- Per-source state, history, and mirror live under:
  - `knowledge/sources/<source-id>/state.json`
  - `knowledge/sources/<source-id>/sync-history/*.json`
  - `knowledge/sources/<source-id>/mirror/`

Current rules:

- only `github` sources are supported
- only `markdown-only` content policy is supported
- sync only ingests `.md` and `.mdx`
- sync scopes to declared or inferred docs roots such as `docs`, `content`, `pages`, or `app`
- sync rebuilds one source partition at a time under:
  - `knowledge/kb/docs/sources/<source-id>/...`
  - `knowledge/kb/metadata/sources/<source-id>/...`

Current endpoints:

- `GET /knowledge/sources`
- `POST /knowledge/sources`
- `GET /knowledge/sources/{source-id}`
- `PATCH /knowledge/sources/{source-id}`
- `POST /knowledge/sources/{source-id}/sync`

Sync semantics:

- per-source deterministic rebuild
- idempotent re-run for the same repo commit
- stable doc identity from `source-id + repo-relative path`
- other knowledge docs and sources are left untouched

The existing knowledge query interface does not change. Source sync feeds the same `knowledge/search` and `knowledge/docs/{slug}` read paths.

## Optional Agentic Ingest

Prism Memory can optionally run an OpenAI-compatible classification pass on memory inbox items before default digest and rolling-memory synthesis.

Intended use:

- keep raw inbox capture deterministic
- enrich selected items with derived metadata
- exclude low-signal assistant/retrieval chatter from default synthesis when configured

Default posture:

- disabled by default
- bundled `space.json` points at `codex-runtime` by default
- bundled `space.json` uses `gpt-5.5` as the default model
- provider target can be swapped to any OpenAI-compatible service

Optional envs:

- `AGENTIC_INGEST_ENABLED=true|false`
- `AGENTIC_INGEST_SCOPE=bot_only|scoped|all`
- `AGENTIC_INGEST_PROVIDER_BASE_URL=...` overrides `space.json`
- `AGENTIC_INGEST_PROVIDER_API_KEY=...`
- `AGENTIC_INGEST_MODEL=...` overrides `space.json`
- `AGENTIC_INGEST_TIMEOUT_SECONDS=30`
- `AGENTIC_INGEST_SCOPED_SOURCES=discord,...`
- `AGENTIC_INGEST_SCOPED_BUCKETS=cohort,...`

Current behavior:

- `enabled=false` does nothing
- scope `bot_only` targets Discord thread/bot-context inbox items based on structural metadata
- scope `scoped` limits enrichment to configured sources and/or buckets
- records classified with `memory_include_default=false` remain stored in raw transcripts but are excluded from default digest generation

## Generated State

Prism Memory exposes generated state for source-agnostic coordination:

- `GET /state/latest`
- `GET /state/projects`
- `GET /state/signals`
- `GET /state/objectives`
- `GET /state/throughlines`

The first objective-state slice extracts signals from raw records, inbox
metadata, and knowledge source activity, builds active/watching/inactive
objectives, and creates throughlines from explicit hints or optional objective
enrichment suggestions.
Throughlines use the same active/watching windows as objectives, so stale
narratives decay out of open throughline views instead of staying active
forever.

Throughline curation is durable. Ops-authenticated agents can edit, merge, or
hide throughlines through direct state routes; those changes are stored in
`state/curation/throughlines.json` and reapplied during later state runs and
backfills:

```bash
curl -fsSL \
  -X PATCH \
  -H "content-type: application/json" \
  -H "X-Prism-Api-Key: $PRISM_API_OPS_KEY" \
  "$PRISM_MEMORY_BASE_URL/state/throughlines/website-analytics-cleanup" \
  -d '{"title":"Remove Fathom Analytics","kind":"project","pinned":true}'

curl -fsSL \
  -X POST \
  -H "content-type: application/json" \
  -H "X-Prism-Api-Key: $PRISM_API_OPS_KEY" \
  "$PRISM_MEMORY_BASE_URL/state/throughlines/raidguild-website-maintenance/merge" \
  -d '{"target_key":"website-analytics-cleanup","reason":"Duplicate throughline"}'

curl -fsSL \
  -X DELETE \
  -H "X-Prism-Api-Key: $PRISM_API_OPS_KEY" \
  "$PRISM_MEMORY_BASE_URL/state/throughlines/noisy-generated-key"
```

Objective enrichment reuses the existing optional agentic ingest provider. When
`AGENTIC_INGEST_ENABLED=true` and the configured provider is reachable, changed
objectives may receive a model-generated title, summary, status explanation,
action items, decisions, open questions, and throughline suggestions. The
provider client supports OpenAI-compatible `/v1/chat/completions` endpoints and
falls back to Codex Runtime `/v1/responses/jobs` when chat completions returns
404. No additional env is required. When the toggle is off or the provider is
unavailable, deterministic state still writes normally.

Operators can rebuild generated state for a date without running the full memory
pipeline:

```bash
curl -fsSL \
  -X POST \
  -H "X-Prism-Api-Key: $PRISM_API_OPS_KEY" \
  "$PRISM_MEMORY_BASE_URL/ops/state/run?date=YYYY-MM-DD&force=true"
```

Backfill generated state across recent history:

```bash
curl -fsSL \
  -X POST \
  -H "X-Prism-Api-Key: $PRISM_API_OPS_KEY" \
  "$PRISM_MEMORY_BASE_URL/ops/state/backfill?days=60&force=true"
```

State reads support filters such as:

```text
/state/objectives?status=active&externalSystem=portal
/state/signals?anchor=request:26
/state/throughlines?status=active
```
