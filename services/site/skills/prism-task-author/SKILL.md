---
name: prism-task-author
description: Use this skill when Codex is asked to design or create a scheduled Prism task from a user's natural-language request.
---

Use this skill to turn a user's task idea into a durable Prism task definition.

Every new task should include one active `accountabilityDomainKey`. The domain
owns maintenance and audit follow-through; it does not grant runtime authority.

Task authoring rules:

1. Do not create an enabled recurring `codex-prompt` task. Ad hoc prompts belong
   in an Agent Console or, when a reusable manual task definition is genuinely
   useful, an explicitly invoked disabled `codex-prompt` utility.
2. Use `taskType="workflow-runner"` for every scheduled agent task. Each
   scheduled occurrence creates a native Operational Inbox request. The task
   should only create and start that request; the workflow owns analysis,
   artifacts, external delivery, delivery verification, retries, provenance,
   failure handling, and terminal closure.
3. Use `taskType="http-post"` for simple deterministic HTTP POST cron jobs that should avoid LLM calls by default.
4. Use `taskType="script-runner"` for deterministic watchdogs, pollers, API checks, checkpoint updates, and other jobs that need more logic than one HTTP POST.
5. Store replayable natural-language instructions in `instructionConfig.prompt` for `codex-prompt` and `workflow-runner` tasks.
6. Store optional skill names in `instructionConfig.requestedSkills`.
   Credential requirements declared by instance-owned skills are resolved at
   runtime; do not duplicate them in task configuration.
7. Store schedule in `scheduleCron` using standard five-field cron syntax.
8. Default new tasks to `enabled=false` unless the user explicitly asks to enable it after review.
9. Do not store arbitrary JavaScript, Python, or shell code in the task row.
10. If deterministic repeatable code is needed, create or verify a site-owned task script through `/agent/task-scripts` first, then reference it with `inputConfig.scriptKey` and structured `inputConfig.params`.
11. Include required destination/config assumptions in `inputConfig` or `outputConfig`.
12. If the user asks to send output to a destination such as Discord `#updates` or a Telegram group, resolve the destination during task creation when possible. Use `availableOutputDestinations` from session metadata first. Store resolved destinations in `outputConfig.outputDestinations`; do not leave channel matching for scheduled run time if the channel can be resolved now.
13. A resolved output destination must include `adapter`, `type`, `id`, and `label`. If you only know the label, the destination is unresolved.
14. If a requested destination cannot be resolved, create the task disabled and state that delivery is unresolved.
15. When a task creates a request from an outside system, attach that source as a request external ref when the API is available. Examples: GitHub issue collector tasks attach the source issue, Discord support triage tasks attach the source message or thread, and publishing tasks attach the final CMS post.
16. For `workflow-runner` tasks, include `inputConfig.request.estimatedHumanHours` when the request scope is predictable. Estimate the whole request, including expected human gates, review/approval time, coordination, and likely loopbacks. Choose one bucket from `0.25`, `0.5`, `1`, `2`, `4`, `8`, `16`, `24`, or `40`.
17. For Portal email queue dispatch, create an `http-post` task with key `portal-notification-email-dispatch`, schedule `*/5 * * * *`, method `POST`, URL `https://portal.raidguild.org/api/notifications/email/run`, `Authorization: Bearer ${PORTAL_TASK_SECRET}`, body `{ "limit": 50 }`, retry attempts `3`, exponential backoff, and `timeoutMs: 30000`. Do not create a recurring `codex-prompt` task for five-minute email dispatch.
18. Before removing a legacy integration secret, run Prism Doctor and test every
    enabled task that requests the migrated skill or starts an affected
    workflow.
19. Set `agentConfig.executorAgent` deliberately for agent-backed tasks. Omitting
    it invokes the visible Admin fallback and should be disclosed as temporary
    authoring debt.
20. Use provider-neutral `agentConfig.modelTier` values (`economy`, `standard`,
    or `deep`) when a task should override its executor profile default. Omit it
    to inherit the Agent Profile and Site defaults. Never store a provider model
    name in a task definition.
21. After creation, inspect `GET /agent/accountability/audit` for the task's
    assignment, executor resolution, cross-domain execution, and fallback state.
22. Do not use `outputConfig.outputDestinations` on a `codex-prompt` task as a
    shortcut for an operational workflow. If delivery is part of successful
    completion, perform and verify it inside the request workflow, save the
    delivered content as an artifact, and attach the accepted external message
    or publication as an external ref when supported. Deterministic watchdogs
    may still deliver alerts through `script-runner`; simple service dispatch
    may use `http-post`.

