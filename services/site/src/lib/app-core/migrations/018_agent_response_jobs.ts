export const agentResponseJobsMigration = {
  name: '018_agent_response_jobs',
  sql: `
    CREATE TABLE IF NOT EXISTS agent_response_jobs (
      id TEXT PRIMARY KEY,
      session_id TEXT REFERENCES agent_sessions(id) ON DELETE SET NULL,
      status TEXT NOT NULL DEFAULT 'queued',
      input_json TEXT NOT NULL DEFAULT '{}',
      response_json TEXT NOT NULL DEFAULT '{}',
      output_text TEXT,
      error_message TEXT,
      trace_json TEXT NOT NULL DEFAULT '[]',
      started_at TEXT,
      finished_at TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE INDEX IF NOT EXISTS idx_agent_response_jobs_session
      ON agent_response_jobs(session_id, created_at DESC);

    CREATE INDEX IF NOT EXISTS idx_agent_response_jobs_status
      ON agent_response_jobs(status, created_at DESC);
  `,
};
