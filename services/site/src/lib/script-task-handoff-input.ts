function record(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {}
}

export function validateScriptTaskHandoff(
  instructionConfig: Record<string, unknown>,
  agentConfig: Record<string, unknown>,
): string | null {
  const handoff = record(agentConfig.handoff ?? agentConfig.agentHandoff ?? agentConfig.agent_handoff)
  if (handoff.enabled !== true) return null

  const when = typeof handoff.when === "string" && handoff.when.trim()
    ? handoff.when.trim()
    : "shouldEscalate"
  if (when !== "shouldEscalate") {
    return `script-runner agentConfig.handoff.when must be shouldEscalate`
  }
  if (typeof instructionConfig.prompt !== "string" || !instructionConfig.prompt.trim()) {
    return "script-runner agent handoff requires instructionConfig.prompt"
  }
  return null
}
