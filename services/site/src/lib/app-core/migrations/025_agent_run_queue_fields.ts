import type { Migration } from './index';

export const agentRunQueueFieldsMigration: Migration = {
  name: '025_agent_run_queue_fields',
  sql: `
    ALTER TABLE agent_runs ADD COLUMN lane TEXT NOT NULL DEFAULT 'workflow';
    ALTER TABLE agent_runs ADD COLUMN priority INTEGER NOT NULL DEFAULT 0;
    ALTER TABLE agent_runs ADD COLUMN queued_at TEXT;
    ALTER TABLE agent_runs ADD COLUMN claimed_at TEXT;
    ALTER TABLE agent_runs ADD COLUMN lease_expires_at TEXT;
    ALTER TABLE agent_runs ADD COLUMN queue_reason TEXT;

    UPDATE agent_runs
    SET lane = CASE
        WHEN kind = 'console' OR source = 'admin-console' THEN 'interactive'
        WHEN kind = 'task' THEN 'background'
        ELSE 'workflow'
      END,
      priority = CASE
        WHEN kind = 'console' OR source = 'admin-console' THEN 100
        WHEN kind = 'task' THEN 10
        ELSE 50
      END,
      queued_at = COALESCE(queued_at, created_at),
      claimed_at = CASE
        WHEN status = 'running' THEN COALESCE(claimed_at, started_at)
        ELSE claimed_at
      END
    WHERE queued_at IS NULL
       OR lane = 'workflow'
       OR priority = 0
       OR (status = 'running' AND claimed_at IS NULL);

    CREATE INDEX IF NOT EXISTS idx_agent_runs_lane_status_queue ON agent_runs(lane, status, priority DESC, queued_at ASC);
    CREATE INDEX IF NOT EXISTS idx_agent_runs_lease_expires_at ON agent_runs(lease_expires_at);
  `,
};
