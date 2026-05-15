---
name: prism-hook-author
description: Use this skill when Codex is asked to create, update, test, or delete Prism workflow hooks that trigger workflow-backed requests from external events or on-demand calls.
---

Use this skill to turn an event trigger idea into a durable Prism hook.

Hooks are on-demand entrypoints. A hook receives a JSON payload, creates a workflow-backed request, and can auto-run that request until the next human gate.

Every hook-triggered request stores the incoming trigger body as a `hook-payload.json` request artifact with kind `hook-payload`. Workflow steps should read that artifact when they need the exact event body. The request `source` is set to `hook:<hook-key>` so the board can distinguish hook-created requests from task, agent, and manual requests.

Hook authoring rules:

1. Use hooks for external events, manual integrations, or lightweight webhook-style entrypoints.
2. Use tasks for scheduled work. A task may trigger a hook, but schedules belong in tasks.
3. Use workflows for multi-step work. Hooks should point at an existing workflow by `workflowKey`.
4. Do not store arbitrary JavaScript, Python, or shell code in a hook row.
5. Put durable behavior in workflow markdown, skills, scripts, or adapters; use the hook for request creation and payload capture.
6. Default new hooks to `enabled=false` unless the user explicitly asks to enable it after review.
7. Default `autoRun.enabled=true` when the hook should start the workflow immediately.
8. Keep `requestTemplate` generic. Use templates like `{{date}}`, `{{now}}`, `{{payload}}`, or top-level payload keys such as `{{title}}`.
9. Use `targetAppId` only when the workflow actually requires a target repo/app. Many hooks can create content, notifications, or artifacts without a target.
10. If a payload references an outside system, include stable identifiers and URLs in the payload so workflow steps can attach external refs.

Hook request templates must use one of these `requestType` values: `bug`, `feature`, `issue`, `content`, `design`, `config`, or `ops`. Use `issue` when the hook represents an imported issue-like source item rather than a broader feature or content request.

Recommended hook shape:

```json
{
  "key": "daily-brief-request",
  "name": "Daily brief request",
  "description": "Create and run a daily brief workflow request from an external trigger.",
  "enabled": false,
  "workflowKey": "daily-brief-draft-review-publish",
  "authMode": "service-token",
  "requestTemplate": {
    "titleTemplate": "Daily Brief - {{date}}",
    "descriptionTemplate": "Create a daily brief from this trigger payload.\n\nPayload:\n{{payload}}",
    "requestType": "content",
    "priority": "normal",
    "constraints": {
      "source": "hook"
    }
  },
  "autoRun": {
    "enabled": true,
    "requestedSkills": ["prism-workflow-author"]
  }
}
```

Create or update hooks through the agent API:

```bash
curl -fsSL \
  -X POST \
  -H "content-type: application/json" \
  -H "x-service-token: $PRISM_AGENT_SERVICE_TOKEN" \
  "$PRISM_AGENT_API_BASE_URL/agent/hooks" \
  -d "$HOOK_JSON"
```

Trigger a hook:

```bash
curl -fsSL \
  -X POST \
  -H "content-type: application/json" \
  -H "x-service-token: $PRISM_AGENT_SERVICE_TOKEN" \
  "$PRISM_AGENT_API_BASE_URL/agent/hooks/daily-brief-request/trigger" \
  -d '{"source":"manual-test"}'
```

Manage existing hooks:

```http
GET /agent/hooks
GET /agent/hooks/:key
PATCH /agent/hooks/:key
DELETE /agent/hooks/:key
POST /agent/hooks/:key/trigger
```

Do not use `/admin/hooks` from Codex Runtime. That route is for the browser admin UI and requires an authenticated admin session. Runtime agents should use `/agent/hooks` with `x-service-token`.

In deployed Prism instances, Codex Runtime usually receives `APP_API_BASE_URL` and `APP_API_SERVICE_TOKEN`, and exposes them to Codex as `PRISM_AGENT_API_BASE_URL` and `PRISM_AGENT_SERVICE_TOKEN`. If the `PRISM_*` names are not present, check the `APP_*` names before concluding the hook API is unavailable.

Return a concise review summary with:

- hook key
- workflow key
- whether it is enabled
- trigger endpoint
- expected payload shape
- whether auto-run is enabled
- what request the hook will create
