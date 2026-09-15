import assert from 'node:assert/strict';
import { test } from 'node:test';
import { execFileSync } from 'node:child_process';
import os from 'node:os';
import { browserToolEnvironment } from './browser-tools.js';
import { buildCodexChildEnvironment, buildPrompt } from './codex-runtime.js';

test('browser module resolves outside the runtime cwd with an isolated HOME', () => {
  const env = buildCodexChildEnvironment('full', process.env, {}, null, '/tmp/prism-isolated-test-home');
  assert.equal(env.PRISM_CHROMIUM_EXECUTABLE, browserToolEnvironment.PRISM_CHROMIUM_EXECUTABLE);
  assert.equal(env.HOME, '/tmp/prism-isolated-test-home');
  const output = execFileSync(process.execPath, ['-e',
    'const p=require(process.env.PRISM_PLAYWRIGHT_MODULE); console.log(typeof p.chromium.launch)',
  ], { cwd: os.tmpdir(), env, encoding: 'utf8' });
  assert.equal(output.trim(), 'function');
});

test('read-only utility does not gain browser tool configuration', () => {
  const env = buildCodexChildEnvironment('read_only_utility', { ...process.env, ...browserToolEnvironment }, {}, null);
  assert.equal(env.PRISM_PLAYWRIGHT_MODULE, undefined);
  assert.equal(env.PRISM_CHROMIUM_EXECUTABLE, undefined);
});

test('full jobs receive browser discovery guidance but read-only utilities do not', () => {
  for (const authorityMode of ['full', 'read_only_utility'] as const) {
    const { prompt } = buildPrompt({ prompt: 'Verify this page.', recentHistory: [],
      sessionId: 'browser-test', authorityMode, metadata: {},
    }, false, { availableSkills: [], selectedSkills: [] });
    assert.equal(prompt.includes('PRISM_PLAYWRIGHT_MODULE'), authorityMode === 'full');
    assert.equal(prompt.includes('PRISM_CHROMIUM_EXECUTABLE'), authorityMode === 'full');
  }
});
