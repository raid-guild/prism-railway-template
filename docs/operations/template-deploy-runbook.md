# Prism Railway Template Deploy Runbook

Use this after deploying the Railway template into a fresh project.

## 1. Link The CLI

From a checkout of `raid-guild/prism-railway-template`:

```bash
railway link --project <project-id> --environment production
railway status
```

Confirm the project and environment match the new deploy before running any remote commands.

## 2. Expected Services

The deployed project should include:

| Service | Root directory | Volume |
| --- | --- | --- |
| `site` | `/services/site` | `/data` |
| `prism-memory` | `/services/prism-memory` | `/data` |
| `discord-adapter` | `/services/source-adapter` | `/data` |
| `codex-runtime` | `/services/codex-runtime` | `/data` |
| `discord-sync-cron` | `/services/prism-trigger` | none |
| `memory-cron` | `/services/prism-trigger` | none |
| `knowledge-cron` | `/services/prism-trigger` | none |

## 3. Smoke Checks

Get service domains from Railway, then check:

```bash
curl https://<site-domain>/
curl https://<prism-memory-domain>/health
curl https://<discord-adapter-domain>/health
curl https://<codex-runtime-domain>/health
```

Expected early results:

- `site /api/health` returns `ok: true` and shows applied migrations.
- `site` returns HTML.
- `prism-memory` returns `ok: true` and `space: community`.
- `discord-adapter` returns `ok: true`; Discord may show `discordReady: false` until Discord credentials are set.
- `codex-runtime` returns `ok: true`.
- `memory-cron` and `knowledge-cron` should stop after successful one-shot runs.
- `discord-sync-cron` should stop cleanly with `PRISM_TRIGGER_DISABLED=true`.

## 4. Bootstrap The App

```bash
bash scripts/railway-bootstrap-api.sh --environment production --service site
```

Expected:

- migrations are applied or already current
- admin bootstrap succeeds
- target bootstrap succeeds with zero default target records unless you added a manifest

Do not share terminal output from this command publicly; Railway prints service environment variables.

## 5. Codex Device Auth

SSH into the Codex runtime:

```bash
railway ssh -s codex-runtime
```

Inside the Railway shell:

```bash
mkdir -p /data/codex
export CODEX_HOME=/data/codex
export PATH="/app/node_modules/.bin:$PATH"
codex login --device-auth
```

Complete the browser device-auth flow, then exit:

```bash
exit
```

The auth files live under `/data/codex` on the mounted volume and should persist across redeploys.

## 6. Discord Setup

Set these on `discord-adapter` when ready to enable Discord:

```text
DISCORD_BOT_TOKEN=<bot-token> # Discord bot token. Required to enable Discord sync/chat.
DISCORD_GUILD_ID=<guild-id> # Discord guild ID to sync and serve. Required to enable Discord.
DISCORD_APPLICATION_ID=<optional-application-id> # Discord application ID. Recommended for slash command registration.
```

`DISCORD_APPLICATION_ID` is optional but recommended for slash command registration.

After setting Discord credentials, redeploy `discord-adapter` and check:

```bash
curl https://<discord-adapter-domain>/health
```

Expected:

```json
"discordReady": true
```

After the adapter is healthy, inspect the live Discord server structure before enabling sync:

```bash
curl -fsSL \
  -H "X-Adapter-Token: $COMMUNICATION_ADAPTER_TOKEN" \
  "$COMMUNICATION_ADAPTER_BASE_URL/guild/channels"
```

Use that inventory to configure the instance-specific Prism Memory `discord.category_to_bucket` mapping. Prefer `mappingCandidates[].id` or `categories[].id` as keys because those are Discord category IDs. Do not map every child channel ID; child channels inherit through their category. Use channel IDs only for truly uncategorized channel exceptions. The template does not ship category IDs because Discord category IDs are unique to each community.

If the instance already collected Discord messages before the mapping was corrected, repair the existing memory files after patching config:

