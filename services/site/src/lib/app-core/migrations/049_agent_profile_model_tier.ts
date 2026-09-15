import type { Migration } from './index';

export const agentProfileModelTierMigration: Migration = {
  name: '049_agent_profile_model_tier',
  sql: `
    ALTER TABLE agent_profiles ADD COLUMN model_tier TEXT
      CHECK (model_tier IS NULL OR model_tier IN ('economy', 'standard', 'deep'));
  `,
};
