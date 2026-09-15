---
name: prism-instance-profile
description: Use this skill when Codex is asked to audit, explain, or change a Prism instance profile such as collector/memory-core vs workspace mode, especially to disable default source collection tasks without deleting data.
---

Use this skill for safe instance-profile operations after a Prism template deploy.

This is an operational profile, not a hard platform mode. Do not change Railway
environment variables, delete memory data, delete tasks, or rewrite workflows
unless the user explicitly asks for that separate work.

Required environment:

- `PRISM_AGENT_API_BASE_URL`
- `PRISM_AGENT_SERVICE_TOKEN`

If those names are not present, use:

- `APP_API_BASE_URL`
- `APP_API_SERVICE_TOKEN`

Send service auth as:

```bash
-H "x-service-token: ${PRISM_AGENT_SERVICE_TOKEN:-$APP_API_SERVICE_TOKEN}"
```

## Profiles

`collector` / `memory-core`:

- owns canonical source collection
- owns scheduled memory and knowledge materialization
- may run Discord/Telegram source sync tasks
- may run voice recording and post-recording workflows when configured
- exposes Prism Memory as a shared read source for other workspace instances

`workspace`:

- owns specialized requests, skills, workflows, tasks, hooks, and source policy
- may use Discord/Telegram chat and output delivery
- may read from a shared Prism Memory Core
- may have local Prism Memory for scratch artifacts or specialized knowledge
- does not run broad default source collectors unless explicitly re-enabled

Workspace mode does **not** mean "no memory". It means "no default broad
collection".

## Audit Current Profile

List tasks:

```bash
curl -fsSL \
  -H "x-service-token: ${PRISM_AGENT_SERVICE_TOKEN:-$APP_API_SERVICE_TOKEN}" \
  "${PRISM_AGENT_API_BASE_URL:-$APP_API_BASE_URL}/agent/tasks"
```

Classify tasks:

- Collector/source sync tasks:
  - keys containing `discord-sync`, `source-sync`, `source-collect`, `collector`
  - descriptions mentioning source collection, Discord sync, Telegram sync, or adapter sync
- Memory materialization tasks:
  - keys such as `memory-run`
  - descriptions mentioning memory run, rolling memory, digest materialization, or seeds
- Knowledge materialization tasks:
  - keys such as `knowledge-run` or `knowledge-source-sync`
  - descriptions mentioning knowledge source sync, repository source sync, or index rebuilds
- Workspace execution tasks:
  - task prompts that create requests, run workflows, publish content, monitor APIs, post updates, or execute specialized skills

Report:

- enabled collector/source sync tasks
- enabled memory materialization tasks
- enabled knowledge materialization tasks
- enabled workspace execution tasks
- whether the instance appears closer to `collector` or `workspace`
- any ambiguity that needs operator review

## Convert To Workspace Profile

When the user asks to convert an instance to workspace mode:

1. List tasks through `/agent/tasks`.
2. Identify collector-oriented built-in tasks using the classification above.
3. Disable them by re-posting each task row to `/agent/tasks` with `enabled:false`.
4. Do not delete tasks.
5. Do not disable communication adapter chat/output.
6. Do not disable user-authored workspace tasks unless they clearly collect broad shared memory and the user confirms.
7. Do not change Prism Memory config or rebuild memory.
8. Return a concise report with changed task keys and tasks left enabled.

To disable a task, preserve its full shape and only change `enabled` to false.
The task API is an upsert endpoint, so include the key, name, schedule, config,
and task type fields from the existing task.

Example payload shape:

```json
{
  "key": "discord-sync",
  "name": "Discord sync",
  "description": "Built-in scheduled task: Discord sync",
  "enabled": false,
  "triggerType": "schedule",
  "scheduleCron": "0 * * * *",
  "timezone": "UTC",
  "taskType": "builtin",
  "inputConfig": {},
  "instructionConfig": {},
  "outputConfig": {},
  "agentConfig": {}
}
```

Write it back:

```bash
curl -fsSL \
  -X POST \
  -H "content-type: application/json" \
  -H "x-service-token: ${PRISM_AGENT_SERVICE_TOKEN:-$APP_API_SERVICE_TOKEN}" \
  "${PRISM_AGENT_API_BASE_URL:-$APP_API_BASE_URL}/agent/tasks" \
  -d "$TASK_JSON"
```

Verify by listing tasks again.

## Convert To Collector Profile

Do not automatically enable collector tasks just because the user says "collector
profile".

Instead:

1. Audit current tasks.
2. Report which collector tasks are disabled or missing.
3. Ask for confirmation before enabling broad collection tasks.
4. Confirm source adapter config first:
   - Discord bot/guild if enabling Discord sync
   - Telegram bot/group if a Telegram collector exists
   - Prism Memory API base/key for memory writes
5. Enable only the confirmed tasks.

## Safety Rules

- Never delete memory files, task rows, skills, workflows, hooks, or artifacts as
  part of profile conversion.
- Never assume every disabled collector task should be enabled again.
- Never run a memory repair/rebuild as part of workspace conversion.
- Never turn off Discord or Telegram chat/output just because collection is
  disabled.
- Preserve custom tasks unless the user explicitly names them or confirms they
  are source collectors.
- If there is ambiguity, leave the task enabled and list it under "needs review".

## Report Format

Return:

- inferred starting profile
- requested target profile
- tasks disabled or changed
- tasks intentionally left enabled
- tasks needing review
- whether memory data, skills, workflows, hooks, and artifacts were untouched
- suggested next checks

Keep the report concise. The goal is operational clarity, not a long migration
essay.