```bash
curl -fsSL \
  -X POST \
  -H "content-type: application/json" \
  -H "X-Prism-Api-Key: $PRISM_API_OPS_KEY" \
  "$PRISM_MEMORY_BASE_URL/ops/memory/repair-discord-buckets" \
  -d '{"from_date":"YYYY-MM-DD","to_date":"YYYY-MM-DD","dry_run":true}'

curl -fsSL \
  -X POST \
  -H "content-type: application/json" \
  -H "X-Prism-Api-Key: $PRISM_API_OPS_KEY" \
  "$PRISM_MEMORY_BASE_URL/ops/memory/repair-discord-buckets" \
  -d '{"from_date":"YYYY-MM-DD","to_date":"YYYY-MM-DD","dry_run":false,"rebuild":true}'
```

The repair keeps ingest/activity history intact, reclassifies raw windows using saved Discord channel metadata, and force-rebuilds affected digests, rolling memory, and seeds.

## 7. Enable Discord Sync Cron

`discord-sync-cron` deploys disabled by default:

```text
PRISM_TRIGGER_DISABLED=true # Keeps Discord sync disabled until Discord credentials are configured.
```

After Discord credentials are working, set:

```text
PRISM_TRIGGER_DISABLED=false # Enables Discord sync after credentials and permissions are verified.
```

or remove the variable, then add a Railway cron schedule for `discord-sync-cron`.

The service should keep:

```text
PRISM_API_BASE=https://${{discord-adapter.RAILWAY_PUBLIC_DOMAIN}} # Public URL for the Discord adapter service.
PRISM_TRIGGER_PATH=/sync # Path on the Discord adapter that triggers Discord message sync.
PRISM_TRIGGER_AUTH_HEADER=X-Adapter-Token # Header name used to send the Discord adapter auth token.
PRISM_TRIGGER_AUTH_TOKEN=${{discord-adapter.SOURCE_ADAPTER_TOKEN}} # Shared token used to authorize cron calls to the Discord adapter.
PRISM_TRIGGER_BODY={} # JSON body sent to the Discord sync endpoint.
```

Before enabling a recurring schedule, run one dry sync manually if desired:

```bash
TOKEN="$(railway variable list -s discord-adapter --json | node -e "let d='';process.stdin.on('data',c=>d+=c);process.stdin.on('end',()=>process.stdout.write(JSON.parse(d).SOURCE_ADAPTER_TOKEN || ''))")"
curl -X POST "https://<discord-adapter-domain>/sync?dry_run=true" \
  -H "X-Adapter-Token: $TOKEN" \
  -H "Content-Type: application/json" \
  -d "{}"
```

## 8. Configure Cron Schedules

Railway template creation may preserve the cron services without preserving recurring schedules. Treat cron schedules as a required post-deploy Railway setting, not as application env.

Suggested starting schedules:

| Service | Suggested Schedule | Purpose |
| --- | --- | --- |
| `memory-cron` | hourly, for example `0 * * * *` | Processes Prism Memory inbox items, digests, memory, and seed outputs. |
| `knowledge-cron` | daily, for example `15 3 * * *` | Promotes, validates, and indexes knowledge docs. |
| `discord-sync-cron` | every 15-60 minutes after Discord setup, for example `*/30 * * * *` | Pulls Discord message history through `discord-adapter /sync`. Keep disabled until Discord credentials and permissions are verified. |

Manual setup:

1. Open each cron service in Railway.
2. Go to **Settings -> Deploy -> Cron Schedule**.
3. Add the schedule.
4. Force one run from Railway before relying on the recurring schedule.

Backfill is optional. A fresh template instance can validate Prism Memory with direct inbox writes, such as Discord voice transcript and summary ingestion, before enabling recurring backfill or sync.

## 9. Optional Voice Transcription

Set on `discord-adapter`:

