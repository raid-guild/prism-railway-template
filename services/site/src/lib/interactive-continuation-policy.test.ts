import assert from "node:assert/strict"
import test from "node:test"

import { interactiveContinuationPolicy } from "./interactive-continuation-policy"

test("durable console conversations always continue the session", () => {
  assert.equal(interactiveContinuationPolicy({ linkedWorkflow: false }), "session")
  assert.equal(
    interactiveContinuationPolicy({
      linkedWorkflow: false,
      workflowAgentConfig: { contextPolicy: { continuation: "step" } },
    }),
    "session",
  )
})

test("linked workflows retain their configured continuation boundary", () => {
  assert.equal(interactiveContinuationPolicy({ linkedWorkflow: true }), "session")
  assert.equal(
    interactiveContinuationPolicy({
      linkedWorkflow: true,
      workflowAgentConfig: { contextPolicy: { continuation: "step" } },
    }),
    "step",
  )
})
