import assert from "node:assert/strict"
import test from "node:test"

import { shouldRefreshInbox } from "./inbox-refresh"

test("inbox refresh runs only while visible and without an overlapping refresh", () => {
  assert.equal(shouldRefreshInbox({ visible: true, refreshPending: false }), true)
  assert.equal(shouldRefreshInbox({ visible: false, refreshPending: false }), false)
  assert.equal(shouldRefreshInbox({ visible: true, refreshPending: true }), false)
})
