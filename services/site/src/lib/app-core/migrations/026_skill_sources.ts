import type { Migration } from './index';

export const skillSourcesMigration: Migration = {
  name: '026_skill_sources',
  sql: `
    CREATE TABLE IF NOT EXISTS skill_sources (
      key TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      provider TEXT NOT NULL DEFAULT 'github',
      repo_url TEXT NOT NULL,
      branch TEXT NOT NULL DEFAULT 'main',
      source_path TEXT NOT NULL DEFAULT 'skills',
      enabled INTEGER NOT NULL DEFAULT 1,
      last_synced_at TEXT,
      last_commit_sha TEXT,
      last_error TEXT,
      last_skill_count INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE INDEX IF NOT EXISTS idx_skill_sources_enabled ON skill_sources(enabled, key);
  `,
};
