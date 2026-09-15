import assert from "node:assert/strict"
import test from "node:test"

import { buildRequestTimeline } from "./request-timeline"

test("unified timeline uses stable chronological and kind ordering", () => {
  const timeline = buildRequestTimeline({
    messages: [{ id: "m1", role: "user", source: "site", content: "Context", createdAt: "2026-01-01T00:00:00.000Z" }],
    events: [{ id: "e1", eventType: "step.completed", stepKey: "work", actorType: "system", note: null, createdAt: "2026-01-01T00:00:00.000Z" }],
    runs: [{ id: "r1", status: "failed", kind: "workflow_step", workflowStepKey: "work", errorMessage: "Tests failed", queuedAt: "2026-01-01T00:01:00.000Z", startedAt: null, finishedAt: null }],
    artifacts: [{ id: "a1", name: "report.md", kind: "report", description: null, createdAt: "2026-01-01T00:02:00.000Z", agentRunId: "r1" }],
    externalRefs: [],
  })

  assert.deepEqual(timeline.map((item) => item.id), ["message:m1", "event:e1", "run:r1", "artifact:a1"])
  assert.equal(timeline[2]?.needsAttention, true)
  assert.equal(timeline[3]?.runId, "r1")
})
test("run occurrence uses finish, start, then queue time", () => {
  const [run] = buildRequestTimeline({
    messages: [], events: [], artifacts: [], externalRefs: [],
    runs: [{ id: "r1", status: "completed", kind: "workflow_step", workflowStepKey: null, errorMessage: null, queuedAt: "2026-01-01T00:00:00.000Z", startedAt: "2026-01-01T00:01:00.000Z", finishedAt: "2026-01-01T00:02:00.000Z" }],
  })
  assert.equal(run?.occurredAt, "2026-01-01T00:02:00.000Z")
})
