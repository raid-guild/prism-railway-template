# Site-Owned Task Scripts

## Problem

`script-runner` tasks currently store `inputConfig.scriptKey`, but `task-runner` resolves that key only from `TASK_RUNNER_SCRIPT_REGISTRY_JSON`.

That makes chat-authored script tasks confusing:

- Codex Runtime can create the task row through `/agent/tasks`.
- Codex Runtime can create or test a local scratch script in its own workspace.
- The scheduled `task-runner` service cannot see that scratch script.
- The task only runs if an operator also updates task-runner env and provides the script file.

The user-facing contract should be simpler: a script task is valid only when its `scriptKey` points at a site-owned task script that `task-runner` can fetch and execute without LLM calls.

## Goals

- Let Codex Runtime create deterministic scheduled script tasks through Prism APIs.
- Avoid LLM usage on recurring deterministic runs.
- Avoid Railway env edits for each new script.
- Avoid repo commits for instance-specific scripts.
- Avoid requiring a persistent volume on `task-runner`.
- Keep executable code out of DB rows; store DB metadata plus file/object storage references.
- Preserve current timeout, stdout/stderr caps, task run history, and output delivery behavior.
- Remove `TASK_RUNNER_SCRIPT_REGISTRY_JSON` rather than maintaining two script registries.

## Non-Goals

- Do not make `task-runner` depend on Codex Runtime for scheduled script execution.
- Do not execute arbitrary shell command strings from task rows.
- Do not use request artifacts as the primary executable script store.
- Do not build the admin UI in the first slice unless needed for validation.

## Precedent

Hosted Prism skills provide the closest model:

- built-in skills live in `services/site/skills`
- custom skills live on the site data volume under `/data/skills`
- Codex Runtime discovers them through `/agent/skills`
- Codex Runtime downloads full skill content only when needed

Task scripts should follow the same ownership pattern:

- site owns script metadata and content storage
- task-runner discovers/fetches scripts through `/agent/task-scripts`
- task rows reference scripts by stable key

## Proposed Model

Add first-class `task_scripts` managed by the site service.

Script metadata lives in SQLite:

```json
{
  "id": "uuid",
  "key": "hello-cron",
  "name": "Hello cron",
  "description": "Return hello cron as JSON.",
  "runtime": "node-esm",
  "enabled": true,
  "storagePath": "hello-cron/<checksum-prefix>.mjs",
  "checksum": "sha256:...",
  "timeoutMs": 60000,
  "createdAt": "...",
  "updatedAt": "..."
}
```

Script content lives in site-managed storage under the site data root, for example:

```text
/data/task-scripts/hello-cron/<checksum-prefix>.mjs
```

Task rows stay small:

```json
{
  "key": "hello-cron-script",
  "taskType": "script-runner",
  "scheduleCron": "*/10 * * * *",
  "inputConfig": {
    "scriptKey": "hello-cron",
    "params": {
      "message": "hello cron"
    }
  }
}
```

## API Shape

Add site service routes:

```text
GET    /agent/task-scripts
POST   /agent/task-scripts
GET    /agent/task-scripts/:key
PATCH  /agent/task-scripts/:key
DELETE /agent/task-scripts/:key
GET    /agent/task-scripts/:key/content
```

Creation request:

```json
{
  "key": "hello-cron",
  "name": "Hello cron",
  "description": "Return hello cron as JSON.",
  "runtime": "node-esm",
  "enabled": true,
  "timeoutMs": 60000,
  "content": "let raw = '';\nfor await (const chunk of process.stdin) raw += chunk;\nconst input = JSON.parse(raw);\nconsole.log(JSON.stringify({ ok: true, summary: input.params.message }));\n"
}
```

Content response for task-runner:

```json
{
  "ok": true,
  "script": {
    "key": "hello-cron",
    "runtime": "node-esm",
    "enabled": true,
    "timeoutMs": 60000,
    "checksum": "sha256:..."
  },
  "content": "..."
}
```

