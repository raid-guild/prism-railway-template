import type { Migration } from './index';

const codeReviewAgentSnapshot = {
  key: 'code-review-agent',
  name: 'Code Review Agent',
  description: 'Independent, fresh-context reviewer for repository changes and linked pull requests.',
  status: 'active',
  systemKey: 'code-review-agent',
  owner: { type: 'agent', userId: null, agentProfileId: 'agent-profile-admin' },
  persona: {
    name: 'Code Review Agent',
    instructions: [
      'Review the actual diff and verification evidence independently from the implementation agent.',
      'Record precise, actionable findings with stable identifiers and severity.',
      'You may maintain one idempotent Prism review comment on the linked pull request.',
      'Never implement fixes, modify repository files, commit, push, merge, approve, deploy, or change unrelated GitHub state.',
    ].join(' '),
  },
  runtimeProfileKey: null,
  skills: ['prism-code-review'],
  memoryScope: {
    scope: 'request-artifacts-only',
    instructions: 'Use only the linked request, target repository, pull request evidence, and durable request artifacts.',
  },
  authority: {
    mode: 'policy-controlled',
    maximumAccessMode: 'full',
    consoleAccessMode: 'readonly',
    credentialPolicy: 'allowlist',
    gatewayCredentials: ['github'],
    allowedMutations: ['github.pr_comment', 'prism.request_artifact'],
    forbiddenMutations: ['repository.write', 'github.merge', 'github.approve', 'deploy'],
  },
  contextPolicy: { continuation: 'step', handoff: 'artifacts' },
  version: 1,
};

const changeRequestWorkflow = {
  key: 'change-request-default',
  name: 'Change Request',
  version: 6,
  description: 'Default human-reviewed request flow with independent local and external pull-request review.',
  entrypoint: 'triage',
  workflowPath: 'workflows/change-request-default/workflow.md',
  target: { kind: 'repository', required: true },
  agentConfig: {
    mode: 'main-agent',
    identity: 'prism-change-agent',
    model: null,
    reasoningEffort: null,
    contextPolicy: { continuation: 'step', handoff: 'artifacts' },
    delegation: { allowed: false, maxAgents: 0 },
  },
  steps: [
    {
      key: 'triage', label: 'Triage', type: 'agent',
      instructionPath: 'workflows/change-request-default/steps/triage.md',
      agentConfig: { skills: ['change-request-ops'] },
      next: 'approve-for-work',
    },
    { key: 'approve-for-work', label: 'Approve', type: 'gate', next: 'implement' },
    {
      key: 'implement', label: 'Work', type: 'agent',
      instructionPath: 'workflows/change-request-default/steps/implement.md',
      agentConfig: {
        skills: ['change-request-ops', 'target-deploy-ops'],
        delegation: { allowed: true, maxAgents: 3 },
      },
      next: 'local-code-review',
    },
    {
      key: 'local-code-review', label: 'Local Code Review', type: 'agent',
      executorAgent: 'code-review-agent', executionMode: 'reviewer',
      instructionPath: 'workflows/change-request-default/steps/local-code-review.md',
      agentConfig: { skills: ['prism-code-review'], delegation: { allowed: false, maxAgents: 0 } },
      next: 'pr-review',
    },
    {
      key: 'pr-review', label: 'External PR Review', type: 'checkpoint',
      executorAgent: 'code-review-agent', executionMode: 'reviewer',
      instructionPath: 'workflows/change-request-default/steps/pr-review.md',
      agentConfig: { skills: ['prism-code-review'], delegation: { allowed: false, maxAgents: 0 } },
      next: 'review',
    },
    {
      key: 'review', label: 'Review', type: 'gate',
      instructionPath: 'workflows/change-request-default/steps/review.md',
      next: 'closed',
    },
    { key: 'closed', label: 'Closed', type: 'terminal' },
  ],
};

function escaped(value: unknown) {
  return JSON.stringify(value).replace(/'/g, "''");
}

export const codeReviewAgentMigration: Migration = {
  name: '044_code_review_agent',
  sql: `
    INSERT OR IGNORE INTO agent_profiles (
      id, key, name, description, status, system_key, owner_type, owner_agent_profile_id,
      persona_json, skills_json, memory_scope_json, authority_json, context_policy_json,
      version, created_at, updated_at
    ) VALUES (
      'agent-profile-code-review',
      'code-review-agent',
      'Code Review Agent',
      'Independent, fresh-context reviewer for repository changes and linked pull requests.',
      'active',
      'code-review-agent',
      'agent',
      'agent-profile-admin',
      '${escaped(codeReviewAgentSnapshot.persona)}',
      '${escaped(codeReviewAgentSnapshot.skills)}',
      '${escaped(codeReviewAgentSnapshot.memoryScope)}',
      '${escaped(codeReviewAgentSnapshot.authority)}',
      '${escaped(codeReviewAgentSnapshot.contextPolicy)}',
      1,
      strftime('%Y-%m-%dT%H:%M:%fZ', 'now'),
      strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
    );

    INSERT OR IGNORE INTO agent_profile_versions (
      profile_id, version, snapshot_json, created_at
    ) VALUES (
      'agent-profile-code-review',
      1,
      '${escaped(codeReviewAgentSnapshot)}',
      strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
    );

    UPDATE workflows
    SET version = 6,
        definition_json = '${escaped(changeRequestWorkflow)}',
        system_default = 1,
        updated_at = datetime('now')
    WHERE key = 'change-request-default'
      AND version < 6;
  `,
};