```text
VOICE_TRANSCRIPTION_BASE_URL=https://api.venice.ai/api/v1/audio/transcriptions # Optional Whisper-compatible transcription endpoint for Discord voice recordings.
VOICE_TRANSCRIPTION_API_KEY=<transcription-key> # Optional API key for the configured voice transcription endpoint.
VOICE_RECORDING_WARNING_MINUTES=50 # Warns before a long Discord voice recording is stopped automatically.
VOICE_RECORDING_MAX_MINUTES=60 # Stops long Discord voice recordings automatically. Set to 0 to disable.
```

Then test `/prism-record` and `/prism-stoprecord` in Discord.

## 10. Optional Target Repo Access

Set on `codex-runtime` only if Codex should clone or push private target repositories:

```text
TARGET_REPO_GITHUB_TOKEN=<github-token> # Optional GitHub token for cloning or pushing private target repositories.
```

Public target repositories may not need this.

## 11. Final Template Notes

Template-generated secrets should use Railway template functions:

```text
${{ secret(32) }}
${{ secret(64) }}
```

## 12. Template Raw Variable Blocks

Use these blocks in the Railway template composer raw variable editor when descriptions need to be carried by inline comments.

```text
PORT="3100" # Port the site service listens on.
NODE_ENV="production" # Runtime environment for the site service.
NEXT_PUBLIC_API_BASE_URL="https://${{site.RAILWAY_PUBLIC_DOMAIN}}" # Browser-facing API URL used by the site.
NEXT_PUBLIC_INTERACTION_BASE_URL="https://${{discord-adapter.RAILWAY_PUBLIC_DOMAIN}}" # Browser-visible base URL used to display callable external interaction endpoints.
API_INTERNAL_BASE_URL="http://${{site.RAILWAY_PRIVATE_DOMAIN}}:${{site.PORT}}" # Server-side API URL used by the site.
COMMUNICATION_ADAPTER_BASE_URL="http://${{discord-adapter.RAILWAY_PRIVATE_DOMAIN}}:${{discord-adapter.PORT}}" # Private communication adapter URL used by Site server routes.
SITE_USE_LOCAL_APP_API="true" # Site owns the app API and SQLite runtime state.
PRISM_LAB_ENABLED="false" # Opt-in Lab rollout. Set exactly true only for intentional field testing.
PRISM_AGENT_DATA_ROOT="/data" # Mounted data directory for site runtime state.
ADMIN_EMAIL="admin@local.agent" # Initial admin account email.
ADMIN_PASSWORD="changeme" # Temporary admin password; change after deploy.
SESSION_SECRET="${{ secret(32) }}" # Secret used to sign site sessions.
INTERNAL_SERVICE_TOKEN="${{ secret(32) }}" # Shared token for internal service-to-service API calls.
CODEX_RUNTIME_BASE_URL="http://${{codex-runtime.RAILWAY_PRIVATE_DOMAIN}}:${{codex-runtime.PORT}}" # Private URL for Codex Runtime using its internal port.
COMMUNITY_PROVIDER="discord" # Community adapter provider enabled for this stack.
```

### Prism Memory

```text
PORT="8788" # Port the Prism Memory service listens on.
PRISM_API_KEY="${{ secret(64) }}" # API key used to authorize Prism Memory API calls.
PRISM_API_DATA_ROOT="/data" # Mounted data directory for Prism Memory runtime state.
PRISM_API_SPACE="community" # Runtime Prism Memory space slug.
```

### Discord Adapter

