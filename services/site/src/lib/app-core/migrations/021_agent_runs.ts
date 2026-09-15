import type { Migration } from './index';

export const agentRunsMigration: Migration = {
  name: '021_agent_runs',
  sql: `
    CREATE TABLE IF NOT EXISTS agent_runs (
      id TEXT PRIMARY KEY,
      kind TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'queued',
      idempotency_key TEXT,
      request_id TEXT,
      workflow_run_id TEXT,
      workflow_step_key TEXT,
      task_key TEXT,
      hook_key TEXT,
      session_id TEXT,
      source TEXT NOT NULL DEFAULT 'site',
      input_json TEXT NOT NULL DEFAULT '{}',
      result_json TEXT NOT NULL DEFAULT '{}',
      trace_json TEXT NOT NULL DEFAULT '[]',
      error_message TEXT,
      started_at TEXT,
      finished_at TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      FOREIGN KEY (request_id) REFERENCES change_requests(id) ON DELETE SET NULL,
      FOREIGN KEY (workflow_run_id) REFERENCES workflow_runs(id) ON DELETE SET NULL,
      FOREIGN KEY (session_id) REFERENCES agent_sessions(id) ON DELETE SET NULL
    );

    CREATE INDEX IF NOT EXISTS idx_agent_runs_kind_created_at ON agent_runs(kind, created_at DESC);
    CREATE INDEX IF NOT EXISTS idx_agent_runs_status_created_at ON agent_runs(status, created_at DESC);
    CREATE INDEX IF NOT EXISTS idx_agent_runs_request_id ON agent_runs(request_id, created_at DESC);
    CREATE INDEX IF NOT EXISTS idx_agent_runs_workflow_run_id ON agent_runs(workflow_run_id, created_at DESC);
    CREATE INDEX IF NOT EXISTS idx_agent_runs_idempotency_key ON agent_runs(idempotency_key);
  `,
};
