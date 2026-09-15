import assert from "node:assert/strict"
import test from "node:test"

import { resolveRequestManagementIntent } from "./request-management-intent"

const steps = [
  { key: "work", label: "Work", type: "agent" },
  { key: "remotion-prep", label: "Remotion prep", type: "agent" },
  { key: "approve-for-work", label: "Approve", type: "gate" },
  { key: "pr-review", label: "PR Review", type: "checkpoint" },
  { key: "closed", label: "Closed", type: "terminal" },
]

test("clear request cancellation commands resolve without model authority", () => {
  assert.deepEqual(resolveRequestManagementIntent("can you cancel this request", steps), {
    kind: "cancel-request",
  })
  assert.deepEqual(resolveRequestManagementIntent("Please close the request now.", steps), {
    kind: "cancel-request",
  })
  assert.deepEqual(resolveRequestManagementIntent("can you cancel now?", steps), {
    kind: "cancel-request",
  })
  assert.equal(resolveRequestManagementIntent("Can you explain how cancellation works?", steps), null)
})

test("clear retry commands resolve without model authority", () => {
  for (const command of [
    "try again",
    "please retry",
    "retry this step",
    "can you rerun the current step?",
    "run this step again now",
  ]) {
    assert.deepEqual(resolveRequestManagementIntent(command, steps), { kind: "retry-step" })
  }
  assert.equal(resolveRequestManagementIntent("Can you explain whether retrying is safe?", steps), null)
  assert.equal(resolveRequestManagementIntent("What happened when it tried again?", steps), null)
})

test("clear status-check commands resolve without model authority", () => {
  for (const command of [
    "check now",
    "check status",
    "check the current status",
    "poll render status",
    "can you refresh the job progress now?",
    "run the status check",
    "please run the current checkpoint now",
  ]) {
    assert.deepEqual(resolveRequestManagementIntent(command, steps), { kind: "check-status" })
  }
  assert.equal(resolveRequestManagementIntent("What did the last status check say?", steps), null)
})

test("clear step movement commands resolve only exact nonterminal workflow steps", () => {
  assert.deepEqual(resolveRequestManagementIntent("move back to work", steps), {
    kind: "move-step",
    targetStepKey: "work",
    runAfterMove: false,
  })
  assert.deepEqual(resolveRequestManagementIntent("Can you move this request forward to PR Review?", steps), {
    kind: "move-step",
    targetStepKey: "pr-review",
    runAfterMove: false,
  })
  assert.deepEqual(resolveRequestManagementIntent("move back and run from work", steps), {
    kind: "move-step",
    targetStepKey: "work",
    runAfterMove: true,
  })
  assert.deepEqual(resolveRequestManagementIntent("move back and run from remotion prep", steps), {
    kind: "move-step",
    targetStepKey: "remotion-prep",
    runAfterMove: true,
  })
  assert.deepEqual(resolveRequestManagementIntent("move to PR Review and retry", steps), {
    kind: "move-step",
    targetStepKey: "pr-review",
    runAfterMove: true,
  })
  assert.equal(resolveRequestManagementIntent("move to review", steps), null)
  assert.equal(resolveRequestManagementIntent("move to closed", steps), null)
})
