import assert from "node:assert/strict"
import test from "node:test"

import { buildWorkflowExplorer } from "./workflow-explorer"

test("workflow explorer marks current, observed, completed, branches, and loops", () => {
  const steps = buildWorkflowExplorer({
    definition: {
      steps: [
        { key: "work", label: "Work", type: "agent", next: "review" },
        { key: "review", label: "Review", type: "gate", routes: { approved: "closed", revise: "work" } },
        { key: "closed", label: "Closed", type: "terminal" },
      ],
    },
    currentStepKey: "review",
    events: [
      { stepKey: "work", eventType: "agent.completed" },
      { stepKey: "review", eventType: "gate.entered" },
    ],
  })

  assert.equal(steps[0]?.completed, true)
  assert.equal(steps[1]?.current, true)
  assert.equal(steps[1]?.observed, true)
  assert.deepEqual(steps[1]?.routes, [
    { action: "approved", target: "closed", loop: false },
    { action: "revise", target: "work", loop: true },
  ])
  assert.equal(steps[2]?.terminal, true)
})

test("workflow explorer exposes deterministic review-loop routes", () => {
  const steps = buildWorkflowExplorer({
    definition: {
      steps: [
        { key: "implement", type: "agent", next: "review" },
        { key: "review", type: "agent", next: "decision" },
        {
          key: "decision",
          type: "loop",
          next: "human-review",
          loop: {
            target: "implement",
            onMaxIterations: "attention",
            onError: "attention",
          },
        },
        { key: "human-review", type: "gate", next: "closed" },
        { key: "attention", type: "gate", next: "human-review" },
        { key: "closed", type: "terminal" },
      ],
    },
    currentStepKey: "decision",
    events: [],
  })

  assert.deepEqual(steps[2]?.routes, [
    { action: "next", target: "human-review", loop: false },
    { action: "changes requested", target: "implement", loop: true },
    { action: "max iterations", target: "attention", loop: false },
    { action: "evaluation error", target: "attention", loop: false },
  ])
})
