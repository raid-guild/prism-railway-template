# Durable Run Cutover Validation

Use this checklist after deploying the `agent_runs` cutover to a live instance.

## Request Workflows

- Create a change request with workflow autostart enabled.
  - Expected: request creation returns quickly.
  - Expected: `/agent/runs?requestId=<id>` shows a `workflow_step` run.
  - Expected: no new `change_request_executions` row is created for the run.
- Continue or approve a workflow step from the admin UI.
  - Expected: the UI shows an active agent run and disables duplicate continue.
  - Expected: the request moves only when the matching run completes.
- Continue or approve a workflow step through the service route used by Discord:
  `POST /agent/change-board/requests/by-number/:requestNumber/workflow/continue`.
  - Expected: the response is `202 Accepted` with an agent run.
  - Expected: repeated calls reuse or reject based on the active agent run.
- Cancel while a run is active.
  - Expected: workflow cancel marks active request `agent_runs` as `canceled`.
  - Expected: late runtime completions create `agent.completion_ignored` and do
    not move the workflow.

## Task And Hook Runs

- Manually run a task from the Tasks tab.
  - Expected: the task-run row includes `agentRunId`.
  - Expected: `/agent/runs?taskKey=<task-key>` includes the linked `task` run.
- Trigger a hook from the Hooks tab.
  - Expected: the hook-run row includes `agentRunId`.
  - Expected: the hook row says which request was created.
  - Expected: `/agent/runs?hookKey=<hook-key>` includes the linked `hook` run.

## Legacy Records

- Open a request created before the cutover that has legacy execution rows.
  - Expected: the request log still shows legacy execution history.
  - Expected: new workflow runs on that request appear as agent runs, not new
    execution rows.

## Restart Behavior

- Start a long workflow run, then redeploy or restart the site service.
  - Expected: the active `agent_run` remains visible after restart.
  - Expected: the operator can cancel or retry based on the persisted run.
  - Note: automatic stale-run reconciliation is still a separate follow-up.
