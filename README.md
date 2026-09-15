# Prism Railway Template

Railway template source for a Codex-first community agent platform:

- `services/site` for the public/admin web app and app API
- `services/prism-memory` for the Prism memory API
- `services/source-adapter` for source-specific ingestion into Prism memory
- `services/prism-trigger` for one-shot cron/ops triggers

Current direction:

- Codex CLI is the primary agent/operator runtime
- `discord-adapter` is the supported Discord bridge for sync plus live chat transport
- `codex-runtime` is the shared Codex CLI runtime for Discord and future adapters
- `site` owns the app API and SQLite-backed runtime state
- `codex-runtime` and `discord-adapter` call `site` over the internal network

## Architecture

Documentation starts at [docs/README.md](docs/README.md).
Template authoring notes live in [docs/template/template-authoring.md](docs/template/template-authoring.md).
Post-deploy template operations live in [docs/operations/template-deploy-runbook.md](docs/operations/template-deploy-runbook.md).
Non-Railway deployment notes live in [docs/operations/local-vps-deployment.md](docs/operations/local-vps-deployment.md).
Template versioning and update behavior live in [docs/template/versioning-and-updates.md](docs/template/versioning-and-updates.md).
Prism Memory storage cleanup planning lives in [docs/archive/prism-memory-path-cleanup.md](docs/archive/prism-memory-path-cleanup.md).
Site/API consolidation planning lives in [docs/architecture/site-api-consolidation-plan.md](docs/architecture/site-api-consolidation-plan.md).
Site/API live cutover steps live in [docs/archive/site-api-cutover-checklist.md](docs/archive/site-api-cutover-checklist.md).
Template env deltas for that cutover live in [docs/template/template-site-api-env-delta.md](docs/template/template-site-api-env-delta.md).

This repo is intentionally split by deployable service instead of using PM2 inside one container.

The current folders reflect the work in progress, not the final target shape.

- Railway service: `site`
- Railway service: `prism-memory`
- Railway service: `discord-adapter`
- Railway service: `codex-runtime`
- Railway service: `discord-sync-cron`
- Railway service: `memory-cron`
- Railway service: `knowledge-cron`

Recommended deployment model:

1. Import this repo into Railway as a JavaScript monorepo.
2. Create one service per deployable directory.
3. Point each service at its own root directory under `services/`.
4. Keep `prism-memory` on a persistent volume.
5. Use `services/prism-trigger` twice for the cron jobs with different env vars.
6. Route operator chat through the Discord-to-Codex bridge.
7. Mount the app SQLite/data volume on `site` at `/data`.

## Service Map

### `services/site`

Owns:

- public/admin routes
- auth and sessions
- profiles, points, badges, and admin flows
- change requests, agent runs, targets, and deploy metadata as the system of record
- agent chat sessions and Discord thread linkage as durable conversation state
- the internal app API surface consumed by Codex runtime and Discord
- the app SQLite/runtime volume at `/data`

### `services/prism-memory`

Owns:

- normalized message ingest
- the vendored `prism-memory-starter` runtime under `prism_seed/default`, seeded into the configured runtime space
- memory, knowledge, and product retrieval API
- mounted data volume at `/data/prism_seed/<PRISM_API_SPACE>`
- authenticated `/ops/*` routes for collect, digest, memory, seeds, and knowledge jobs

### `services/source-adapter`

Owns:

- source-specific authentication and collection
- source-specific normalization for Discord, Slack, or Telegram
- posting normalized batches into `prism-memory`

### `services/codex-runtime`

Owns:

- Codex CLI-backed chat execution via HTTP
- persisted Codex auth and thread state through `CODEX_HOME`
- reusable runtime endpoint for Discord, Slack, and the admin console

Does not own:

- durable request state
- agent-run history as the source of truth
- deploy metadata
- Discord transport concerns
- durable app-side chat session storage

Current scaffold:

- `GET /health` for Railway health checks
- `GET /codex/health`
- `POST /v1/responses`

Target direction:

- adapters call one shared Codex runtime instead of embedding it
- persisted Codex thread IDs are mapped to app-side sessions
- Prism Memory is available as optional runtime context, not forced on every turn

