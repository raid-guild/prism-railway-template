import assert from "node:assert/strict"
import test from "node:test"

import { evaluateLoopCondition } from "./workflow-control-flow"

const finding = (status: "open" | "resolved", severity: "blocking" | "high" | "medium" = "high") => ({
  id: "finding-1",
  status,
  severity,
})

test("review loop exits only for a consistent approved review", () => {
  assert.deepEqual(evaluateLoopCondition("review_approved", {
    version: 2,
    status: "approved",
    findings: [finding("resolved")],
  }), {
    counts: { pending: 0, in_progress: 0, complete: 1, blocked: 0, skipped: 0, total: 1 },
    complete: true,
    error: null,
  })

  assert.equal(evaluateLoopCondition("review_approved", {
    version: 2,
    status: "approved",
    findings: [finding("open")],
  }).error, "LOOP_REVIEW_VERDICT_MISMATCH")
})

test("review loop returns requested changes to its target step", () => {
  const result = evaluateLoopCondition("review_approved", {
    version: 2,
    status: "changes_requested",
    findings: [finding("open")],
  })
  assert.equal(result.complete, false)
  assert.equal(result.error, null)
  assert.equal(result.counts?.blocked, 1)
})

test("review loop stops on inconclusive or malformed review evidence", () => {
  assert.equal(evaluateLoopCondition("review_approved", {
    version: 2,
    status: "inconclusive",
    findings: [],
  }).error, "LOOP_REVIEW_INCONCLUSIVE")
  assert.equal(evaluateLoopCondition("review_approved", {
    version: 2,
    status: "changes_requested",
    findings: [],
  }).error, "LOOP_REVIEW_VERDICT_MISMATCH")
  assert.equal(evaluateLoopCondition("review_approved", null).error, "LOOP_REVIEW_INVALID")
})
