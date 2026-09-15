import assert from "node:assert/strict"
import test from "node:test"
import { defaultSourceAdapterPolicy, normalizeSourceAdapterPolicy } from "./app-core/source-adapter-policy"
import { authorizeSourceHistoryContext, authorizeSourceHistoryRequest, SourceHistoryError, sourceHistoryCapabilities } from "./source-history"

test("trusted history search allows bot-visible Discord scope except explicit off targets", () => {
  const policy = normalizeSourceAdapterPolicy({
    platforms: { discord: { targets: { "999": { mode: "off" } } } },
  })
  assert.deepEqual(authorizeSourceHistoryRequest({ source: "discord", query: "old decision", channelIds: ["123"] }, policy).channelIds, ["123"])
  assert.throws(
    () => authorizeSourceHistoryRequest({ source: "discord", query: "old decision", channelIds: ["999"] }, policy),
    (error: unknown) => error instanceof SourceHistoryError && error.status === 403,
  )
})

test("source-originated search defaults to its target and honors explicit historyScopes", () => {
  const policy = normalizeSourceAdapterPolicy({
    platforms: {
      discord: {
        targets: { "123": { mode: "readonly", historyScopes: ["123", "456"] } },
      },
    },
  })
  const context = { targetId: "123", userId: "789" }
  assert.deepEqual(authorizeSourceHistoryRequest({ source: "discord", query: "x", sourceContext: context }, policy).channelIds, ["123"])
  assert.deepEqual(authorizeSourceHistoryRequest({ source: "discord", query: "x", channelIds: ["456"], sourceContext: context }, policy).channelIds, ["456"])
  assert.throws(() => authorizeSourceHistoryRequest({ source: "discord", query: "x", channelIds: ["777"], sourceContext: context }, policy), SourceHistoryError)
})

test("history context is bounded and age-restricted search is rejected", () => {
  assert.throws(() => authorizeSourceHistoryRequest({ source: "discord", query: "x", includeNsfw: true }, defaultSourceAdapterPolicy), SourceHistoryError)
  assert.equal(authorizeSourceHistoryContext({ source: "discord", channelId: "123", messageId: "456", before: 10 }, defaultSourceAdapterPolicy).before, 10)
  assert.throws(() => authorizeSourceHistoryContext({ source: "discord", channelId: "123", messageId: "456", before: 11 }, defaultSourceAdapterPolicy), SourceHistoryError)
})

test("capabilities report configured Discord native search honestly", async () => {
  const fetchImpl: typeof fetch = async () => Response.json({ capabilities: ["search-discord-history", "read-buzz-channel-history"] })
  const result = await sourceHistoryCapabilities(fetchImpl, { baseUrl: "http://adapter.internal", token: "secret" })
  assert.equal(result.sources.discord.mode, "native-search")
  assert.equal(result.sources.discord.supportsQuery, true)
  assert.equal(result.sources.buzz.mode, "bounded-read-through")
  assert.equal(result.sources.telegram.mode, "unavailable")
})
