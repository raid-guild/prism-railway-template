import assert from "node:assert/strict"
import test from "node:test"

import {
  beginRequestReviewLoad,
  captureRequestReviewScope,
  createRequestReviewScope,
  isCurrentRequestReviewLoad,
  isCurrentRequestReviewScope,
  selectRequestReviewScope,
} from "./request-review-coordinator"

test("a response from the previous request cannot become current after a request switch", () => {
  let scope = createRequestReviewScope("request-a")
  const requestA = beginRequestReviewLoad(scope)
  scope = requestA.scope

  scope = selectRequestReviewScope(scope, "request-b")
  const requestB = beginRequestReviewLoad(scope)
  scope = requestB.scope

  assert.equal(isCurrentRequestReviewLoad(scope, requestA.token), false)
  assert.equal(isCurrentRequestReviewLoad(scope, requestB.token), true)
})

test("an older overlapping refresh cannot replace or finish a newer refresh", () => {
  let scope = createRequestReviewScope("request-a")
  const first = beginRequestReviewLoad(scope)
  scope = first.scope
  const second = beginRequestReviewLoad(scope)
  scope = second.scope

  assert.equal(isCurrentRequestReviewLoad(scope, first.token), false)
  assert.equal(isCurrentRequestReviewLoad(scope, second.token), true)
})

test("generation prevents an old request from becoming current after navigating away and back", () => {
  let scope = createRequestReviewScope("request-a")
  const oldMutation = captureRequestReviewScope(scope)
  const oldLoad = beginRequestReviewLoad(scope)
  scope = oldLoad.scope

  scope = selectRequestReviewScope(scope, "request-b")
  scope = selectRequestReviewScope(scope, "request-a")
  const currentMutation = captureRequestReviewScope(scope)

  assert.equal(isCurrentRequestReviewScope(scope, oldMutation), false)
  assert.equal(isCurrentRequestReviewLoad(scope, oldLoad.token), false)
  assert.equal(isCurrentRequestReviewScope(scope, currentMutation), true)
})
