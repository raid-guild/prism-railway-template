# Script Runner Tasks

Script runner tasks are deterministic scheduled jobs for work that does not need an LLM on every run.

Use cases:

- API watchdogs and health checks
- external API pollers
- checkpoint maintenance
- cheap sync checks
- notification gates that only alert on meaningful events

## Model

Task rows use `taskType="script-runner"` and reference a site-owned task script by key:

```json
{
  "key": "api-watchdog",
  "name": "API watchdog",
  "enabled": false,
  "triggerType": "schedule",
  "scheduleCron": "*/10 * * * *",
  "timezone": "UTC",
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
  "instructionConfig": {},
  "agentConfig": {
    "gatewayCredentials": ["example"]
  },
  "outputConfig": {}
}
```

Do not store inline JavaScript, shell, or Python in task rows. The task row stores orchestration config; executable code lives in a site-owned task script managed through `/agent/task-scripts`.

`params` are non-secret task inputs. When a script needs an organization
credential, assign an adapter connected service through
`agentConfig.gatewayCredentials` and read its declared environment variable from
`process.env`. Task Runner leases those values for one execution and exposes
them only to the child process. It fails the task if an assigned lease cannot be
obtained; it does not fall back to credentials embedded in params or script
content.

## Task Script

Create the script through the site service before creating or enabling the task:

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

The site stores script metadata in the DB and script content in site-managed storage. The runner fetches `/agent/task-scripts/:key/content`, executes the script ephemerally without a shell, and sends task context as JSON on stdin.

## Script Output

Scripts should write JSON to stdout:

```json
{
  "ok": false,
  "status": "unhealthy",
  "summary": "Health check returned HTTP 503",
  "consecutiveFailures": 3,
  "shouldNotify": true,
  "shouldEscalate": true,
  "details": {
    "statusCode": 503,
    "latencyMs": 1240
  },
  "agentConfig": {
    "gatewayCredentials": ["example"]
  }
}
```

`params` are non-secret task inputs. When a script needs an organization
credential, assign an adapter connected service through
`agentConfig.gatewayCredentials` and read its declared environment variable from
`process.env`. Task Runner leases those values for one execution and exposes
them only to the child process. It fails the task if an assigned lease cannot be
obtained; it does not fall back to credentials embedded in params or script
content.

When `outputConfig.outputDestinations` is set, task-runner delivers the script output unless the JSON body includes `shouldNotify:false` or `notify:false`.

For destination messages, task-runner prefers `responseText`, `output_text`, `summary`, `message`, or `text` before falling back to raw JSON. Prefer `summary` for human-readable watchdog alerts.

Script stdout and stderr capture is bounded by `TASK_RUNNER_SCRIPT_OUTPUT_MAX_BYTES`, and timed-out scripts receive `SIGTERM` followed by `SIGKILL` after `TASK_RUNNER_SCRIPT_KILL_GRACE_MS`.

## Conditional agent handoff

A script task can invoke Codex only when its JSON output contains
`shouldEscalate:true`. Configure the handoff on the same task:

```json
{
  "taskType": "script-runner",
  "inputConfig": {
    "scriptKey": "api-result-check",
    "params": { "url": "https://example.com/events" }
  },
  "instructionConfig": {
    "prompt": "Review the matching events and recommend the appropriate follow-up.",
    "requestedSkills": ["event-reviewer"]
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

The execution order is deterministic:

1. Run the script without an LLM.
2. Require a JSON object on stdout when handoff is enabled.
3. Finish successfully without invoking Codex unless `shouldEscalate` is
   exactly `true`.
4. When true, start one Codex Runtime job with the configured prompt and the
   full script result. The result is labeled as untrusted data so values from
   the queried API cannot silently become agent instructions.
5. Store the script result and handoff decision in the task run metadata. When
   an agent runs, its response becomes the deliverable task body.

`shouldNotify:false` continues to suppress output-adapter delivery even when an
agent handoff ran. An enabled handoff supports only `when="shouldEscalate"` and
requires `instructionConfig.prompt`; Site rejects invalid task definitions.
