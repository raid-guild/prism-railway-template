import assert from 'node:assert/strict';
import test from 'node:test';

import { resolveCodexModelPolicy } from './model-tier.js';

const defaults = {
  defaultModel: 'default-model',
  economyModel: 'economy-model',
  standardModel: null,
  deepModel: 'deep-model',
  economyReasoningEffort: null,
  standardReasoningEffort: null,
  deepReasoningEffort: null,
};

test('model tiers resolve provider-specific models and reasoning defaults', () => {
  assert.deepEqual(resolveCodexModelPolicy({ ...defaults, tier: 'economy' }), {
    modelTier: 'economy', model: 'economy-model', reasoningEffort: 'low',
  });
  assert.deepEqual(resolveCodexModelPolicy({ ...defaults, tier: 'standard' }), {
    modelTier: 'standard', model: 'default-model', reasoningEffort: null,
  });
  assert.deepEqual(resolveCodexModelPolicy({ ...defaults, tier: 'deep' }), {
    modelTier: 'deep', model: 'deep-model', reasoningEffort: 'high',
  });
});

test('unconfigured nonstandard tiers fail instead of silently using the default model', () => {
  assert.throws(
    () => resolveCodexModelPolicy({ ...defaults, tier: 'economy', economyModel: null }),
    /MODEL_TIER_UNAVAILABLE:economy/,
  );
});
