import type { Migration } from './index';

export const externalInteractionsMigration: Migration = {
  name: '034_external_interactions',
  sql: `
    CREATE TABLE interaction_profiles (
      key TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      description TEXT,
      mode TEXT NOT NULL CHECK (mode IN ('off', 'readonly', 'run-approved', 'full')),
      runtime_profile_key TEXT,
      persona_name TEXT,
      persona_instructions TEXT NOT NULL DEFAULT '',
      allowed_workflows_json TEXT NOT NULL DEFAULT '[]',
      rate_limit_window_seconds INTEGER NOT NULL DEFAULT 60 CHECK (rate_limit_window_seconds BETWEEN 1 AND 86400),
      rate_limit_max_requests INTEGER NOT NULL DEFAULT 6 CHECK (rate_limit_max_requests BETWEEN 1 AND 10000),
      version INTEGER NOT NULL DEFAULT 1 CHECK (version >= 1),
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      FOREIGN KEY (runtime_profile_key) REFERENCES runtime_profiles(key) ON DELETE SET NULL
    );

    CREATE TABLE external_interfaces (
      key TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      description TEXT,
      enabled INTEGER NOT NULL DEFAULT 0,
      auth_mode TEXT NOT NULL DEFAULT 'api-key' CHECK (auth_mode IN ('api-key')),
      interaction_profile_key TEXT NOT NULL,
      allowed_origins_json TEXT NOT NULL DEFAULT '[]',
      credential_hash TEXT,
      credential_prefix TEXT,
      credential_created_at TEXT,
      credential_last_used_at TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      FOREIGN KEY (interaction_profile_key) REFERENCES interaction_profiles(key) ON DELETE RESTRICT
    );

    CREATE INDEX idx_external_interfaces_enabled
      ON external_interfaces(enabled, key);
    CREATE INDEX idx_external_interfaces_profile
      ON external_interfaces(interaction_profile_key, enabled);

    CREATE TABLE interaction_access_events (
      id TEXT PRIMARY KEY,
      interface_key TEXT,
      outcome TEXT NOT NULL,
      reason TEXT NOT NULL,
      request_id TEXT,
      subject_hash TEXT,
      metadata_json TEXT NOT NULL DEFAULT '{}',
      created_at TEXT NOT NULL
    );

    CREATE INDEX idx_interaction_access_events_interface_created
      ON interaction_access_events(interface_key, created_at DESC);
  `,
};