### `services/source-adapter`

Owns:

- source-specific authentication and collection
- source-specific normalization for Discord, Slack, or Telegram
- posting normalized batches into `prism-memory`
- Discord mention/thread chat transport that forwards to `codex-runtime`

### `services/prism-trigger`

Owns:

- one-shot authenticated trigger call into Prism memory

Use two Railway services from this one directory:

- `memory-cron` with `PRISM_TRIGGER_PATH=/ops/memory/run`
- `knowledge-cron` with `PRISM_TRIGGER_PATH=/ops/knowledge/run`

Optionally add a third cron service from the same directory:

- `discord-sync-cron` with `PRISM_API_BASE=https://your-discord-adapter.up.railway.app`
- `discord-sync-cron` with `PRISM_TRIGGER_PATH=/sync`
- `discord-sync-cron` with `PRISM_TRIGGER_AUTH_HEADER=X-Adapter-Token`
- `discord-sync-cron` with `PRISM_TRIGGER_AUTH_TOKEN=<SOURCE_ADAPTER_TOKEN>`

## Local Setup

This scaffold is intentionally light. It gives you a deploy shape and starter services, not a full migration of the existing app.

```bash
npm run bootstrap
```

That will:

- create `.env` from `.env.example` if needed
- install all npm workspaces
- create `services/prism-memory/.venv`
- install the Prism memory Python dependencies
- install the source adapter TypeScript workspace dependencies

Default local ports:

- Site: `3100`
- Source adapter: `8789`
- Prism memory: `8788`

Then work service-by-service:

```bash
npm run dev --workspace @prism-railway/site
```

Or run the whole local stack:

```bash
npm run dev:all
```

For local development, use concrete loopback URLs in `.env`; Railway template references such as `${{api.RAILWAY_PRIVATE_DOMAIN}}` only resolve inside Railway templates.

Local lifecycle commands report the installed Prism version and check the
canonical `superprismio/prism-railway-template` `main` branch for updates:

```bash
npm run local:status
npm run local:doctor
```

The check is informational and never changes the checkout. Review and preserve
local modifications before pulling or merging an update.

Minimum local values:

```text
API_INTERNAL_BASE_URL=http://127.0.0.1:3100
NEXT_PUBLIC_API_BASE_URL=http://127.0.0.1:3100
APP_API_BASE_URL=http://127.0.0.1:3100
CODEX_RUNTIME_BASE_URL=http://127.0.0.1:3030
PRISM_API_BASE=http://127.0.0.1:8788
PRISM_API_KEY=replace-me
INTERNAL_SERVICE_TOKEN=replace-me
SOURCE_ADAPTER_TOKEN=replace-me
COMMUNICATION_ADAPTER_BASE_URL=http://127.0.0.1:8789
COMMUNICATION_ADAPTER_TOKEN=replace-me
```

Codex runtime needs local Codex auth. The default `.env.example` uses your normal `~/.codex`:

```text
CODEX_HOME=$HOME/.codex
```

Discord and voice transcription are optional locally. Leave these blank unless you want to test Discord sync/chat or `/prism-record`:

```text
DISCORD_BOT_TOKEN=
DISCORD_GUILD_ID=
VOICE_TRANSCRIPTION_BASE_URL=
VOICE_TRANSCRIPTION_API_KEY=
```

### Local Target Apps

Shared target bootstrap data should only include stable shared environments such as staging and production.

Do not commit machine-specific local target values such as:

- local filesystem paths
- local app ports
- local dev commands

For example, if you want to work against a local target app checkout, start that app in its own repo and keep the path and port as operator-local knowledge rather than baking them into `services/site/config/target-apps.default.json`.

Current local example:

- repo: `../example-target-app`
- app URL: `http://localhost:5173/`
- start command:

```bash
cd ../example-target-app
nvm use
npm install
npm run dev
```

If the Prism app needs to reference a local target during development, create that target record manually in the local admin/API layer instead of committing it to the shared manifest.

## Railway Notes

