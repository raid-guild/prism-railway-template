---
name: prism-task-author
description: Use this skill when Codex is asked to design or create a scheduled Prism task from a user's natural-language request.
---

Use this skill to turn a user's task idea into a durable Prism task definition.

Task authoring rules:

1. Prefer `taskType="codex-prompt"` for user-authored scheduled prompt tasks.
2. Use `taskType="workflow-runner"` when the task should create a durable request and run it through a workflow.
3. Store replayable natural-language instructions in `instructionConfig.prompt`.
4. Store optional skill names in `instructionConfig.requestedSkills`.
5. Store schedule in `scheduleCron` using standard five-field cron syntax.
6. Default new tasks to `enabled=false` unless the user explicitly asks to enable it after review.
7. Do not store arbitrary JavaScript, Python, or shell code in the task row.
8. If repeatable code is needed, create or reference a reviewed script outside the DB, then mention that script in the prompt.
9. Include required destination/config assumptions in `inputConfig` or `outputConfig`.
10. If the user asks to send output to a destination such as Discord `#updates`, resolve the destination during task creation when possible. Use `availableOutputDestinations` from session metadata first. Store resolved destinations in `outputConfig.outputDestinations`; do not leave channel matching for scheduled run time if the channel can be resolved now.
11. A resolved output destination must include `adapter`, `type`, `id`, and `label`. If you only know the label, the destination is unresolved.
12. If a requested destination cannot be resolved, create the task disabled and state that delivery is unresolved.
13. When a task creates a request from an outside system, attach that source as a request external ref when the API is available. Examples: GitHub issue collector tasks attach the source issue, Discord support triage tasks attach the source message or thread, and publishing tasks attach the final CMS post.

Workflow-runner request types must use one of: `bug`, `feature`, `issue`, `content`, `design`, `config`, or `ops`. Use `issue` for imported GitHub issues or issue-like support intake when the source item itself is the request.

Recommended task row shape:

```json
{
  "key": "daily-memory-brief",
  "name": "Daily memory brief",
  "description": "Generate and send a daily Prism Memory brief.",
  "enabled": false,
  "triggerType": "schedule",
  "scheduleCron": "0 9 * * *",
  "timezone": "UTC",
  "taskType": "codex-prompt",
  "inputConfig": {
    "mode": "scheduled"
  },
  "instructionConfig": {
    "prompt": "Create a concise daily brief from Prism Memory. Return only the brief text and a short source summary.",
    "requestedSkills": ["prism-scheduled-task-runner", "prism-memory-ops"]
  },
  "outputConfig": {
    "summary": true,
    "outputDestinations": [
      {
        "adapter": "discord",
        "type": "discord-channel",
        "id": "1234567890",
        "label": "#updates"
      }
    ]
  }
}
```

Workflow runner task shape:

```json
{
  "key": "weekly-blog-workflow",
  "name": "Weekly blog workflow",
  "description": "Create a weekly blog request and run the workflow until the next gate.",
  "enabled": false,
  "triggerType": "schedule",
  "scheduleCron": "0 16 * * 5",
  "timezone": "UTC",
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
  },
  "outputConfig": {}
}
```

Workflow-runner tasks create requests through `/agent/change-board/requests`. When `inputConfig.autoRun.enabled` is true, the created request should start automatically if the workflow entry step is an agent step. If the entry step is a gate, it waits for an operator decision.

When creating a task through the Prism API, use the site internal task endpoint if credentials are available:

```bash
curl -fsSL \
  -X POST \
  -H "content-type: application/json" \
  -H "x-service-token: $PRISM_AGENT_SERVICE_TOKEN" \
  "$PRISM_AGENT_API_BASE_URL/agent/tasks" \
  -d "$TASK_JSON"
```

Do not use `/admin/tasks` from Codex Runtime. That route is for the browser admin UI and requires an authenticated admin session, so `401 Unauthorized` there does not mean task creation is unavailable. Runtime agents should use `/agent/tasks` with `x-service-token`.

In deployed Prism instances, Codex Runtime usually receives `APP_API_BASE_URL` and `APP_API_SERVICE_TOKEN`, and exposes them to Codex as `PRISM_AGENT_API_BASE_URL` and `PRISM_AGENT_SERVICE_TOKEN`. If the `PRISM_*` names are not present, check the `APP_*` names before concluding the task API is unavailable.

Return a concise review summary with:

- task key
- schedule
- whether it is enabled
- required env/config
- resolved output destinations, if any
- what the scheduled prompt will do
