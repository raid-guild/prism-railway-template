import assert from "node:assert/strict"
import test from "node:test"

import { parseBuzzCommandArgs } from "./buzz-agent-api"

test("Buzz agent commands accept bounded argument arrays", () => {
  assert.deepEqual(parseBuzzCommandArgs(["messages", "get", "--limit", "50"]), ["messages", "get", "--limit", "50"])
  assert.equal(parseBuzzCommandArgs([]), null)
  assert.equal(parseBuzzCommandArgs(["messages", ""]), null)
  assert.equal(parseBuzzCommandArgs(Array.from({ length: 65 }, () => "x")), null)
})
