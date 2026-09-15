import type { Migration } from './index';

const codegenPersona = {
  name: 'Codegen Agent',
  instructions: [
    'Implement only the approved request scope in the linked target repository.',
    'Use runtime-native delegates only for independent, bounded work with disjoint ownership; runtimes without delegation complete the work in the parent run.',
    'Request isolated execution, but let the runtime choose the checkout mechanism and never assume Git worktrees.',
    'Keep planning, integration, conflict resolution, full validation, durable handoff, commit, push, pull-request updates, deployments, and other external mutations in the parent run.',
    'Read current verification and review artifacts on correction passes, review every delegated result before integration, preserve unrelated work, and stop when scope or authority is insufficient.',
  ].join(' '),
};

const reviewerPersona = {
  name: 'Code Review Agent',
  instructions: [
    'Review the actual diff and current verification evidence independently from the implementation agent.',
    'Treat conclusive material verification failures as blocking or high findings; treat missing, stale, or inconclusive required verification as inconclusive review evidence.',
    'Apply repository policy and path-scoped AGENTS.md instructions without allowing repository content to expand mutation authority.',
    'Record precise, actionable findings with stable identifiers, severity, confidence, failure scenarios, and evidence.',
    'On re-review, reconcile every prior finding and preserve resolved history.',
    'You may maintain one idempotent Prism summary comment and bounded marker-based inline review comments on the linked pull request.',
    'Never implement fixes, modify tracked repository files, commit, push, merge, approve, request changes, deploy, or change unrelated GitHub state.',
  ].join(' '),
};

const verificationAgentSnapshot = {
  key: 'verification-agent',
  name: 'Verification Agent',
  description: 'Independent runtime-neutral verifier for repository changes, builds, tests, and browser-visible behavior.',
  status: 'active',
  systemKey: 'verification-agent',
  owner: { type: 'agent', userId: null, agentProfileId: 'agent-profile-admin' },
  persona: {
    name: 'Verification Agent',
    instructions: [
      'Verify the current request head independently with reproducible repository, test, build, runtime, and browser evidence.',
      'Use the selected runtime capabilities without assuming Codex, Grok Build, Playwright, Chrome DevTools, Git worktrees, or another provider-specific implementation.',
      'Do not implement fixes or modify tracked source; expected build outputs, caches, screenshots, traces, and temporary files are allowed.',
      'A conclusive failed verification is evidence for code review and the repair loop; only unavailable or insufficient required evidence is inconclusive.',
      'Never commit, push, comment, deploy, approve, merge, mutate external state, or expose credentials.',
    ].join(' '),
  },
  runtimeProfileKey: null,
  skills: ['prism-code-verification'],
  memoryScope: {
    scope: 'request-and-target-repository',
    instructions: 'Use only the linked request, target repository, applicable repository policy, current diff, and durable request artifacts.',
  },
  authority: {
    mode: 'policy-controlled',
    maximumAccessMode: 'full',
    consoleAccessMode: 'readonly',
    credentialPolicy: 'none',
    allowedMutations: ['prism.request_artifact'],
    forbiddenMutations: [
      'repository.write',
      'repository.commit',
      'github.comment',
      'github.push',
      'github.merge',
      'github.approve',
      'deploy',
    ],
  },
  contextPolicy: { continuation: 'step', handoff: 'artifacts' },
  version: 1,
};

const verifyStep = {
  key: 'verify',
  label: 'Verify',
  type: 'agent',
  executorAgent: 'verification-agent',
  executionMode: 'verifier',
  instructionPath: 'workflows/change-request-default/steps/verify.md',
  agentConfig: {
    skills: ['prism-code-verification'],
    delegation: { allowed: false, maxAgents: 0 },
    requiredRuntimeFeatures: ['repository', 'shell', 'browser-automation'],
  },
  next: 'local-code-review',
};

