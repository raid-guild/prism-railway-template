import type { Migration } from './index';

export const agentProfilesMigration: Migration = {
  name: '040_agent_profiles',
  sql: `
    CREATE TABLE IF NOT EXISTS agent_profiles (
      id TEXT PRIMARY KEY,
      key TEXT NOT NULL UNIQUE,
      name TEXT NOT NULL,
      description TEXT,
      status TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'active', 'disabled', 'archived')),
      system_key TEXT UNIQUE,
      owner_type TEXT NOT NULL CHECK (owner_type IN ('workspace', 'user', 'agent')),
      owner_user_id TEXT REFERENCES users(id) ON DELETE SET NULL,
      owner_agent_profile_id TEXT REFERENCES agent_profiles(id) ON DELETE RESTRICT,
      persona_json TEXT NOT NULL DEFAULT '{}',
      runtime_profile_key TEXT REFERENCES runtime_profiles(key) ON DELETE SET NULL,
      skills_json TEXT NOT NULL DEFAULT '[]',
      memory_scope_json TEXT NOT NULL DEFAULT '{}',
      authority_json TEXT NOT NULL DEFAULT '{}',
      context_policy_json TEXT NOT NULL DEFAULT '{}',
      version INTEGER NOT NULL DEFAULT 1 CHECK (version > 0),
      created_by_user_id TEXT REFERENCES users(id) ON DELETE SET NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      CHECK (
        (owner_type = 'workspace' AND owner_user_id IS NULL AND owner_agent_profile_id IS NULL) OR
        (owner_type = 'user' AND owner_user_id IS NOT NULL AND owner_agent_profile_id IS NULL) OR
        (owner_type = 'agent' AND owner_user_id IS NULL AND owner_agent_profile_id IS NOT NULL)
      ),
      CHECK (owner_agent_profile_id IS NULL OR owner_agent_profile_id <> id)
    );

    CREATE INDEX IF NOT EXISTS idx_agent_profiles_status_name
      ON agent_profiles(status, name, key);
    CREATE INDEX IF NOT EXISTS idx_agent_profiles_owner_agent
      ON agent_profiles(owner_agent_profile_id);

    CREATE TABLE IF NOT EXISTS agent_profile_versions (
      profile_id TEXT NOT NULL REFERENCES agent_profiles(id) ON DELETE CASCADE,
      version INTEGER NOT NULL CHECK (version > 0),
      snapshot_json TEXT NOT NULL,
      created_by_user_id TEXT REFERENCES users(id) ON DELETE SET NULL,
      created_at TEXT NOT NULL,
      PRIMARY KEY (profile_id, version)
    );

    CREATE TABLE IF NOT EXISTS agent_profile_stewards (
      profile_id TEXT NOT NULL REFERENCES agent_profiles(id) ON DELETE CASCADE,
      user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      role TEXT NOT NULL DEFAULT 'steward' CHECK (role IN ('steward', 'owner')),
      created_at TEXT NOT NULL,
      PRIMARY KEY (profile_id, user_id)
    );

    CREATE TABLE IF NOT EXISTS agent_profile_bindings (
      id TEXT PRIMARY KEY,
      profile_id TEXT NOT NULL REFERENCES agent_profiles(id) ON DELETE CASCADE,
      surface_type TEXT NOT NULL CHECK (surface_type IN ('buzz', 'discord', 'telegram', 'external', 'user')),
      surface_key TEXT NOT NULL,
      label TEXT,
      enabled INTEGER NOT NULL DEFAULT 1 CHECK (enabled IN (0, 1)),
      configuration_json TEXT NOT NULL DEFAULT '{}',
      created_by_user_id TEXT REFERENCES users(id) ON DELETE SET NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      UNIQUE (surface_type, surface_key)
    );

    CREATE INDEX IF NOT EXISTS idx_agent_profile_bindings_profile
      ON agent_profile_bindings(profile_id, enabled, surface_type, surface_key);

    ALTER TABLE agent_sessions ADD COLUMN agent_profile_id TEXT REFERENCES agent_profiles(id) ON DELETE SET NULL;
    ALTER TABLE agent_sessions ADD COLUMN agent_profile_version INTEGER;
    ALTER TABLE agent_sessions ADD COLUMN conversation_scope TEXT CHECK (conversation_scope IN ('individual', 'channel', 'thread', 'automated'));

    ALTER TABLE agent_response_jobs ADD COLUMN agent_profile_id TEXT REFERENCES agent_profiles(id) ON DELETE SET NULL;
    ALTER TABLE agent_response_jobs ADD COLUMN agent_profile_version INTEGER;
    ALTER TABLE agent_response_jobs ADD COLUMN execution_mode TEXT;

    ALTER TABLE agent_runs ADD COLUMN agent_profile_id TEXT REFERENCES agent_profiles(id) ON DELETE SET NULL;
    ALTER TABLE agent_runs ADD COLUMN agent_profile_version INTEGER;
    ALTER TABLE agent_runs ADD COLUMN execution_mode TEXT;

    CREATE INDEX IF NOT EXISTS idx_agent_sessions_profile_activity
      ON agent_sessions(agent_profile_id, updated_at DESC);
    CREATE INDEX IF NOT EXISTS idx_agent_response_jobs_profile_activity
      ON agent_response_jobs(agent_profile_id, created_at DESC);
    CREATE INDEX IF NOT EXISTS idx_agent_runs_profile_activity
      ON agent_runs(agent_profile_id, created_at DESC);

    CREATE TRIGGER IF NOT EXISTS trg_agent_response_jobs_profile_snapshot
    AFTER INSERT ON agent_response_jobs
    WHEN NEW.session_id IS NOT NULL AND NEW.agent_profile_id IS NULL
    BEGIN
      UPDATE agent_response_jobs
      SET agent_profile_id = (SELECT agent_profile_id FROM agent_sessions WHERE id = NEW.session_id),
          agent_profile_version = (SELECT agent_profile_version FROM agent_sessions WHERE id = NEW.session_id),
          execution_mode = COALESCE(
            NEW.execution_mode,
            json_extract(NEW.input_json, '$.execution_mode'),
            'worker'
          )
      WHERE id = NEW.id;
    END;

    CREATE TRIGGER IF NOT EXISTS trg_agent_runs_profile_snapshot
    AFTER INSERT ON agent_runs
    WHEN NEW.session_id IS NOT NULL AND NEW.agent_profile_id IS NULL
    BEGIN
      UPDATE agent_runs
      SET agent_profile_id = (SELECT agent_profile_id FROM agent_sessions WHERE id = NEW.session_id),
          agent_profile_version = (SELECT agent_profile_version FROM agent_sessions WHERE id = NEW.session_id),
          execution_mode = COALESCE(
            NEW.execution_mode,
            json_extract(NEW.input_json, '$.execution_mode'),
            'worker'
          )
      WHERE id = NEW.id;
    END;

    INSERT OR IGNORE INTO agent_profiles (
      id, key, name, description, status, system_key, owner_type,
      persona_json, skills_json, memory_scope_json, authority_json,
      context_policy_json, version, created_at, updated_at
    ) VALUES (
      'agent-profile-admin',
      'admin-agent',
      'Admin Agent',
      'Required Prism control-plane agent for cross-agent observability, orchestration, and bounded repair.',
      'active',
      'admin-agent',
      'workspace',
      '{"name":"Admin Agent","instructions":"Operate Prism transparently, preserve durable state, and escalate authority-sensitive work."}',
      '[]',
      '{"scope":"workspace-operational"}',
      '{"mode":"policy-controlled","crossAgentVisibility":true,"credentialPolicy":"job-scoped"}',
      '{"continuation":"step","handoff":"artifacts"}',
      1,
      strftime('%Y-%m-%dT%H:%M:%fZ', 'now'),
      strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
    );

    INSERT OR IGNORE INTO agent_profile_versions (
      profile_id, version, snapshot_json, created_at
    ) VALUES (
      'agent-profile-admin',
      1,
      '{"key":"admin-agent","name":"Admin Agent","description":"Required Prism control-plane agent for cross-agent observability, orchestration, and bounded repair.","status":"active","systemKey":"admin-agent","owner":{"type":"workspace","userId":null,"agentProfileId":null},"persona":{"name":"Admin Agent","instructions":"Operate Prism transparently, preserve durable state, and escalate authority-sensitive work."},"runtimeProfileKey":null,"skills":[],"memoryScope":{"scope":"workspace-operational"},"authority":{"mode":"policy-controlled","crossAgentVisibility":true,"credentialPolicy":"job-scoped"},"contextPolicy":{"continuation":"step","handoff":"artifacts"},"version":1}',
      strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
    );
  `,
};
