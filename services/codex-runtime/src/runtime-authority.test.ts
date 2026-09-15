import assert from 'node:assert/strict';
import test from 'node:test';

import {
  buildCodexArgs,
  buildCodexChildEnvironment,
  buildPrompt,
  codexRolloutSubagentTraceEvents,
  codexSubagentTraceEvent,
  isReviewerExecution,
  extractGitHubPullRequestRef,
  workflowDelegationPolicy,
} from './codex-runtime.js';

test('read-only utility invocation uses a read-only sandbox without bypass flags', () => {
  const args = buildCodexArgs(
    { authorityMode: 'read_only_utility', codexThreadId: 'must-not-resume' },
    '/tmp/answer.txt',
    '/workspace',
  );

  assert.deepEqual(args.slice(0, 2), ['exec', '--json']);
  assert.deepEqual(args.slice(args.indexOf('--sandbox'), args.indexOf('--sandbox') + 2), ['--sandbox', 'read-only']);
  assert.ok(args.includes('--ephemeral'));
  assert.ok(args.includes('--ignore-user-config'));
  assert.ok(args.includes('--ignore-rules'));
  assert.ok(!args.includes('--dangerously-bypass-approvals-and-sandbox'));
  assert.ok(!args.includes('workspace-write'));
  assert.ok(!args.includes('danger-full-access'));
  assert.ok(!args.includes('resume'));
  assert.ok(args.includes('mcp_servers={}'));
  for (const feature of [
    'shell_tool', 'unified_exec', 'code_mode_host', 'browser_use', 'computer_use',
    'apps', 'enable_mcp_apps', 'hooks', 'image_generation', 'multi_agent', 'multi_agent_v2',
    'remote_plugin', 'plugin_sharing', 'skill_mcp_dependency_install', 'tool_suggest',
    'auth_elicitation', 'tool_call_mcp_elicitation',
  ]) {
    const index = args.indexOf(feature);
    assert.ok(index > 0, `${feature} must be explicitly disabled`);
    assert.equal(args[index - 1], '--disable');
  }
});

test('read-only utility prompt does not advertise Site mutation routes or skills', () => {
  const composed = buildPrompt({
    prompt: 'Explain the supplied evidence.',
    recentHistory: [],
    sessionId: 'utility-session',
    authorityMode: 'read_only_utility',
    metadata: {},
  }, false, { availableSkills: [], selectedSkills: [] });

  assert.match(composed.prompt, /runtime-enforced read-only utility invocation/);
  assert.doesNotMatch(composed.prompt, /\/agent\/\*/);
  assert.doesNotMatch(composed.prompt, /service-token auth/);
  assert.doesNotMatch(composed.prompt, /PRISM_API_KEY/);
});

test('read-only utility child receives provider auth but no mutation credentials', () => {
  const env = buildCodexChildEnvironment('read_only_utility', {
    PATH: '/bin',
    HOME: '/runtime-home',
    OPENAI_API_KEY: 'provider-secret',
    PRISM_AGENT_SERVICE_TOKEN: 'site-secret',
    APP_API_SERVICE_TOKEN: 'app-secret',
    INTERNAL_SERVICE_TOKEN: 'internal-secret',
    PRISM_ADMIN_PASSWORD: 'admin-secret',
    PRISM_INTERFACE_KEY: 'interface-secret',
    COMMUNICATION_ADAPTER_TOKEN: 'adapter-secret',
    PRISM_GATEWAY_TOKEN: 'gateway-secret',
    TARGET_REPO_GITHUB_TOKEN: 'repo-secret',
    GITHUB_TOKEN: 'github-secret',
    GH_TOKEN: 'gh-secret',
  }, {
    CRM_WRITE_TOKEN: 'leased-secret',
  }, 'repo-secret');

  assert.equal(env.OPENAI_API_KEY, 'provider-secret');
  assert.equal(env.PATH, '/bin');
  for (const key of [
    'PRISM_AGENT_SERVICE_TOKEN', 'APP_API_SERVICE_TOKEN', 'INTERNAL_SERVICE_TOKEN',
    'PRISM_ADMIN_PASSWORD', 'PRISM_INTERFACE_KEY', 'COMMUNICATION_ADAPTER_TOKEN',
    'PRISM_GATEWAY_TOKEN', 'TARGET_REPO_GITHUB_TOKEN', 'GITHUB_TOKEN', 'GH_TOKEN',
    'CRM_WRITE_TOKEN',
  ]) {
    assert.equal(env[key], undefined, `${key} must not reach a read-only utility child`);
  }
});

