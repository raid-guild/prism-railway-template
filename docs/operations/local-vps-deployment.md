# Local And VPS Deployment

This stack is designed for Railway templates, but it is not Railway-only.

You can run it:

- locally for development
- on a VPS with `systemd`, Docker Compose, or another process manager
- on Railway with the existing template flow

The main difference outside Railway is that you must provide:

- concrete service URLs instead of Railway service references
- persistent storage paths
- your own cron scheduling
- your own reverse proxy and TLS where needed

## What Is Railway-Specific vs Portable

Portable parts:

- `site`
- `codex-runtime`
- `prism-memory`
- `discord-adapter`
- `prism-trigger`

Railway-specific conveniences:

- internal DNS such as `RAILWAY_PRIVATE_DOMAIN`
- public service domains such as `RAILWAY_PUBLIC_DOMAIN`
- mounted volumes at `/data`
- built-in cron schedules

Those Railway features are conveniences, not hard requirements.

## Local Development

### One-command local instance

The Compose-backed local instance keeps the Prism control plane in containers
and runs AI harness adapters on the host so they can use the operator's normal
authentication and local repositories. At least one authenticated Codex CLI or
Grok Build installation is required. Detected adapters are registered
automatically, and the first-run selection becomes the default profile.

Prerequisites:

- Node.js 20 or newer
- Docker with the Compose plugin
- repository dependencies installed with `npm install`
- at least one supported runtime: Codex CLI or Grok Build, installed and authenticated

Initialize and start:

```bash
npm run local:init
npm run local:up
```

The first command prints the generated local admin credentials once. Internal
service tokens and encryption keys are written with restrictive permissions
under `~/.local/share/prism/instances/default`. Provider credentials are not
stored there; add them through **Settings > Gateway** after login.

Common lifecycle commands:

```bash
npm run local:status
npm run local:doctor
npm run local:logs
npm run local:down
```

When both runtimes are available, `local:init` or the first `local:up` asks
which should be the default. Non-interactive setup chooses the first detected
runtime unless `PRISM_LOCAL_DEFAULT_RUNTIME=codex-default` or
`PRISM_LOCAL_DEFAULT_RUNTIME=grok-local` is set. Change the active default later
under **Settings > Runtimes**. Use `npm run local:logs -- grok` for the Grok
adapter log. Runtime provider credentials remain in `~/.codex` and `~/.grok`;
Prism does not copy them into its local instance directory.
After initial registration, Site owns the active default, so changes made in
Settings survive later `local:up` restarts.

Set `PRISM_LOCAL_INSTANCE` to operate more than one named local instance, or
`PRISM_LOCAL_HOME` to move local instance data. The Compose services bind to
loopback by default.

### Contributor development

Use the repo bootstrap first:

```bash
npm run bootstrap
```

Then copy or adjust `.env` from `.env.example`.

For local development, use loopback URLs and your normal Codex home:

```env
API_INTERNAL_BASE_URL=http://127.0.0.1:3100
NEXT_PUBLIC_API_BASE_URL=http://127.0.0.1:3100
APP_API_BASE_URL=http://127.0.0.1:3100
CODEX_RUNTIME_BASE_URL=http://127.0.0.1:3030
PRISM_API_BASE=http://127.0.0.1:8788
PRISM_API_KEY=replace-me
INTERNAL_SERVICE_TOKEN=replace-me
SOURCE_ADAPTER_TOKEN=replace-me
CODEX_HOME=$HOME/.codex
```

For local Codex runtime, `CODEX_HOME` should point to your normal Codex home:

```env
CODEX_HOME=$HOME/.codex
```

Do not set local `CODEX_HOME` to Railway-style `/data/codex` unless you intentionally want a separate local auth state.

Default local ports:

- `site`: `3100`
- `codex-runtime`: `3030`
- `grok-runtime`: `3031` when Grok is installed
- `prism-memory`: `8788`
- `discord-adapter`: `8789`
- `task-runner`: `8790`
- `prism-gateway`: `8794`

Run the whole stack:

```bash
npm run dev:all
```

Or run services individually:

```bash
npm run dev --workspace @prism-railway/site
CODEX_HOME="$HOME/.codex" PORT=3030 npm run dev --workspace @prism-railway/codex-runtime
PORT=8789 npm run dev --workspace @prism-railway/source-adapter
```

For `prism-memory`, use its virtualenv and local server flow from `services/prism-memory`.

## VPS Deployment

On a VPS, the stack works the same way, but you need to supply the operational pieces Railway normally gives you.

Minimum requirements:

