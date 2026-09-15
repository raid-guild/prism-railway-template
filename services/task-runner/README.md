# Task Runner Service

`task-runner` is the first step toward a first-class Tasks workflow.

It replaces the fixed Railway cron workers by running built-in scheduled tasks:

- Discord sync
- Prism Memory run
- Prism Knowledge source sync
- Prism Knowledge run
- Prism Doctor report

It also runs DB-authored prompt, HTTP, script, and workflow automations. Built-in task definitions, custom task configuration, and run history live in the `site` app DB.

## Endpoints

- `GET /health`
- `GET /tasks`
- `POST /tasks/:key/run`

Manual runs require `X-Task-Runner-Token` when `TASK_RUNNER_TOKEN` is configured.

## Global env

- `PORT=8790`
- `TASK_RUNNER_DISABLED=false`
- `TASK_RUNNER_POLL_SECONDS=60`
- `TASK_RUNNER_TOKEN=<optional internal admin token>`
- `APP_API_BASE_URL=http://site.railway.internal:3100`
- `APP_API_SERVICE_TOKEN=${{site.INTERNAL_SERVICE_TOKEN}}`
- `CODEX_RUNTIME_BASE_URL=http://codex-runtime.railway.internal:3030`
- `TASK_RUNNER_HTTP_TIMEOUT_MS=120000`
- `TASK_RUNNER_LONG_RUNNING_HTTP_TIMEOUT_MS=960000`
- `TASK_RUNNER_SCRIPT_TIMEOUT_MS=120000`
- `TASK_RUNNER_SCRIPT_OUTPUT_MAX_BYTES=256000`
- `TASK_RUNNER_SCRIPT_KILL_GRACE_MS=5000`

When `APP_API_BASE_URL` is set, the runner idempotently registers built-in task defaults, reads effective enabled state and cron schedules from `site`, and writes task run history through internal APIs.

Manual task runs return `202 Accepted` after the run is started. Completion is recorded asynchronously in the `site` task run row and linked agent run, so the UI should refresh task runs instead of waiting for the entire agent run in the HTTP request.

`TASK_RUNNER_HTTP_TIMEOUT_MS` applies to normal service calls. Codex-backed prompt and workflow steps use `TASK_RUNNER_LONG_RUNNING_HTTP_TIMEOUT_MS`, which defaults to `CODEX_RUNTIME_TIMEOUT_MS + 60000` or 15 minutes, whichever is larger. Both timeout values may be set higher for long-running agent tasks.

## Built-in Tasks

The built-in task defaults are seeded into `site` on startup and on scheduler polls only when a row does not already exist:

- `discord-sync`: disabled, `0 * * * *`
- `memory-run`: disabled, `45 * * * *`
- `knowledge-source-sync`: disabled, `15 * * * *`
- `skill-source-sync`: disabled, `20 * * * *`
- `knowledge-run`: disabled, `55 * * * *`
- `prism-doctor`: disabled, `0 15 * * 1`

After seeding, `site` DB values are the scheduler source of truth. The runner refreshes task rows on each poll.

## Custom prompt tasks

User-authored scheduled prompt tasks use `taskType=codex-prompt` in the `site` DB. The runner loads these rows from `site`, reads `instructionConfig.prompt`, and replays the prompt through `codex-runtime`.

Supported config:

- `instructionConfig.prompt`: required prompt text
- `instructionConfig.requestedSkills`: optional skill names forwarded to `codex-runtime`
- `inputConfig`: optional metadata passed to the runtime
- `outputConfig`: optional metadata passed to the runtime

The runner calls:

- `POST /v1/responses` on `CODEX_RUNTIME_BASE_URL`

## HTTP POST tasks

Deterministic HTTP POST tasks use `taskType=http-post` in the `site` DB. Use
this for simple external HTTPS cron jobs that should not invoke Codex Runtime.

Supported config:

```json
{
  "key": "portal-notification-email-dispatch",
  "name": "Portal notification email dispatch",
  "scheduleCron": "*/5 * * * *",
  "taskType": "http-post",
  "inputConfig": {
    "method": "POST",
    "url": "https://portal.raidguild.org/api/notifications/email/run",
    "headers": {
      "Authorization": "Bearer ${PORTAL_TASK_SECRET}"
    },
    "body": {
      "limit": 50
    },
    "retry": {
      "attempts": 3,
      "backoff": "exponential"
    },
    "timeoutMs": 30000
  }
}
```

