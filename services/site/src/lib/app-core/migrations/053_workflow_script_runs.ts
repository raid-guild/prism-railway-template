import type { Migration } from './index';

export const workflowScriptRunsMigration: Migration = {
  name: '053_workflow_script_runs',
  sql: `
    CREATE TABLE script_revisions (
      id TEXT PRIMARY KEY,
      script_key TEXT NOT NULL,
      checksum TEXT NOT NULL,
      source TEXT NOT NULL,
      runtime TEXT NOT NULL CHECK(runtime = 'node-esm'),
      contract_version INTEGER NOT NULL CHECK(contract_version = 1),
      input_binding TEXT NOT NULL,
      effect_class TEXT NOT NULL CHECK(effect_class = 'pure'),
      timeout_ms INTEGER NOT NULL,
      output_max_bytes INTEGER NOT NULL,
      created_by TEXT NOT NULL,
      created_at TEXT NOT NULL,
      UNIQUE(script_key, checksum, input_binding, contract_version)
    );
    CREATE INDEX idx_script_revisions_key ON script_revisions(script_key, created_at DESC);

    CREATE TABLE workflow_script_runs (
      id TEXT PRIMARY KEY,
      request_id TEXT NOT NULL REFERENCES change_requests(id),
      workflow_run_id TEXT NOT NULL REFERENCES workflow_runs(id),
      step_key TEXT NOT NULL,
      iteration_key TEXT NOT NULL,
      attempt INTEGER NOT NULL,
      revision_id TEXT NOT NULL REFERENCES script_revisions(id),
      checksum TEXT NOT NULL,
      config_json TEXT NOT NULL,
      input_json TEXT NOT NULL,
      input_checksum TEXT NOT NULL,
      profile_id TEXT,
      policy_json TEXT NOT NULL DEFAULT '{}',
      status TEXT NOT NULL CHECK(status IN ('queued','running','canceling','completing','completed','no_op','escalate','failed','canceled','superseded')),
      lease_token TEXT,
      lease_expires_at TEXT,
      output_json TEXT,
      error_code TEXT,
      exit_code INTEGER,
      receipt_artifact_id TEXT,
      result_artifact_id TEXT,
      advancement_at TEXT,
      created_at TEXT NOT NULL,
      claimed_at TEXT,
      finished_at TEXT,
      updated_at TEXT NOT NULL,
      UNIQUE(workflow_run_id, step_key, iteration_key, attempt)
    );
    CREATE UNIQUE INDEX idx_workflow_script_active
      ON workflow_script_runs(workflow_run_id)
      WHERE status IN ('queued','running','canceling','completing');
    CREATE INDEX idx_workflow_script_claim ON workflow_script_runs(status, created_at);
    CREATE INDEX idx_workflow_script_request ON workflow_script_runs(request_id, created_at DESC);

    CREATE TRIGGER workflow_script_agent_mutex_insert BEFORE INSERT ON workflow_script_runs
    WHEN NEW.status IN ('queued','running','canceling','completing') AND EXISTS (
      SELECT 1 FROM agent_runs WHERE workflow_run_id=NEW.workflow_run_id AND status IN ('queued','running'))
    BEGIN SELECT RAISE(ABORT, 'WORKFLOW_EXECUTOR_ACTIVE'); END;
    CREATE TRIGGER agent_script_mutex_insert BEFORE INSERT ON agent_runs
    WHEN NEW.workflow_run_id IS NOT NULL AND NEW.status IN ('queued','running') AND EXISTS (
      SELECT 1 FROM workflow_script_runs WHERE workflow_run_id=NEW.workflow_run_id AND status IN ('queued','running','canceling','completing'))
    BEGIN SELECT RAISE(ABORT, 'WORKFLOW_SCRIPT_ACTIVE'); END;
    CREATE TRIGGER agent_script_mutex_update BEFORE UPDATE OF status,workflow_run_id ON agent_runs
    WHEN NEW.workflow_run_id IS NOT NULL AND NEW.status IN ('queued','running') AND EXISTS (
      SELECT 1 FROM workflow_script_runs WHERE workflow_run_id=NEW.workflow_run_id AND status IN ('queued','running','canceling','completing'))
    BEGIN SELECT RAISE(ABORT, 'WORKFLOW_SCRIPT_ACTIVE'); END;

    CREATE TABLE workflow_health_deliveries (
      scope_key TEXT PRIMARY KEY,
      fingerprint TEXT NOT NULL,
      request_id TEXT NOT NULL REFERENCES change_requests(id),
      report_artifact_id TEXT NOT NULL REFERENCES request_artifacts(id),
      provider_message_id TEXT NOT NULL,
      delivered_at TEXT NOT NULL
    );
  `,
};
