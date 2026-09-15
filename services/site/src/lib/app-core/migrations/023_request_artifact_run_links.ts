import type { Migration } from './index';

export const requestArtifactRunLinksMigration: Migration = {
  name: '023_request_artifact_run_links',
  sql: `
    ALTER TABLE request_artifacts ADD COLUMN agent_run_id TEXT REFERENCES agent_runs(id) ON DELETE SET NULL;

    CREATE INDEX IF NOT EXISTS idx_request_artifacts_agent_run_id ON request_artifacts(agent_run_id);
  `,
};