The runner only accepts `https:` URLs and always sends a JSON body with
`Content-Type: application/json`. Custom headers may reference task-runner
environment variables with `${ENV_NAME}`; configured `Content-Type` headers are
ignored so the serialized body and content type stay aligned. The secret value
is not stored in the task row.

The job logs each attempt with timestamp, endpoint, HTTP status, parsed response
result counts when present, and error body for non-2xx responses. Retries are
bounded by `inputConfig.retry.attempts`; no task run retries forever. The task
runner also prevents concurrent runs of the same task key.

## Script runner tasks

Deterministic scheduled tasks use `taskType=script-runner`. Use this for watchdogs, pollers, API checks, checkpoint updates, and other jobs that should not spend LLM tokens on every run.

Task rows reference a site-owned task script by key. They do not store inline code.

Supported config:

```json
{
  "taskType": "script-runner",
  "inputConfig": {
    "scriptKey": "http-health-watchdog",
    "params": {
      "url": "https://example.com/health",
      "expectedStatus": 200,
      "unhealthyThreshold": 3
    },
    "timeoutMs": 60000
  },
  "outputConfig": {
    "outputDestinations": [
      {
        "adapter": "discord",
        "type": "discord-channel",
        "id": "1234567890",
        "label": "#ops"
      }
    ]
  }
}
```

Create scripts through the site service:

```json
{
  "key": "http-health-watchdog",
  "name": "HTTP health watchdog",
  "runtime": "node-esm",
  "enabled": true,
  "timeoutMs": 60000,
  "content": "let raw = ''; for await (const chunk of process.stdin) raw += chunk; const input = JSON.parse(raw); console.log(JSON.stringify({ ok: true, summary: `Checked ${input.params.url}` }));"
}
```

The runner fetches `/agent/task-scripts/:key/content`, executes `node-esm` script content ephemerally without a shell, passes a JSON payload on stdin, and also sets:

- `PRISM_TASK_KEY`
- `PRISM_TASK_SCRIPT_KEY`
- `PRISM_TASK_PARAMS_JSON`

Scripts should write JSON to stdout. Recommended output:

```json
{
  "ok": true,
  "status": "healthy",
  "summary": "API healthy",
  "shouldNotify": false,
  "shouldEscalate": false
}
```

To invoke an agent only for meaningful results, add a conditional handoff:

```json
{
  "instructionConfig": {
    "prompt": "Analyze the matching API results and recommend the next action.",
    "requestedSkills": ["api-result-reviewer"]
  },
  "agentConfig": {
    "handoff": {
      "enabled": true,
      "when": "shouldEscalate"
    },
    "gatewayCredentials": ["example-api"]
  }
}
```

With handoff enabled, stdout must be a JSON object. Codex Runtime is not called
unless `shouldEscalate` is exactly `true`. The runner passes the configured
prompt plus the complete script result as explicitly untrusted data, forwards
requested skills and Gateway credentials, and stores the script result and
handoff decision in task-run metadata. The agent response becomes the task body
used for output delivery. `shouldNotify:false` on the script result suppresses
that delivery without suppressing the requested agent analysis.

If `outputConfig.outputDestinations` is configured, task-runner posts the script output unless the JSON body contains `shouldNotify:false` or `notify:false`.

For notifications, task-runner prefers a JSON `responseText`, `output_text`, `summary`, `message`, or `text` field before falling back to raw output. Stdout/stderr capture is bounded by `TASK_RUNNER_SCRIPT_OUTPUT_MAX_BYTES` so noisy scripts cannot exhaust task-runner memory.

Script-runner tasks may declare credentials through
`agentConfig.gatewayCredentials`. When assigned, Task Runner leases their
credentials from Prism Gateway and injects the returned environment variables
only into the script child process. Do not place provider credentials in task
params or script content. Assigned leases fail closed when Gateway is disabled
or unavailable. Configure `PRISM_GATEWAY_ENABLED`, `PRISM_GATEWAY_BASE_URL`, and
the Task Runner-specific `PRISM_GATEWAY_TOKEN`; never reuse the Site or runtime
caller token.

