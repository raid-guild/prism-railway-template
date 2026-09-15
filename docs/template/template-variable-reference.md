# Template Variable Reference

Use this while filling out the Railway template composer.

## API

| Variable | Value | Description | Optional? |
| --- | --- | --- | --- |
| `PORT` | `4010` | Port the API service listens on. | No |
| `NODE_ENV` | `production` | Runtime environment for the API service. | No |
| `APP_BASE_URL` | `https://${{api.RAILWAY_PUBLIC_DOMAIN}}` | Public URL for the API service. | No |
| `PRISM_AGENT_DATA_ROOT` | `/data` | Mounted data directory for API runtime state. | No |
| `ADMIN_EMAIL` | `admin@local.agent` | Initial admin account email. | No |
| `ADMIN_PASSWORD` | `${{ secret(32) }}` | Generated initial admin password. | No |
| `SESSION_SECRET` | `${{ secret(64) }}` | Secret used to sign API sessions. | No |
| `INTERNAL_SERVICE_TOKEN` | `${{ secret(64) }}` | Shared token for internal service-to-service API calls. | No |
| `PRISM_MEMORY_BASE_URL` | `http://${{prism-memory.RAILWAY_PRIVATE_DOMAIN}}:${{prism-memory.PORT}}` | Private URL for Prism Memory. References the memory service port. | No |
| `CODEX_RUNTIME_BASE_URL` | `http://${{codex-runtime.RAILWAY_PRIVATE_DOMAIN}}:${{codex-runtime.PORT}}` | Private URL the API uses to call Codex Runtime. References the runtime port. | No |
| `COMMUNITY_PROVIDER` | `discord` | Community adapter provider enabled for this stack. | No |

## Site

| Variable | Value | Description | Optional? |
| --- | --- | --- | --- |
| `PORT` | `3100` | Port the site service listens on. | No |
| `NODE_ENV` | `production` | Runtime environment for the site service. | No |
| `NEXT_PUBLIC_API_BASE_URL` | `https://${{api.RAILWAY_PUBLIC_DOMAIN}}` | Browser-facing API URL used by the site. | No |
| `NEXT_PUBLIC_INTERACTION_BASE_URL` | `https://${{discord-adapter.RAILWAY_PUBLIC_DOMAIN}}` | Browser-visible base URL used to display external interaction endpoints. | Yes |
| `API_INTERNAL_BASE_URL` | `https://${{api.RAILWAY_PUBLIC_DOMAIN}}` | Server-side API URL used by the site. | No |
| `COMMUNICATION_ADAPTER_BASE_URL` | `http://${{discord-adapter.RAILWAY_PRIVATE_DOMAIN}}:${{discord-adapter.PORT}}` | Private communication adapter URL used by Site server routes. | Yes |
| `PRISM_LAB_ENABLED` | `false` | Opt-in rollout switch for `/admin/lab`. Only `true` enables the live Lab workspace; missing or other values keep it disabled. | Yes |
| `PRISM_GATEWAY_ENABLED` | `true` | Shows Gateway connection administration. Set false only when Gateway is intentionally omitted. | Yes |
| `PRISM_GATEWAY_BASE_URL` | `http://${{prism-gateway.RAILWAY_PRIVATE_DOMAIN}}:${{prism-gateway.PORT}}` | Private Gateway URL used by Site server routes. | Yes |
| `PRISM_GATEWAY_TOKEN` | `${{prism-gateway.GATEWAY_SITE_TOKEN}}` | Site-specific Gateway caller token. Never expose it to browser code. | Yes |

## Prism Memory

