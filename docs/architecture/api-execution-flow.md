# API Agent Run Flow

The API uses `agent_runs` as the durable run layer for tracked request work,
Prism Console prompts, task runs, and hook triggers.

## Purpose

This is the bridge between:

- a board request that is ready for agent work
- a target repository and review branch
- task and hook activity that operators need to inspect
- the artifacts and external refs created while an agent is working

## Primary Run Record

`agent_runs`

Each agent run captures one durable unit of work. Request workflow steps use
`kind="workflow_step"`. Task and hook rows keep domain-specific details and link
to a shared `agent_runs` row through `agent_run_id`.

Stored fields include:

- status
- idempotency key
- request, workflow run, workflow step, task, hook, or session reference
- input and result JSON
- runtime trace
- error message
- started and finished timestamps

`change_request_executions` is legacy read-only history for older requests. New
workflow-step runs should not create mirrored execution rows.

## Endpoints

Service-token callers use:

- `GET /agent/runs`
- `GET /agent/change-board/requests/:id`
- `GET /agent/change-board/requests/:id/executions`
- `GET /agent/change-board/requests/by-number/:requestNumber/review`
- `POST /agent/change-board/requests/by-number/:requestNumber/workflow/continue`
- `POST /agent/change-board/requests/by-number/:requestNumber/workflow/reconcile`
- `GET /agent/change-board/requests/:id/deploy-plan`

The `executions` routes return `legacyExecutions` plus `agentRuns`. Mutation
routes for legacy executions return `410` and should not be used for new work.

## `deploy-plan`

`deploy-plan` validates the selected target environment and returns canonical
target context:

- target app
- target environment
- deploy backend
- deploy config
- whether the target is currently allowed
- warnings that block or weaken execution
- the next manual review or preview action

Codex, another approved runtime, or a human can fetch one trusted plan instead
of reading target config ad hoc.

## Current Adapter Mode

Current mode is `manual`.

That means:

- the API validates target state
- the API returns a deploy plan
- the active agent run records branch, commit, trace, and failure details
- preview deployment is handled by GitHub/Railway PR environments or another
  configured target workflow

## Next Step

The next implementation step is to keep enriching `agent_runs.result`,
artifacts, and external refs with PR metadata, deploy URLs, and review context
from the configured workflow.