All routes use existing service auth with `x-service-token`.

## Execution Contract

For `taskType="script-runner"`:

1. `task-runner` reads `inputConfig.scriptKey`.
2. `task-runner` fetches `/agent/task-scripts/:key/content`.
3. It rejects the run if the script is missing, disabled, or has an unsupported runtime.
4. It executes the script ephemerally without a shell.
5. It passes the same JSON stdin payload used by the current registry runner.
6. It passes only selected task env vars:
   - `PRISM_TASK_KEY`
   - `PRISM_TASK_SCRIPT_KEY`
   - `PRISM_TASK_PARAMS_JSON`
7. The script writes JSON or text to stdout.
8. `task-runner` records output in `task_runs.output_snapshot_json`.
9. If configured, `task-runner` delivers output to `outputConfig.outputDestinations`.

The first runtime should be `node-esm`.

## Security Guardrails

- Execute without a shell.
- Do not inherit the full task-runner env by default.
- Keep current timeout limit with per-script override capped by runner max.
- Keep stdout/stderr byte caps.
- Reject disabled scripts.
- Record script `key`, `runtime`, `checksum`, and `version` or `updatedAt` in task run output.
- Validate script keys with the same conservative slug pattern used by skills/workflows.
- Store script content under a path derived from the script key and validate resolved paths stay under the task-script storage root.

## Migration Plan

Phase 1: Site Storage and API

- Add migration for `task_scripts`.
- Add task script storage helpers under `services/site/src/lib/app-core`.
- Add repository methods:
  - `listTaskScripts`
  - `getTaskScriptByKey`
  - `upsertTaskScript`
  - `deleteTaskScriptByKey`
- Add `/agent/task-scripts` routes.
- Add tests or route-level smoke coverage where practical.

Phase 2: Task-Runner Fetch and Execute

- Add task-runner client helpers for `/agent/task-scripts/:key/content`.
- Add `node-esm` ephemeral execution.
- Update `buildScriptRunnerTask` to require site-owned scripts.
- Remove `TASK_RUNNER_SCRIPT_REGISTRY_JSON` parsing and execution paths.
- Fail `script-runner` executions when `scriptKey` does not resolve to an enabled site-owned script.
- Include script metadata in task run output snapshots.

Phase 3: Authoring Rules and Docs

- Update `services/site/skills/prism-task-author/SKILL.md`:
  - verify/create `/agent/task-scripts` before creating a `script-runner` task
  - never rely on Codex Runtime local files for scheduled execution
  - create invalid/unresolved script tasks disabled or reject them
- Update `docs/features/script-runner-tasks.md`.
- Update `services/task-runner/README.md`.

Phase 4: Cleanup

- Remove env documentation for `TASK_RUNNER_SCRIPT_REGISTRY_JSON`.
- Remove stale script-registry examples from task-runner docs.
- Consider an admin UI for listing scripts, viewing checksums, and disabling scripts.

## Example End-to-End Flow

User asks:

> Make a task that returns hello cron as JSON every 10 minutes.

Agent should:

1. Create task script:

```text
POST /agent/task-scripts
```

2. Create task:

```text
POST /agent/tasks
```

3. Optionally trigger a manual run through task-runner:

```text
POST /tasks/hello-cron-script/run
```

The response should mention both resources:

- task script key: `hello-cron`
- task key: `hello-cron-script`
- schedule: `*/10 * * * *`
- enabled state
- manual run result, if triggered

## Conditional Agent Handoff

Scripts receive provider credentials only through explicit
`agentConfig.gatewayCredentials`. A task may additionally enable
`agentConfig.handoff` with `when="shouldEscalate"`. The runner invokes Codex
only when the script returns a JSON object with `shouldEscalate:true`; false or
missing values are deterministic no-ops. This is an agent response handoff, not
automatic request or workflow creation.