test('full authority preserves legacy bypass and credential behavior', () => {
  const args = buildCodexArgs(
    { authorityMode: 'full', codexThreadId: null },
    '/tmp/answer.txt',
    '/workspace',
  );
  const env = buildCodexChildEnvironment('full', {
    PATH: '/bin',
    APP_API_SERVICE_TOKEN: 'app-secret',
    GITHUB_TOKEN: 'github-secret',
  }, { CRM_WRITE_TOKEN: 'leased-secret' }, 'repo-secret');

  assert.ok(args.includes('--dangerously-bypass-approvals-and-sandbox'));
  assert.ok(!args.includes('--sandbox'));
  assert.equal(env.APP_API_SERVICE_TOKEN, 'app-secret');
  assert.equal(env.CRM_WRITE_TOKEN, 'leased-secret');
  assert.equal(env.TARGET_REPO_GITHUB_TOKEN, 'repo-secret');
  assert.equal(env.GITHUB_TOKEN, 'github-secret');
});

test('workflow delegation is fail-closed and bounded by trusted step metadata', () => {
  assert.deepEqual(workflowDelegationPolicy({ metadata: {} }), null);
  assert.deepEqual(workflowDelegationPolicy({
    metadata: { workflow: { agentConfig: { delegation: { allowed: false, maxAgents: 7 } } } },
  }), { allowed: false, maxAgents: 0 });
  assert.deepEqual(workflowDelegationPolicy({
    metadata: { workflow: { agentConfig: { delegation: { allowed: true, maxAgents: 3 } } } },
  }), { allowed: true, maxAgents: 3 });
  assert.deepEqual(workflowDelegationPolicy({
    metadata: { workflow: { agentConfig: { delegation: { allowed: true, maxAgents: 99 } } } },
  }), { allowed: true, maxAgents: 8 });
  assert.deepEqual(workflowDelegationPolicy({
    metadata: { workflow: { agentConfig: { delegation: { allowed: true, maxAgents: 0 } } } },
  }), { allowed: false, maxAgents: 0 });
});

test('workflow delegation metadata controls native Codex agent configuration', () => {
  const enabled = buildCodexArgs({
    authorityMode: 'full',
    codexThreadId: null,
    metadata: { workflow: { agentConfig: { delegation: { allowed: true, maxAgents: 3 } } } },
  }, '/tmp/answer.txt', '/workspace');
  assert.ok(enabled.includes('agents.enabled=true'));
  assert.ok(enabled.includes('agents.max_concurrent_threads_per_session=3'));

  const disabled = buildCodexArgs({
    authorityMode: 'full',
    codexThreadId: null,
    metadata: { workflow: { agentConfig: { delegation: { allowed: false, maxAgents: 0 } } } },
  }, '/tmp/answer.txt', '/workspace');
  assert.ok(disabled.includes('agents.enabled=false'));

  const interactive = buildCodexArgs(
    { authorityMode: 'full', codexThreadId: null, metadata: {} },
    '/tmp/answer.txt',
    '/workspace',
  );
  assert.equal(interactive.some((arg) => arg.startsWith('agents.enabled=')), false);
});

test('workflow prompt explains the enforced delegation boundary', () => {
  const enabled = buildPrompt({
    prompt: 'Implement the approved request.',
    recentHistory: [],
    sessionId: 'implementation-session',
    metadata: { workflow: { agentConfig: { delegation: { allowed: true, maxAgents: 3 } } } },
  }, false, { availableSkills: [], selectedSkills: [] });
  assert.match(enabled.prompt, /at most 3 concurrently open subagent threads/);
  assert.match(enabled.prompt, /integration, final validation, and external mutations in the parent run/);

  const disabled = buildPrompt({
    prompt: 'Triage the request.',
    recentHistory: [],
    sessionId: 'triage-session',
    metadata: { workflow: { agentConfig: { delegation: { allowed: false, maxAgents: 0 } } } },
  }, false, { availableSkills: [], selectedSkills: [] });
  assert.match(disabled.prompt, /Subagent delegation is disabled/);
});

