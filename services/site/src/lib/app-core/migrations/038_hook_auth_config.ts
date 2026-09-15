import type { Migration } from './index';

export const hookAuthConfigMigration: Migration = {
  name: '038_hook_auth_config',
  sql: `
    ALTER TABLE hooks ADD COLUMN auth_config_json TEXT NOT NULL DEFAULT '{}';
  `,
};
