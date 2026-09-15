import type { Migration } from './index';

export const runLinksMigration: Migration = {
  name: '022_run_links',
  sql: `
    ALTER TABLE task_runs ADD COLUMN agent_run_id TEXT REFERENCES agent_runs(id) ON DELETE SET NULL;
    ALTER TABLE hook_runs ADD COLUMN agent_run_id TEXT REFERENCES agent_runs(id) ON DELETE SET NULL;

    CREATE INDEX IF NOT EXISTS idx_task_runs_agent_run_id ON task_runs(agent_run_id);
    CREATE INDEX IF NOT EXISTS idx_hook_runs_agent_run_id ON hook_runs(agent_run_id);
  `,
};