| Variable | Value | Description | Optional? |
| --- | --- | --- | --- |
| `PORT` | `8788` | Port the Prism Memory service listens on. | No |
| `PRISM_API_KEY` | `${{ secret(64) }}` | API key used to authorize Prism Memory API calls. | No |
| `PRISM_API_DATA_ROOT` | `/data` | Mounted data directory for Prism Memory runtime state. | No |
| `PRISM_API_SPACE` | `community` | Runtime Prism Memory space slug. | No |
| `AGENTIC_INGEST_ENABLED` | `false` | Optional enable switch for agentic inbox enrichment. Leave false for deterministic default behavior. | Yes |
| `AGENTIC_INGEST_SCOPE` | `bot_only` | Optional agentic enrichment scope when enabled. | Yes |
| `AGENTIC_INGEST_PROVIDER_BASE_URL` | empty | Optional override for the provider base URL in `space.json`. Bundled default already points at Codex Runtime. | Yes |
| `AGENTIC_INGEST_PROVIDER_API_KEY` | empty | Optional provider API key for agentic enrichment. | Yes |
| `AGENTIC_INGEST_MODEL` | empty | Optional override for the provider model in `space.json`. Bundled default is `gpt-5.5`. | Yes |
| `AGENTIC_INGEST_TIMEOUT_SECONDS` | `30` | Optional request timeout for provider calls. | Yes |
| `AGENTIC_INGEST_SCOPED_SOURCES` | empty | Optional comma-separated source allowlist used when scope is `scoped`. | Yes |
| `AGENTIC_INGEST_SCOPED_BUCKETS` | empty | Optional comma-separated bucket allowlist used when scope is `scoped`. | Yes |

## Prism Gateway

| Variable | Value | Description | Optional? |
| --- | --- | --- | --- |
| `PORT` | `8794` | Port the Gateway service listens on. | No |
| `NODE_ENV` | `production` | Runtime environment for Gateway. | No |
| `GATEWAY_MASTER_ENCRYPTION_KEY` | `${{ secret(32) }}` | Current root key used to encrypt connection credentials. Never replace it without the key-rotation runbook. | No |
| `GATEWAY_MASTER_KEY_VERSION` | `v1` | Version recorded with encrypted credential rows. | No |
| `GATEWAY_PREVIOUS_MASTER_ENCRYPTION_KEY` | empty | Previous root key used temporarily during a documented rotation. Set together with its version, then remove after re-encryption. | Yes |
| `GATEWAY_PREVIOUS_MASTER_KEY_VERSION` | empty | Version for the temporary previous root key. | Yes |
| `GATEWAY_SITE_TOKEN` | `${{ secret(64) }}` | Caller-specific token for server-side Site administration calls. | No |
| `GATEWAY_CODEX_RUNTIME_TOKEN` | `${{ secret(64) }}` | Caller-specific token for Codex Runtime connected-service use and job-scoped leases. | No |
| `GATEWAY_TASK_RUNNER_TOKEN` | `${{ secret(64) }}` | Caller-specific token for Task Runner job-scoped credential leases. | No |

## Discord Adapter

