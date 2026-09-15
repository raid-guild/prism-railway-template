# Prism Railway Template Authoring

This repo is the source code for a Railway template. The template itself should be generated from a clean Railway project after the project has been configured once in the Railway dashboard.

## Recommended Flow

1. Keep this repo public and free of runtime data, local env files, generated builds, and service volumes.
2. Create a clean Railway project named something like `prism-stack-template-source`.
3. Add one Railway service for each deployable service in this repo.
4. Configure root directories, public networking, health checks, volumes, variables, and cron schedules in that source project.
5. Smoke-test the source project.
6. Generate the Railway template from the source project.
7. Deploy the generated template into a fresh project and run the post-deploy checks.

## Template Services

| Railway service | Source directory | Notes |
| --- | --- | --- |
| `site` | `services/site` | Browser-facing app/admin UI and app API. Requires persistent `/data` volume for SQLite/runtime state. |
| `prism-memory` | `services/prism-memory` | Requires persistent `/data` volume. |
| `discord-adapter` | `services/source-adapter` | Discord sync, chat, slash commands, and voice recording. Requires persistent `/data` volume for recordings/recovery. |
| `codex-runtime` | `services/codex-runtime` | Requires persistent `/data` volume for Codex auth and target workspaces. |
| `prism-gateway` | `services/prism-gateway` | Optional capability and connection boundary. Requires persistent `/data` volume for encrypted SQLite state. |
| `discord-sync-cron` | `services/prism-trigger` | Cron service that calls the Discord adapter `/sync` endpoint. |
| `memory-cron` | `services/prism-trigger` | Cron service that calls Prism memory `/ops/memory/run`. |
| `knowledge-cron` | `services/prism-trigger` | Cron service that calls Prism memory `/ops/knowledge/run`. |

## Variables

Use Railway reference variables wherever possible so the canvas shows service edges and so template users do not have to copy internal URLs by hand.

Good reference variable examples:

- `site.NEXT_PUBLIC_API_BASE_URL=https://${{site.RAILWAY_PUBLIC_DOMAIN}}`
- `site.API_INTERNAL_BASE_URL=http://${{site.RAILWAY_PRIVATE_DOMAIN}}:${{site.PORT}}`
- `discord-adapter.APP_API_BASE_URL=http://${{site.RAILWAY_PRIVATE_DOMAIN}}:${{site.PORT}}`
- `discord-adapter.CODEX_RUNTIME_BASE_URL=http://${{codex-runtime.RAILWAY_PRIVATE_DOMAIN}}:${{codex-runtime.PORT}}`
- `discord-adapter.PRISM_API_BASE=https://${{prism-memory.RAILWAY_PUBLIC_DOMAIN}}`
- `codex-runtime.APP_API_BASE_URL=http://${{site.RAILWAY_PRIVATE_DOMAIN}}:${{site.PORT}}`
- `codex-runtime.PRISM_API_BASE=http://${{prism-memory.RAILWAY_PRIVATE_DOMAIN}}:${{prism-memory.PORT}}`
- `codex-runtime.COMMUNICATION_ADAPTER_BASE_URL=http://${{discord-adapter.RAILWAY_PRIVATE_DOMAIN}}:${{discord-adapter.PORT}}`
- `codex-runtime.COMMUNICATION_ADAPTER_TOKEN=${{discord-adapter.SOURCE_ADAPTER_TOKEN}}`
- `site.PRISM_GATEWAY_BASE_URL=http://${{prism-gateway.RAILWAY_PRIVATE_DOMAIN}}:${{prism-gateway.PORT}}`
- `site.PRISM_GATEWAY_TOKEN=${{prism-gateway.GATEWAY_SITE_TOKEN}}`
- `codex-runtime.PRISM_GATEWAY_BASE_URL=http://${{prism-gateway.RAILWAY_PRIVATE_DOMAIN}}:${{prism-gateway.PORT}}`
- `codex-runtime.PRISM_GATEWAY_TOKEN=${{prism-gateway.GATEWAY_CODEX_RUNTIME_TOKEN}}`
- `task-runner.PRISM_GATEWAY_BASE_URL=http://${{prism-gateway.RAILWAY_PRIVATE_DOMAIN}}:${{prism-gateway.PORT}}`
- `task-runner.PRISM_GATEWAY_TOKEN=${{prism-gateway.GATEWAY_TASK_RUNNER_TOKEN}}`
- `discord-sync-cron.PRISM_API_BASE=https://${{discord-adapter.RAILWAY_PUBLIC_DOMAIN}}`
- `memory-cron.PRISM_API_BASE=https://${{prism-memory.RAILWAY_PUBLIC_DOMAIN}}`
- `knowledge-cron.PRISM_API_BASE=https://${{prism-memory.RAILWAY_PUBLIC_DOMAIN}}`

Template-required user inputs:

- `DISCORD_BOT_TOKEN`
- `DISCORD_APPLICATION_ID`
- `DISCORD_GUILD_ID`
- `VOICE_TRANSCRIPTION_BASE_URL` and `VOICE_TRANSCRIPTION_API_KEY` if voice transcription is enabled
- `TARGET_REPO_GITHUB_TOKEN` if change requests should push branches to private target repos

Template-generated secrets:

- `SESSION_SECRET`
- `INTERNAL_SERVICE_TOKEN`
- `PRISM_API_KEY`
- `SOURCE_ADAPTER_TOKEN`
- `GATEWAY_MASTER_ENCRYPTION_KEY`
- `GATEWAY_SITE_TOKEN`
- `GATEWAY_CODEX_RUNTIME_TOKEN`

## Post-Deploy Steps

After deploying the template into a new project:

1. Link the local CLI to the new project and environment.
2. Run the site bootstrap script to migrate and seed admin/catalog/target state.
3. Register Discord slash commands if automatic registration is disabled or failed.
4. SSH into `codex-runtime` and run `codex login --device-auth` with `CODEX_HOME` on the mounted volume.
5. Run health checks for `api`, `site`, `prism-memory`, `discord-adapter`, and `codex-runtime`.
6. Run a dry Discord sync before enabling scheduled ingest.
7. Run a small voice recording test if voice capture is enabled.

## Known Template Gaps

- Railway CLI volume creation was unreliable in smoke testing; attach volumes in the template source project instead of relying on post-deploy CLI volume creation.
- Codex device auth is intentionally manual because it writes account auth into the mounted `CODEX_HOME`.
- Target app GitHub/Railway tokens remain operator-provided. Do not bake target repo credentials into the template.
- Some planning docs still describe the old split topology. Keep operator-facing setup docs aligned to the merged `site`-owned app API shape.
