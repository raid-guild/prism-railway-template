import type { Migration } from './index';

const codegenAgentSnapshot = {
  key: 'codegen-agent',
  name: 'Codegen Agent',
  description: 'Protected implementation orchestrator for approved repository changes with bounded runtime-native delegation.',
  status: 'active',
  systemKey: 'codegen-agent',
  owner: { type: 'agent', userId: null, agentProfileId: 'agent-profile-admin' },
  persona: {
    name: 'Codegen Agent',
    instructions: [
      'Implement only the approved request scope in the linked target repository.',
      'Use runtime-native delegates only for independent, bounded work with disjoint ownership; runtimes without delegation complete the work in the parent run.',
      'Let the runtime choose the isolated checkout mechanism; never assume Git worktrees.',
      'Keep planning, integration, conflict resolution, full validation, durable handoff, commit, push, pull-request updates, deployments, and other external mutations in the parent run.',
      'Review every delegated result before integrating it, preserve unrelated work, and stop for operator attention when the approved scope or authority is insufficient.',
    ].join(' '),
  },
  runtimeProfileKey: null,
  skills: ['prism-codegen'],
  memoryScope: {
    scope: 'request-and-target-repository',
    instructions: 'Use the linked request, approved plan, durable request artifacts, target repository, and applicable repository policy.',
  },
  authority: {
    mode: 'policy-controlled',
    maximumAccessMode: 'full',
    consoleAccessMode: 'readonly',
    credentialPolicy: 'job-scoped',
    allowedMutations: [
      'repository.write',
      'repository.commit',
      'github.branch_push',
      'github.pull_request',
      'github.issue_comment',
      'prism.request_artifact',
      'target.preview_deploy',
    ],
    forbiddenMutations: ['github.merge', 'github.approve', 'github.review_decision', 'production.deploy'],
  },
  contextPolicy: { continuation: 'step', handoff: 'artifacts' },
  version: 1,
};

function escaped(value: unknown) {
  return JSON.stringify(value).replace(/'/g, "''");
}

export const codegenAgentMigration: Migration = {
  name: '046_codegen_agent',
  sql: `
    INSERT OR IGNORE INTO agent_profiles (
      id, key, name, description, status, system_key, owner_type, owner_agent_profile_id,
      persona_json, skills_json, memory_scope_json, authority_json, context_policy_json,
      version, created_at, updated_at
    ) VALUES (
      'agent-profile-codegen',
      'codegen-agent',
      'Codegen Agent',
      'Protected implementation orchestrator for approved repository changes with bounded runtime-native delegation.',
      'active',
      'codegen-agent',
      'agent',
      'agent-profile-admin',
      '${escaped(codegenAgentSnapshot.persona)}',
      '${escaped(codegenAgentSnapshot.skills)}',
      '${escaped(codegenAgentSnapshot.memoryScope)}',
      '${escaped(codegenAgentSnapshot.authority)}',
      '${escaped(codegenAgentSnapshot.contextPolicy)}',
      1,
      strftime('%Y-%m-%dT%H:%M:%fZ', 'now'),
      strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
    );

    INSERT OR IGNORE INTO agent_profile_versions (
      profile_id, version, snapshot_json, created_at
    ) VALUES (
      'agent-profile-codegen',
      1,
      '${escaped(codegenAgentSnapshot)}',
      strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
    );

    UPDATE workflows
    SET version = 8,
        definition_json = json_set(
          definition_json,
          '$.version', 8,
          '$.description', 'Default human-reviewed request flow with bounded Codegen Agent orchestration and an independent code-review correction loop.',
          '$.steps[2].executorAgent', 'codegen-agent',
          '$.steps[2].executionMode', 'orchestrator',
          '$.steps[2].agentConfig.skills', json('["prism-codegen","change-request-ops","target-deploy-ops"]'),
          '$.steps[2].agentConfig.delegation', json('{"allowed":true,"maxAgents":3}')
        ),
        updated_at = datetime('now')
    WHERE key = 'change-request-default'
      AND system_default = 1
      AND version = 7
      AND json_extract(definition_json, '$.steps[2].key') = 'implement'
      AND json_extract(definition_json, '$.steps[3].key') = 'local-code-review'
      AND json_extract(definition_json, '$.steps[4].key') = 'review-cycle';
  `,
};