| Variable | Value | Description | Optional? |
| --- | --- | --- | --- |
| `PORT` | `8789` | Port the Discord adapter listens on. | No |
| `NODE_ENV` | `production` | Runtime environment for the Discord adapter. | No |
| `SOURCE_KIND` | `discord` | Source provider handled by this adapter. | No |
| `SOURCE_SPACE` | `community` | Prism Memory space this adapter writes into. Must match `PRISM_API_SPACE`. | No |
| `SOURCE_SYNC_MODE` | `manual` | Sync mode for Discord ingestion. | No |
| `SOURCE_ADAPTER_TOKEN` | `${{ secret(64) }}` | Token used to authorize calls to the adapter. | No |
| `SOURCE_ADAPTER_DATA_ROOT` | `/data` | Mounted data directory for checkpoints and recordings. | No |
| `SOURCE_CHECKPOINT_OVERLAP_MINUTES` | `5` | Minutes of overlap when resuming Discord sync checkpoints. | No |
| `PRISM_API_BASE` | `https://${{prism-memory.RAILWAY_PUBLIC_DOMAIN}}` | Public URL for Prism Memory ingest calls. | No |
| `PRISM_API_KEY` | `${{prism-memory.PRISM_API_KEY}}` | Prism Memory API key reference. | No |
| `PRISM_INGEST_PATH` | `/ingest/messages` | Prism Memory ingest endpoint path. | No |
| `APP_API_BASE_URL` | `http://${{api.RAILWAY_PRIVATE_DOMAIN}}:${{api.PORT}}` | Private URL for the API service. References the API service port. | No |
| `INTERNAL_SERVICE_TOKEN` | `${{api.INTERNAL_SERVICE_TOKEN}}` | Internal API service token reference. | No |
| `CODEX_RUNTIME_BASE_URL` | `http://${{codex-runtime.RAILWAY_PRIVATE_DOMAIN}}:${{codex-runtime.PORT}}` | Private URL for Codex Runtime. References the runtime port. | No |
| `DISCORD_BOT_TOKEN` | empty | Discord bot token. Required to enable Discord sync/chat. | No |
| `DISCORD_GUILD_ID` | empty | Discord guild ID to sync and serve. Required to enable Discord. | No |
| `DISCORD_APPLICATION_ID` | empty | Discord application ID. Recommended for slash command registration. | Yes |
| `DISCORD_CHAT_ENABLED` | `true` | Enables Discord mention/thread chat bridge. | No |
| `DISCORD_REGISTER_COMMANDS` | `true` | Automatically registers Discord slash commands on startup. | No |
| `DISCORD_SYNC_WINDOW_HOURS` | `24` | Lookback window for Discord sync. | No |
| `DISCORD_MAX_MESSAGES_PER_CHANNEL` | `200` | Maximum messages fetched per channel per sync. | No |
| `DISCORD_INCLUDE_ARCHIVED_THREADS` | `false` | Whether archived threads are included during sync. | No |
| `DISCORD_IGNORE_BOT_MESSAGES` | `false` | Whether bot messages are skipped during sync. | No |
| `DISCORD_ATTACHMENT_TEXT_ENABLED` | `true` | Enables extraction of text-like Discord attachments. | No |
| `DISCORD_EMBED_TEXT_ENABLED` | `true` | Enables preservation of Discord embed text. | No |
| `VOICE_DAVE_ENCRYPTION` | `true` | Enables Discord DAVE voice encryption support when available. | No |
| `VOICE_CHAT_IGNORE_BOT_MESSAGES` | `true` | Skips bot messages when stitching voice channel chat into transcripts. | No |
| `VOICE_RECORDING_WARNING_MINUTES` | `50` | Sends a warning before a long Discord voice recording is stopped automatically. Set `0` to disable the warning. | No |
| `VOICE_RECORDING_MAX_MINUTES` | `60` | Stops long Discord voice recordings automatically. Set `0` to disable the automatic stop. | No |
| `VOICE_TRANSCRIPTION_BASE_URL` | `https://api.venice.ai/api/v1/audio/transcriptions` | Whisper-compatible transcription endpoint for Discord voice recordings. | Yes |
| `VOICE_TRANSCRIPTION_API_KEY` | empty | API key for the configured voice transcription endpoint. | Yes |
| `VOICE_TRANSCRIPTION_MODEL` | `nvidia/parakeet-tdt-0.6b-v3` | Model sent to the transcription endpoint. | Yes |
| `VOICE_TRANSCRIPTION_LANGUAGE` | `en` | Optional transcription language hint. | Yes |
| `VOICE_TRANSCRIPTION_RESPONSE_FORMAT` | `json` | Response format sent to the transcription endpoint. | Yes |
| `VOICE_TRANSCRIPTION_TIMESTAMPS` | `true` | Requests timestamp segments from the transcription endpoint. | Yes |
| `CODEX_RUNTIME_REQUEST_TIMEOUT_SECONDS` | `660` | Timeout for adapter calls to Codex Runtime. | No |

## Buzz Adapter

Deploy the source-adapter directory as a separate `buzz-adapter` service. It
uses the same Prism ingest and checkpoint variables documented above, with the
following Buzz-specific configuration.

