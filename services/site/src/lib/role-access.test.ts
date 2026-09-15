import assert from "node:assert/strict"
import test from "node:test"

import { capabilitiesForRoles } from "./role-access"

test("members can browse Memory and chat without operational execution authority", () => {
  const capabilities = capabilitiesForRoles(["member"])
  assert.equal(capabilities.has("canViewMemory"), true)
  assert.equal(capabilities.has("canChatAgents"), true)
  assert.equal(capabilities.has("canRunAgent"), false)
  assert.equal(capabilities.has("canManageMemorySources"), false)
})