```text
PORT="8789" # Port the Discord adapter listens on.
NODE_ENV="production" # Runtime environment for the Discord adapter.
SOURCE_KIND="discord" # Source provider handled by this adapter.
SOURCE_SPACE="community" # Prism Memory space this adapter writes into. Must match PRISM_API_SPACE.
SOURCE_SYNC_MODE="manual" # Sync mode for Discord ingestion.
SOURCE_ADAPTER_TOKEN="${{ secret(64) }}" # Token used to authorize calls to the adapter.
SOURCE_ADAPTER_DATA_ROOT="/data" # Mounted data directory for checkpoints and recordings.
SOURCE_CHECKPOINT_OVERLAP_MINUTES="5" # Minutes of overlap when resuming Discord sync checkpoints.
PRISM_API_BASE="https://${{prism-memory.RAILWAY_PUBLIC_DOMAIN}}" # Public URL for Prism Memory ingest calls.
PRISM_API_KEY="${{prism-memory.PRISM_API_KEY}}" # Prism Memory API key reference.
PRISM_INGEST_PATH="/ingest/messages" # Prism Memory ingest endpoint path.
APP_API_BASE_URL="http://${{site.RAILWAY_PRIVATE_DOMAIN}}:${{site.PORT}}" # Private URL for the site app API using its internal port.
INTERNAL_SERVICE_TOKEN="${{site.INTERNAL_SERVICE_TOKEN}}" # Internal site service token reference.
CODEX_RUNTIME_BASE_URL="http://${{codex-runtime.RAILWAY_PRIVATE_DOMAIN}}:${{codex-runtime.PORT}}" # Private URL for Codex Runtime using its internal port.
DISCORD_BOT_TOKEN="" # Discord bot token. Required to enable Discord sync/chat.
DISCORD_GUILD_ID="" # Discord guild ID to sync and serve. Required to enable Discord.
DISCORD_APPLICATION_ID="" # Discord application ID. Recommended for slash command registration.
DISCORD_CHAT_ENABLED="true" # Enables Discord mention/thread chat bridge.
DISCORD_REGISTER_COMMANDS="true" # Automatically registers Discord slash commands on startup.
DISCORD_SYNC_WINDOW_HOURS="24" # Lookback window for Discord sync.
DISCORD_MAX_MESSAGES_PER_CHANNEL="200" # Maximum messages fetched per channel per sync.
DISCORD_INCLUDE_ARCHIVED_THREADS="false" # Whether archived threads are included during sync.
DISCORD_IGNORE_BOT_MESSAGES="false" # Whether bot messages are skipped during sync.
DISCORD_ATTACHMENT_TEXT_ENABLED="true" # Enables extraction of text-like Discord attachments.
DISCORD_EMBED_TEXT_ENABLED="true" # Enables preservation of Discord embed text.
VOICE_DAVE_ENCRYPTION="true" # Enables Discord DAVE voice encryption support when available.
VOICE_CHAT_IGNORE_BOT_MESSAGES="true" # Skips bot messages when stitching voice channel chat into transcripts.
VOICE_RECORDING_WARNING_MINUTES="50" # Warns before a long Discord voice recording is stopped automatically.
VOICE_RECORDING_MAX_MINUTES="60" # Stops long Discord voice recordings automatically. Set to 0 to disable.
VOICE_TRANSCRIPTION_BASE_URL="https://api.venice.ai/api/v1/audio/transcriptions" # Whisper-compatible transcription endpoint for Discord voice recordings.
VOICE_TRANSCRIPTION_API_KEY="" # Optional API key for the configured voice transcription endpoint.
VOICE_TRANSCRIPTION_MODEL="nvidia/parakeet-tdt-0.6b-v3" # Model sent to the transcription endpoint.
VOICE_TRANSCRIPTION_LANGUAGE="en" # Optional transcription language hint.
VOICE_TRANSCRIPTION_RESPONSE_FORMAT="json" # Response format sent to the transcription endpoint.
VOICE_TRANSCRIPTION_TIMESTAMPS="true" # Requests timestamp segments from the transcription endpoint.
CODEX_RUNTIME_REQUEST_TIMEOUT_SECONDS="660" # Timeout for adapter calls to Codex Runtime.
```

### Codex Runtime

