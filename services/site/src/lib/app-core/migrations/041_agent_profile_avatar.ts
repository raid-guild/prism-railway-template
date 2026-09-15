import type { Migration } from './index';

export const agentProfileAvatarMigration: Migration = {
  name: '041_agent_profile_avatar',
  sql: `
    ALTER TABLE agent_profiles ADD COLUMN avatar_url TEXT;
  `,
};
