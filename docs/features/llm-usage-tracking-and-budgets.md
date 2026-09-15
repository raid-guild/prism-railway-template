# LLM Usage Tracking And Budgets

Status: future feature spec

## Purpose

Prism should track LLM token usage and estimated cost across the surfaces that
can call Codex Runtime:

- Prism Console
- workflow steps
- request automation
- scheduled tasks
- hooks
- communication adapter prompts from Discord or Telegram
- voice recording summaries

Operators need to answer questions such as:

- How many tokens did this request use?
- How many tokens did this user spend in the console this month?
- How much usage came from Discord prompts?
- Which workflows or tasks are the largest token consumers?
- Should a request, channel, user, or workspace be paused when it reaches a
  budget?

## Design Principles

- Treat each model call as an immutable usage event.
- Aggregate usage from events instead of mutating shared counters directly.
- Capture usage at the job/run boundary where request, user, task, workflow,
  and transport context are known.
- Keep budget enforcement explicit and explainable.
- Start with tracking, then add warning-only budgets, then enforce limits.
- Store raw provider usage metadata for debugging, but normalize common token
  fields for queries.
- Do not treat deterministic script-runner tasks as LLM usage unless they call
  a model.

## Usage Event Model

Add a durable ledger table such as `llm_usage_events`.

Suggested fields:

```text
id
occurred_at
provider
model
surface
source_service
agent_run_id
response_job_id
request_id
workflow_run_id
workflow_step_key
task_id
task_run_id
hook_key
hook_run_id
session_id
user_id
external_actor_id
external_actor_label
external_channel_id
input_tokens
output_tokens
reasoning_tokens
cached_input_tokens
total_tokens
estimated_cost_usd
raw_usage_json
metadata_json
created_at
```

`surface` should use a small controlled vocabulary:

- `console`
- `workflow`
- `task`
- `hook`
- `discord`
- `telegram`
- `voice-summary`
- `system`

`source_service` should identify the service that initiated or mediated the
call:

- `site`
- `codex-runtime`
- `communication-adapter`
- `task-runner`

## Capture Points

### Codex Runtime

Codex Runtime is the best place to parse raw model usage because every
LLM-backed Prism call should eventually pass through it.

Runtime responses should include a normalized usage object when available:

```json
{
  "responseText": "...",
  "thread_id": "...",
  "usage": {
    "provider": "openai",
    "model": "gpt-5.5",
    "inputTokens": 1234,
    "outputTokens": 456,
    "reasoningTokens": 789,
    "cachedInputTokens": 0,
    "totalTokens": 2479,
    "raw": {}
  }
}
```

When exact usage is unavailable, runtime may return `usage.unavailableReason`
instead of guessing.

### Site Service

The site service should persist usage events because it has the richest Prism
context:

- authenticated user
- agent session
- request
- workflow run and step
- response job
- agent run
- hook run

`/agent/responses` and admin console response routes should write a usage event
when Codex Runtime returns usage.

### Communication Adapter

The communication adapter should pass attribution metadata into Codex Runtime:

- transport platform
- guild/chat id
- channel/thread id
- source message id
- Discord or Telegram actor id
- actor display name
- access policy mode

The adapter should not own durable accounting. It should provide enough context
for the site service to write accurate usage events.

### Task Runner

Task-runner should pass task and task-run identifiers into runtime calls. This
lets Prism distinguish scheduled automation usage from interactive user usage.

Script-runner tasks that do not call Codex Runtime should not create LLM usage
events.

## Aggregations

Usage should be queryable by:

- request
- user
- agent session
- workflow
- workflow step
- task
- hook
- source service
- communication platform
- external actor
- Discord channel or Telegram chat
- model
- day, week, and month

Initial views can compute totals directly from `llm_usage_events`. If queries
become expensive, add daily rollup tables later.

## Request-Level Usage

Request detail pages should show:

- total tokens
- estimated cost
- usage by workflow step
- usage by agent run
- latest model/provider
- warning when budget is near or exceeded

Request usage should include all workflow steps and request-linked console
messages. It should not include unrelated console sessions even if they mention
the request in text.

## User-Level Usage

Console sessions should attribute usage to the authenticated admin user when
available.

Discord or Telegram usage should attribute to `external_actor_id` first. A later
identity-linking feature can map external actors to Prism users or profiles.

## Budgets

After usage events are reliable, add budget policies.

Suggested `llm_budgets` fields:

```text
id
scope_type
scope_id
period
token_limit
cost_limit_usd
warn_threshold_percent
action
enabled
created_at
updated_at
```

`scope_type` examples:

- `workspace`
- `user`
- `request`
- `workflow`
- `task`
- `hook`
- `surface`
- `discord-channel`
- `telegram-chat`

`period` examples:

- `day`
- `week`
- `month`
- `request-lifetime`
- `all-time`

`action` examples:

- `warn`
- `require-approval`
- `block`

The first budget slice should be warning-only. Enforcement can come after the
UI clearly shows why a call was blocked and who can override it.

## Enforcement Points

Budget checks should happen before calling Codex Runtime.

For a blocked call, Prism should return a structured error:

```json
{
  "ok": false,
  "error": "LLM_BUDGET_EXCEEDED",
  "budget": {
    "scopeType": "request",
    "scopeId": "request-id",
    "period": "request-lifetime",
    "tokenLimit": 200000,
    "currentTokens": 212450
  }
}
```

If `action` is `require-approval`, Prism should create or update a workflow
gate, request blocker, or admin notification rather than silently failing.

## UI Surfaces

First useful UI surfaces:

- Request detail usage card.
- Console session usage summary.
- Admin usage dashboard by day and surface.
- Task run detail usage summary.
- Communication adapter usage by channel and external actor.

Later:

- budget editor in settings
- usage export
- estimated monthly forecast
- per-model cost breakdown

## Observability

Agent runs and response jobs should link to usage events. This makes stuck,
retried, canceled, or superseded runs easier to audit.

Late completions from canceled or superseded runs may still create usage events
if tokens were actually spent. Those events should be marked with metadata such
as:

```json
{
  "runStatusAtCompletion": "canceled",
  "lateCompletion": true
}
```

This preserves real spend without implying the canceled run changed workflow
state.

## Non-Goals For First Slice

- Exact dollar cost for every provider and pricing tier.
- Hard enforcement before tracking is proven.
- Billing or chargeback.
- Identity linking between Discord users and Prism users.
- Token estimation when the provider does not return usage.
- Retrofitting precise historical usage from old runs.

## Suggested First Slice

1. Extend Codex Runtime result shape with normalized `usage` when available.
2. Add `llm_usage_events`.
3. Persist one usage event per completed runtime call.
4. Link usage events to `agent_runs`, `agent_response_jobs`, requests, sessions,
   workflows, task runs, and transport metadata when available.
5. Show request-level and console-session totals.
6. Add warning-only budgets after the event data is reliable.
