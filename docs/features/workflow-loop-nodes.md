# Workflow Loop Nodes

## Status

Partially implemented.

The first runtime slice adds checklist loop evaluation in the site workflow
runner, `loop.*` workflow events, max-iteration routing, queue idempotency
context for loop iterations, auto-continue through `agent -> loop -> agent`
chains, basic UI awareness, and workflow authoring guidance. It supports JSON
request artifacts with `condition: "all_items_complete"`.

This document proposes a first-class `loop` workflow step type for Prism
workflows. The goal is to make iterative work observable and resumable without
turning agent step instructions into hidden orchestration logic.

## Problem

Some workflow work is naturally iterative:

- research across a list of sources,
- large code builds broken into checklist items,
- repeated implementation and review passes,
- migration batches,
- content production where each section needs drafting and review,
- audit workflows where each finding needs remediation.

Today a workflow can approximate this in a few ways:

- put the whole loop inside one long `agent` step,
- use a human `gate` to route back for changes,
- make a static loop in the manifest and rely on a blocker or manual step change
  to escape,
- have an agent patch workflow state through an API.

Those options either hide progress inside a single agent run or make routing
less deterministic. Operators cannot easily see which iteration happened, why
the workflow repeated, which checklist item was selected, or why it finally
exited.

## Goals

- Add a deterministic control-flow step for iterative workflows.
- Let workflows route back to a previous step until a structured exit condition
  is satisfied.
- Preserve an event trail for every loop decision.
- Use request artifacts as the first loop state source.
- Support checklist-driven loops as the first implementation.
- Require safety limits so loops cannot run forever.
- Keep agents responsible for work and artifact updates, while the workflow
  engine owns loop routing.
- Make loop behavior visible in request history and workflow UI.

## Non-Goals

- Do not make `loop` a general scripting language.
- Do not let freeform agent prose decide workflow routing.
- Do not require a new database table for the first implementation.
- Do not make loop steps call Codex Runtime directly.
- Do not replace human gates for subjective approval decisions.
- Do not infer checklist meaning from markdown tables in the first slice.

## Proposed Workflow Shape

A common checklist loop:

```text
generate-checklist
  -> implement-item
  -> review-iteration
  -> checklist-loop
       incomplete and under max iterations -> implement-item
       complete -> final-review
       max iterations hit -> loop-review-gate
  -> final-review
  -> closed
```

Example manifest:

```json
{
  "steps": [
    {
      "key": "generate-checklist",
      "label": "Generate Checklist",
      "type": "agent",
      "instructionPath": "steps/generate-checklist.md",
      "next": "implement-item"
    },
    {
      "key": "implement-item",
      "label": "Implement Item",
      "type": "agent",
      "instructionPath": "steps/implement-item.md",
      "next": "review-iteration"
    },
    {
      "key": "review-iteration",
      "label": "Review Iteration",
      "type": "agent",
      "instructionPath": "steps/review-iteration.md",
      "next": "checklist-loop"
    },
    {
      "key": "checklist-loop",
      "label": "Checklist Loop",
      "type": "loop",
      "loop": {
        "artifactName": "implementation-checklist.json",
        "condition": "all_items_complete",
        "target": "implement-item",
        "maxIterations": 10,
        "onMaxIterations": "loop-review-gate"
      },
      "next": "final-review"
    },
    {
      "key": "loop-review-gate",
      "label": "Loop Review",
      "type": "gate",
      "next": "implement-item",
      "routes": {
        "approved": "implement-item",
        "skipToFinalReview": "final-review"
      }
    },
    {
      "key": "final-review",
      "label": "Final Review",
      "type": "agent",
      "instructionPath": "steps/final-review.md",
      "next": "closed"
    },
    {
      "key": "closed",
      "label": "Closed",
      "type": "terminal"
    }
  ]
}
```

## Step Contract

Initial loop fields:

```json
{
  "key": "checklist-loop",
  "label": "Checklist Loop",
  "type": "loop",
  "loop": {
    "artifactName": "implementation-checklist.json",
    "condition": "all_items_complete",
    "target": "implement-item",
    "maxIterations": 10,
    "onMaxIterations": "loop-review-gate"
  },
  "next": "final-review"
}
```

Field semantics:

- `loop.artifactName`: request artifact name to inspect.
- `loop.condition`: supported condition identifier.
- `loop.target`: step key to route to when the loop should continue.
- `loop.maxIterations`: required positive integer safety cap.
- `loop.onMaxIterations`: optional step key used when the cap is reached.
- `next`: step key used when the exit condition is satisfied.

The first condition should be `all_items_complete`.

## Checklist Artifact

The first implementation should support JSON request artifacts with this shape:

```json
{
  "version": 1,
  "items": [
    {
      "id": "auth-validation",
      "title": "Add auth validation",
      "status": "complete",
      "notes": "Implemented and tested"
    },
    {
      "id": "admin-ui-empty-state",
      "title": "Update admin UI empty state",
      "status": "pending",
      "notes": "Needs implementation"
    }
  ]
}
```

Initial item statuses:

- `pending`
- `in_progress`
- `complete`
- `blocked`
- `skipped`

For `all_items_complete`, the loop exits only when every item is `complete` or
`skipped`. It continues when any item is `pending`, `in_progress`, or `blocked`.

Blocked checklist items are not automatically workflow blockers in the first
slice. The loop should continue to its target unless the workflow reaches
`maxIterations` or the agent step returns a first-class blocker outcome. This
keeps loop routing separate from blocker semantics.

## Engine Behavior

The loop step is a control-flow step. It does not run Codex Runtime.

When a workflow advances to a `loop` step, the engine evaluates the loop:

1. Load the configured artifact.
2. Parse the structured checklist.
3. Count completed, skipped, pending, in-progress, and blocked items.
4. Read the loop iteration count from workflow run metadata or workflow events.
5. Decide one of:
   - exit to `next`,
   - continue to `loop.target`,
   - route to `loop.onMaxIterations`,
   - stop with a loop evaluation error.
6. Update `workflow_runs.current_step_key` to the decided step.
7. Update the request's current workflow step.
8. Emit a workflow event explaining the decision.

Suggested events:

- `loop.continued`
- `loop.exited`
- `loop.max_iterations`
- `loop.evaluation_failed`

Example event payload:

```json
{
  "loopStepKey": "checklist-loop",
  "decision": "continue",
  "fromStepKey": "checklist-loop",
  "toStepKey": "implement-item",
  "artifactName": "implementation-checklist.json",
  "iteration": 3,
  "maxIterations": 10,
  "counts": {
    "pending": 2,
    "in_progress": 1,
    "complete": 7,
    "blocked": 0,
    "skipped": 0
  }
}
```

## Auto-Continue Behavior

Auto-continue currently runs consecutive `agent` steps until the workflow
reaches a gate, checkpoint, or terminal step.

With loop nodes, auto-continue should resolve control-flow steps before deciding
whether another agent step can run. This allows:

```text
agent -> loop -> agent -> loop -> final-review
```

The auto-continue cap should count agent runs. Loop evaluations should have
their own `maxIterations` cap and should also be bounded by a small internal
control-flow resolution cap to avoid malformed workflows bouncing between
non-agent control steps.

## Missing Or Malformed State

If the configured checklist artifact is missing, invalid JSON, or does not match
the expected shape, the loop should not guess.

First-slice behavior:

- emit `loop.evaluation_failed`,
- keep the workflow on the loop step,
- stop auto-continue,
- surface the error in request history.

A later implementation can allow `onEvaluationFailed` to route to a gate or
checkpoint.

## Iteration Counting

The loop needs a deterministic iteration count.

First implementation options:

- derive count from prior `loop.continued` events for the same loop step,
- or store per-loop counters in `workflow_runs.meta`.

Deriving from events avoids mutable nested metadata but may be less efficient.
Using `workflow_runs.meta` is faster and easier to display, but updates need to
preserve unrelated run metadata.

Either option must count loop decisions, not agent runs. A loop iteration begins
when the loop routes to `loop.target`.

## Idempotency

Loop routing changes which step runs next, so idempotency must avoid treating
all repeated target runs as duplicates forever.

Current workflow step run idempotency keys include request, workflow run, step
key, and action. A repeated loop target may need an iteration component, for
example:

```text
workflow:<requestId>:<workflowRunId>:<stepKey>:loop-<loopStepKey>-<iteration>
```

The first implementation should include enough loop context in queued agent run
input and idempotency keys so each intended iteration can execute once while
still preventing duplicate dispatch of the same iteration.

## Authoring Guidance

The step before a loop should update the loop artifact. In the checklist shape,
`review-iteration` is usually responsible for marking completed, skipped,
blocked, or still-pending items.

The loop target should be written to work on the next incomplete item instead of
redoing the whole checklist. For example, `implement-item.md` should say:

```text
Read implementation-checklist.json. Select the next item whose status is
pending, in_progress, or blocked and work only that item unless the checklist
explicitly says several items must be handled together. Update durable artifacts
with the current agent_run_id.
```

The review step should say:

```text
Review the latest implementation pass against implementation-checklist.json.
Update item statuses and notes. Do not mark an item complete unless the
implementation and verification evidence are present.
```

## UI Behavior

Workflow map:

- render `loop` as a control-flow step distinct from `agent`, `gate`, and
  `checkpoint`,
- show loop target and exit step in detail views,
- include current iteration count when available.

Request history:

- show loop decisions with target, exit, counts, and reason,
- make repeated iterations easy to distinguish.

Request detail:

- when parked on a loop because evaluation failed, show the artifact error and
  the expected artifact name.

## Implementation Slices

### Slice 1: Spec And UI Awareness

- Add this spec.
- Document `loop` in the workflow architecture doc.
- Teach UI helpers to label and badge `loop` steps.
- No runtime behavior yet.

### Slice 2: Runtime Loop Evaluation

- Add loop parsing helpers.
- Add checklist artifact loading.
- Add `all_items_complete` evaluation.
- Add `loop.*` workflow events.
- Add routing from loop to target, next, or max-iteration route.
- Stop on malformed state.

### Slice 3: Auto-Continue Integration

- Resolve loop nodes during auto-continue.
- Include loop iteration context in idempotency keys.
- Add regression coverage for agent-loop-agent chains as part of the
  [Workflow Runtime Test Harness](workflow-runtime-test-harness.md).

### Slice 4: Authoring And Templates

- Add example workflow templates for checklist-driven research and large code
  builds.
- Update the `prism-workflow-author` skill with loop-node authoring guidance,
  including checklist artifact conventions, target-step instructions, max
  iteration defaults, and when to use a gate instead of a loop.

## Open Questions

- Should loop counters live in `workflow_runs.meta` or be derived from
  `workflow_events`?
- Should blocked checklist items continue looping, route to a gate, or defer to
  first-class workflow blocker outcomes?
- Should `loop.onMaxIterations` be required instead of optional?
- Should loop artifacts be selected by `artifactName`, `kind`, or both?
- Should later loop conditions support JSONPath-like selectors, or stay limited
  to named conditions?
- Should a loop be allowed to target only an earlier step, or any non-terminal
  step?
