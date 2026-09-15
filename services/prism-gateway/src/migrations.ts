export type GatewayMigration = {
  name: string;
  sql: string;
};

export const gatewayMigrations: GatewayMigration[] = [
  {
    name: "001_initial_gateway",
    sql: `
      CREATE TABLE connector_drivers (
        key TEXT PRIMARY KEY,
        mode TEXT NOT NULL,
        description TEXT NOT NULL,
        built_in INTEGER NOT NULL DEFAULT 1,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );

      CREATE TABLE integration_connections (
        id TEXT PRIMARY KEY,
        provider TEXT NOT NULL,
        label TEXT NOT NULL,
        auth_type TEXT NOT NULL,
        status TEXT NOT NULL,
        last_tested_at TEXT,
        last_used_at TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );

      CREATE TABLE encrypted_secrets (
        id TEXT PRIMARY KEY,
        connection_id TEXT NOT NULL,
        secret_name TEXT NOT NULL,
        encrypted_value TEXT NOT NULL,
        nonce TEXT NOT NULL,
        auth_tag TEXT NOT NULL,
        key_version TEXT NOT NULL,
        associated_data_json TEXT NOT NULL,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        UNIQUE(connection_id, secret_name),
        FOREIGN KEY(connection_id) REFERENCES integration_connections(id) ON DELETE CASCADE
      );

      CREATE TABLE capabilities (
        key TEXT PRIMARY KEY,
        driver_key TEXT NOT NULL,
        connection_id TEXT,
        provider TEXT NOT NULL,
        mode TEXT NOT NULL,
        description TEXT NOT NULL,
        driver_config_json TEXT NOT NULL,
        input_schema_json TEXT,
        output_schema_json TEXT,
        risk_level TEXT NOT NULL,
        requires_approval INTEGER NOT NULL DEFAULT 0,
        default_unit_price REAL NOT NULL DEFAULT 0,
        enabled INTEGER NOT NULL DEFAULT 1,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        FOREIGN KEY(driver_key) REFERENCES connector_drivers(key),
        FOREIGN KEY(connection_id) REFERENCES integration_connections(id) ON DELETE SET NULL
      );

      CREATE TABLE capability_grants (
        id TEXT PRIMARY KEY,
        subject_type TEXT NOT NULL,
        subject_id TEXT NOT NULL,
        capability_key TEXT NOT NULL,
        allowed INTEGER NOT NULL DEFAULT 1,
        policy_json TEXT NOT NULL,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        UNIQUE(subject_type, subject_id, capability_key),
        FOREIGN KEY(capability_key) REFERENCES capabilities(key) ON DELETE CASCADE
      );

      CREATE TABLE audit_events (
        id TEXT PRIMARY KEY,
        trace_id TEXT NOT NULL,
        capability_key TEXT NOT NULL,
        authenticated_caller_id TEXT NOT NULL,
        delegated_actor_id TEXT,
        request_id TEXT,
        workflow_run_id TEXT,
        workflow_step_key TEXT,
        status TEXT NOT NULL,
        policy_decision TEXT NOT NULL,
        budget_decision TEXT,
        latency_ms INTEGER,
        error_code TEXT,
        input_summary_json TEXT,
        output_summary_json TEXT,
        created_at TEXT NOT NULL
      );

      CREATE UNIQUE INDEX audit_events_trace_id_idx ON audit_events(trace_id);
      CREATE INDEX audit_events_capability_created_idx ON audit_events(capability_key, created_at);

      CREATE TABLE usage_ledger (
        id TEXT PRIMARY KEY,
        trace_id TEXT NOT NULL,
        capability_key TEXT NOT NULL,
        authenticated_caller_id TEXT NOT NULL,
        delegated_actor_id TEXT,
        request_id TEXT,
        units REAL NOT NULL,
        unit_price REAL NOT NULL,
        estimated_cost REAL NOT NULL,
        actual_cost REAL,
        settlement_status TEXT NOT NULL,
        created_at TEXT NOT NULL
      );
    `,
  },
  {
    name: "005_stored_credentials",
    sql: `
      CREATE TABLE stored_credentials (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL UNIQUE,
        source TEXT NOT NULL,
        encrypted_value TEXT NOT NULL,
        nonce TEXT NOT NULL,
        auth_tag TEXT NOT NULL,
        key_version TEXT NOT NULL,
        associated_data_json TEXT NOT NULL,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );

      CREATE TABLE stored_credential_bindings (
        connection_id TEXT NOT NULL,
        secret_name TEXT NOT NULL,
        stored_credential_id TEXT NOT NULL,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        PRIMARY KEY(connection_id, secret_name),
        FOREIGN KEY(connection_id) REFERENCES integration_connections(id) ON DELETE CASCADE,
        FOREIGN KEY(stored_credential_id) REFERENCES stored_credentials(id) ON DELETE RESTRICT
      );

      CREATE INDEX stored_credential_bindings_credential_idx
        ON stored_credential_bindings(stored_credential_id);
    `,
  },
  {
    name: "006_credential_bundles",
    sql: `
      ALTER TABLE integration_connections ADD COLUMN credential_key TEXT;
      ALTER TABLE integration_connections ADD COLUMN configuration_json TEXT NOT NULL DEFAULT '{}';
      ALTER TABLE integration_connections ADD COLUMN env_bindings_json TEXT NOT NULL DEFAULT '{}';

      CREATE UNIQUE INDEX integration_connections_credential_key_idx
        ON integration_connections(credential_key)
        WHERE credential_key IS NOT NULL;
    `,
  },
  {
    name: "007_remove_legacy_toolset_profiles",
    sql: `
      DROP TABLE IF EXISTS toolset_profiles;
    `,
  },
  {
    name: "008_remove_legacy_capability_system",
    sql: `
      ALTER TABLE audit_events RENAME TO audit_events_legacy;

      CREATE TABLE audit_events (
        id TEXT PRIMARY KEY,
        trace_id TEXT NOT NULL,
        credential_key TEXT NOT NULL,
        authenticated_caller_id TEXT NOT NULL,
        delegated_actor_id TEXT,
        request_id TEXT,
        workflow_run_id TEXT,
        workflow_step_key TEXT,
        status TEXT NOT NULL,
        policy_decision TEXT NOT NULL,
        latency_ms INTEGER,
        error_code TEXT,
        input_summary_json TEXT,
        output_summary_json TEXT,
        created_at TEXT NOT NULL
      );

      INSERT INTO audit_events (
        id, trace_id, credential_key, authenticated_caller_id,
        delegated_actor_id, request_id, workflow_run_id, workflow_step_key,
        status, policy_decision, latency_ms, error_code,
        input_summary_json, output_summary_json, created_at
      )
      SELECT
        id, trace_id, substr(capability_key, length('credential:') + 1),
        authenticated_caller_id, delegated_actor_id, request_id,
        workflow_run_id, workflow_step_key, status, policy_decision,
        latency_ms, error_code, input_summary_json, output_summary_json, created_at
      FROM audit_events_legacy
      WHERE capability_key LIKE 'credential:%';

      DROP TABLE audit_events_legacy;
      DROP TABLE IF EXISTS capability_grants;
      DROP TABLE IF EXISTS capabilities;
      DROP TABLE IF EXISTS connector_drivers;
      DROP TABLE IF EXISTS usage_ledger;

      UPDATE integration_connections SET status = 'leased' WHERE status = 'healthy';
      UPDATE integration_connections SET status = 'untested' WHERE status = 'unhealthy';

      CREATE UNIQUE INDEX audit_events_trace_id_idx ON audit_events(trace_id);
      CREATE INDEX audit_events_credential_created_idx
        ON audit_events(credential_key, created_at);
    `,
  },
];
