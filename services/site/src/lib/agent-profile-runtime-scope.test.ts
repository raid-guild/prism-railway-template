import assert from "node:assert/strict"
import test from "node:test"

import {
  consoleExecutionModeForAgentProfile,
  filterGatewayCredentialKeysForProfile,
  resolveAgentProfileRuntimeScope,
} from "./agent-profile-runtime-scope"

function systemProfile(systemKey: string | null) {
  return {
    id: `profile-${systemKey ?? "custom"}`, key: systemKey ?? "custom", name: systemKey ?? "Custom", description: null, avatarUrl: null,
    accentColor: "#36E7FF", status: "active" as const, systemKey,
    owner: { type: "workspace" as const, userId: null, agentProfileId: null }, stewards: [], persona: {},
    runtimeProfileKey: null, modelTier: null, skills: [], memoryScope: {}, authority: {}, contextPolicy: {}, version: 1,
    createdByUserId: null, bindings: [], createdAt: "", updatedAt: "",
  }
}

test("built-in console profiles use their trusted execution modes", () => {
  assert.equal(consoleExecutionModeForAgentProfile(systemProfile("admin-agent"), "worker"), "orchestrator")
  assert.equal(consoleExecutionModeForAgentProfile(systemProfile("code-review-agent"), "worker"), "reviewer")
  assert.equal(consoleExecutionModeForAgentProfile(systemProfile("verification-agent"), "worker"), "verifier")
  assert.equal(consoleExecutionModeForAgentProfile(systemProfile("codegen-agent"), "worker"), "worker")
  assert.equal(consoleExecutionModeForAgentProfile(systemProfile(null), "repair"), "repair")
})

test("assigned Agent Profile controls runtime identity, runtime, and skills", () => {
  const scope = resolveAgentProfileRuntimeScope({
    profile: {
      id: "profile-1", key: "research", name: "Research Agent", description: "Ground decisions in evidence.", avatarUrl: null, accentColor: "#36E7FF",
      status: "active", systemKey: null, owner: { type: "workspace", userId: null, agentProfileId: null }, stewards: [],
      persona: { name: "Rook", instructions: "Cite sources and state uncertainty." }, runtimeProfileKey: "careful-runtime", modelTier: "standard",
      skills: ["research-reader"], memoryScope: { buckets: ["research"] }, authority: { maximumAccessMode: "readonly" },
      contextPolicy: { continuation: "session" }, version: 4, createdByUserId: null, bindings: [], createdAt: "", updatedAt: "",
    },
    assignedVersion: 3,
    executionMode: "worker",
    requestSkills: ["attachment-reader"],
    callerRuntimeProfileKey: "untrusted-runtime",
  })
  assert.equal(scope.runtimeProfileKey, "careful-runtime")
  assert.equal(scope.modelTier, "standard")
  assert.deepEqual(scope.skills, ["research-reader", "attachment-reader"])
  assert.match(scope.policyInstructions ?? "", /Rook/)
  assert.match(scope.policyInstructions ?? "", /Cite sources/)
  assert.match(scope.policyInstructions ?? "", /Research Agent.*research.*version 3/)
  assert.equal(scope.metadata?.version, 3)
})

test("profile Gateway credential allowlists cap workflow credentials", () => {
  const profile = {
    id: "reviewer", key: "code-review-agent", name: "Code Review Agent", description: null, avatarUrl: null,
    accentColor: "#36E7FF", status: "active" as const, systemKey: "code-review-agent",
    owner: { type: "workspace" as const, userId: null, agentProfileId: null }, stewards: [], persona: {},
    runtimeProfileKey: null, modelTier: null, skills: [], memoryScope: {},
    authority: { credentialPolicy: "allowlist", gatewayCredentials: ["github"] }, contextPolicy: {}, version: 1,
    createdByUserId: null, bindings: [], createdAt: "", updatedAt: "",
  }
  assert.deepEqual(filterGatewayCredentialKeysForProfile(profile, ["portal", "github", "github"]), ["github"])
  assert.deepEqual(filterGatewayCredentialKeysForProfile(null, ["portal", "github"]), ["portal", "github"])
})

test("credential-free profiles receive no Gateway credentials", () => {
  const profile = {
    id: "verifier", key: "verification-agent", name: "Verification Agent", description: null, avatarUrl: null,
    accentColor: "#36E7FF", status: "active" as const, systemKey: "verification-agent",
    owner: { type: "agent" as const, userId: null, agentProfileId: "agent-profile-admin" }, stewards: [], persona: {},
    runtimeProfileKey: null, modelTier: null, skills: [], memoryScope: {}, authority: { credentialPolicy: "none" },
    contextPolicy: {}, version: 1, createdByUserId: null, bindings: [], createdAt: "", updatedAt: "",
  }
  assert.deepEqual(filterGatewayCredentialKeysForProfile(profile, ["github", "portal"]), [])
})

test("request model tiers override profile defaults", () => {
  const scope = resolveAgentProfileRuntimeScope({
    profile: {
      id: "profile-1", key: "summarizer", name: "Summarizer", description: null, avatarUrl: null,
      accentColor: "#36E7FF", status: "active", systemKey: null,
      owner: { type: "workspace", userId: null, agentProfileId: null }, stewards: [], persona: {},
      runtimeProfileKey: null, modelTier: "standard", skills: [], memoryScope: {}, authority: {},
      contextPolicy: {}, version: 1, createdByUserId: null, bindings: [], createdAt: "", updatedAt: "",
    },
    executionMode: "worker",
    requestedModelTier: "economy",
  })
  assert.equal(scope.modelTier, "economy")
})