- Each service directory includes its own `railway.json`.
- Do not use one repo-level `startCommand` for every service.
- Set service-specific env vars in Railway, not in source control.
- `services/source-adapter` is the preferred place for Discord/Slack/Telegram collection for memory ingest.
- `services/source-adapter` supports persisted sync checkpoints, `dry_run`, and resettable sync windows.
- `services/prism-memory` seeds the starter runtime into its mounted volume and keeps the active config at `/data/prism_seed/<PRISM_API_SPACE>/config/space.json`.
- `prism-memory` and `source-adapter` both use explicit Dockerfiles so the deploy runtime stays pinned and reproducible.

Supporting docs:

- [Docs Index](docs/README.md)
- [Codex-First Architecture](docs/architecture/codex-first-architecture.md)
- [Codex Runtime Device Auth](docs/operations/codex-runtime-auth.md)
- [Railway Env Checklist](docs/operations/railway-env-checklist.md)
- [TODO](docs/archive/todo.md)

## Deployment Checklist

For a first Railway bring-up:

1. Create services for `site`, `prism-memory`, `discord-adapter`, `codex-runtime`, `discord-sync-cron`, `memory-cron`, and `knowledge-cron`.
2. Set each service root directory to its matching folder under `services/`.
3. Deploy `site`, then run `migrate`, `bootstrap:admin`, and `bootstrap:targets`.
4. For `prism-memory`, mount a persistent volume for runtime state.
5. Configure `discord-adapter` to post normalized batches into `prism-memory` and persist checkpoints on its service volume or data root.
6. Configure `discord-sync-cron` to call `discord-adapter /sync` with `X-Adapter-Token`.
7. Deploy `codex-runtime` with persistent `CODEX_HOME` storage and complete `codex login` once in the running service.
8. Deploy `discord-adapter` with Discord bot credentials, app API base URL, internal service token, and `CODEX_RUNTIME_BASE_URL`.
9. Set shared URLs so `codex-runtime` and `discord-adapter` point to `site`, and services point to `prism-memory` where needed.
10. Set secrets in Railway, especially `SESSION_SECRET`, `INTERNAL_SERVICE_TOKEN`, `ADMIN_PASSWORD`, `PRISM_API_KEY`, `SOURCE_ADAPTER_TOKEN`, `COMMUNICATION_ADAPTER_TOKEN`, and Codex/Discord credentials.
10. Deploy `site` and confirm `/admin` loads.

API bootstrap split:

- `npm run migrate --workspace @prism-railway/api`
- `npm run bootstrap:admin --workspace @prism-railway/api`
- `npm run bootstrap:targets --workspace @prism-railway/api`
- optional: `npm run seed:catalog --workspace @prism-railway/api`
- optional: `npm run seed:demo --workspace @prism-railway/api`

Remote Railway API bootstrap from your local terminal:

```bash
npm run railway:bootstrap-api -- \
  --environment production \
  --service api
```

Combined deploy and bootstrap flow:

```bash
npm run railway:deploy-prism-stack -- \
  --prism-api-base https://prism-memory-production.up.railway.app \
  --prism-api-key <PRISM_API_KEY> \
  --run-memory \
  --run-knowledge
```

This will:

- deploy `api`
- run `migrate`, `bootstrap:admin`, and `bootstrap:targets` on `api`
- deploy `site`
- deploy `prism-memory`
- optionally trigger `memory.run` and `knowledge.run`

Manual steps still required:

- Codex auth/bootstrap for the chosen runtime
- Discord bridge onboarding
- Railway secret entry
- Railway cron schedule setup. Template instances may create `memory-cron`, `knowledge-cron`, and `discord-sync-cron` without recurring schedules; add schedules manually after deploy. Suggested starting points: hourly `memory-cron`, daily `knowledge-cron`, and 15-60 minute `discord-sync-cron` only after Discord is configured.

## Suggested Migration Order

1. Move the API contract first.
2. Point the site at the new API.
3. Move Prism memory with a volume and normalized ingest.
4. Add a source adapter for Discord collection if memory ingestion needs channel history.
5. Add the Discord-to-Codex bridge.
6. Decide whether to flatten `site` and `api` into one Next.js app.
7. Add cron triggers last.
