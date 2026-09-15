# Task Runner Template Rollover Checklist

Use this to update the Railway template and migrate existing instances from the three fixed Railway cron services to the built-in `task-runner` service.

## Target Shape

- [ ] Template includes these long-running services:
  - `site`
  - `prism-memory`
  - `discord-adapter`
  - `codex-runtime`
  - `task-runner`
- [ ] Template no longer creates these recurring cron services for new installs:
  - `discord-sync-cron`
  - `memory-cron`
  - `knowledge-cron`
- [ ] `task-runner` is one always-on service, not a Railway cron service.
- [ ] `task-runner` has exactly one running instance/replica.
- [ ] Built-in task schedules are stored in the `site` DB `tasks` table.
- [ ] Built-in task run history is stored in the `site` DB `task_runs` table.

## Railway Service Setup

- [ ] Add `task-runner` to the template source project.
  - Root directory: `/services/task-runner`
  - Build: Dockerfile
  - Healthcheck path: `/health`
  - Restart policy: `ON_FAILURE`
  - Restart retries: `10`
- [ ] Do not attach a volume to `task-runner`.
- [ ] Do not add a Railway cron schedule to `task-runner`.
- [ ] Set `task-runner` service instances/replicas to `1`.
- [ ] Keep existing volumes:
  - `site`: `/data`
  - `prism-memory`: `/data`
  - `discord-adapter`: `/data`
  - `codex-runtime`: `/data`

## Task Runner Variables

Set these on `task-runner`:

- [ ] `PRISM_GATEWAY_ENABLED=true` when script-runner tasks use connected services.
- [ ] `PRISM_GATEWAY_BASE_URL=http://${{prism-gateway.RAILWAY_PRIVATE_DOMAIN}}:${{prism-gateway.PORT}}`.
- [ ] `PRISM_GATEWAY_TOKEN=${{prism-gateway.GATEWAY_TASK_RUNNER_TOKEN}}`.
- [ ] Gateway has a distinct generated `GATEWAY_TASK_RUNNER_TOKEN`; do not reuse Site or runtime tokens.

```text
PORT="8790"
TASK_RUNNER_DISABLED="false"
TASK_RUNNER_POLL_SECONDS="60"
TASK_RUNNER_TOKEN="${{site.INTERNAL_SERVICE_TOKEN}}"
APP_API_BASE_URL="http://${{site.RAILWAY_PRIVATE_DOMAIN}}:${{site.PORT}}"
APP_API_SERVICE_TOKEN="${{site.INTERNAL_SERVICE_TOKEN}}"
COMMUNICATION_ADAPTER_BASE_URL="http://${{discord-adapter.RAILWAY_PRIVATE_DOMAIN}}:${{discord-adapter.PORT}}"
COMMUNICATION_ADAPTER_TOKEN="${{discord-adapter.SOURCE_ADAPTER_TOKEN}}"
PRISM_MEMORY_BASE_URL="http://${{prism-memory.RAILWAY_PRIVATE_DOMAIN}}:${{prism-memory.PORT}}"
PRISM_API_KEY="${{prism-memory.PRISM_API_KEY}}"
CODEX_RUNTIME_BASE_URL="http://${{codex-runtime.RAILWAY_PRIVATE_DOMAIN}}:${{codex-runtime.PORT}}"
```

- [ ] Do not set `TASK_DISCORD_SYNC_ENABLED`.
- [ ] Do not set `TASK_DISCORD_SYNC_CRON`.
- [ ] Do not set `TASK_MEMORY_RUN_ENABLED`.
- [ ] Do not set `TASK_MEMORY_RUN_CRON`.
- [ ] Do not set `TASK_KNOWLEDGE_RUN_ENABLED`.
- [ ] Do not set `TASK_KNOWLEDGE_RUN_CRON`.
- [ ] Keep referenced URL values on one line in Railway raw variable blocks.
- [ ] Verify rendered private URLs include explicit ports.

## Site Requirements

- [ ] Deploy `site` before `task-runner`.
- [ ] Set this on `site` if the admin Tasks tab should show runner state and support manual runs:

```text
TASK_RUNNER_BASE_URL="http://${{task-runner.RAILWAY_PRIVATE_DOMAIN}}:${{task-runner.PORT}}"
```

- [ ] Confirm migration `006_tasks` is applied.
- [ ] Confirm `/api/health` reports the expected migration count.
- [ ] Confirm `POST /agent/tasks` supports `preserveExisting`.
- [ ] Confirm `GET /agent/tasks` returns:
  - `discord-sync`
  - `memory-run`
  - `knowledge-run`
  - `knowledge-source-sync`

## Built-In Task Defaults

