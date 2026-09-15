const defaultChangeRequestWorkflow = {
  key: "change-request-default",
  name: "Change Request",
  version: 1,
  description: "Default human-reviewed request flow for repository-backed changes.",
  entrypoint: "triage",
  workflowPath: "workflows/change-request-default/workflow.md",
  target: {
    kind: "repository",
    required: true,
  },
  agentConfig: {
    runtime: "codex-runtime",
    mode: "main-agent",
    identity: "prism-change-agent",
    model: null,
    reasoningEffort: null,
    skills: ["change-request-ops", "target-deploy-ops"],
    delegation: {
      allowed: false,
      maxAgents: 0,
    },
  },
  steps: [
    {
      key: "triage",
      label: "Triage",
      type: "agent",
      instructionPath: "workflows/change-request-default/steps/triage.md",
      next: "approve-for-work",
    },
    {
      key: "approve-for-work",
      label: "Approve",
      type: "gate",
      next: "implement",
    },
    {
      key: "implement",
      label: "Work",
      type: "agent",
      instructionPath: "workflows/change-request-default/steps/implement.md",
      agentConfig: {
        skills: ["change-request-ops", "target-deploy-ops"],
        delegation: {
          allowed: true,
          maxAgents: 3,
        },
      },
      next: "review",
    },
    {
      key: "review",
      label: "Review",
      type: "gate",
      instructionPath: "workflows/change-request-default/steps/review.md",
      next: "closed",
    },
    {
      key: "closed",
      label: "Closed",
      type: "terminal",
    },
  ],
};

const escapedDefaultWorkflow = JSON.stringify(defaultChangeRequestWorkflow).replace(/'/g, "''");

export const workflowsMigration = {
  name: '007_workflows',
  sql: `
    ALTER TABLE tasks
      ADD COLUMN agent_config_json TEXT NOT NULL DEFAULT '{}';

    ALTER TABLE change_requests
      ADD COLUMN workflow_key TEXT NOT NULL DEFAULT 'change-request-default';

    CREATE TABLE IF NOT EXISTS workflows (
      id TEXT PRIMARY KEY,
      key TEXT NOT NULL UNIQUE,
      name TEXT NOT NULL,
      description TEXT,
      version INTEGER NOT NULL DEFAULT 1,
      definition_json TEXT NOT NULL DEFAULT '{}',
      system_default INTEGER NOT NULL DEFAULT 0 CHECK (system_default IN (0, 1)),
      enabled INTEGER NOT NULL DEFAULT 1 CHECK (enabled IN (0, 1)),
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE INDEX IF NOT EXISTS idx_workflows_enabled_key
      ON workflows(enabled, key);

    INSERT INTO workflows (
      id, key, name, description, version, definition_json, system_default, enabled, created_at, updated_at
    ) VALUES (
      lower(hex(randomblob(4))) || '-' || lower(hex(randomblob(2))) || '-' || lower(hex(randomblob(2))) || '-' || lower(hex(randomblob(2))) || '-' || lower(hex(randomblob(6))),
      'change-request-default',
      'Change Request',
      'Default human-reviewed request flow for repository-backed changes.',
      1,
      '${escapedDefaultWorkflow}',
      1,
      1,
      datetime('now'),
      datetime('now')
    )
    ON CONFLICT(key) DO UPDATE SET
      name = excluded.name,
      description = excluded.description,
      version = excluded.version,
      definition_json = excluded.definition_json,
      system_default = excluded.system_default,
      enabled = excluded.enabled,
      updated_at = excluded.updated_at;
  `,
};
