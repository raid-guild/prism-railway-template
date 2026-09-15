export const modelTiers = ["economy", "standard", "deep"] as const

export type ModelTier = (typeof modelTiers)[number]

export function normalizeModelTier(value: unknown): ModelTier | null {
  if (typeof value !== "string" || !value.trim()) return null
  const normalized = value.trim().toLowerCase()
  if (!modelTiers.includes(normalized as ModelTier)) {
    throw new Error(`MODEL_TIER_INVALID:${normalized}`)
  }
  return normalized as ModelTier
}

export function modelTierFromAgentConfig(value: unknown): ModelTier | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null
  const config = value as Record<string, unknown>
  return normalizeModelTier(config.modelTier ?? config.model_tier)
}
