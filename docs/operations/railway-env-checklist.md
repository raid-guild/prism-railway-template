# Railway Env Checklist

Use this as the first-pass setup sheet for Railway.

## Shared Reference Pattern

When two services live in the same Railway project, prefer shared env references for
service-to-service URLs and shared secrets. This keeps the graph readable in Railway
and avoids drift when a service domain or token changes.

Use these rules:

- use `http://${{service.RAILWAY_PRIVATE_DOMAIN}}:${{service.PORT}}` for internal server-to-server calls after connectivity has been verified from the calling service
- use `https://${{service.RAILWAY_PUBLIC_DOMAIN}}` only when a browser or external webhook needs the value
- for browser flows and human-shareable links, use public Railway URLs; for internal runtime calls, use private Railway domains
- use shared references for secrets that must stay identical across services
- keep ports, booleans, timeouts, local paths, and target-app-specific values manual

Recommended shared references in this project:

| Consumer | Variable | Recommended value |
| --- | --- | --- |
| `site` | `API_INTERNAL_BASE_URL` | `http://${{site.RAILWAY_PRIVATE_DOMAIN}}:${{site.PORT}}` |
| `site` | `NEXT_PUBLIC_API_BASE_URL` | `https://${{site.RAILWAY_PUBLIC_DOMAIN}}` |
| `site` | `COMMUNICATION_ADAPTER_BASE_URL` | `http://${{discord-adapter.RAILWAY_PRIVATE_DOMAIN}}:${{discord-adapter.PORT}}` |
| `site` | `NEXT_PUBLIC_INTERACTION_BASE_URL` | `https://${{discord-adapter.RAILWAY_PUBLIC_DOMAIN}}` |
| `codex-runtime` | `APP_API_BASE_URL` | `http://${{site.RAILWAY_PRIVATE_DOMAIN}}:${{site.PORT}}` |
| `codex-runtime` | `PRISM_API_BASE` | `http://${{prism-memory.RAILWAY_PRIVATE_DOMAIN}}:${{prism-memory.PORT}}` |
| `codex-runtime` | `APP_API_SERVICE_TOKEN` | `${{site.INTERNAL_SERVICE_TOKEN}}` |
| `codex-runtime` | `COMMUNICATION_ADAPTER_BASE_URL` | `http://${{discord-adapter.RAILWAY_PRIVATE_DOMAIN}}:${{discord-adapter.PORT}}` |
| `codex-runtime` | `COMMUNICATION_ADAPTER_TOKEN` | `${{discord-adapter.SOURCE_ADAPTER_TOKEN}}` |
| `task-runner` | `COMMUNICATION_ADAPTER_BASE_URL` | `http://${{discord-adapter.RAILWAY_PRIVATE_DOMAIN}}:${{discord-adapter.PORT}}` |
| `task-runner` | `COMMUNICATION_ADAPTER_TOKEN` | `${{discord-adapter.SOURCE_ADAPTER_TOKEN}}` |
| `discord-adapter` | `APP_API_BASE_URL` | `http://${{site.RAILWAY_PRIVATE_DOMAIN}}:${{site.PORT}}` |
| `discord-adapter` | `CODEX_RUNTIME_BASE_URL` | `http://${{codex-runtime.RAILWAY_PRIVATE_DOMAIN}}:${{codex-runtime.PORT}}` |
| `discord-adapter` | `PRISM_API_BASE` | `https://${{prism-memory.RAILWAY_PUBLIC_DOMAIN}}` |
| `discord-adapter` | `INTERNAL_SERVICE_TOKEN` | `${{site.INTERNAL_SERVICE_TOKEN}}` |
| `discord-adapter` | `PRISM_API_KEY` | `${{prism-memory.PRISM_API_KEY}}` |
| `discord-sync-cron` | `PRISM_API_BASE` | `https://${{discord-adapter.RAILWAY_PUBLIC_DOMAIN}}` |
| `discord-sync-cron` | `PRISM_TRIGGER_AUTH_TOKEN` | `${{discord-adapter.SOURCE_ADAPTER_TOKEN}}` |
| `memory-cron` | `PRISM_API_BASE` | `https://${{prism-memory.RAILWAY_PUBLIC_DOMAIN}}` |
| `memory-cron` | `PRISM_TRIGGER_AUTH_TOKEN` | `${{prism-memory.PRISM_API_KEY}}` |
| `knowledge-cron` | `PRISM_API_BASE` | `https://${{prism-memory.RAILWAY_PUBLIC_DOMAIN}}` |
| `knowledge-cron` | `PRISM_TRIGGER_AUTH_TOKEN` | `${{prism-memory.PRISM_API_KEY}}` |

## `site`

Required:

