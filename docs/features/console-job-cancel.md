# Prism Console Job Cancel

## Status

Planned / future.

## Problem

Prism Console can appear stuck when a long-running console job is interrupted by
a browser refresh, network issue, deploy, or Railway restart. The browser stores
the active job id in `localStorage` as `prism-console-active-job-id`, and the
console input stays disabled while that id is active.

Operators can recover today by clearing local storage, but that is not obvious
from the UI and does not update any stale server-side run records. A stale
`queued` or `running` console `agent_run` can also make diagnostics confusing.

## Goals

- Let an operator cancel the active Prism Console job from the UI.
- Unlock the console input immediately after cancellation.
- Mark the matching `agent_runs` row as `canceled`.
- Mark the matching `agent_response_jobs` row as `canceled` when one exists.
- Preserve backend consistency if the original runtime call returns after the
  operator cancels.
- Keep request workflow cancellation separate from general console cancellation.

## Non-Goals

- Do not add general queue management in this slice.
- Do not cancel unrelated workflow, task, or hook runs from the console UI.
- Do not require Codex Runtime process termination in the first slice.
- Do not automatically delete run history or message history.

## UX

When `CodexConsole` has an active job id, show a secondary `Cancel` button near
the running state:

```txt
Prism is working in the background. [Cancel]
```

On click:

1. Disable the cancel button while the request is in flight.
2. Call the console cancel endpoint.
3. Remove `prism-console-active-job-id` from browser local storage.
4. Clear `activeJobId` and `activeJobTrace`.
5. Unlock the textarea.
6. Show a short status message such as `Console job canceled.`

If cancellation fails, keep polling the active job and show the API error.

The existing `New` button should continue to clear local browser session state,
but it should not be the only recovery control for a stuck active job.

## API

Add an admin route:

```http
POST /admin/console/jobs/:id/cancel
```

Behavior:

- Require the same admin access as the other console job routes.
- Look up the id as an `agent_run` first.
- Only allow cancellation when `kind = "console"` and status is `queued` or
  `running`.
- Update the run:

```json
{
  "status": "canceled",
  "errorMessage": "Canceled by admin console",
  "finishedAt": "<now>"
}
```

- If the run result references a response job id, update the matching
  `agent_response_jobs` row to `canceled`.
- Return the updated run/job summary.

Suggested response:

```json
{
  "ok": true,
  "job": {
    "id": "agent-run-id",
    "status": "canceled",
    "sessionId": "agent-session-id",
    "errorMessage": "Canceled by admin console"
  }
}
```

For unknown ids, return `404`. For non-console runs, return `409` with a clear
message that workflow runs must be canceled from the request detail controls.

## Backend Safety

The cancel endpoint alone is not sufficient. `runConsoleJob()` currently writes
the final result after `handleResponsePost()` returns. If the operator cancels
while the runtime call is still in flight, the late completion must not overwrite
the canceled state.

Before writing a final `succeeded` or `failed` result, `runConsoleJob()` should
reload the current `agent_run` and `agent_response_job` records. If either is
already `canceled`, leave the records canceled and return without appending a
late assistant answer.

Recommended checks:

- Before starting: if the job or run was canceled while queued, do not call
  `handleResponsePost()`.
- Before final update: if the job or run is canceled, do not mark it succeeded
  or failed.
- In the poll route: return `canceled` so the browser clears local active-job
  state.

This makes cancellation durable even if the underlying Codex Runtime process
cannot be interrupted in the first implementation.

## Data Notes

No schema change is required for the first slice. Existing fields are enough:

- `agent_runs.status`
- `agent_runs.error_message`
- `agent_runs.finished_at`
- `agent_response_jobs.status`
- `agent_response_jobs.error_message`
- `agent_response_jobs.finished_at`

Later queue work may add explicit cancellation metadata such as
`canceled_by_user_id` or `cancel_requested_at`.

## Testing

Cover these cases:

- Cancel an active console job and verify the textarea unlocks.
- Cancel a queued console job before it starts.
- Polling a canceled job clears browser active-job state.
- A late runtime success does not overwrite `canceled`.
- A late runtime failure does not overwrite `canceled`.
- Attempting to cancel a workflow run from the console cancel route returns
  `409`.
- The browser-side recovery still works if the cancel request fails and the user
  chooses `New`.

## Future Work

- Add a stale-run recovery sweep for console runs left `queued` or `running`
  after deploys.
- Add runtime-level cancellation if Codex Runtime exposes a cancellable job API.
- Add operator-visible run diagnostics for active console jobs.
- Fold console cancellation into the broader agent run queue and concurrency
  work.