These are seeded by `task-runner` only when a task row does not already exist:

| Task | Default Enabled | Default Cron |
| --- | --- | --- |
| `discord-sync` | `false` | `0 * * * *` |
| `memory-run` | `false` | `45 * * * *` |
| `knowledge-source-sync` | `false` | `15 * * * *` |
| `knowledge-run` | `false` | `55 * * * *` |

- [ ] Keep `knowledge-run` hourly at `55 * * * *` for new template instances.

## Singleton / One-Instance Rule

`task-runner` must run as a singleton because it polls schedules and executes due tasks from process memory.

- [ ] Keep Railway replicas/instances at `1`.
- [ ] Do not enable multi-region replicas for `task-runner`.
- [ ] Do not run a second `task-runner` service against the same `site` DB.
- [ ] During migration, do not leave old cron services enabled for the same task after the task-runner schedule has been verified.
- [ ] Treat future horizontal scaling as blocked until the scheduler has a DB-backed lease/lock around due task claims.

## New Template Install Flow

- [ ] Deploy the template with `task-runner` included and old cron services omitted.
- [ ] Bootstrap `site`:
  - `npm run migrate --workspace @prism-railway/site`
  - `npm run bootstrap:admin --workspace @prism-railway/site`
  - `npm run bootstrap:targets --workspace @prism-railway/site`
- [ ] Deploy/redeploy `site`.
- [ ] Deploy/redeploy `task-runner`.
- [ ] Confirm `task-runner /health` shows all built-in tasks disabled.
- [ ] Run manual task tests:
  - `POST /tasks/memory-run/run`
  - `POST /tasks/knowledge-source-sync/run`
  - `POST /tasks/knowledge-run/run`
  - `POST /tasks/discord-sync/run`
- [ ] Confirm each manual run writes a `succeeded` row to `/agent/tasks/runs`.
- [ ] Enable schedules by updating `site` DB task rows, not Railway env.

## Existing Instance Migration

Use this for `prism-stack` and any already-created template instances.

- [ ] Deploy `site` with `006_tasks` and `preserveExisting` support.
- [ ] Run migrations on `site`.
- [ ] Deploy `task-runner`.
- [ ] Confirm all built-ins are registered into `site`.
- [ ] Confirm `task-runner` private connectivity to:
  - `site`
  - `prism-memory`
  - `discord-adapter`
- [ ] Run the three manual task tests.
- [ ] Enable one schedule at a time in the DB.
- [ ] After one scheduled success, disable the corresponding old cron service.
- [ ] Repeat until all three old cron services are disabled.
- [ ] Remove old cron services from the project only after at least one normal cycle has completed for each replacement task.

## Rollover Order

Recommended order:

1. `memory-run`
2. `knowledge-source-sync`
3. `knowledge-run`
4. `discord-sync`

For each task:

- [ ] Set the DB row `enabled=true`.
- [ ] Confirm `scheduleCron` is correct.
- [ ] Wait for a scheduled `succeeded` task run.
- [ ] Disable the matching old Railway cron service.
- [ ] Watch logs and task run history for one more cycle.

## Template Docs To Update

- [ ] `docs/template/template-authoring.md`
  - Replace cron services with `task-runner`.
  - Add singleton note.
- [ ] `docs/operations/template-deploy-runbook.md`
  - Replace cron setup with task DB schedule setup.
  - Add manual task-runner validation steps.
- [ ] `docs/operations/railway-env-checklist.md`
  - Remove cron service env sections from the default path.
  - Add `task-runner` env section.
- [ ] `docs/template/template-variable-reference.md`
  - Remove `api` references where the consolidated service is now `site`.
  - Add `task-runner` variables.
  - Remove old cron variable tables from the recommended template path.
- [ ] `docs/operations/railway-setup.md`
  - Replace recommended cron services with `task-runner`.
- [ ] `scripts/railway-deploy-prism-stack.sh`
  - Add optional `task-runner` deploy support.
  - Stop describing Railway cron schedule setup as required for the new path.
- [ ] Railway template source project
  - Add `task-runner` service.
  - Remove or mark old cron services as legacy.
  - Regenerate and smoke-test the published template.

## Final Acceptance

- [ ] Fresh template install has no old cron services.
- [ ] Fresh template install has one online `task-runner` service.
- [ ] `site` DB contains four disabled built-in task rows after `task-runner` first boot.
- [ ] Manual runs succeed and write durable run history.
- [ ] Enabling a task in DB causes exactly one scheduled execution per cron tick.
- [ ] Redeploying `task-runner` does not overwrite existing DB task schedules.
- [ ] Existing migrated instances have old cron services disabled or removed.