## Workflow runner tasks

Scheduled workflow tasks use `taskType=workflow-runner`. The runner creates a request through `site`, then optionally invokes the current workflow step through `/agent/responses`.

Supported config:

```json
{
  "taskType": "workflow-runner",
  "inputConfig": {
    "workflowKey": "blog-post-draft-review-publish",
    "request": {
      "title": "Weekly blog post",
      "description": "Create this week's blog post from Prism Memory and Knowledge.",
      "requestType": "content",
      "priority": "normal"
    },
    "autoRun": {
      "enabled": true,
      "maxSteps": 1,
      "stopStatuses": ["closed"]
    }
  },
  "instructionConfig": {
    "prompt": "Run the current workflow step using the request description and workflow step instructions."
  }
}
```

The default behavior creates the request and immediately invokes the workflow. The site service runs consecutive agent steps until the workflow reaches a gate, checkpoint, terminal state, failure, or its server-side continuation guard. `maxSteps` remains as a compatibility guard around repeated task-runner invocations; the usual value is `1`.

The runner calls:

- `POST /agent/change-board/requests` on `APP_API_BASE_URL`
- `POST /agent/responses` on `APP_API_BASE_URL`

### Discord sync

- `COMMUNICATION_ADAPTER_BASE_URL=http://discord-adapter.railway.internal:8789`
- `COMMUNICATION_ADAPTER_TOKEN=...`

The runner calls:

- `POST /sync`
- header: `X-Adapter-Token`

### Output delivery

- `COMMUNICATION_ADAPTER_BASE_URL=http://discord-adapter.railway.internal:8789`
- `COMMUNICATION_ADAPTER_TOKEN=...`

The runner calls:

- `GET /destinations`
- `POST /messages`
- header: `X-Adapter-Token`

### Memory run

- `PRISM_MEMORY_BASE_URL=http://prism-memory.railway.internal:8788`
- `PRISM_API_KEY=...`

The runner calls:

- `POST /ops/memory/run`
- header: `X-Prism-Api-Key`

### Knowledge run

- `PRISM_MEMORY_BASE_URL=http://prism-memory.railway.internal:8788`
- `PRISM_API_KEY=...`

The runner calls:

- `POST /ops/knowledge/run`
- header: `X-Prism-Api-Key`

### Knowledge source sync

- `PRISM_MEMORY_BASE_URL=http://prism-memory.railway.internal:8788`
- `PRISM_API_KEY=...`

The runner calls:

- `POST /ops/knowledge/sources/sync`
- header: `X-Prism-Api-Key`

The Prism Memory endpoint checks each configured GitHub source remote branch head and only syncs sources whose head differs from `last_synced_commit`.

### Skill source sync

- `APP_API_BASE_URL=http://site.railway.internal:4010`
- `APP_API_SERVICE_TOKEN=...`

The runner calls:

- `POST /agent/skill-sources/sync`
- header: `X-Service-Token`

The site endpoint syncs enabled GitHub-backed skill sources into the site data volume, validates each `SKILL.md`, and exposes successful source-backed skills through `/agent/skills`.

### Prism Doctor

- `APP_API_BASE_URL=http://site.railway.internal:4010`
- `APP_API_SERVICE_TOKEN=...`

The runner calls:

- `GET /agent/workflows`
- `GET /agent/workflows/:key`
- `GET /agent/tasks`
- `GET /agent/hooks`
- `GET /agent/skills`

The task emits a report-only JSON body. It checks workflow structure for simple
gate `next` flow, missing step links, and loop target/exit/max-iteration config,
legacy Gateway toolset/capability fields, and legacy toolset instructions,
then warns when tasks or hooks reference workflows with findings. It does not
mutate workflows, tasks, hooks, skills, requests, or instance config.

## Validation approach

Deploy this first on the ejected `prism-stack` project from a feature branch.

Recommended rollout:

1. deploy `task-runner` with all tasks disabled
2. use `POST /tasks/:key/run` for manual tests
3. enable one schedule at a time
4. disable the old Railway cron service for that job only after the runner proves stable
