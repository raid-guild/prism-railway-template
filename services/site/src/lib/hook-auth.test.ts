import assert from "node:assert/strict"
import test from "node:test"
import Database from "better-sqlite3"

import {
  authorizeExternalInterface,
  rotateExternalInterfaceCredential,
  upsertExternalInterface,
  upsertInteractionProfile,
  type HookRecord,
} from "@/lib/app-core"
import { externalInteractionsMigration } from "@/lib/app-core/migrations/034_external_interactions"
import { interactionMemoryInstructionsMigration } from "@/lib/app-core/migrations/035_interaction_memory_instructions"
import { runtimeProfilesMigration } from "@/lib/app-core/migrations/031_runtime_profiles"
import { authorizeHookAccess, hookResultArtifactNames } from "@/lib/hook-auth"

function hook(input: Partial<HookRecord> = {}): HookRecord {
  return {
    id: "hook-1",
    key: "project-kpi-snapshot",
    name: "Project KPI Snapshot",
    description: null,
    enabled: true,
    workflowKey: "project-kpi-snapshot",
    authMode: "service-token",
    authConfig: {},
    requestTemplate: {},
    autoRun: { enabled: true },
    systemDefault: false,
    lastTriggeredAt: null,
    createdAt: "2026-07-22T00:00:00.000Z",
    updatedAt: "2026-07-22T00:00:00.000Z",
    ...input,
  }
}

test("service token can trigger every hook auth mode", async () => {
  const previous = process.env.INTERNAL_SERVICE_TOKEN
  process.env.INTERNAL_SERVICE_TOKEN = "service-secret"
  try {
    for (const authMode of ["service-token", "interface-token"]) {
      const result = await authorizeHookAccess(new Request("https://example.test", {
        headers: { "x-service-token": "service-secret" },
      }), hook({ authMode }))
      assert.deepEqual(result, { ok: true, principal: { kind: "service" } })
    }
  } finally {
    if (previous === undefined) delete process.env.INTERNAL_SERVICE_TOKEN
    else process.env.INTERNAL_SERVICE_TOKEN = previous
  }
})

test("service-token hooks reject interface credentials", async () => {
  const result = await authorizeHookAccess(new Request("https://example.test", {
    headers: {
      "x-prism-interface-id": "action-items",
      "x-prism-interface-key": "interface-secret",
    },
  }), hook())
  assert.deepEqual(result, { ok: false, status: 401, error: "Unauthorized" })
})

test("interface-token hooks require their configured interface", async () => {
  const configuredHook = hook({
    authMode: "interface-token",
    authConfig: { interfaceKey: "action-items" },
  })
  const wrongInterface = await authorizeHookAccess(new Request("https://example.test", {
    headers: {
      "x-prism-interface-id": "external-chatbot",
      "x-prism-interface-key": "interface-secret",
    },
  }), configuredHook)
  assert.deepEqual(wrongInterface, { ok: false, status: 403, error: "HOOK_INTERFACE_NOT_ALLOWED" })

  const db = new Database(":memory:")
  db.pragma("foreign_keys = ON")
  db.exec(runtimeProfilesMigration.sql)
  db.exec(externalInteractionsMigration.sql)
  db.exec(interactionMemoryInstructionsMigration.sql)
  upsertInteractionProfile({ key: "readonly", mode: "readonly" }, db)
  upsertExternalInterface({ key: "action-items", interactionProfileKey: "readonly" }, db)
  const rotated = rotateExternalInterfaceCredential("action-items", db)
  upsertExternalInterface({ key: "action-items", interactionProfileKey: "readonly", enabled: true }, db)
  try {
    const authorized = await authorizeHookAccess(new Request("https://example.test", {
      headers: {
        "x-prism-interface-id": "action-items",
        "x-prism-interface-key": rotated.credential,
      },
    }), configuredHook, (input) => authorizeExternalInterface(input, db))
    assert.deepEqual(authorized, { ok: true, principal: { kind: "interface", interfaceKey: "action-items" } })
  } finally {
    db.close()
  }
})

test("hook result artifacts are explicit and deduplicated", () => {
  assert.deepEqual(hookResultArtifactNames(hook({
    authConfig: {
      resultArtifactNames: ["kpi-snapshot-proposal.json", "kpi-snapshot-proposal.json", ""],
    },
  })), ["kpi-snapshot-proposal.json"])
})
