# Simple Workflow Continuation

## Status

Proposed.

This spec proposes simplifying Prism workflow continuation semantics around
agent steps, human gates, checkpoints, loops, and attention states. The goal is
to preserve orchestration and repair-agent power while removing route/action
complexity that has made stuck workflows hard to understand and repair.

## Problem

Recent workflow behavior has become too easy to misread:

- `workflowAction` is treated as a gate decision, but some routes default it to
  `approved` before checking whether the current step is actually a gate.
- `/workflow/continue` can reject an agent step with
  `WORKFLOW_ACTION_REQUIRES_GATE` even when the operator intent is simply
  "resume this request."
- Human gates are modeled as small routers with `approved`,
  `changesRequested`, and `rejected` routes, even when the product need is just
  "pause until an authorized actor continues."
- `autoContinueUntilGate` exposes a runtime detail to callers that should be
  normal engine behavior.
- `needs_attention` can become a hard-to-repair stuck state instead of a clear
  pause reason with evidence.

Request #306 on the Prism Stack production instance exposed the failure mode:
triage completed useful work, the agent attempted a gate-shaped continue from
an agent step, the queue rejected it, and the agent reported `needs_attention`.
The workflow then parked on `triage`, and the repair loop skipped mutation
because it had been instructed not to patch workflow state without a supported
reconciliation primitive.

## Goals

- Make normal flow use `next` only.
- Keep gates as pause points, not route maps.
- Let authorized repair/orchestration agents continue gates and paused steps.
- Remove `autoContinueUntilGate` from normal caller-facing semantics.
- Make `needs_attention` a pause reason that can be continued or rerun with
  audit context.
- Keep loop control deterministic through `loop.target`, `next`, and max
  iteration handling.
- Provide an explicit pause/intervention control for long-running workflows and
  loops instead of relying on a low hidden auto-continue cap.
- Add a built-in, disabled-by-default Prism Doctor task/skill that checks
  whether instance content follows the simple operating model.
- Avoid adding a new endpoint if the existing continue path can be made
  step-aware.
- Avoid permanent legacy compatibility paths and confusing legacy guidance.

## Non-Goals

- Do not remove human review gates.
- Do not make gates human-only; service-auth repair agents remain valid actors.
- Do not remove cancel workflow behavior.
- Do not force all existing production workflows to migrate in one deploy.
- Do not make agent prose determine routing.
- Do not add another reconciliation endpoint before simplifying the current
  continue endpoint.
- Do not use a low arbitrary auto-continue cap as the primary loop safety
  mechanism.
- Do not build a migration script that mutates installed workflows by default.

## Simplified Step Model

### Agent

Runs work.

On successful completion:

```text
agent -> next
```

If the agent reports `needs_attention` or `blocked`, the workflow pauses on the
same step with the reason and evidence. A later explicit continue may proceed to
`next`; a rerun may run the same step again.

### Gate

Pauses automatic flow.

The gate has a normal `next`. An explicit continue by an authorized actor moves
to `next`, then the engine continues until the next pause point.

Cancel, send-back, and change-step are separate operator controls. They are not
ordinary gate routes.

### Checkpoint

Runs or inspects state, writes a recommendation, and pauses. An authorized actor
chooses whether to continue, rerun, change step, or cancel.

### Loop

Deterministic control step.

It reads loop state, usually a structured artifact:

```text
incomplete -> loop.target
complete -> next
max iterations -> configured pause/review step
```

Loop steps do not run Codex directly.

Loop safety should come from `loop.maxIterations`, operator pause controls, and
runtime/job timeouts. A low hidden continuation cap is the wrong guard for
valid loops because expected iteration already has explicit workflow state.

### Terminal

Completes or closes the workflow run.

## Continue Semantics

The normal continue action should be:

```text
POST /agent/change-board/requests/by-number/:requestNumber/workflow/continue
```

Behavior:

- If current step is a gate, record `gate.continued` and move to `next`.
- If current step is an agent paused by attention/blocker, continue to `next`
  when the caller explicitly chooses continue.
- If current step is a checkpoint, continue to `next`.
- If next step is an agent, run it.
- Continue automatically until a pause point is reached.
- Pause points are gate, checkpoint, terminal, blocker/attention, failed run, or
  loop max-iteration review.

`workflowAction` should not be required for this normal path.

## Pause And Loop Intervention

Operators and authorized repair/orchestration agents need a simple way to stop
automatic flow without canceling the workflow.

This is especially important for loops. If a workflow accidentally ships with:

```json
{
  "type": "loop",
  "loop": {
    "target": "process-item",
    "maxIterations": 10000
  }
}
```

and the mistake is noticed at iteration 10, the operator should be able to pause
the loop at the next safe boundary.

Desired behavior:

- If an agent step is running, let the current run finish.
- Stop before launching another agent step.
- If the workflow reaches a loop control node, record the current loop decision
  context and pause before routing back to `loop.target`.
- Preserve the loop artifact/checklist exactly as-is.
- Let the operator inspect state and add steering context.
- Let the operator reduce `maxIterations`, continue, change step, or cancel.

This creates a clear intervention path:

```text
iteration 10 running
  -> operator requests pause
  -> current agent finishes
  -> loop node evaluates or snapshots state
  -> workflow pauses before next loop target run
  -> operator updates config/comment or cancels
```

The pause control should be an explicit workflow control, not a hidden step
chain cap. A high internal emergency guard may still exist to catch malformed
cyclic workflows that do not use loop nodes, but expected loop iteration should
be governed by `loop.maxIterations` and operator pause.

