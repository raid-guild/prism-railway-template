export const modelTiers = ['economy', 'standard', 'deep'] as const;
export type ModelTier = (typeof modelTiers)[number];

const reasoningEfforts = ['none', 'minimal', 'low', 'medium', 'high', 'xhigh', 'max', 'ultra'] as const;
export type ReasoningEffort = (typeof reasoningEfforts)[number];

export function modelTier(value: unknown): ModelTier | null {
  if (typeof value !== 'string' || !value.trim()) return null;
  const normalized = value.trim().toLowerCase();
  return modelTiers.includes(normalized as ModelTier) ? normalized as ModelTier : null;
}

function reasoningEffort(value: string | null | undefined, fallback: ReasoningEffort | null) {
  const normalized = value?.trim().toLowerCase() ?? '';
  if (!normalized) return fallback;
  if (!reasoningEfforts.includes(normalized as ReasoningEffort)) {
    throw new Error(`MODEL_REASONING_EFFORT_INVALID:${normalized}`);
  }
  return normalized as ReasoningEffort;
}

export function resolveCodexModelPolicy(input: {
  tier: ModelTier | null;
  defaultModel: string | null;
  economyModel: string | null;
  standardModel: string | null;
  deepModel: string | null;
  economyReasoningEffort: string | null;
  standardReasoningEffort: string | null;
  deepReasoningEffort: string | null;
}) {
  if (!input.tier) {
    return { modelTier: null, model: input.defaultModel, reasoningEffort: null };
  }
  if (input.tier === 'standard') {
    return {
      modelTier: input.tier,
      model: input.standardModel ?? input.defaultModel,
      reasoningEffort: reasoningEffort(input.standardReasoningEffort, null),
    };
  }
  const model = input.tier === 'economy' ? input.economyModel : input.deepModel;
  if (!model) throw new Error(`MODEL_TIER_UNAVAILABLE:${input.tier}`);
  return {
    modelTier: input.tier,
    model,
    reasoningEffort: input.tier === 'economy'
      ? reasoningEffort(input.economyReasoningEffort, 'low')
      : reasoningEffort(input.deepReasoningEffort, 'high'),
  };
}
