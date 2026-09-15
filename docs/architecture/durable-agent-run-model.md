# Durable Agent Run Model

Status: draft

## Purpose

Prism has several ways to run Codex-backed work: Prism Console, change request
workflows, task-runner jobs, hook triggers, and communication adapter commands.
These surfaces currently share parts of the same response handler, but each one
also owns a different piece of run state. That makes browser timeouts, retries,
late completions, and gate approvals hard to reason about.

This spec proposes one durable run model for long-running agent work and one
subject-agnostic workflow model. Change requests remain an important domain
object, but workflow mechanics should not be intrinsically change-request-only.

## Goals

- make every long-running operation return quickly with a durable run id
- keep browser, Discord, hook, and task retries from starting duplicate work
- make workflow transitions compare-and-set against the state that existed when
  the run started
- ignore late completions from canceled, superseded, or stale runs
- keep delivery to Discord, Telegram, or browser UI separate from workflow
  mutation
- provide a single run timeline operators can inspect

## Non-Goals

- do not replace Codex Runtime's internal job API in the first slice
- do not redesign workflow manifests
- do not couple request state to Discord channels, Portal records, or task keys
- do not make adapter delivery success determine workflow success

## Current Run Surfaces

### Prism Console

The browser posts to `/admin/console/jobs`. The site creates an
`agent_response_jobs` row, then starts an in-process job that calls the shared
response handler. The browser polls the job row.

This protects the browser request from direct Codex Runtime timeouts, but the
job still runs inside the site process and still shares workflow mutation logic
with request workflows.

### Change Requests

Requests can be created from the admin UI, Prism Console, hooks, tasks, or
service callers. Creation may autostart the workflow by calling
`/agent/responses`. Continue and approve actions also call the shared response
handler.

The shared handler now starts or resumes `agent_runs`, calls Codex Runtime,
records messages, and mutates workflow state. Historical
`change_request_executions` rows remain readable for older requests, but new
workflow-step runs should not create mirrored execution rows.

### Tasks

The task-runner service owns in-memory task state and writes task-run rows back
to the site. Workflow-runner tasks create change requests and can autostart or
continue request workflows by calling `/agent/responses`.

### Hooks

Hook triggers translate external events into Prism state. They may create a
change request and currently can autostart the request workflow. Hook run
visibility is separate from request agent-run visibility.

### Communication Adapters

Discord and Telegram commands should behave as ingress and egress layers. They
can create requests, approve gates, or ask questions, but they should not own
workflow run state. They also need fast acknowledgement, idempotency, and
best-effort delivery of status updates.

## Target Model

All long-running work should be represented as a durable run:

```text
agent_run
  id
  kind: console | workflow_step | task | hook | adapter_command
  status: queued | running | succeeded | failed | canceled
  idempotency_key
  request_id
  workflow_run_id
  workflow_step_key
  expected_workflow_step_key
  task_key
  hook_key
  session_id
  actor/source metadata
  input
  result
  trace
  error
  timestamps
```

Workflow state should be represented as a workflow run attached to a subject:

```text
workflow_run
  id
  workflow_key
  subject_type: change_request | task | hook | portal_session | memory_curation | ...
  subject_id
  current_step_key
  status: active | completed | canceled
  timestamps
```

The current `workflow_runs.request_id` field is the first subject binding. The
target model is equivalent to:

```text
subject_type = "change_request"
subject_id = request_id
```

Change request fields such as title, priority, target app, artifacts, GitHub
issue, and pull request are domain data. Step transitions, gates, checkpoint
rules, terminal state, cancel/supersede behavior, and run history are workflow
engine data and should apply the same way to any workflow subject.

Every surface follows the same pattern:

1. validate the caller and input
2. create or reuse a durable run by idempotency key
3. return `202 Accepted` with the run id
4. execute the run asynchronously
5. poll or subscribe to run status
6. reconcile results only if expected state still matches

## Workflow State Rules

- A workflow action such as `approved` is only valid on a gate step.
- A run that starts on step `X` may only complete step `X` if the workflow is
  still on `X`.