- `PORT=3100`
- `NEXT_PUBLIC_API_BASE_URL=https://${{site.RAILWAY_PUBLIC_DOMAIN}}`
- `NEXT_PUBLIC_INTERACTION_BASE_URL=https://${{discord-adapter.RAILWAY_PUBLIC_DOMAIN}}`
- `API_INTERNAL_BASE_URL=http://${{site.RAILWAY_PRIVATE_DOMAIN}}:${{site.PORT}}`
- `COMMUNICATION_ADAPTER_BASE_URL=http://${{discord-adapter.RAILWAY_PRIVATE_DOMAIN}}:${{discord-adapter.PORT}}`
- `SITE_USE_LOCAL_APP_API=true`
- `PRISM_AGENT_DATA_ROOT=/data`
- `SESSION_SECRET=<strong-secret>`
- `INTERNAL_SERVICE_TOKEN=<strong-secret>`
- `ADMIN_PASSWORD=<shared-admin-password>`

Notes:

- after deploy, confirm `GET /api/health`
- `/admin` uses a simple password form that stores the shared admin password in an HTTP-only cookie
- deploy-time bootstrap order is `migrate`, `bootstrap:admin`, then `bootstrap:targets`
- `bootstrap:targets` reads `services/site/config/target-apps.default.json` unless `TARGET_APPS_MANIFEST` overrides it

## `codex-runtime`

Required:

- `PORT=3030`
- `CODEX_HOME=/data/codex`

Recommended:

- mount a persistent volume
- `CODEX_RUNTIME_TIMEOUT_MS=600000`
- `CODEX_WORKSPACE_ROOT=/app`
- `CODEX_TARGET_WORKSPACE_ROOT=/data/workspaces`
- `PRISM_API_BASE=http://${{prism-memory.RAILWAY_PRIVATE_DOMAIN}}:${{prism-memory.PORT}}`
- `PRISM_API_KEY=<read-or-limited prism api key>`
- `APP_API_BASE_URL=http://${{site.RAILWAY_PRIVATE_DOMAIN}}:${{site.PORT}}`
- `APP_API_SERVICE_TOKEN=${{site.INTERNAL_SERVICE_TOKEN}}`
- `COMMUNICATION_ADAPTER_BASE_URL=http://${{discord-adapter.RAILWAY_PRIVATE_DOMAIN}}:${{discord-adapter.PORT}}`
- `COMMUNICATION_ADAPTER_TOKEN=${{discord-adapter.SOURCE_ADAPTER_TOKEN}}`

Notes:

- complete `codex login` once inside the running service so auth is written into `CODEX_HOME`
- this service exposes `POST /v1/responses` for transport adapters
- set the output adapter env refs if Codex agents should directly resolve destinations or send one-off Discord messages; scheduled task output delivery can still be handled by `task-runner`
- external target apps like `daohaus-admin` need a writable target workspace path on the mounted volume so Codex can clone and edit the repo outside the runtime service source tree
- follow [Codex Runtime Device Auth](codex-runtime-auth.md) for the exact Railway shell steps

## `discord-adapter`

Required:

- `SOURCE_KIND=discord`
- `SOURCE_SPACE=community`
- `SOURCE_SYNC_MODE=manual`
- `SOURCE_ADAPTER_TOKEN=<strong-secret>`
- `SOURCE_ADAPTER_DATA_ROOT=/data`
- `SOURCE_CHECKPOINT_OVERLAP_MINUTES=5`
- `PRISM_API_BASE=https://${{prism-memory.RAILWAY_PUBLIC_DOMAIN}}`
- `PRISM_API_KEY=<same prism api key>`
- `PRISM_INGEST_PATH=/ingest/messages`
- `DISCORD_BOT_TOKEN=<discord bot token>`
- `DISCORD_GUILD_ID=<discord guild id>`
- `DISCORD_CHAT_ENABLED=true`
- `APP_API_BASE_URL=http://${{site.RAILWAY_PRIVATE_DOMAIN}}:${{site.PORT}}`
- `INTERNAL_SERVICE_TOKEN=${{site.INTERNAL_SERVICE_TOKEN}}`
- `CODEX_RUNTIME_BASE_URL=http://${{codex-runtime.RAILWAY_PRIVATE_DOMAIN}}:${{codex-runtime.PORT}}`

Recommended first-pass values:

- `DISCORD_SYNC_WINDOW_HOURS=24`
- `DISCORD_MAX_MESSAGES_PER_CHANNEL=200`
- `DISCORD_INCLUDE_ARCHIVED_THREADS=false`
- `DISCORD_IGNORE_BOT_MESSAGES=false`
- `DISCORD_REGISTER_COMMANDS=true`
- `VOICE_TRANSCRIPTION_BASE_URL=https://api.venice.ai/api/v1/audio/transcriptions`
- `VOICE_TRANSCRIPTION_API_KEY=<voice transcription API key>`
- `VOICE_TRANSCRIPTION_MODEL=nvidia/parakeet-tdt-0.6b-v3`
- `VOICE_TRANSCRIPTION_LANGUAGE=en`
- `VOICE_TRANSCRIPTION_RESPONSE_FORMAT=json`
- `VOICE_TRANSCRIPTION_TIMESTAMPS=true`
- `VOICE_FFMPEG_SEGMENT_SECONDS=180`
- `VOICE_CHAT_MAX_MESSAGES=200`
- `VOICE_CHAT_IGNORE_BOT_MESSAGES=true`
- `VOICE_DAVE_ENCRYPTION=true`
- `VOICE_RECORDING_WARNING_MINUTES=50`
- `VOICE_RECORDING_MAX_MINUTES=60`