```text
PORT="3030" # Port the Codex Runtime service listens on.
NODE_ENV="production" # Runtime environment for Codex Runtime.
CODEX_BIN="/app/node_modules/.bin/codex" # Path to the Codex CLI binary inside the runtime image.
CODEX_HOME="/data/codex" # Mounted Codex home directory for auth and thread state.
CODEX_RUNTIME_TIMEOUT_MS="600000" # Maximum Codex execution timeout in milliseconds.
CODEX_IMAGE_GENERATION_ENABLED="true" # Enables the Codex CLI built-in image_generation feature for $imagegen workflows.
CODEX_WORKSPACE_ROOT="/app" # Default workspace root for Codex execution.
CODEX_TARGET_WORKSPACE_ROOT="/data/workspaces" # Mounted directory for cloned target repositories.
PRISM_API_BASE="http://${{prism-memory.RAILWAY_PRIVATE_DOMAIN}}:${{prism-memory.PORT}}" # Private URL for Prism Memory using its internal port.
PRISM_API_KEY="${{prism-memory.PRISM_API_KEY}}" # Prism Memory API key reference.
APP_API_BASE_URL="http://${{site.RAILWAY_PRIVATE_DOMAIN}}:${{site.PORT}}" # Private URL for the site-owned app API using its internal port.
APP_API_SERVICE_TOKEN="${{site.INTERNAL_SERVICE_TOKEN}}" # Internal site service token reference.
COMMUNICATION_ADAPTER_BASE_URL="http://${{discord-adapter.RAILWAY_PRIVATE_DOMAIN}}:${{discord-adapter.PORT}}" # Private URL for communication adapter destination lookup and direct message sends from Codex agents.
COMMUNICATION_ADAPTER_TOKEN="${{discord-adapter.SOURCE_ADAPTER_TOKEN}}" # Shared adapter token sent as X-Adapter-Token for direct communication adapter calls.
TARGET_REPO_GITHUB_TOKEN="" # Optional GitHub token for cloning or pushing private target repositories.
GIT_AUTHOR_NAME="Prism Codex" # Git author name used for Codex-created commits.
GIT_AUTHOR_EMAIL="prism-codex@users.noreply.github.com" # Git author email used for Codex-created commits.
```

### Discord Sync Cron

```text
PRISM_API_BASE="https://${{discord-adapter.RAILWAY_PUBLIC_DOMAIN}}" # Public URL for the Discord adapter service.
PRISM_TRIGGER_BODY="{}" # JSON body sent to the Discord sync endpoint.
PRISM_TRIGGER_PATH="/sync" # Path on the Discord adapter that triggers Discord message sync.
PRISM_TRIGGER_DISABLED="true" # Keeps Discord sync disabled until Discord credentials are configured.
PRISM_TRIGGER_AUTH_TOKEN="${{discord-adapter.SOURCE_ADAPTER_TOKEN}}" # Shared token used to authorize cron calls to the Discord adapter.
PRISM_TRIGGER_AUTH_HEADER="X-Adapter-Token" # Header name used to send the Discord adapter auth token.
```

### Memory Cron

```text
PRISM_API_BASE="https://${{prism-memory.RAILWAY_PUBLIC_DOMAIN}}" # Public URL for the Prism Memory service.
PRISM_TRIGGER_PATH="/ops/memory/run" # Prism Memory endpoint that runs collection, digest, memory, and seeds.
PRISM_TRIGGER_AUTH_HEADER="X-Prism-Api-Key" # Header name used to send the Prism API key.
PRISM_TRIGGER_AUTH_TOKEN="${{prism-memory.PRISM_API_KEY}}" # Prism Memory API key reference.
PRISM_TRIGGER_BODY="{}" # JSON body sent to the memory run endpoint.
```

### Knowledge Cron

```text
PRISM_API_BASE="https://${{prism-memory.RAILWAY_PUBLIC_DOMAIN}}" # Public URL for the Prism Memory service.
PRISM_TRIGGER_PATH="/ops/knowledge/run" # Prism Memory endpoint that promotes, validates, and indexes knowledge docs.
PRISM_TRIGGER_AUTH_HEADER="X-Prism-Api-Key" # Header name used to send the Prism API key.
PRISM_TRIGGER_AUTH_TOKEN="${{prism-memory.PRISM_API_KEY}}" # Prism Memory API key reference.
PRISM_TRIGGER_BODY="{}" # JSON body sent to the knowledge run endpoint.
```

Do not hardcode source-project or smoke-project secret values into published template variables.