| Variable | Value | Description | Optional? |
| --- | --- | --- | --- |
| `SOURCE_KIND` | `buzz` | Selects Buzz collection for `/sync`. | No |
| `BUZZ_ENABLED` | `true` | Enables Buzz destination discovery, collection, and delivery. | No |
| `BUZZ_RELAY_URL` | `https://buzz.example.org` | HTTP base URL for the Buzz relay. | No |
| `BUZZ_PRIVATE_KEY` | secret | Dedicated Nostr private key for the Prism Buzz identity. | No |
| `BUZZ_PUBLIC_KEY` | public hex key | Public key used to identify and optionally ignore adapter-authored events. | No |
| `BUZZ_CHANNEL_ALLOWLIST` | channel UUIDs | Required comma-separated collection and delivery boundary. | No |
| `BUZZ_SYNC_WINDOW_HOURS` | `24` | Initial/reset lookback window. | No |
| `BUZZ_MAX_MESSAGES_PER_CHANNEL` | `500` | Maximum events fetched per channel per sync. | No |
| `BUZZ_IGNORE_OWN_MESSAGES` | `true` | Excludes messages authored by the adapter identity from Memory ingestion. | No |
| `BUZZ_CLI_TIMEOUT_SECONDS` | `30` | Timeout for each signed Buzz CLI operation. | No |
| `BUZZ_CHECKPOINT_EVENT_LIMIT` | `10000` | Recent event IDs retained to deduplicate overlap and retry windows. | No |
| `BUZZ_CLI_PATH` | `buzz` | Optional override for the pinned CLI installed in the adapter image. | Yes |
| `APP_API_BASE_URL` | `http://${{site.RAILWAY_PRIVATE_DOMAIN}}:${{site.PORT}}` | Private Site API used for profiles, sessions, and runtime invocation. | Required for interaction |
| `APP_API_SERVICE_TOKEN` | `${{site.INTERNAL_SERVICE_TOKEN}}` | Site service-token reference; do not copy the underlying value. | Required for interaction |
| `BUZZ_INTERACTION_ENABLED` | `false` | Enables continuous structured-mention polling and replies. | Yes |
| `BUZZ_INTERACTION_PROFILE_KEY` | profile key | Legacy single-profile label. New deployments route each channel through Site source-adapter policy. | No |
| `BUZZ_INTERACTION_DISPLAY_NAME` | `Prism` | Leading `@name` removed from the runtime prompt. | Yes |
| `BUZZ_INTERACTION_POLL_SECONDS` | `5` | Delay between non-overlapping interaction polls. | Yes |
| `BUZZ_INTERACTION_LOOKBACK_SECONDS` | `3600` | First-start lookback; durable checkpoints are used afterward. | Yes |
| `BUZZ_HISTORY_CHANNEL_ALLOWLIST` | channel UUIDs | Channels readable through the internal service-authenticated direct-history route. Empty disables the route. | Yes |
| `BUZZ_HISTORY_MAX_LOOKBACK_SECONDS` | `7200` | Maximum direct-history lookback accepted by the adapter. | Yes |
| `BUZZ_HISTORY_MAX_MESSAGES` | `100` | Maximum messages returned by one direct-history request. | Yes |

## Codex Runtime