- A run may only complete if its `agent_runs` row is still active.
- Manual step changes are blocked while a queued or running agent run exists for
  the same workflow subject.
- Operators can cancel/supersede an active run, then move the workflow step.
- Terminal workflow states are final unless an explicit reopen operation creates
  a new run context.
- Late completions from canceled or stale runs should record
  `agent.completion_ignored` and must not mutate workflow state.
- Delivery failures must not roll back successful workflow mutation.

## Step Types

- `agent`: enqueues an `agent_run(kind="workflow_step")`.
- `gate`: records a human or service decision and moves to the routed next step.
- `checkpoint`: enqueues an `agent_run(kind="workflow_step")`, but the workflow
  remains on the checkpoint unless a later explicit transition advances it.
- `terminal`: finalizes the workflow run and cancels/supersedes active runs for
  the same subject.

## Cancel And Supersede

Cancel is workflow-level by default. It means the current workflow run should no
longer continue, and all active agent runs for that workflow subject should be
marked `canceled` or `superseded`.

Runtime work may still return after cancel. The site must treat those late
returns as ignored completions and must not mutate workflow state.

Step-level interruption can be introduced later, but should be named separately
from workflow cancellation.

## Hook Trigger Rules

Hook triggers should fit the same model:

```text
external event -> hook run -> optional request created -> workflow step run
```

The hook run owns event validation, matching, artifact creation, and request
creation. The request workflow owns triage, approval, implementation, review,
and terminal state.

## Communication Adapter Rules

Adapter-originated requests and approvals should also enqueue durable runs.

- use idempotency keys from platform, channel/thread, and message or interaction
  ids
- acknowledge slash commands before Codex work begins
- keep source refs, but do not use Discord threads/channels as workflow state
- reject approval commands unless the current workflow step is a gate
- record delivery failures separately from workflow agent runs
- ignore bot self-output unless a command explicitly opts in

## First Slice Checklist

- [x] Reject workflow actions on non-gate steps.
- [x] Ignore late completions when the workflow is no longer on the run's
  expected step.
- [x] Preserve run results and trace even when workflow mutation is
  ignored.
- [x] Store workflow-step active-run idempotency in
  `agent_runs.idempotency_key`.
- [x] Reuse an active agent run response when the same request, workflow run,
  step, and action are submitted again.
- [ ] Add tests or focused validation for stale completion behavior.
- [ ] Confirm Prism Console, request autostart, task workflow-runner, hook
  autostart, and Discord approval routes all pass through the same guard.

## Later Checklist

- [x] Introduce a general `agent_runs` table.
- [x] Link request workflow-step executions to `agent_runs` for observability
  during the cutover.
- [x] Add service/admin read routes for inspecting agent runs.
- [x] Enqueue request workflow autostart through `agent_runs` instead of
  waiting on Codex Runtime during request creation.
- [x] Enqueue service-token request workflow continue/approve actions through
  `agent_runs` and return `202 Accepted`.
- [x] Move Prism Console jobs onto `agent_runs` while keeping the old job route
  as a compatibility poll API.
- [x] Surface request-linked `agent_runs` in the request run log ahead of
  legacy execution rows.
- [x] Block manual workflow step changes while active `agent_runs` exist.
- [x] Make cancel workflow-level and mark active `agent_runs` canceled or
  superseded.
- [x] Move request workflow metadata reads from `change_request_executions` to
  `agent_runs.result`.
- [x] Stop creating mirrored `change_request_executions` rows for new
  workflow-step runs.
- [x] Move request active/next selection and direct runtime idempotency guards
  from active execution rows to active `agent_runs`.
- [x] Retire service-token mutation routes for `change_request_executions`;
  keep execution reads only for legacy history.
- [ ] Generalize workflow runs from `request_id` to subject type/id.
- [x] Move hook trigger run records onto `agent_runs` or link hook runs
  to agent runs.
- [x] Link task-runner task runs to `agent_runs` for shared operator
  visibility.
- [ ] Add idempotency keys for adapter commands, hooks, task runs, and request
  workflow steps.
- [ ] Add a unified run detail view in the admin UI.
- [ ] Add a cleanup/reconciliation task for old active runs.
