import type { Migration } from './index';

export const accountabilityDomainsMigration: Migration = {
  name: '048_accountability_domains',
  sql: `
    CREATE TABLE IF NOT EXISTS accountability_domains (
      id TEXT PRIMARY KEY,
      key TEXT NOT NULL UNIQUE,
      name TEXT NOT NULL,
      description TEXT,
      status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'archived')),
      system_key TEXT UNIQUE,
      governance_ref_json TEXT NOT NULL DEFAULT '{}',
      version INTEGER NOT NULL DEFAULT 1 CHECK (version > 0),
      created_by_user_id TEXT REFERENCES users(id) ON DELETE SET NULL,
      updated_by_user_id TEXT REFERENCES users(id) ON DELETE SET NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS accountability_domain_stewards (
      domain_id TEXT NOT NULL REFERENCES accountability_domains(id) ON DELETE CASCADE,
      user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      created_by_user_id TEXT REFERENCES users(id) ON DELETE SET NULL,
      created_at TEXT NOT NULL,
      PRIMARY KEY (domain_id, user_id)
    );

    CREATE TABLE IF NOT EXISTS accountability_domain_assignments (
      target_type TEXT NOT NULL CHECK (target_type IN ('agent_profile', 'workflow', 'task')),
      target_id TEXT NOT NULL,
      domain_id TEXT NOT NULL REFERENCES accountability_domains(id) ON DELETE RESTRICT,
      assigned_by_user_id TEXT REFERENCES users(id) ON DELETE SET NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      PRIMARY KEY (target_type, target_id)
    );

    CREATE INDEX IF NOT EXISTS idx_accountability_assignments_domain
      ON accountability_domain_assignments(domain_id, target_type, target_id);
    CREATE INDEX IF NOT EXISTS idx_accountability_domain_stewards_user
      ON accountability_domain_stewards(user_id, domain_id);

    ALTER TABLE agent_runs ADD COLUMN executor_resolution TEXT CHECK (
      executor_resolution IS NULL OR executor_resolution IN (
        'step-explicit', 'workflow-default', 'task-explicit', 'hook-workflow-default',
        'admin-fallback', 'historical-unknown', 'not-applicable'
      )
    );
    ALTER TABLE agent_runs ADD COLUMN accountability_snapshot_json TEXT NOT NULL DEFAULT '{}';

    INSERT OR IGNORE INTO accountability_domains (
      id, key, name, description, status, system_key, governance_ref_json, version, created_at, updated_at
    ) VALUES (
      'accountability-domain-prism-builtins',
      'prism-builtins',
      'Prism Built-ins',
      'System-owned control-plane and reusable built-in execution definitions.',
      'active',
      'prism-builtins',
      '{}',
      1,
      strftime('%Y-%m-%dT%H:%M:%fZ', 'now'),
      strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
    );

    INSERT OR IGNORE INTO accountability_domain_stewards (domain_id, user_id, created_at)
    SELECT 'accountability-domain-prism-builtins', ur.user_id, strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
    FROM user_roles ur
    JOIN roles r ON r.id = ur.role_id
    WHERE r.slug = 'admin';

    INSERT OR IGNORE INTO accountability_domain_assignments (
      target_type, target_id, domain_id, created_at, updated_at
    )
    SELECT 'agent_profile', id, 'accountability-domain-prism-builtins',
           strftime('%Y-%m-%dT%H:%M:%fZ', 'now'), strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
    FROM agent_profiles
    WHERE system_key IS NOT NULL;

    INSERT OR IGNORE INTO accountability_domain_assignments (
      target_type, target_id, domain_id, created_at, updated_at
    )
    SELECT 'workflow', id, 'accountability-domain-prism-builtins',
           strftime('%Y-%m-%dT%H:%M:%fZ', 'now'), strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
    FROM workflows
    WHERE system_default = 1;

    UPDATE agent_runs
    SET executor_resolution = 'historical-unknown'
    WHERE executor_resolution IS NULL AND status IN ('completed', 'succeeded', 'failed', 'canceled');
  `,
};
