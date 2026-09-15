# Workflow Step Blockers And Attention States

## Status

Partially implemented.

The first implementation parses a fenced `workflow-outcome` JSON block from
agent responses, stores the normalized outcome on `agent_runs.result`, keeps the
workflow on the current step for `blocked` and `needs_attention`, emits
`agent.blocked` or `agent.needs_attention`, stops auto-continue, and shows an
amber attention panel in the request details UI. A follow-up slice adds
request-level unresolved attention projection, request-list badges/counts, and
an operator override action that requires a comment and records an
`operator.blocker_overridden` event. Dedicated blocker lifecycle storage remains
future work.

This spec captures the follow-up from auditing a long media workflow where an
agent step could detect a real blocker, create blocker artifacts, and still be
treated by the workflow engine as completed. The current engine only understands
workflow structure: agent steps advance on successful runtime completion,
checkpoints stay on the current step, gates wait for operator action, and
terminal steps close the run. It does not have a first-class step outcome for
"blocked" or "needs attention."

## Problem

Workflow instructions can tell an agent not to advance when required evidence is
missing, but the engine cannot enforce that instruction unless the workflow is
modeled as a checkpoint or gate.

For a normal `agent` step:

1. Codex Runtime returns a successful response.
2. The site marks the agent run succeeded.
3. The workflow moves to the step's `next`.
4. Auto-continue may keep running later agent steps until a gate, checkpoint, or
   terminal step is reached.

If the agent created a "blocker" artifact or wrote "blocked" in the response,
the engine currently treats that as plain output. A workflow can therefore move
to final review or closed even when a step found a missing output URL, rejected
asset, failed publish precheck, or other condition that needs operator attention.

## Goals

- Let a workflow step explicitly finish as completed, blocked, or needs
  attention.
- Keep blocked/attention workflows on the current step.
- Stop auto-continue immediately when a step needs attention.
- Show the reason, suggested fix, and evidence in the request UI.
- Preserve an audit trail when an operator chooses to continue anyway.
- Support both hard blockers and soft attention warnings.
- Avoid relying on artifact names as the primary control signal.

## Non-Goals

- Do not infer blocker state from arbitrary prose.
- Do not silently patch workflow state around blockers.
- Do not make every warning a hard stop.
- Do not require all existing workflows to adopt the new outcome contract at
  once.
- Do not delete blocker artifacts after override; they remain evidence.

## Current Behavior

The engine has these effective stops:

- `gate`: requires an explicit workflow action before moving.
- `checkpoint`: runs, records the check, and stays on the same step.
- `terminal`: marks the workflow completed.

Auto-continue stops when the next step is not an `agent`. It does not inspect
artifacts or response text for blocker meaning.

## Proposed Outcome Contract

Workflow steps should be able to return a structured outcome in addition to
normal response text:

```json
{
  "workflowOutcome": {
    "status": "needs_attention",
    "summary": "Rendered video output URL is missing or not fetchable.",
    "suggestedFix": "Check the Remotion render job, confirm S3 upload completed, then rerun render-status-check.",
    "blockers": [
      {
        "key": "render-output-url",
        "severity": "hard",
        "reason": "No fetchable final video URL was found.",
        "suggestedFix": "Regenerate a public or presigned GET URL for the rendered video.",
        "canOverride": true,
        "evidence": [
          {
            "kind": "artifact",
            "name": "render-status-check.md"
          }
        ]
      }
    ]
  }
}
```

Initial statuses:

- `completed`: step succeeded and may advance normally.
- `needs_attention`: step found a condition that should stop auto-continue and
  wait for an operator decision.
- `blocked`: step cannot safely continue until the condition is fixed or
  explicitly overridden.

Initial severities:

- `soft`: stop auto-continue, but operator can accept and continue.
- `hard`: stop workflow advancement unless fixed or explicitly overridden.
- `non_overridable`: stop workflow advancement until fixed; no continue-anyway
  option.

## Engine Behavior

When a step returns `completed` or no structured outcome:

- preserve existing behavior,
- mark the agent run succeeded,
- emit `agent.completed`,
- advance to `next` when the current step is an `agent`.

When a step returns `needs_attention` or `blocked`:

- mark the agent run succeeded or attention-needed according to the chosen run
  status model,
- persist the structured outcome on the agent run result,
- keep `workflow_runs.current_step_key` on the current step,
- keep the request workflow step on the current step,
- emit `agent.needs_attention` or `agent.blocked`,
- stop auto-continue immediately,
- project the request state as `Needs attention` or `Blocked`,
- show the summary, blockers, suggested fix, and evidence in the request UI.

The first implementation can avoid a new `agent_runs.status` enum by keeping
`status: "succeeded"` and storing `result.workflowOutcome.status`. A later
migration can add `needs_attention` or `blocked` run statuses if the UI and
queries benefit from it.

## Operator Override

Operators need an explicit way to continue past selected blockers.

Example action:

```json
{
  "workflowAction": "continue_anyway",
  "comment": "I manually verified the rendered video URL in S3. The URL in the artifact expired, but the object exists.",
  "resolvedBlockers": ["render-output-url"]
}
```

Override rules:

- Require an operator comment.
- Record actor, timestamp, blocker keys, and comment.
- Emit `operator.blocker_overridden`.
- Do not delete or rewrite the original blocker outcome.
- Only route forward through the normal workflow runner.
- Do not allow override for `non_overridable` blockers.

After override, the workflow can:

- advance to the normal `next` step,
- rerun the same step,
- route to a configured review/fix step,
- or require a human gate, depending on workflow design.

## Workflow Authoring Guidance

Workflow authors should use first-class blocker outcomes for conditions that are
deterministic enough for the engine to respect.

Good blocker examples:

- required artifact missing,
- output URL is not fetchable,
- publish target rejected credentials,
- safety review failed,
- generated media does not meet minimum dimensions or duration,
- upstream job is still running,
- source attachment cannot be fetched.

Poor blocker examples:

- vague uncertainty,
- low-confidence prose without a concrete fix,
- optional polish notes,
- minor warnings that do not affect the next step.

Blocker keys should be stable and specific:

```text
render-output-url
avatar-asset-policy
publish-target-auth
source-attachment-fetch
```

## UI Behavior

Request row:

- show `Needs attention` or `Blocked`,
- include the current workflow step,
- avoid presenting the request as closed while blockers are unresolved.

Request detail:

- show an attention panel near the workflow controls,
- list blockers with severity, reason, suggested fix, and evidence,
- offer `Rerun step`, `Mark fixed and rerun`, or `Continue anyway` when allowed,
- require an override comment for `Continue anyway`.

Run history:

- show the blocker outcome on the agent run,
- show override events as separate audit events,
- preserve links to artifacts and external refs used as evidence.

## Data Model Options

Option A: Store outcome in existing run result first.

```ts
agent_runs.result.workflowOutcome = {
  status: "needs_attention" | "blocked" | "completed",
  summary: string,
  suggestedFix?: string,
  blockers?: WorkflowBlocker[]
}
```

This is the smallest first slice and avoids a migration.

Option B: Add workflow outcome columns.

```ts
workflow_runs.attention_status
workflow_runs.attention_json
workflow_runs.attention_updated_at
```

This makes list filtering and request projection easier.

Option C: Add a workflow blockers table.

```ts
workflow_blockers (
  id,
  request_id,
  workflow_run_id,
  agent_run_id,
  step_key,
  blocker_key,
  severity,
  reason,
  suggested_fix,
  can_override,
  status,
  created_at,
  resolved_at,
  resolved_by,
  resolution_note
)
```

This is best once blockers need lifecycle management, filtering, and analytics.

Recommended path: start with Option A, then move to Option C when blocker
history becomes important.

## API Shape

Potential step completion metadata can be accepted from Codex Runtime through
the existing response result path.

Potential override route:

```http
POST /agent/change-board/requests/by-number/:requestNumber/workflow/blockers/override
```

Payload:

```json
{
  "blockerKeys": ["render-output-url"],
  "comment": "Verified manually in S3 and regenerated the URL.",
  "workflowAction": "continue_anyway"
}
```

Browser admin routes should call the same site-owned workflow service logic.
Codex Runtime should continue to use `/agent/*` with service auth.

## Open Questions

- Should blocked runs use `agent_runs.status = "succeeded"` with an outcome, or
  should the run status become `needs_attention`?
- Should `blocked` and `needs_attention` be separate request projections, or one
  UI state with severity labels?
- Should a workflow manifest declare which blocker keys are known and whether
  they can be overridden?
- Should a step be allowed to advance to a configured `blockedNext` step instead
  of staying on the current step?
- Should override permissions require admin-only access, workflow owner access,
  or service-token access from trusted adapters?

## First Slice

1. Define a `workflowOutcome` shape and parser in the site response handler.
2. Let agents include the outcome in a fenced JSON block with a stable marker.
3. Keep the workflow on the current step for `blocked` and `needs_attention`.
4. Stop auto-continue when an attention outcome is present.
5. Store the outcome on `agent_runs.result`.
6. Emit `agent.blocked` or `agent.needs_attention`.
7. Show the latest outcome in request details.

Current marker format:

````markdown
```workflow-outcome
{
  "status": "blocked",
  "summary": "Rendered video output URL is missing or not fetchable.",
  "suggestedFix": "Check the render job, confirm S3 upload completed, then rerun this step.",
  "blockers": [
    {
      "key": "render-output-url",
      "severity": "hard",
      "reason": "No fetchable final video URL was found.",
      "suggestedFix": "Regenerate a public or presigned GET URL.",
      "canOverride": true
    }
  ]
}
```
````

## Later Slices

- Add a dedicated workflow blockers table.
- Add manifest-declared blocker policies.
- Add request list filtering by blocker state.
- Add workflow authoring skill guidance for blocker outcomes.