- Node.js for the JS services
- Python plus the Prism Memory venv for `prism-memory`
- `git` for `codex-runtime` and knowledge source sync
- `ffmpeg` for Discord voice transcription flow
- a reverse proxy such as Nginx or Caddy
- persistent disk for service data
- cron or timers for recurring jobs

Recommended persistent paths:

- `site`: `/srv/prism/site-data`
- `codex-runtime`: `/srv/prism/codex`
- `codex-runtime` workspaces: `/srv/prism/workspaces`
- `prism-memory`: `/srv/prism/prism-memory`
- `discord-adapter`: `/srv/prism/discord-adapter`

Example VPS env values:

```env
API_INTERNAL_BASE_URL=http://127.0.0.1:3100
NEXT_PUBLIC_API_BASE_URL=https://app.example.com
APP_API_BASE_URL=http://127.0.0.1:3100
CODEX_RUNTIME_BASE_URL=http://127.0.0.1:3030
PRISM_API_BASE=https://memory.example.com
PRISM_API_KEY=replace-me
INTERNAL_SERVICE_TOKEN=replace-me
SOURCE_ADAPTER_TOKEN=replace-me

CODEX_HOME=/srv/prism/codex
CODEX_TARGET_WORKSPACE_ROOT=/srv/prism/workspaces
PRISM_AGENT_DATA_ROOT=/srv/prism/site-data
PRISM_API_DATA_ROOT=/srv/prism/prism-memory
SOURCE_ADAPTER_DATA_ROOT=/srv/prism/discord-adapter
```

If you want local-only access between services on the VPS, keep the service-to-service URLs on `127.0.0.1` and only expose the public routes you actually need.

## Public vs Private Services

Typical public routes:

- `site`
- `prism-memory` if you want human-shareable artifact and knowledge links
- `discord-adapter` if Discord or external webhook callbacks need public reachability

Typical private-only routes:

- `codex-runtime`
- cron trigger services

## Persistent State

Outside Railway, you still need durable storage for:

- Codex auth and thread state
- target repo workspaces
- Prism Memory data
- Discord recording recovery data

The important runtime paths are:

- `CODEX_HOME`
- `CODEX_TARGET_WORKSPACE_ROOT`
- `PRISM_API_DATA_ROOT`
- `SOURCE_ADAPTER_DATA_ROOT`
- `PRISM_AGENT_DATA_ROOT`

## Cron Jobs

Railway uses separate trigger services. On a VPS you can keep that model or replace it with direct scheduled HTTP calls.

Suggested schedules:

- memory: hourly
- knowledge: daily
- Discord sync: every 15-60 minutes after Discord is configured

Example cron-style calls:

```bash
curl -X POST \
  -H "X-Prism-Api-Key: $PRISM_API_KEY" \
  "http://127.0.0.1:8788/ops/memory/run"
```

```bash
curl -X POST \
  -H "X-Prism-Api-Key: $PRISM_API_KEY" \
  "http://127.0.0.1:8788/ops/knowledge/run"
```

```bash
curl -X POST \
  -H "X-Adapter-Token: $SOURCE_ADAPTER_TOKEN" \
  -H "Content-Type: application/json" \
  -d "{}" \
  "http://127.0.0.1:8789/sync"
```

## Discord And Voice

Discord is optional outside Railway, just like it is on Railway.

Set these only when you want Discord chat or sync:

```env
DISCORD_BOT_TOKEN=
DISCORD_GUILD_ID=
DISCORD_APPLICATION_ID=
DISCORD_CHAT_ENABLED=true
DISCORD_REGISTER_COMMANDS=true
```

Voice transcription is also optional:

```env
VOICE_TRANSCRIPTION_BASE_URL=https://api.venice.ai/api/v1/audio/transcriptions
VOICE_TRANSCRIPTION_API_KEY=
VOICE_TRANSCRIPTION_MODEL=nvidia/parakeet-tdt-0.6b-v3
VOICE_DAVE_ENCRYPTION=true
```

## GitHub Access

Public target repos do not require a token for read-side clone/fetch.

Private target repos still require:

```env
TARGET_REPO_GITHUB_TOKEN=
```

That token is mainly for:

- cloning private repos
- pushing CR branches

## Recommended First Smoke Test

For a non-Railway deployment, validate in this order:

1. `api`, `site`, `prism-memory`, and `codex-runtime` health endpoints
2. Codex auth in `CODEX_HOME`
3. target repo branch creation from the CR flow
4. optional Discord mention chat
5. optional voice recording summary and Prism artifact links

## Notes

- Local development should use `CODEX_HOME=$HOME/.codex`.
- Railway deployments should continue to use a persistent mounted path such as `/data/codex`.
- If you want a first-class non-Railway deployment path later, the next useful artifact is a `docker-compose.yml` with explicit bind mounts and reverse proxy notes.
