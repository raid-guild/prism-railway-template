const defaultChangeRequestWorkflow = {
  key: "change-request-default",
  name: "Change Request",
  version: 3,
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
      next: "pr-review",
    },
    {
      key: "pr-review",
      label: "PR Review",
      type: "checkpoint",
      instructionPath: "workflows/change-request-default/steps/pr-review.md",
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

export const simpleChangeRequestReviewGateMigration = {
  name: '027_simple_change_request_review_gate',
  sql: `
    UPDATE workflows
    SET version = 3,
        definition_json = '${escapedDefaultWorkflow}',
        updated_at = datetime('now')
    WHERE key = 'change-request-default';
  `,
};
