import type { Migration } from './index';

export const agentProfileAccentColorMigration: Migration = {
  name: '042_agent_profile_accent_color',
  sql: `
    ALTER TABLE agent_profiles ADD COLUMN accent_color TEXT;
  `,
};
