import type { Migration } from './index';

export const runtimeProfilesMigration: Migration = {
  name: '031_runtime_profiles',
  sql: `
    CREATE TABLE IF NOT EXISTS runtime_profiles (
      key TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      adapter TEXT NOT NULL,
      base_url TEXT NOT NULL,
      enabled INTEGER NOT NULL DEFAULT 1,
      is_default INTEGER NOT NULL DEFAULT 0,
      contract_version TEXT,
      features_json TEXT NOT NULL DEFAULT '[]',
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE INDEX IF NOT EXISTS idx_runtime_profiles_enabled ON runtime_profiles(enabled, key);
    CREATE UNIQUE INDEX IF NOT EXISTS idx_runtime_profiles_single_default
      ON runtime_profiles(is_default)
      WHERE is_default = 1;
  `,
};
