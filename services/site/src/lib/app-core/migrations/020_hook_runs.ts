import type { Migration } from './index';

export const hookRunsMigration: Migration = {
  name: '020_hook_runs',
  sql: `
    CREATE TABLE IF NOT EXISTS hook_runs (
      id TEXT PRIMARY KEY,
      hook_id TEXT,
      hook_key TEXT NOT NULL,
      hook_name TEXT,
      workflow_key TEXT,
      status TEXT NOT NULL DEFAULT 'running',
      source TEXT NOT NULL DEFAULT 'hook',
      request_id TEXT,
      request_number INTEGER,
      request_title TEXT,
      auto_start_queued INTEGER NOT NULL DEFAULT 0 CHECK (auto_start_queued IN (0, 1)),
      auto_start_started INTEGER NOT NULL DEFAULT 0 CHECK (auto_start_started IN (0, 1)),
      error_message TEXT,
      payload_json TEXT NOT NULL DEFAULT '{}',
      result_json TEXT NOT NULL DEFAULT '{}',
      started_at TEXT NOT NULL,
      finished_at TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      FOREIGN KEY (hook_id) REFERENCES hooks(id) ON DELETE SET NULL,
      FOREIGN KEY (request_id) REFERENCES change_requests(id) ON DELETE SET NULL
    );

    CREATE INDEX IF NOT EXISTS idx_hook_runs_hook_key_created_at ON hook_runs(hook_key, created_at DESC);
    CREATE INDEX IF NOT EXISTS idx_hook_runs_created_at ON hook_runs(created_at DESC);
    CREATE INDEX IF NOT EXISTS idx_hook_runs_request_id ON hook_runs(request_id);
  `,
};
