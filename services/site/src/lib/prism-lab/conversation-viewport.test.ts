import assert from "node:assert/strict"
import test from "node:test"

import { decideConversationViewportUpdate } from "./conversation-viewport"

test("initial and request-switched conversations reveal the latest message", () => {
  const initial = decideConversationViewportUpdate(
    { requestId: null, lastMessageId: null },
    { requestId: "request-a", lastMessageId: "message-3", nearBottom: false, revealLatest: false },
  )
  assert.equal(initial.scrollToLatest, true)
  assert.equal(decideConversationViewportUpdate(initial.next, {
    requestId: "request-b",
    lastMessageId: "message-8",
    nearBottom: false,
    revealLatest: false,
  }).scrollToLatest, true)
})
test("background messages preserve an older reading position and expose an unread control", () => {
  const update = decideConversationViewportUpdate(
    { requestId: "request-a", lastMessageId: "message-3" },
    { requestId: "request-a", lastMessageId: "message-4", nearBottom: false, revealLatest: false },
  )
  assert.equal(update.scrollToLatest, false)
  assert.equal(update.showNewMessages, true)
})

test("near-bottom and operator-requested updates reveal the latest message", () => {
  const tracker = { requestId: "request-a", lastMessageId: "message-3" }
  assert.equal(decideConversationViewportUpdate(tracker, {
    requestId: "request-a",
    lastMessageId: "message-4",
    nearBottom: true,
    revealLatest: false,
  }).scrollToLatest, true)
  assert.equal(decideConversationViewportUpdate(tracker, {
    requestId: "request-a",
    lastMessageId: "message-4",
    nearBottom: false,
    revealLatest: true,
  }).scrollToLatest, true)
})
