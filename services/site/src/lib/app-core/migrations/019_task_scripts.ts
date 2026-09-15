export const taskScriptsMigration = {
  name: '019_task_scripts',
  sql: `
    CREATE TABLE IF NOT EXISTS task_scripts (
      id TEXT PRIMARY KEY,
      key TEXT NOT NULL UNIQUE,
      name TEXT NOT NULL,
      description TEXT,
      runtime TEXT NOT NULL DEFAULT 'node-esm',
      enabled INTEGER NOT NULL DEFAULT 0 CHECK (enabled IN (0, 1)),
      storage_path TEXT NOT NULL,
      checksum TEXT NOT NULL,
      timeout_ms INTEGER,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE INDEX IF NOT EXISTS idx_task_scripts_enabled_key
      ON task_scripts(enabled, key);
  `,
};
