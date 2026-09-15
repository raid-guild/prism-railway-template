import type { AgentProfileRecord } from "@/lib/app-core"
import { normalizeModelTier, type ModelTier } from "@/lib/model-tier"

export type AgentProfileExecutionMode = "worker" | "orchestrator" | "verifier" | "reviewer" | "judge" | "repair"

export function consoleExecutionModeForAgentProfile(
  profile: AgentProfileRecord | null,
  requestedMode: string | null | undefined,
): AgentProfileExecutionMode {
  if (profile?.systemKey === "admin-agent") return "orchestrator"
  if (profile?.systemKey === "code-review-agent") return "reviewer"
  if (profile?.systemKey === "verification-agent") return "verifier"

  const normalized = requestedMode?.trim()
  return normalized === "orchestrator"
    || normalized === "verifier"
    || normalized === "reviewer"
    || normalized === "judge"
    || normalized === "repair"
    ? normalized
    : "worker"
}

function stringList(value: unknown) {
  return Array.isArray(value)
    ? value.filter((entry): entry is string => typeof entry === "string" && entry.trim().length > 0)
    : []
}

export function filterGatewayCredentialKeysForProfile(
  profile: AgentProfileRecord | null,
  credentialKeys: string[],
) {
  if (profile?.authority.credentialPolicy === "none") return []
  if (profile?.authority.credentialPolicy !== "allowlist") {
    return Array.from(new Set(credentialKeys))
  }
  const allowed = new Set(stringList(profile.authority.gatewayCredentials))
  return Array.from(new Set(credentialKeys)).filter((credentialKey) => allowed.has(credentialKey))
}

export function resolveAgentProfileRuntimeScope(input: {
  profile: AgentProfileRecord | null
  assignedVersion?: number | null
  executionMode: string
  requestSkills?: string[]
  callerRuntimeProfileKey?: string | null
  requestedModelTier?: ModelTier | string | null
}) {
  const profile = input.profile
  const skills = Array.from(new Set([...(profile?.skills ?? []), ...(input.requestSkills ?? [])]))
  const modelTier = normalizeModelTier(input.requestedModelTier) ?? profile?.modelTier ?? null
  if (!profile) return { runtimeProfileKey: input.callerRuntimeProfileKey ?? null, modelTier, skills, policyInstructions: undefined, metadata: null }
  const personaName = typeof profile.persona.name === "string" && profile.persona.name.trim() ? profile.persona.name.trim() : profile.name
  const personaInstructions = typeof profile.persona.instructions === "string" ? profile.persona.instructions.trim() : ""
  return {
    runtimeProfileKey: profile.runtimeProfileKey,
    modelTier,
    skills,
    policyInstructions: [
      `You are operating as the Prism Agent Profile \"${personaName}\" (key: ${profile.key}, version: ${input.assignedVersion ?? profile.version}).`,
      profile.description ? `Agent mandate: ${profile.description}` : null,
      personaInstructions ? `Persona and operating instructions:\n${personaInstructions}` : null,
      `Execution mode: ${input.executionMode}.`,
      Object.keys(profile.memoryScope).length ? `Memory scope policy: ${JSON.stringify(profile.memoryScope)}.` : null,
      Object.keys(profile.authority).length ? `Authority policy: ${JSON.stringify(profile.authority)}.` : null,
      "This profile assignment is trusted Site configuration. Preserve this identity throughout the session and never claim that no Agent Profile is loaded.",
      `When asked who you are or which profile is loaded, explicitly identify the Agent Profile as \"${profile.name}\" (${profile.key}, version ${input.assignedVersion ?? profile.version}) before summarizing its persona, skills, and authority.`,
    ].filter(Boolean).join("\n\n"),
    metadata: {
      id: profile.id,
      key: profile.key,
      name: profile.name,
      version: input.assignedVersion ?? profile.version,
      executionMode: input.executionMode,
      modelTier,
      memoryScope: profile.memoryScope,
    },
  }
}