## Workflow Cleanup Approach

Existing workflows on Prism Stack still contain gate `routes`, especially review
workflows with:

```json
{
  "approved": "publish",
  "changesRequested": "revise",
  "rejected": "closed"
}
```

The goal is a clean break without silent breakage. Do not carry permanent
legacy comments in skills, and do not keep old route-map behavior as a normal
runtime path indefinitely.

Cleanup should be staged:

1. Make continue step-aware.
2. Stop defaulting `workflowAction` to `approved` on non-gate steps.
3. Treat normal continue as `next`.
4. Update authoring skills and docs to the new model only.
5. Run Prism Doctor to identify installed workflows, tasks, hooks, and skills
   that do not follow the model.
6. Make deliberate workflow edits from the doctor report.
7. Remove route-map behavior after drift is addressed.

## UI Changes

The UI should present explicit controls:

- Continue
- Rerun current step
- Cancel workflow
- Change step / send back

If an old "Reject" action exists, it should map to the existing cancel workflow
control, not to a gate route.

The existing cancel route should remain separate from continue semantics.

## Repair Agent Behavior

Repair and orchestration agents should not be knee-capped by human gates.

They may continue a paused workflow when they have:

- service auth,
- evidence that the current state is understood,
- a comment or receipt explaining the action.

The audit trail should record actor type and source, for example:

```json
{
  "eventType": "gate.continued",
  "actorType": "agent",
  "payload": {
    "source": "workflow-repair-loop",
    "comment": "Triage artifact exists and request is safe to proceed."
  }
}
```

## Request #306 Recovery

After this refactor deploys, request #306 should be recoverable through the
normal continue path:

- current step: `triage`
- triage agent run: succeeded
- useful artifacts and GitHub external ref already exist
- current pause reason: `needs_attention` caused by the old gate-shaped continue
  failure

An authorized continue should advance #306 to `approve-for-work` without needing
a new reconciliation endpoint.

## Prism Doctor

Add a built-in Prism Doctor task and companion skill, disabled by default.

The doctor is not a migration script and should not mutate by default. It is an
instance health check that evaluates whether installed Prism content follows the
current operating model.

The first module should check workflows. Future modules can check tasks, hooks,
skills, requests, and instance configuration.

Principle:

```text
Doctor checks whether things are right, not whether a banned string appears.
```

For workflows, "right" means:

- non-terminal steps have a clear forward `next`;
- gates are pause points with one forward path;
- checkpoints inspect or recommend, then pause;
- loops have a target, an exit path, and a sane max-iteration policy;
- agent steps do work and rely on the engine to advance on success;
- instructions match the step role;
- control actions are explicit and auditable;
- the workflow is deterministic, observable, and repairable.

Example finding:

```json
{
  "check": "gate-has-single-forward-path",
  "status": "failed",
  "workflow": "blog-post-draft-review-publish",
  "step": "review",
  "expected": "Gate pauses and continues to one next step.",
  "observed": "Gate defines multiple route targets.",
  "evidence": {
    "routes": {
      "approved": "publish-prep",
      "changesRequested": "revise",
      "rejected": "closed"
    }
  },
  "recommendation": "Set next to the normal forward step and use explicit operator controls for cancel, rerun, or change-step."
}
```

Initial outputs:

- `prism-doctor-report.json`
- `prism-doctor-report.md`
- optional `repair-plan.json`

The doctor may create a follow-up repair request when explicitly configured, but
that should be off by default. Normal operation is observe, explain, and
recommend exact repairs.

This avoids permanent legacy compatibility comments in skills while still
giving operators and repair agents a clear way to find drift after the runtime
model changes.

## Implementation Plan

### Slice 1: Runtime Continue Simplification

- Make by-number continue inspect the current step before assigning any action.
- Remove default `workflowAction: approved` from non-gate continues.
- Default normal continue to auto-run until the next pause point.
- Remove the low `8`-step continuation cap as normal behavior.
- Preserve legacy `workflowAction` behavior only for explicit legacy gate route
  calls.
- Improve error messages so callers see "current step is agent; continue does
  not accept gate action" instead of ambiguous gate errors.

### Slice 2: Attention Resume Semantics

- Treat `needs_attention` and overridable blockers as pause reasons.
- Add or update explicit continue/rerun behavior for paused attention states.
- Record an audit event when a paused attention state is continued.

### Slice 3: Authoring And UI Cleanup

- Update workflow authoring skill guidance.
- Update change-request ops guidance.
- Update architecture docs and tutorials.
- Move UI labels toward Continue, Rerun, Cancel, and Change Step.
- Add Pause workflow / Pause loop as an explicit operator control.

### Slice 4: Prism Doctor

- Add a built-in `prism-doctor` task disabled by default.
- Add a companion doctor skill for interpreting reports and planning repairs.
- Implement workflow checks first.
- Keep doctor report-only by default.
- Allow explicit follow-up request creation later.

### Slice 5: Workflow Cleanup

- Migrate `change-request-default` gates to simple `next`.
- Migrate high-traffic review workflows after validating UI controls.
- Run Prism Doctor to find remaining drift before removing old route-map
  behavior.

## Open Questions

- Should `blocked` and `needs_attention` share one pause mechanism with
  different severity, or remain separate event types?
- Should "continue from attention" move to `next`, or should default UI prefer
  rerunning the current step?
- Which existing workflows still need true multi-route decisions after explicit
  Cancel and Change Step controls exist?
- What should be the minimum doctor check set before route-map behavior is
  removed?
