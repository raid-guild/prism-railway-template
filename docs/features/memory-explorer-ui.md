# Memory Explorer UI

The Memory Explorer is an admin-only surface for browsing Prism Memory from the site app.

It lives outside the change board at:

```text
/admin/memory
```

The change board remains focused on change requests, target apps, agent-run records, and Codex runs. Memory exploration is a related operator workflow, but it needs its own route because it has different layout needs: artifact tables, document previews, raw payload inspection, scoped memory chat, and future retrieval or graph tools.

## Purpose

The first Memory Explorer POC lets admins:

- browse Prism Memory artifacts
- filter and sort returned artifacts
- inspect artifact content and raw JSON payloads
- review registered knowledge sources and sync status
- attach artifacts to a Memory Chat session
- ask the Prism agent questions about selected artifacts or the broader knowledge base

The browser-facing explorer remains read-first. Memory Chat can ask the agent to draft new knowledge-base content, but publishing that content should go through an explicit Prism Memory write path or knowledge inbox approval flow.

Graph visualization is deferred until the team has tested the explorer and reviewed the metadata/provenance gaps.

## Current Shape

Implemented in `services/site`.

Primary page:

- `services/site/src/app/admin/memory/page.tsx`

Client workspace:

- `services/site/src/components/admin/memory-explorer-workspace.tsx`

Site-side Prism Memory helper:

- `services/site/src/lib/prism-memory.ts`

The existing admin board links to the explorer with a `Memory` action in the admin header.

## Auth And Proxy Model

The browser does not call Prism Memory directly.

Instead, the site exposes admin-only route handlers under:

```text
/admin/memory/api/*
```

Those handlers:

- reuse the existing admin password cookie flow
- validate admin access through the API
- call Prism Memory server-side
- send `X-Prism-Api-Key` from server env
- return Prism Memory JSON to the browser
- avoid exposing Prism Memory keys or internal base URLs

This keeps the explorer scoped to the `site` app, which now also owns the app API and SQLite runtime state.

## Implemented Proxy Routes

Current site route handlers:

- `GET /admin/memory/api/artifacts`
- `GET /admin/memory/api/artifacts/:id`
- `GET /admin/memory/api/knowledge/sources`

They proxy these Prism Memory endpoints:

- `GET /api/artifacts`
- `GET /api/artifacts/{id}`
- `GET /knowledge/sources`

The Artifacts view is the browsing surface for memory and knowledge artifacts; Chat is the question-answering surface.

## Required Env

Set on `site`:

```text
PRISM_MEMORY_BASE_URL=http://127.0.0.1:8788
PRISM_API_READ_KEY=replace-me
```

Fallback:

```text
PRISM_API_KEY=replace-me
```

`PRISM_API_READ_KEY` is preferred when the deployment has split Prism Memory read, write, and ops keys. `PRISM_API_KEY` keeps older single-key deployments working.

### Existing Instances And Template Impact

This POC adds new `site`-side Prism Memory wiring.

Existing instances or older template deploys need at least:

```text
PRISM_MEMORY_BASE_URL=http://<reachable-prism-memory>
```

For auth:

- preferred: `PRISM_API_READ_KEY`
- fallback: existing `PRISM_API_KEY`

So the new hard requirement is the Prism Memory base URL on `site`. The read key is only a new requirement when the deployment has already split Prism Memory auth by scope.

The site still needs the normal admin/API env:

```text
API_INTERNAL_BASE_URL=http://127.0.0.1:3100
NEXT_PUBLIC_API_BASE_URL=http://127.0.0.1:3100
```

## Artifact Explorer

The artifact explorer reads from `GET /api/artifacts`.

Current controls:

- category
- status
- source
- type
- limit
- local text search over returned rows
- sort by newest, oldest, source, type, or content length

Current table fields:

- chat attachment checkbox
- created
- filename
- preview
- source
- type
- status
- content length

Selecting a row loads `GET /api/artifacts/{id}` and shows:

- status/category/source badges
- source link when available
- content preview
- raw payload JSON

Checking a row adds that artifact to the Chat tab attachment tray. Attachments are removable individually or as a group.

## Knowledge Sources

The sources view reads from `GET /knowledge/sources`.

Current table fields:

- label
- repo URL
- branch
- kind
- status
- doc count
- last synced time

Selecting a source shows:

- file count
- doc count
- repo and branch
- last synced commit
- last synced time
- docs roots
- current sync error when present
- raw source JSON

Source creation, editing, and sync controls are not part of the explorer.

## Memory Chat

The Chat tab reuses the existing admin response endpoint:

```text
POST /admin/responses
GET /admin/responses?session_id=...
```

Memory Chat stores its session ID in browser local storage separately from the Change Board Prism Console. New sessions can be started from the Chat tab.

Current behavior:

- selected artifacts from the Artifacts tab are passed as bounded context
- `prism-api-reader` is requested automatically so the agent can inspect Prism Memory when needed
- the prompt asks the agent to cite artifact IDs, doc slugs, or source URLs
- content creation requests are treated as drafts unless an explicit write-back flow is added

The recommended write-back path is for the agent to draft a summary or knowledge article, then submit it through a Prism Memory write endpoint or knowledge inbox with explicit approval and provenance. Direct browser writes to Prism Memory are intentionally avoided.

## Current Limitations

The POC depends on the existing Prism Memory read endpoints.

Known limitations:

- artifact full-text search is local over the returned page, not a server-side search
- artifact pagination is limited to the current `limit` behavior
- date-range filters are not implemented yet
- source/type dropdowns are derived from the currently returned artifacts
- graph relationships are not exposed by Prism Memory yet
- Memory Chat passes selected artifact summaries as bounded context; it does not automatically inline every full artifact body
- Memory Chat write-back is not implemented yet
- the explorer is admin-password gated, not role-scoped beyond the current admin model
- the explorer does not expose a separate document search tab; use Artifacts for browsing and Chat for question-answering

These are acceptable for the first POC because the immediate goal is to validate the route, proxy boundary, and operator browsing workflow.

## Validation

The site workspace passes:

```bash
npm run typecheck --workspace @prism-railway/site
npm run build --workspace @prism-railway/site
```

The production build includes:

- `/admin/memory`
- `/admin/memory/api/artifacts`
- `/admin/memory/api/artifacts/[id]`
- `/admin/memory/api/knowledge/sources`

## Next Steps

Near-term:

- test the explorer with real Prism Memory volume data
- confirm whether artifact filters are enough for operators
- add date-range filtering if the artifact set is large
- decide whether artifact search should move into Prism Memory
- add stable pagination or cursors if needed
- add a clearer link from settings/setup into `/admin/memory`
- add a dedicated agent-readable memory route if selected artifacts should be fetched by the runtime through the site service instead of Prism Memory reader skills
- add an explicit knowledge inbox write-back action with review/provenance

After team review:

- require citations back to artifact IDs, doc slugs, and source URLs
- keep Codex context bounded instead of letting it crawl all memory by default
- add graph-ready provenance fields where missing
- prototype a graph endpoint before building a graph canvas

Possible graph endpoint shape:

```text
GET /api/graph?category=memory&source=discord-voice&limit=500
```

Possible dedicated Memory Chat route shape if `/admin/responses` becomes too generic:

```text
POST /admin/memory/api/ask
```

The recommended next product step is to use the POC with real data before adding graph visualization or direct knowledge write-back.
