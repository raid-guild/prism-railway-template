import assert from "node:assert/strict"
import test from "node:test"

import {
  agentMemoryScopeAllows,
  listRollingDatesFromArtifacts,
  listRollingDatesFromIndex,
  normalizeMemoryReferences,
  parseRollingDay,
} from "./memory"

test("rolling artifacts produce unique newest-first dates and ignore latest alias", () => {
  assert.deepEqual(listRollingDatesFromArtifacts({ artifacts: [
    { path: "memory/rolling/latest.json" },
    { path: "memory/rolling/2026-08-20.json" },
    { filename: "2026-08-21.json" },
    { path: "memory/rolling/2026-08-20.json" },
  ] }), ["2026-08-21", "2026-08-20"])
})

test("rolling date index accepts canonical summaries and returns newest first", () => {
  assert.deepEqual(listRollingDatesFromIndex({ dates: [
    { date: "2026-08-19", section_count: 3 },
    { date: "2026-08-21", section_count: 4 },
    { date: "2026-08-19" },
    { date: "latest" },
  ] }), ["2026-08-21", "2026-08-19"])
})

test("rolling parser retains deterministic evidence and derives buckets", () => {
  const day = parseRollingDay({
    date: "2026-08-21",
    narrative: "One decision.",
    source_digest_paths: ["buckets/meetings/digests/2026-08-21.md"],
    sections: { key_decisions: [{ bucket: "ops", text: "Ship it", source_digest_path: "buckets/ops/digests/2026-08-21.md", evidence_quotes: [{ author: "Ada", text: "Ship it", timestamp: "now", jump_url: "https://example.test/1" }] }] },
  })
  assert.deepEqual(day?.buckets, ["meetings", "ops"])
  assert.equal(day?.sections.key_decisions?.[0]?.evidence[0]?.author, "Ada")
})

test("memory scope fails closed and matches workspace, buckets, or knowledge facets", () => {
  const rolling = { type: "rolling-day" as const, date: "2026-08-21", buckets: ["meetings", "ops"] }
  assert.equal(agentMemoryScopeAllows({}, rolling), false)
  assert.equal(agentMemoryScopeAllows({ scope: "workspace-operational" }, rolling), true)
  assert.equal(agentMemoryScopeAllows({ buckets: ["meetings"] }, rolling), false)
  assert.equal(agentMemoryScopeAllows({ buckets: ["meetings", "ops"] }, rolling), true)
  const knowledge = { type: "knowledge-doc" as const, slug: "guide/one", sourceId: "handbook", kind: "guide", tags: ["ops"], entities: [], audience: "workspace", stability: "evergreen" }
  assert.equal(agentMemoryScopeAllows({ knowledgeSourceIds: ["handbook"], tags: ["ops"] }, knowledge), true)
  assert.equal(agentMemoryScopeAllows({ knowledgeSourceIds: ["other"] }, knowledge), false)
})

test("browser references accept identifiers only, dedupe, and reject traversal", () => {
  assert.deepEqual(normalizeMemoryReferences([
    { type: "rolling-day", date: "2026-08-21", content: "untrusted" },
    { type: "rolling-day", date: "2026-08-21" },
    { type: "knowledge-doc", slug: "guide/intro", content: "untrusted" },
    { type: "knowledge-doc", slug: "../secret" },
  ]), [
    { type: "rolling-day", date: "2026-08-21" },
    { type: "knowledge-doc", slug: "guide/intro" },
  ])
})
