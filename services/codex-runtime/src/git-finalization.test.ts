import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { finalizeGitWorkspace } from './codex-runtime.js';

for (const mode of ['verifier', 'reviewer', 'worker']) {
  test(`${mode} Git finalization respects independent evaluation`, async () => {
    const cwd = await mkdtemp(path.join(tmpdir(), 'prism-finalize-test-'));
    const git = (...args: string[]) => execFileSync('git', args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
    try {
      git('init', '-b', 'main');
      git('config', 'user.email', 'test@example.invalid');
      git('config', 'user.name', 'Test');
      await writeFile(path.join(cwd, 'app.txt'), 'original');
      git('add', '.'); git('commit', '-m', 'initial');
      const sha = git('rev-parse', 'HEAD');
      const prepared = { workspacePath: cwd, repoUrl: 'https://github.com/example/app', branchName: 'main', baseBranch: 'main', baseCommitSha: sha, commitSha: sha };
      const input = { prompt: 'check', sessionId: 'test', recentHistory: [], metadata: { agentProfile: { executionMode: mode } } };
      if (mode === 'worker') {
        await assert.rejects(finalizeGitWorkspace(input, prepared, [], null), /TARGET_REPO_AUTH_MISSING/);
        return;
      }
      // Untracked browser evidence must not become an application commit.
      await writeFile(path.join(cwd, 'browser-evidence.json'), '{}');
      await finalizeGitWorkspace(input, prepared, [], null);
      assert.equal(git('rev-parse', 'HEAD'), sha);
      assert.match(git('status', '--porcelain'), /\?\? browser-evidence.json/);
      await writeFile(path.join(cwd, 'app.txt'), 'changed');
      await assert.rejects(finalizeGitWorkspace(input, prepared, [], null), new RegExp(`${mode.toUpperCase()}_TRACKED_WORKSPACE_MODIFIED`));
      assert.equal(git('rev-parse', 'HEAD'), sha);
    } finally {
      await rm(cwd, { recursive: true, force: true });
    }
  });
}
