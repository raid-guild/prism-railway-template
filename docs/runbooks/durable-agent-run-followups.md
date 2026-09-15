# Durable Agent Run Follow-ups

Date started: 2026-06-05

This note tracks follow-up work found while validating the durable `agent_runs`
cutover on the live `prism-stack` Railway instance.

## Observed Validation

- PR #32 deployed to `site` on Railway production from merge commit `8bfa075`.
- Startup migrations executed `021_agent_runs` and `022_run_links`.
- `/agent/runs` is live and can query the new `agent_runs` table.
- Request #137 created a `workflow_step` agent run for `triage`.
- The triage run completed successfully, captured Codex trace, pushed a branch,
  created an external GitHub issue ref, created a triage artifact, and advanced
  the workflow to `approve-for-work`.
- Approving the gate created a second `workflow_step` agent run for
  `implement`.
- The implement run completed successfully, captured Codex trace, created an
  implementation summary artifact, created a GitHub PR external ref, and
  advanced the workflow to `pr-review`.

## Potential Follow-ups

- Link request artifacts directly to the `agent_run_id` that produced them.
  The triage run for request #137 created `triage-fix-notes.md`, but the
  artifact row did not expose an `agentRunId` even though the workflow event and
  timestamps clearly connect it to the run.
- Consider adding a run detail surface that joins agent run, workflow events,
  artifacts, external refs, and request comments in one operator view.
- Make event ordering explicit in the review/debug API. Some payloads return
  newest-first events while older polling assumptions expected oldest-first.
- Add a small live validation command or script for a request number that prints
  current step, active run, recent events, artifacts, and external refs without
  requiring ad hoc shell snippets.
- Add `agentRunId` to artifact creation helpers and skill guidance so Codex
  Runtime and workflow steps preserve provenance consistently.
- Review whether external refs should also support an optional `agent_run_id`
  for symmetric provenance with artifacts.
- Add a warning or UI affordance when a run has produced side effects but is
  still running, so operators know the runtime is active rather than stuck.
- Persist runtime progress trace while a run is still active. During request
  #137's `implement` run, the `agent_run` stayed `running` with an empty trace
  while Codex Runtime had already resumed the workspace; operators only got the
  full trace after completion.
- Expose response-job progress through a service-token route or join it into
  `/agent/runs`. The active implement run had a `responseJobId`, but the
  console job route is admin-session scoped, so external observers could not
  inspect progress with service auth.
- Consider showing the workflow-step idempotency key in debug/admin views for
  duplicate-run diagnosis.
- Add regression tests for gate approval creating exactly one next-step
  `agent_run`, especially across browser retry, Discord retry, and service
  route retry paths.
- Add regression coverage for workflow-level cancel from a running agent step
  and from paused gate/checkpoint states.

## Started in `feat/agent-run-observability-followups`

- Added a request artifact `agent_run_id` column and API support for explicit
  artifact-to-run provenance.
- Added active workflow instructions and skill guidance telling agents to pass
  `agent_run_id` when creating request artifacts.
- Normalized task-run Codex traces from task output snapshots into linked
  `agent_runs.trace`.
- Reworked the request detail cancel control into a workflow-level action with
  a required operator note. The cancel route records that note as a request
  comment and workflow event, cancels active agent runs when present, and moves
  the workflow to a terminal closed step.
