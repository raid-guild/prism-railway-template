# Workflow Runtime Test Harness

## Status

Future feature spec.

Prism workflow behavior is now large enough that typechecking and manual
runbooks are not enough on their own. The workflow engine coordinates request
state, workflow runs, workflow events, agent runs, artifacts, auto-continue,
gates, checkpoints, blockers, queueing, and control-flow nodes such as loops.

This document proposes a focused test harness for workflow runtime behavior.

## Problem

The repo currently does not have a first-class workflow fixture or automated
runtime test suite. Workflow changes are validated with TypeScript typechecks,
manual inspection, and operational runbooks.

That leaves several high-risk behaviors under-tested:

- routing from one step to another,
- gate action routing,
- checkpoint parking behavior,
- blocker and needs-attention outcomes,
- auto-continue chains,
- queued workflow agent runs,
- workflow event emission,
- request artifact reads and writes,
- loop-node evaluation and iteration safety.

As workflow step types grow, regressions can appear without compiler errors. For
example, a route may update `workflow_runs.current_step_key` but forget to emit
`workflow.step_changed`, or auto-continue may stop before resolving a
deterministic control-flow step.

## Goals

- Add repeatable tests for workflow runtime transitions.
- Seed realistic workflow definitions, requests, workflow runs, artifacts, and
  agent runs without requiring a deployed Prism instance.
- Keep tests fast enough for local development and CI.
- Cover deterministic workflow behavior without calling Codex Runtime.
- Make new step types prove their routing, event, and safety behavior.
- Provide fixtures that can also guide workflow authoring examples.

## Non-Goals

- Do not test model quality or Codex Runtime behavior in the first pass.
- Do not require live GitHub, Discord, Railway, or communication-adapter calls.
- Do not build a full browser end-to-end suite before runtime tests exist.
- Do not snapshot huge response bodies or UI markup.
- Do not replace manual deployment runbooks for service integration checks.

## Proposed Test Layers

### Unit-Level Runtime Tests

Extract deterministic workflow helpers into modules that can be tested directly:

- step lookup,
- step type handling,
- route resolution,
- loop checklist evaluation,
- idempotency key generation,
- workflow outcome parsing.

These tests should not need Next.js request handlers or a database.

### Repository-Backed Integration Tests

Use an isolated SQLite database and temporary artifact root to test site runtime
behavior against real repository functions:

- create request,
- ensure workflow run,
- create artifacts,
- advance workflow state,
- emit workflow events,
- create and update agent runs.

This layer should avoid Codex Runtime by testing deterministic handlers/helpers
directly or by stubbing the runtime call boundary.

### Route-Level Tests

Exercise selected API routes with local `Request` objects when useful:

- `/agent/responses`,
- workflow continue routes,
- request artifact routes,
- workflow autostart.

Route-level tests should remain selective because they are slower and require
more setup.

## Initial Fixtures

Add workflow fixtures for the behaviors Prism already depends on.

### Linear Agent Workflow

```text
triage -> implement -> closed
```

Assertions:

- agent completion advances to the next step,
- terminal step marks workflow run completed,
- workflow events are emitted in order.

### Gate Workflow

```text
triage -> review-gate
  approved -> closed
  changesRequested -> triage
```

Assertions:

- gate requires a workflow action,
- route key chooses the correct next step,
- unknown route falls back only when the manifest allows it,
- gate events include action and target step.

### Checkpoint Workflow

```text
render -> render-check -> publish
```

Assertions:

- checkpoint run records the check,
- workflow remains on the checkpoint,
- auto-continue stops at the checkpoint.

### Blocker Outcome Workflow

```text
implement -> review
```

Assertions:

- `workflow-outcome` with `blocked` parks on the current step,
- `needs_attention` parks on the current step,
- auto-continue stops,
- attention events and agent run results preserve structured outcome data.

### Checklist Loop Workflow

```text
generate-checklist
  -> implement-item
  -> review-iteration
  -> checklist-loop
       incomplete -> implement-item
       complete -> final-review
       max iterations -> loop-review-gate
```

Assertions:

- incomplete checklist routes `loop -> target`,
- complete checklist routes `loop -> next`,
- max iterations routes to `onMaxIterations`,
- missing artifact emits `loop.evaluation_failed` and parks on the loop,
- invalid JSON emits `loop.evaluation_failed`,
- loop decisions emit `loop.continued`, `loop.exited`, or
  `loop.max_iterations`,
- repeated loop target runs get distinct idempotency keys.

## Harness Requirements

The test harness needs helpers for:

- creating an isolated app-core database,
- running migrations,
- overriding `dataRoot` and artifact root for a temp directory,
- inserting workflow definitions,
- creating requests with workflow keys,
- writing request artifact files,
- reading workflow events in chronological order,
- stubbing Codex Runtime responses when route-level tests need an agent result.

Recommended helper names:

```ts
createWorkflowTestContext()
seedWorkflowDefinition()
seedWorkflowRequest()
writeRequestArtifact()
completeWorkflowStep()
listWorkflowEventsChronological()
```

## Runtime Refactors To Enable Tests

Some current workflow logic lives inside route handlers. To make it testable,
move deterministic pieces into smaller modules:

- workflow step lookup and routing,
- control-flow resolution,
- loop artifact evaluation,
- workflow completion/update helpers,
- workflow idempotency key helpers.

Route handlers should orchestrate HTTP parsing and response formatting, while
runtime modules own state transitions.

## Suggested Tooling

Use the repo's existing TypeScript stack. Reasonable options:

- Node's built-in test runner for minimal dependencies,
- Vitest if richer assertions, mocks, and watch mode are preferred.

Pick one test runner for the site service and document the command in
`services/site/package.json`, for example:

```json
{
  "scripts": {
    "test:workflow": "vitest run src/lib/workflow-runtime"
  }
}
```

## Implementation Slices

### Slice 1: Harness Skeleton

- Choose test runner.
- Add isolated database/temp data-root setup.
- Add a minimal workflow fixture.
- Test simple agent-step routing without Codex Runtime.

### Slice 2: Existing Step Types

- Add gate routing tests.
- Add checkpoint parking tests.
- Add terminal completion tests.
- Add blocker/needs-attention outcome tests.

### Slice 3: Loop Nodes

- Add checklist loop fixtures.
- Test continue, exit, max-iteration, and evaluation-failure paths.
- Test loop iteration metadata and idempotency key behavior.

### Slice 4: Route-Level Coverage

- Add targeted `/agent/responses` tests with a stubbed runtime boundary.
- Add workflow autostart tests.
- Add task-runner continuation policy tests if practical.

### Slice 5: CI Integration

- Add workflow tests to CI.
- Keep slow external-service checks in manual runbooks.
- Document how to run workflow tests locally.

## Open Questions

- Should tests use Node's built-in runner or Vitest?
- Should workflow runtime helpers live under `src/lib/workflow-runtime/`?
- How should app-core config overrides be injected for temp `dataRoot` and DB
  paths?
- Should route-level tests mock `fetch` globally or extract the Codex Runtime
  boundary behind an injectable function?
- Should fixtures live in code, JSON files, or both?