| Variable | Value | Description | Optional? |
| --- | --- | --- | --- |
| `PORT` | `3030` | Port the Codex Runtime service listens on. | No |
| `NODE_ENV` | `production` | Runtime environment for Codex Runtime. | No |
| `CODEX_BIN` | `/app/node_modules/.bin/codex` | Path to the Codex CLI binary inside the runtime image. | No |
| `CODEX_HOME` | `/data/codex` | Mounted Codex home directory for auth and thread state. | No |
| `CODEX_RUNTIME_TIMEOUT_MS` | `600000` | Maximum Codex execution timeout in milliseconds. | No |
| `CODEX_RUNTIME_PROMPT_WARN_BYTES` | empty | Emits a size warning trace when the composed stdin prompt exceeds this byte count. | Yes |
| `CODEX_RUNTIME_PROMPT_MAX_BYTES` | empty | Rejects an oversized composed prompt with structured section metrics before spawning Codex. | Yes |
| `CODEX_IMAGE_GENERATION_ENABLED` | `true` | Enables the Codex CLI built-in `image_generation` feature for `$imagegen` workflows. | No |
| `CODEX_WORKSPACE_ROOT` | `/app` | Default workspace root for Codex execution. | No |
| `CODEX_TARGET_WORKSPACE_ROOT` | `/data/workspaces` | Mounted directory for cloned target repositories. | No |
| `PRISM_API_BASE` | `http://${{prism-memory.RAILWAY_PRIVATE_DOMAIN}}:${{prism-memory.PORT}}` | Private URL for Prism Memory. References the memory service port. | No |
| `PRISM_API_KEY` | `${{prism-memory.PRISM_API_KEY}}` | Prism Memory API key reference. | No |
| `APP_API_BASE_URL` | `http://${{site.RAILWAY_PRIVATE_DOMAIN}}:${{site.PORT}}` | Private URL for the site-owned app API. References the site service port. | No |
| `APP_API_SERVICE_TOKEN` | `${{site.INTERNAL_SERVICE_TOKEN}}` | Internal site service token reference. | No |
| `COMMUNICATION_ADAPTER_BASE_URL` | `http://${{discord-adapter.RAILWAY_PRIVATE_DOMAIN}}:${{discord-adapter.PORT}}` | Private URL for communication adapter destination lookup and direct message sends from Codex agents. | No |
| `COMMUNICATION_ADAPTER_TOKEN` | `${{discord-adapter.SOURCE_ADAPTER_TOKEN}}` | Shared adapter token sent as `X-Adapter-Token` for direct communication adapter calls. | No |
| `PRISM_GATEWAY_ENABLED` | `true` | Enables assigned Gateway connected services and job-scoped compatibility leases. | Yes |
| `PRISM_GATEWAY_BASE_URL` | `http://${{prism-gateway.RAILWAY_PRIVATE_DOMAIN}}:${{prism-gateway.PORT}}` | Private Gateway URL. | Yes |
| `PRISM_GATEWAY_TOKEN` | `${{prism-gateway.GATEWAY_CODEX_RUNTIME_TOKEN}}` | Codex Runtime caller token for Gateway. | Yes |
| `PRISM_RUNTIME_KEY` | `codex-default` | Stable runtime identity associated with Gateway calls. | Yes |
| `TARGET_REPO_GITHUB_TOKEN` | empty | GitHub token for cloning or pushing private target repositories. | Yes |
| `GIT_AUTHOR_NAME` | `Prism Codex` | Git author name used for Codex-created commits. | No |
| `GIT_AUTHOR_EMAIL` | `prism-codex@users.noreply.github.com` | Git author email used for Codex-created commits. | No |

## Task Runner

