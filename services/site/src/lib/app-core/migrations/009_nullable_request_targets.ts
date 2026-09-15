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

export const nullableRequestTargetsMigration = {
  name: '009_nullable_request_targets',
  sql: `
    PRAGMA foreign_keys = OFF;

    CREATE TABLE change_requests_new (
      id TEXT PRIMARY KEY,
      request_number INTEGER NOT NULL,
      workflow_key TEXT NOT NULL DEFAULT 'change-request-default',
      title TEXT NOT NULL,
      description TEXT NOT NULL,
      request_type TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'submitted',
      priority TEXT NOT NULL DEFAULT 'normal',
      source TEXT NOT NULL DEFAULT 'manual',
      requested_by_user_id TEXT REFERENCES users(id) ON DELETE SET NULL,
      target_app_id TEXT REFERENCES target_apps(id) ON DELETE SET NULL,
      target_environment_id TEXT REFERENCES target_environments(id) ON DELETE SET NULL,
      triage_summary TEXT,
      acceptance_criteria_json TEXT,
      constraints_json TEXT,
      attachments_json TEXT,
      agent_recommendation TEXT,
      review_notes TEXT,
      resolution_summary TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      triaged_at TEXT,
      approved_for_work_at TEXT,
      completed_at TEXT,
      closed_at TEXT
    );

    INSERT INTO change_requests_new (
      id, request_number, workflow_key, title, description, request_type, status, priority, source,
      requested_by_user_id, target_app_id, target_environment_id, triage_summary,
      acceptance_criteria_json, constraints_json, attachments_json, agent_recommendation,
      review_notes, resolution_summary, created_at, updated_at,
      triaged_at, approved_for_work_at, completed_at, closed_at
    )
    SELECT
      id, request_number, workflow_key, title, description, request_type, status, priority, source,
      requested_by_user_id, target_app_id, target_environment_id, triage_summary,
      acceptance_criteria_json, constraints_json, attachments_json, agent_recommendation,
      review_notes, resolution_summary, created_at, updated_at,
      triaged_at, approved_for_work_at, completed_at, closed_at
    FROM change_requests;

    DROP TABLE change_requests;
    ALTER TABLE change_requests_new RENAME TO change_requests;

    CREATE UNIQUE INDEX IF NOT EXISTS idx_change_requests_request_number_unique
      ON change_requests(request_number);

    CREATE INDEX IF NOT EXISTS idx_change_requests_listing
      ON change_requests(status, priority, created_at);

    CREATE INDEX IF NOT EXISTS idx_change_requests_target_app
      ON change_requests(target_app_id, created_at);

    UPDATE workflows
    SET definition_json = '${escapedDefaultWorkflow}',
        updated_at = datetime('now')
    WHERE key = 'change-request-default';

    PRAGMA foreign_keys = ON;
  `,
};