Workflow-runner request types must use one of: `bug`, `feature`, `issue`, `content`, `design`, `config`, or `ops`. Use `issue` for imported GitHub issues or issue-like support intake when the source item itself is the request.

Manual utility task shape:

```json
{
  "key": "memory-brief-preview",
  "name": "Memory brief preview",
  "description": "Generate an ephemeral Memory brief when explicitly invoked.",
  "enabled": false,
  "triggerType": "manual",
  "scheduleCron": null,
  "timezone": "UTC",
  "taskType": "codex-prompt",
  "accountabilityDomainKey": "community-operations",
  "inputConfig": {
    "mode": "manual"
  },
  "instructionConfig": {
    "prompt": "Create a concise brief from Prism Memory. Return only the brief text and a short source summary.",
    "requestedSkills": ["prism-scheduled-task-runner", "prism-memory-ops"]
  },
  "outputConfig": {
    "summary": true
  }
}
```

Workflow runner task shape:

```json
{
  "key": "weekly-blog-workflow",
  "name": "Weekly blog workflow",
  "description": "Create a weekly blog request and run the workflow until the next gate or checkpoint.",
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
      "priority": "normal",
      "estimatedHumanHours": 2
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

Workflow-runner tasks create requests through `/agent/change-board/requests`. When `inputConfig.autoRun.enabled` is true, the created request should start automatically if the workflow entry step is an agent step. If the entry step is a gate or checkpoint, it waits for an operator decision/check.

HTTP POST task shape:

```json
{
  "key": "portal-notification-email-dispatch",
  "name": "Portal notification email dispatch",
  "description": "Dispatch queued Portal email notifications.",
  "enabled": false,
  "triggerType": "schedule",
  "scheduleCron": "*/5 * * * *",
  "timezone": "UTC",
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
  },
  "instructionConfig": {},
  "outputConfig": {}
}
```

For `http-post` tasks, the secret value must live in the task-runner service environment. Store a header template such as `Bearer ${PORTAL_TASK_SECRET}`, not the secret itself. The runner only accepts HTTPS URLs and sets `Content-Type: application/json` itself. The task logs timestamp, endpoint, HTTP status, parsed response result counts when present, and error body for non-2xx responses. Retries must be bounded; do not configure unbounded retry behavior.

Script runner task shape:

```json
{
  "key": "api-watchdog",
  "name": "API watchdog",
  "description": "Check an API and only notify when unhealthy.",
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
  "outputConfig": {
    "outputDestinations": [
      {
        "adapter": "discord",
        "type": "discord-channel",
        "id": "discord:1234567890",
        "label": "#ops"
      }
    ]
  }
}
```

For script-runner tasks, the script itself must be a site-owned task script available through `/agent/task-scripts/:key/content`. Do not rely on local Codex Runtime files, repo-only files, or task-runner env registries for scheduled execution. The task row only references `scriptKey` and passes structured non-secret params. Scripts should write JSON to stdout and may include `shouldNotify:false` to suppress configured output delivery for healthy/no-op runs.

For a deterministic preflight that conditionally hands meaningful results to an
agent, configure `agentConfig.handoff.enabled=true`, set
`agentConfig.handoff.when="shouldEscalate"`, and provide
`instructionConfig.prompt`. The script must return a JSON object. A false or
missing `shouldEscalate` value completes without invoking Codex; exactly `true`
starts one agent run with the script result supplied as untrusted data. Put
requested skill names in `instructionConfig.requestedSkills`. Do not describe
`shouldEscalate` as advisory when this handoff is enabled.

When a script needs an organization credential, configure it in Gateway and
declare its credential key in `agentConfig.gatewayCredentials`. Read the leased environment variable
from `process.env` in the script. Never store credentials in
`inputConfig.params`, task-script content, or output. The lease exists only in
the script child process and the task must fail when an assigned lease cannot be
obtained.

Create or update a task script before creating the scheduled task:

```bash
curl -fsSL \
  -X POST \
  -H "content-type: application/json" \
  -H "x-service-token: $PRISM_AGENT_SERVICE_TOKEN" \
  "$PRISM_AGENT_API_BASE_URL/agent/task-scripts" \
  -d "$TASK_SCRIPT_JSON"
```

Use `runtime="node-esm"` for script-runner scripts. A script receives JSON on stdin with `task`, `scriptKey`, `params`, `inputConfig`, `outputConfig`, `agentConfig`, and `triggeredAt`.

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
- what the scheduled prompt, workflow, or script will do
- accountable domain and resolved executor profile