Recommended:

- mount a persistent volume or otherwise persist `SOURCE_ADAPTER_DATA_ROOT`
- set `VOICE_RECORDING_MAX_MINUTES=0` only if the instance should allow unbounded voice recordings
- prefer Railway private domains once verified from inside the deployed service; the current voice path has been validated with public Railway service URLs for `codex-runtime` and `prism-memory`

Manual smoke tests:

- `GET /health`
- `POST /sync?dry_run=true` with header `X-Adapter-Token: <SOURCE_ADAPTER_TOKEN>`
- `POST /sync` with header `X-Adapter-Token: <SOURCE_ADAPTER_TOKEN>`
- mention the bot in Discord and confirm the reply path hits `codex-runtime`
- run `/prism-record`, speak, then `/prism-stoprecord`; expect `Speakers with audio: 1+`, Prism Memory transcript path, and Prism Memory summary path
- post a message in the voice channel chat during the recording; expect it to appear in the merged transcript as a `chat` segment
- check logs for `eager receiver subscribe`, `received first opus chunk`, `voice chat transcript messages`, and `prismMemorySummaryPath`

Known validation note:

- if Discord returns `403 Missing Access` for many channels, the bot role still lacks read history access in parts of the guild
- if the bot token is exposed in shell/tool output, rotate it in the Discord developer portal and update `DISCORD_BOT_TOKEN` in Railway

## `prism-memory`

Required:

- `PRISM_API_PORT=8788`
- `PRISM_API_KEY=<strong-secret>`
- `PRISM_API_DATA_ROOT=/data`
- `PRISM_API_SPACE=community`

Recommended:

- mount a persistent volume

Notes:

- this service now accepts `POST /ingest/messages`
- active starter data is stored at `/data/prism_seed/<PRISM_API_SPACE>`
- `POST /ops/memory/run` performs `collect`, `digest`, `memory`, and `seeds`
- `POST /ops/knowledge/run` performs `promote`, `validate`, and `index`
- after deploy, confirm `GET /health`

## `discord-sync-cron`

Required:

- `PRISM_API_BASE=https://${{discord-adapter.RAILWAY_PUBLIC_DOMAIN}}`
- `PRISM_TRIGGER_PATH=/sync`
- `PRISM_TRIGGER_AUTH_HEADER=X-Adapter-Token`
- `PRISM_TRIGGER_AUTH_TOKEN=${{discord-adapter.SOURCE_ADAPTER_TOKEN}}`
- `PRISM_TRIGGER_BODY={}`

Optional:

- set `PRISM_TRIGGER_PATH=/sync?dry_run=true` for safe validation before enabling real ingest
- private `http://${{discord-adapter.RAILWAY_PRIVATE_DOMAIN}}` produced `Connection refused` from this cron on 2026-04-21; keep the public URL unless private connectivity is explicitly revalidated

## `memory-cron`

Required:

- `PRISM_API_BASE=https://${{prism-memory.RAILWAY_PUBLIC_DOMAIN}}`
- `PRISM_TRIGGER_PATH=/ops/memory/run`
- `PRISM_TRIGGER_AUTH_HEADER=X-Prism-Api-Key`
- `PRISM_TRIGGER_AUTH_TOKEN=${{prism-memory.PRISM_API_KEY}}`
- `PRISM_TRIGGER_BODY={}`

Validation notes:

- hourly `memory-cron` can run with `force=false`
- rolling memory rebuilds when any source digest for the target date is newer than `memory/rolling/<date>.md` or `memory/rolling/<date>.json`
- confirmed on 2026-04-21: a non-force run rebuilt `memory/rolling/2026-04-21.*` after a later Discord `knowledge` digest was created, and included both `knowledge` and `meetings` source digests

## `knowledge-cron`

Required:

- `PRISM_API_BASE=https://${{prism-memory.RAILWAY_PUBLIC_DOMAIN}}`
- `PRISM_TRIGGER_PATH=/ops/knowledge/run`
- `PRISM_TRIGGER_AUTH_HEADER=X-Prism-Api-Key`
- `PRISM_TRIGGER_AUTH_TOKEN=${{prism-memory.PRISM_API_KEY}}`
- `PRISM_TRIGGER_BODY={}`

Note:

- in this Railway project, the one-shot cron trigger services reached `prism-memory` reliably via the public domain but failed with `Connection refused` via `prism-memory.railway.internal`; keep the cron services on the public domain unless Railway private-network behavior changes

## Suggested Bring-Up Order

1. `api`
2. `site`
3. `prism-memory`
4. `discord-adapter`
5. `discord-sync-cron` as `dry_run`
6. `discord-sync-cron` real sync
7. `memory-cron`
8. `knowledge-cron`
9. `codex-runtime`
