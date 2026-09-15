import assert from "node:assert/strict"
import test from "node:test"

import { publishCheckpointReceipt, type PublishCheckpointReceiptDependencies } from "./checkpoint-receipt"

test("checkpoint completion publishes one durable request-conversation receipt", () => {
  const messages: Array<{ source: string; sourceMessageId: string | null; content?: string }> = []
  const session = { id: "session-1", meta: { contextKey: "prism-lab-request:request-1" } }
  const dependencies: PublishCheckpointReceiptDependencies = {
    findSession: () => session,
    createSession: () => session,
    listMessages: () => messages,
    createMessage: (input) => {
      messages.push({ source: input.source, sourceMessageId: input.sourceMessageId, content: input.content })
      return input
    },
    updateSession: () => session,
    now: () => "2026-08-24T19:13:14.333Z",
  }
  const input = {
    request: { id: "request-1", requestNumber: 1652, title: "Render", targetEnvironmentId: null },
    stepKey: "render-status-check",
    stepLabel: "Render status check",
    agentRunId: "run-1",
    responseText: "The render completed successfully.",
    status: "succeeded" as const,
  }
  assert.ok(publishCheckpointReceipt(input, dependencies))
  assert.equal(publishCheckpointReceipt(input, dependencies), null)
  assert.equal(messages.length, 1)
  assert.match(messages[0]?.content ?? "", /^Checkpoint passed · Render status check/)
  assert.match(messages[0]?.content ?? "", /render completed successfully/)
})
