# Request Human Hours Estimate

## Status

First slice implemented.

## Problem

Operators need a lightweight metric for the expected amount of human work behind
a Prism request. The metric should help compare work volume across requests,
tasks, hooks, and external-source intake without adding another required field
for humans to maintain.

## Goals

- Add one request-level estimate for expected human effort.
- Keep the source consistent: agents set the value when creating or triaging a
  request.
- Avoid adding operator review overhead, rationale fields, or per-step estimates.
- Make the value visible in request UI and available through agent/admin APIs.
- Keep existing request creation paths working when the estimate is missing.

## Non-Goals

- Do not add actual time tracking.
- Do not estimate each workflow step, task run, hook run, or agent run.
- Do not add estimate notes, confidence, source, or operator approval state.
- Do not block request creation when no estimate can be inferred.

## Data Model

Add a nullable numeric field to `change_requests`:

```ts
estimatedHumanHours: number | null
```

Database column:

```sql
estimated_human_hours REAL NULL
```

The value represents the expected human hours for the whole request, including
review, coordination, implementation support, human gates, final acceptance, and
likely loopbacks such as review changes that send the workflow to an earlier
step. It is a coarse metric, not a commitment.

Recommended bucket values:

- `0.25`
- `0.5`
- `1`
- `2`
- `4`
- `8`
- `16`
- `24`
- `40`

Agents should choose the nearest bucket. Manual imports and older records may
leave the field null.

## Request Creation Behavior

Agent-created requests should include `estimatedHumanHours` whenever the agent
has enough context to infer a coarse estimate. This includes:

- Prism Console requests
- Discord-created requests
- task-created workflow requests
- hook-created workflow requests
- other service-token callers using `/agent/change-board/requests`

If a request reaches a triage/intake workflow step without an estimate, that
step may set the request-level estimate once. The value should not be repeatedly
rewritten by later workflow steps unless the request scope materially changes.

Manual browser-created requests may leave the estimate empty. The metric is
agent-owned by convention, but the admin/API update route can still accept it so
repairs and future UI edits are possible.

## API Contract

Accept both camelCase and snake_case inputs:

```json
{
  "estimatedHumanHours": 2
}
```

```json
{
  "estimated_human_hours": 2
}
```

Validation:

- nullable
- finite number
- minimum `0`
- maximum `999`
- normalize to two decimal places

Responses should include `estimatedHumanHours` on request records returned from
admin and agent APIs.

## UI

First slice:

- show the estimate on request rows/cards when present,
- show the estimate in request details,
- do not add a required field to the new request dialog.

Optional later:

- add filtering/sorting by estimate,
- show aggregate estimated hours for visible request lists,
- add a small edit affordance if operators ask for corrections.

## Skill Guidance

Update request-authoring skills so agents include the estimate when creating a
request. The instruction should be explicit and short:

- choose one bucket from `0.25, 0.5, 1, 2, 4, 8, 16, 24, 40`,
- estimate whole-request human work, including expected human gates and likely
  loopbacks,
- omit only when there is not enough information.

## Implementation Checklist

- [x] Add migration for `change_requests.estimated_human_hours`.
- [x] Update request repository types, mappers, create, and update helpers.
- [x] Update agent create/update routes to parse and persist the field.
- [x] Update admin create/update routes to preserve the field when provided.
- [x] Show the estimate in request list/detail UI.
- [x] Update `change-request-ops`, task author, hook author, and workflow author
  skills where they create or template requests.
- [x] Update `docs/operations/agent-api-contract.md`.
- [x] Run site/task-runner typecheck and focused validation.