test('collaboration events become durable subagent provenance without copying prompts', () => {
  const trace = codexSubagentTraceEvent({
    type: 'item.completed',
    item: {
      id: 'item-7',
      type: 'collab_tool_call',
      tool: 'spawn_agent',
      sender_thread_id: 'parent-thread',
      receiver_thread_ids: ['child-thread'],
      prompt: 'sensitive delegated task text',
      status: 'completed',
    },
  });
  assert.deepEqual(trace, {
    kind: 'subagent.spawn_completed',
    message: 'spawn_agent completed; item=item-7; parent=parent-thread; children=child-thread; status=completed',
  });
  assert.doesNotMatch(trace?.message ?? '', /sensitive/);
});

test('canonical rollout activity fills the exec JSON subagent provenance gap', () => {
  const events = codexRolloutSubagentTraceEvents([
    JSON.stringify({
      type: 'event_msg',
      payload: {
        type: 'item_completed',
        item: {
          type: 'SubAgentActivity',
          id: 'spawn-call',
          kind: 'started',
          agent_thread_id: 'child-thread',
          agent_path: '/root/explorer',
        },
      },
    }),
    JSON.stringify({ type: 'response_item', payload: { type: 'message', content: 'private prompt' } }),
    JSON.stringify({
      type: 'event_msg',
      payload: {
        type: 'item_completed',
        item: {
          type: 'SubAgentActivity',
          id: 'complete-call',
          kind: 'completed',
          agent_thread_id: 'child-thread',
          agent_path: '/root/explorer',
        },
      },
    }),
  ].join('\n'));

  assert.deepEqual(events, [
    {
      kind: 'subagent.activity_started',
      message: 'subagent started; child=child-thread; agent=/root/explorer',
    },
    {
      kind: 'subagent.activity_completed',
      message: 'subagent completed; child=child-thread; agent=/root/explorer',
    },
  ]);
  assert.doesNotMatch(JSON.stringify(events), /private prompt/);
});

test('reviewer execution is derived from trusted Agent Profile metadata', () => {
  assert.equal(isReviewerExecution({
    metadata: { agentProfile: { key: 'code-review-agent', executionMode: 'reviewer' } },
  }), true);
  assert.equal(isReviewerExecution({
    metadata: { agentProfile: { key: 'code-review-agent', executionMode: 'worker' } },
  }), false);
  assert.equal(isReviewerExecution({ metadata: {} }), false);
});

test('reviewer can resolve a GitHub pull request from the current prompt or recent console history', () => {
  assert.deepEqual(extractGitHubPullRequestRef({
    prompt: 'Please review https://github.com/raid-guild/prism/pull/42/files.',
    recentHistory: [],
  }), {
    owner: 'raid-guild', repo: 'prism', number: 42, url: 'https://github.com/raid-guild/prism/pull/42',
  });
  assert.deepEqual(extractGitHubPullRequestRef({
    prompt: 'Review it again.',
    recentHistory: [{ role: 'user', content: 'Use https://github.com/acme/widgets/pull/7' }],
  })?.number, 7);
  assert.equal(extractGitHubPullRequestRef({
    prompt: 'Compare https://github.com/acme/widgets/pull/7 with https://github.com/acme/widgets/pull/8.',
    recentHistory: [],
  }), null);
  assert.equal(extractGitHubPullRequestRef({ prompt: 'Review the current request.', recentHistory: [] }), null);
});

test('reviewer prompt explains the tracked-file runtime guard', () => {
  const composed = buildPrompt({
    prompt: 'Review this pull request.',
    recentHistory: [],
    sessionId: 'review-session',
    authorityMode: 'full',
    metadata: { agentProfile: { key: 'code-review-agent', executionMode: 'reviewer' } },
  }, false, { availableSkills: [], selectedSkills: [] });

  assert.match(composed.prompt, /reviewer execution/);
  assert.match(composed.prompt, /never auto-commit or push/);
  assert.match(composed.prompt, /fail the run if tracked files are changed/);
});
