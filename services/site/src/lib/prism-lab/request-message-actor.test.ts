import assert from "node:assert/strict"
import test from "node:test"

import { requestActorMessageMeta, resolveRequestMessageActor } from "./request-message-actor"

test("Site request messages prefer immutable actor snapshots", () => {
  const actor = resolveRequestMessageActor({
    role: "user",
    source: "site-request-action",
    meta: { actorUserId: "user-1", actorDisplayName: "Ada Snapshot", actorHandle: "ada" },
  }, { createdByUserId: "other-user" }, () => ({
    id: "user-1",
    displayName: "Ada Current",
    handle: "ada-current",
  }))
  assert.deepEqual(actor, {
    id: "user-1",
    displayName: "Ada Snapshot",
    handle: "ada",
    kind: "site-user",
    basis: "message-snapshot",
  })
})

test("legacy Site messages recover the owning authenticated session actor", () => {
  const actor = resolveRequestMessageActor(
    { role: "user", source: "site-request-ask", meta: {} },
    { createdByUserId: "user-1" },
    () => ({ id: "user-1", displayName: "Ada", handle: "ada" }),
  )
  assert.equal(actor?.displayName, "Ada")
  assert.equal(actor?.kind, "site-user")
  assert.equal(actor?.basis, "session-owner")
})

test("external message authors remain external and assistants have no operator actor", () => {
  assert.deepEqual(resolveRequestMessageActor({
    role: "user",
    source: "discord",
    meta: { authorId: "discord-1", authorName: "Duck" },
  }, null), {
    id: "discord-1",
    displayName: "Duck",
    handle: null,
    kind: "external",
    basis: "external-message",
  })
  assert.equal(resolveRequestMessageActor({ role: "assistant", source: "site", meta: {} }, null), null)
})

test("actor metadata stores stable identity and display snapshot", () => {
  assert.deepEqual(requestActorMessageMeta({
    id: "user-1",
    displayName: "Ada",
    handle: "ada",
    email: "ada@example.com",
  }, "user-1"), {
    actorUserId: "user-1",
    actorDisplayName: "Ada",
    actorHandle: "ada",
  })
})