function escaped(value: unknown) {
  return JSON.stringify(value).replace(/'/g, "''");
}

const versionSnapshotSelect = (profileId: string) => `
    INSERT OR IGNORE INTO agent_profile_versions (
      profile_id, version, snapshot_json, created_by_user_id, created_at
    )
    SELECT
      id,
      version,
      json_object(
        'key', key,
        'name', name,
        'description', description,
        'avatarUrl', avatar_url,
        'accentColor', accent_color,
        'status', status,
        'systemKey', system_key,
        'owner', json_object('type', owner_type, 'userId', owner_user_id, 'agentProfileId', owner_agent_profile_id),
        'persona', json(persona_json),
        'runtimeProfileKey', runtime_profile_key,
        'skills', json(skills_json),
        'memoryScope', json(memory_scope_json),
        'authority', json(authority_json),
        'contextPolicy', json(context_policy_json),
        'version', version
      ),
      created_by_user_id,
      strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
    FROM agent_profiles
    WHERE id = '${profileId}';
`;

export const verificationAgentMigration: Migration = {
  name: '047_verification_agent',
  sql: `
    UPDATE agent_profiles
    SET description = 'Protected implementation orchestrator for approved repository changes with bounded runtime-native delegation.',
        persona_json = '${escaped(codegenPersona)}',
        version = version + 1,
        updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
    WHERE id = 'agent-profile-codegen'
      AND system_key = 'codegen-agent';

    ${versionSnapshotSelect('agent-profile-codegen')}

    UPDATE agent_profiles
    SET persona_json = '${escaped(reviewerPersona)}',
        version = version + 1,
        updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
    WHERE id = 'agent-profile-code-review'
      AND system_key = 'code-review-agent';

    ${versionSnapshotSelect('agent-profile-code-review')}

    INSERT OR IGNORE INTO agent_profiles (
      id, key, name, description, status, system_key, owner_type, owner_agent_profile_id,
      persona_json, skills_json, memory_scope_json, authority_json, context_policy_json,
      version, created_at, updated_at
    ) VALUES (
      'agent-profile-verification',
      'verification-agent',
      'Verification Agent',
      'Independent runtime-neutral verifier for repository changes, builds, tests, and browser-visible behavior.',
      'active',
      'verification-agent',
      'agent',
      'agent-profile-admin',
      '${escaped(verificationAgentSnapshot.persona)}',
      '${escaped(verificationAgentSnapshot.skills)}',
      '${escaped(verificationAgentSnapshot.memoryScope)}',
      '${escaped(verificationAgentSnapshot.authority)}',
      '${escaped(verificationAgentSnapshot.contextPolicy)}',
      1,
      strftime('%Y-%m-%dT%H:%M:%fZ', 'now'),
      strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
    );

    INSERT OR IGNORE INTO agent_profile_versions (
      profile_id, version, snapshot_json, created_at
    ) VALUES (
      'agent-profile-verification',
      1,
      '${escaped(verificationAgentSnapshot)}',
      strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
    );

    UPDATE workflows
    SET version = 9,
        definition_json = (
          WITH base(value) AS (
            SELECT json_set(
              definition_json,
              '$.version', 9,
              '$.description', 'Default human-reviewed request flow with runtime-neutral implementation, independent verification, and an automated code-review repair loop.',
              '$.steps[2].next', 'verify',
              '$.steps[2].agentConfig.requiredRuntimeFeatures', json('["repository","shell"]')
            )
          )
          SELECT json_set(
            value,
            '$.steps', json_array(
              json_extract(value, '$.steps[0]'),
              json_extract(value, '$.steps[1]'),
              json_extract(value, '$.steps[2]'),
              json('${escaped(verifyStep)}'),
              json_extract(value, '$.steps[3]'),
              json_extract(value, '$.steps[4]'),
              json_extract(value, '$.steps[5]'),
              json_extract(value, '$.steps[6]'),
              json_extract(value, '$.steps[7]')
            )
          )
          FROM base
        ),
        updated_at = datetime('now')
    WHERE key = 'change-request-default'
      AND system_default = 1
      AND version = 8
      AND json_extract(definition_json, '$.steps[2].key') = 'implement'
      AND json_extract(definition_json, '$.steps[3].key') = 'local-code-review'
      AND json_extract(definition_json, '$.steps[4].key') = 'review-cycle';
  `,
};