| Variable | Value | Description | Optional? |
| --- | --- | --- | --- |
| `PORT` | `8790` | Port the task-runner service listens on. | No |
| `TASK_RUNNER_DISABLED` | `false` | Keeps the scheduler enabled. Set true only to pause all task execution. | No |
| `TASK_RUNNER_POLL_SECONDS` | `60` | Poll interval for due task schedules. | No |
| `TASK_RUNNER_TOKEN` | `${{site.INTERNAL_SERVICE_TOKEN}}` | Token for task-runner health/admin calls. | No |
| `APP_API_BASE_URL` | `http://${{site.RAILWAY_PRIVATE_DOMAIN}}:${{site.PORT}}` | Private URL for the site-owned app API. References the site service port. | No |
| `APP_API_SERVICE_TOKEN` | `${{site.INTERNAL_SERVICE_TOKEN}}` | Internal site service token reference. | No |
| `COMMUNICATION_ADAPTER_BASE_URL` | `http://${{discord-adapter.RAILWAY_PRIVATE_DOMAIN}}:${{discord-adapter.PORT}}` | Private URL for built-in communication sync, destination lookup, and task output delivery. | No |
| `COMMUNICATION_ADAPTER_TOKEN` | `${{discord-adapter.SOURCE_ADAPTER_TOKEN}}` | Shared adapter token sent as `X-Adapter-Token` for task-runner communication adapter calls. | No |
| `PRISM_MEMORY_BASE_URL` | `http://${{prism-memory.RAILWAY_PRIVATE_DOMAIN}}:${{prism-memory.PORT}}` | Private URL for Prism Memory. References the memory service port. | No |
| `PRISM_API_KEY` | `${{prism-memory.PRISM_API_KEY}}` | Prism Memory API key reference. | No |
| `CODEX_RUNTIME_BASE_URL` | `http://${{codex-runtime.RAILWAY_PRIVATE_DOMAIN}}:${{codex-runtime.PORT}}` | Private URL for Codex Runtime. References the runtime service port. | No |
| `PRISM_GATEWAY_ENABLED` | `true` | Enables job-scoped Gateway credential leases for assigned script-runner tasks. | Yes |
| `PRISM_GATEWAY_BASE_URL` | `http://${{prism-gateway.RAILWAY_PRIVATE_DOMAIN}}:${{prism-gateway.PORT}}` | Private Gateway URL. | Yes |
| `PRISM_GATEWAY_TOKEN` | `${{prism-gateway.GATEWAY_TASK_RUNNER_TOKEN}}` | Task Runner caller token for Gateway leases. | Yes |

## Discord Sync Cron

| Variable | Value | Description | Optional? |
| --- | --- | --- | --- |
| `PRISM_API_BASE` | `https://${{discord-adapter.RAILWAY_PUBLIC_DOMAIN}}` | Public URL for the Discord adapter service. | No |
| `PRISM_TRIGGER_BODY` | `{}` | JSON body sent to the Discord sync endpoint. | No |
| `PRISM_TRIGGER_PATH` | `/sync` | Path on the Discord adapter that triggers Discord message sync. | No |
| `PRISM_TRIGGER_DISABLED` | `true` | Keeps Discord sync disabled until Discord credentials are configured. | No |
| `PRISM_TRIGGER_AUTH_TOKEN` | `${{discord-adapter.SOURCE_ADAPTER_TOKEN}}` | Shared token used to authorize cron calls to the Discord adapter. | No |
| `PRISM_TRIGGER_AUTH_HEADER` | `X-Adapter-Token` | Header name used to send the Discord adapter auth token. | No |

## Memory Cron

| Variable | Value | Description | Optional? |
| --- | --- | --- | --- |
| `PRISM_API_BASE` | `https://${{prism-memory.RAILWAY_PUBLIC_DOMAIN}}` | Public URL for the Prism Memory service. | No |
| `PRISM_TRIGGER_PATH` | `/ops/memory/run` | Prism Memory endpoint that runs collection, digest, memory, and seeds. | No |
| `PRISM_TRIGGER_AUTH_HEADER` | `X-Prism-Api-Key` | Header name used to send the Prism API key. | No |
| `PRISM_TRIGGER_AUTH_TOKEN` | `${{prism-memory.PRISM_API_KEY}}` | Prism Memory API key reference. | No |
| `PRISM_TRIGGER_BODY` | `{}` | JSON body sent to the memory run endpoint. | No |

## Knowledge Cron

| Variable | Value | Description | Optional? |
| --- | --- | --- | --- |
| `PRISM_API_BASE` | `https://${{prism-memory.RAILWAY_PUBLIC_DOMAIN}}` | Public URL for the Prism Memory service. | No |
| `PRISM_TRIGGER_PATH` | `/ops/knowledge/run` | Prism Memory endpoint that promotes, validates, and indexes knowledge docs. | No |
| `PRISM_TRIGGER_AUTH_HEADER` | `X-Prism-Api-Key` | Header name used to send the Prism API key. | No |
| `PRISM_TRIGGER_AUTH_TOKEN` | `${{prism-memory.PRISM_API_KEY}}` | Prism Memory API key reference. | No |
| `PRISM_TRIGGER_BODY` | `{}` | JSON body sent to the knowledge run endpoint. | No |
