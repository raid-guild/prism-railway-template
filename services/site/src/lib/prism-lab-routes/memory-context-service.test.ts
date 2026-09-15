import assert from "node:assert/strict";
import test from "node:test";

import {
  eligibleMemoryAgents,
  resolveLabMemoryReferences,
} from "./memory-context-service";

function profile(
  key: string,
  memoryScope: Record<string, unknown>,
  systemKey: string | null = null,
) {
  return {
    id: key,
    key,
    name: key,
    description: null,
    avatarUrl: null,
    accentColor: "#B7F500",
    status: "active" as const,
    systemKey,
    owner: { type: "workspace" as const, userId: null, agentProfileId: null },
    stewards: [],
    persona: {},
    runtimeProfileKey: null,
    modelTier: null,
    skills: [],
    memoryScope,
    authority: {},
    contextPolicy: {},
    version: 1,
    createdByUserId: null,
    bindings: [],
    createdAt: "",
    updatedAt: "",
  };
}

test("reference resolution re-fetches identifiers and retains canonical evidence", async () => {
  const calls: string[] = [];
  const resolved = await resolveLabMemoryReferences(
    [
      { type: "rolling-day", date: "2026-08-21", content: "browser lie" },
      { type: "knowledge-doc", slug: "guide/intro", content: "browser lie" },
    ],
    async (path) => {
      calls.push(path);
      if (path.startsWith("/memory/date"))
        return {
          ok: true,
          status: 200,
          error: null,
          data: {
            date: "2026-08-21",
            sections: { facts: [{ bucket: "ops", text: "Canonical" }] },
            source_digest_paths: [],
          },
        };
      if (path === "/knowledge/sources")
        return {
          ok: true,
          status: 200,
          error: null,
          data: {
            sources: [
              { id: "handbook", repo_url: "https://github.com/acme/docs" },
            ],
          },
        };
      return {
        ok: true,
        status: 200,
        error: null,
        data: {
          slug: "guide/intro",
          title: "Intro",
          kind: "guide",
          tags: ["ops"],
          entities: [],
          content: "Canonical doc",
          metadata: { source_repo: "acme/docs", audience: "workspace" },
        },
      };
    },
  );
  assert.deepEqual(calls, [
    "/memory/date/2026-08-21",
    "/knowledge/docs/guide/intro",
    "/knowledge/sources",
  ]);
  assert.equal(resolved[0]?.context.sections instanceof Object, true);
  assert.equal(
    resolved[1]?.reference.type === "knowledge-doc" &&
      resolved[1].reference.sourceId,
    "handbook",
  );
});

test("eligible agents enforce user permission, admin policy, and every selected scope", () => {
  const references = [
    {
      reference: {
        type: "rolling-day" as const,
        date: "2026-08-21",
        buckets: ["ops"],
      },
      label: "day",
      citation: "day",
      context: {},
    },
    {
      reference: {
        type: "knowledge-doc" as const,
        slug: "guide/intro",
        sourceId: "handbook",
        kind: "guide",
        tags: [],
        entities: [],
        audience: "workspace",
        stability: null,
      },
      label: "doc",
      citation: "doc",
      context: {},
    },
  ];
  const profiles = [
    profile("scoped", { buckets: ["ops"], knowledgeSourceIds: ["handbook"] }),
    profile("partial", { buckets: ["ops"] }),
    profile("admin", { scope: "workspace-operational" }, "admin-agent"),
  ];
  assert.deepEqual(
    eligibleMemoryAgents({
      profiles,
      references,
      capabilities: ["canViewMemory", "canChatAgents"],
    }).map((item) => item.key),
    ["scoped"],
  );
  assert.deepEqual(
    eligibleMemoryAgents({
      profiles,
      references,
      capabilities: ["canViewMemory", "canChatAgents", "canRunAgent"],
    }).map((item) => item.key),
    ["scoped", "admin"],
  );
});
