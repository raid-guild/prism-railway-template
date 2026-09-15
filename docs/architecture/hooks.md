# Prism Hooks

Hooks are on-demand entrypoints for workflow-backed requests. They are the event-trigger complement to scheduled tasks.

Use hooks when an outside event, service, or agent action should create a request and optionally start a workflow immediately.

Examples:

- a GitHub issue webhook creates a request
- a Discord support escalation creates a request
- a publishing system callback resumes a workflow
- a third-party automation creates a content request
- a Codex agent exposes a reusable trigger for another service

## Mental Model

Prism has three trigger surfaces:

- **Tasks**: scheduled jobs. They run on cron and may create requests.
- **Hooks**: event/on-demand triggers. They receive payloads and create requests.
- **Direct agent requests**: Codex or the UI creates a request directly.

Hooks should stay thin. They should not contain large prompts, arbitrary code, or source-specific business logic. A hook's job is to:

1. accept a JSON payload
2. create a request from a small template
3. preserve the raw payload as an artifact
4. optionally auto-run the workflow until the next gate, checkpoint, or terminal step

The workflow and its step markdown own the behavior after that.

## Data Model

Hooks are stored in the site database in the `hooks` table.

Important fields:

- `key`: stable hook identifier used in the trigger URL
- `name`: human-readable name
- `description`: short explanation for admins and agents
- `enabled`: disabled hooks cannot be triggered
- `workflow_key`: workflow used for created requests
- `auth_mode`: currently `service-token`
- `request_template_json`: small request creation template
- `auto_run_json`: controls whether the workflow starts after request creation
- `system_default`: protects built-in hooks from deletion
- `last_triggered_at`: last successful trigger timestamp

Custom hooks can be created, updated, deleted, and triggered through the agent API. Built-in hooks can be toggled or updated by migrations/template code, but they are protected from agent deletion.

## Request Template

The request template maps a hook payload into a request.

Common fields:

```json
{
  "titleTemplate": "Support Request - {{date}}",
  "descriptionTemplate": "Handle this support event.\n\nPayload:\n{{payload}}",
  "requestType": "issue",
  "priority": "normal",
  "targetAppId": null,
  "targetEnvironmentId": null,
  "constraints": {
    "source": "hook"
  },
  "attachments": []
}
```

Supported template placeholders:

- `{{date}}`: current UTC date, `YYYY-MM-DD`
- `{{now}}`: current ISO timestamp
- `{{payload}}`: full JSON payload
- `{{fieldName}}`: top-level payload field

Keep templates generic. If a workflow needs detailed interpretation, put that in workflow step markdown and have the step read `hook-payload.json`.

## Trigger Behavior

Trigger endpoint:

```text
POST /agent/hooks/<hook-key>/trigger
```

Authentication:

```text
x-service-token: <PRISM_AGENT_SERVICE_TOKEN>
```

On a successful trigger, Prism:

1. verifies the hook exists and is enabled
2. verifies the target workflow exists and is enabled
3. creates a request with `source = hook:<hook-key>`
4. stores the raw trigger body as `hook-payload.json`
5. records the artifact with kind `hook-payload`
6. starts the workflow when `autoRun.enabled` is true
7. updates `last_triggered_at`

Service-token hook triggers return after the request and payload artifact are
created. If `autoRun.enabled` is true, the workflow start is queued in the site
process so external callers such as the Discord adapter do not have to hold a
long webhook request open while Codex runs.

The hook payload is durable request context. Agents should read it through the artifact API instead of relying on chat history or local files.

## Agent API

Runtime agents must use `/agent/*`, not `/admin/*`.

Routes:

```text
GET /agent/hooks
POST /agent/hooks
GET /agent/hooks/:key
PATCH /agent/hooks/:key
DELETE /agent/hooks/:key
POST /agent/hooks/:key/trigger
```

See `docs/operations/agent-api-contract.md` for the shared route/auth contract.

The built-in `prism-hook-author` skill tells Codex agents how to create and test hooks.

## Admin UI

The Hooks tab is intentionally operational, not a full authoring UI.

It supports:

- viewing registered hooks
- grouping custom and built-in hooks
- enabling/disabling hooks
- deleting custom hooks
- copying trigger endpoints
- sending a manual JSON test payload

Hook creation/editing is agent-first. Use `prism-hook-author` and the `/agent/hooks` API so hook creation follows the same pattern as custom skills, tasks, and workflows.

## Source Labels

Requests created by hooks are marked with:

```text
source = hook:<hook-key>
```

The request board displays that as `Hook: <hook-key>`.

Other request sources include:

- `manual`: browser-created request
- `chat`: agent-created request
- `task-runner`: scheduled workflow task

This source label is for traceability. Workflow state still lives in `workflow_runs`, and detailed external system records should be attached as external refs when they need later sync or lookup.

## When Not To Use Hooks

Do not use hooks for:

- cron-based work; use tasks
- long-running business logic; use workflows and skills
- storing executable code; use reviewed scripts or skills
- replacing external refs; attach GitHub/Discord/CMS records as refs when they matter
- public unauthenticated webhooks; the first implementation is service-token based

## Future Work

Likely next slices:

- per-hook secrets for third-party webhook callers that should not receive the full agent service token
- optional payload-to-external-ref mapping
- replay/retry from a stored hook payload
- hook run history beyond `last_triggered_at`
- richer trigger diagnostics in the Hooks tab
