import { randomUUID } from 'node:crypto';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { config } from './config.js';
import { RunBudget, isExecutionProgress, resolveRunBudget } from './run-budget.js';
import { resolveCodexModelPolicy, type ModelTier, type ReasoningEffort } from './model-tier.js';
import { createNativePrismSkillHome, loadRelevantPrismSkills } from './prism-skills.js';
import { gatewayClient } from './runtime-gateway.js';
import { processInvocationSizeMetrics } from './process-size.js';
import { browserToolEnvironment, browserToolInstructions } from './browser-tools.js';

type HistoryEntry = {
  role: string;
  content: string;
};

type LinkedTargetAppMetadata = {
  id?: string;
  slug?: string;
  name?: string;
  defaultBranch?: string;
  repoUrl?: string | null;
  repoProvider?: string | null;
  deployBackend?: string;
  deployConfig?: Record<string, unknown>;
};

type LinkedTargetEnvironmentMetadata = {
  id?: string;
  slug?: string;
  name?: string;
  kind?: string;
  branch?: string | null;
  baseUrl?: string | null;
  deployBackend?: string;
  deployConfig?: Record<string, unknown>;
  agentWritable?: boolean;
};

type LinkedChangeRequestMetadata = {
  id?: string;
  requestNumber?: number;
  title?: string;
  status?: string;
};

type LinkedLatestExecutionMetadata = {
  id?: string;
  branchName?: string | null;
  commitSha?: string | null;
  meta?: Record<string, unknown>;
};

export type GitHubPullRequestRef = {
  owner: string;
  repo: string;
  number: number;
  url: string;
};

type GitHubPullRequestMetadata = GitHubPullRequestRef & {
  title: string | null;
  baseRef: string;
  baseSha: string;
  headRef: string;
  headSha: string;
  repositoryUrl: string;
};

export type CodexRuntimeInput = {
  prompt: string;
  recentHistory: HistoryEntry[];
  sessionId: string;
  authorityMode?: 'full' | 'read_only_utility';
  codexThreadId?: string | null;
  credentials?: string[];
  gatewayContext?: Record<string, string>;
  metadata?: Record<string, unknown>;
  modelTier?: ModelTier | null;
  signal?: AbortSignal;
  onTrace?: (trace: CodexRuntimeResult['trace']) => void;
};

export type CodexRuntimeResult = {
  provider: 'codex-cli';
  model: string | null;
  modelTier: ModelTier | null;
  reasoningEffort: ReasoningEffort | null;
  responseText: string;
  codexThreadId: string | null;
  branchName: string | null;
  commitSha: string | null;
  branchUrl: string | null;
  baseBranch: string | null;
  baseCommitSha: string | null;
  trace: Array<{
    at: string;
    kind: string;
    message: string;
  }>;
};

type WorkflowDelegationPolicy = {
  allowed: boolean;
  maxAgents: number;
};

type CodexJsonEvent = {
  type?: string;
  thread_id?: string;
  message?: string;
  item?: {
    id?: string;
    type?: string;
    text?: string;
    role?: string;
    status?: string;
    tool?: string;
    sender_thread_id?: string;
    receiver_thread_ids?: string[];
    prompt?: string | null;
    agents_states?: Record<string, { status?: string; message?: string | null }>;
  };
  error?: { message?: string } | string;
};

type CodexRuntimeError = Error & {
  codexThreadId?: string | null;
  trace?: Array<{
    at: string;
    kind: string;
    message: string;
  }>;
};

type GitHubRepoAccess = {
  login: string | null;
  repoSlug: string;
  canPull: boolean | null;
  canPush: boolean | null;
};

function slugifySegment(value: string) {
  return value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 80);
}

export function extractGitHubPullRequestRef(input: Pick<CodexRuntimeInput, 'prompt' | 'recentHistory'>) {
  const candidates = [input.prompt, ...input.recentHistory.slice().reverse().map((entry) => entry.content)];
  for (const candidate of candidates) {
    const refs = new Map<string, GitHubPullRequestRef>();
    for (const match of candidate.matchAll(/https:\/\/github\.com\/([A-Za-z0-9_.-]+)\/([A-Za-z0-9_.-]+)\/pull\/(\d+)(?:\b|\/)/gi)) {
      const number = Number.parseInt(match[3]!, 10);
      if (!Number.isSafeInteger(number) || number < 1) continue;
      const owner = match[1]!;
      const repo = match[2]!.replace(/\.git$/i, '');
      const ref = { owner, repo, number, url: `https://github.com/${owner}/${repo}/pull/${number}` } satisfies GitHubPullRequestRef;
      refs.set(ref.url.toLowerCase(), ref);
    }
    if (refs.size === 1) return refs.values().next().value ?? null;
    if (refs.size > 1) return null;
  }
  return null;
}

function parseLinkedTargetApp(metadata: Record<string, unknown> | undefined): LinkedTargetAppMetadata | null {
  if (!metadata?.linkedTargetApp || typeof metadata.linkedTargetApp !== 'object' || Array.isArray(metadata.linkedTargetApp)) {
    return null;
  }

  return metadata.linkedTargetApp as LinkedTargetAppMetadata;
}

function parseLinkedTargetEnvironment(metadata: Record<string, unknown> | undefined): LinkedTargetEnvironmentMetadata | null {
  if (
    !metadata?.linkedTargetEnvironment
    || typeof metadata.linkedTargetEnvironment !== 'object'
    || Array.isArray(metadata.linkedTargetEnvironment)
  ) {
    return null;
  }

  return metadata.linkedTargetEnvironment as LinkedTargetEnvironmentMetadata;
}

function parseLinkedChangeRequest(metadata: Record<string, unknown> | undefined): LinkedChangeRequestMetadata | null {
  if (!metadata?.linkedChangeRequest || typeof metadata.linkedChangeRequest !== 'object' || Array.isArray(metadata.linkedChangeRequest)) {
    return null;
  }

  return metadata.linkedChangeRequest as LinkedChangeRequestMetadata;
}

function parseLinkedLatestExecution(metadata: Record<string, unknown> | undefined): LinkedLatestExecutionMetadata | null {
  if (!metadata?.linkedLatestExecution || typeof metadata.linkedLatestExecution !== 'object' || Array.isArray(metadata.linkedLatestExecution)) {
    return null;
  }

  return metadata.linkedLatestExecution as LinkedLatestExecutionMetadata;
}

function shouldHydrateExternalWorkspace(metadata: Record<string, unknown> | undefined) {
  const targetApp = parseLinkedTargetApp(metadata);
  if (!targetApp?.repoUrl || typeof targetApp.repoUrl !== 'string') {
    return false;
  }

  const deployConfig =
    targetApp.deployConfig && typeof targetApp.deployConfig === 'object' && !Array.isArray(targetApp.deployConfig)
      ? targetApp.deployConfig
      : null;

  return deployConfig?.workspace === 'external';
}

function parseGitHubRepoSlug(repoUrl: string): { owner: string; repo: string; slug: string } | null {
  const match = repoUrl.match(/^https:\/\/github\.com\/([^/]+)\/([^/.]+)(?:\.git)?$/);
  if (!match) {
    return null;
  }
  const [, owner, repo] = match;
  return { owner, repo, slug: `${owner}/${repo}` };
}

function looksLikeGitHubAuthError(message: string) {
  const lower = message.toLowerCase();
  return (
    lower.includes('github.com') &&
    (
      lower.includes('403')
      || lower.includes('authentication failed')
      || lower.includes('permission to')
      || lower.includes('could not read username')
      || lower.includes('requested url returned error')
    )
  );
}

async function inspectGitHubRepoAccess(repoUrl: string, githubToken: string | null): Promise<GitHubRepoAccess | null> {
  const parsed = parseGitHubRepoSlug(repoUrl);
  if (!parsed || !githubToken) {
    return null;
  }

  const response = await fetch(`https://api.github.com/repos/${parsed.slug}`, {
    headers: {
      Authorization: `Bearer ${githubToken}`,
      'User-Agent': 'prism-codex-runtime',
      Accept: 'application/vnd.github+json',
    },
  }).catch(() => null);

  if (!response) {
    return {
      login: null,
      repoSlug: parsed.slug,
      canPull: null,
      canPush: null,
    };
  }

  const payload = await response.json().catch(() => null) as Record<string, unknown> | null;
  const permissions =
    payload?.permissions && typeof payload.permissions === 'object' && !Array.isArray(payload.permissions)
      ? payload.permissions as Record<string, unknown>
      : null;
  const owner =
    payload?.owner && typeof payload.owner === 'object' && !Array.isArray(payload.owner)
      ? payload.owner as Record<string, unknown>
      : null;

  return {
    login: typeof payload?.login === 'string'
      ? payload.login
      : typeof owner?.login === 'string'
        ? owner.login
        : null,
    repoSlug: parsed.slug,
    canPull: typeof permissions?.pull === 'boolean' ? permissions.pull : null,
    canPush: typeof permissions?.push === 'boolean' ? permissions.push : null,
  };
}

async function inspectGitHubPullRequest(
  ref: GitHubPullRequestRef,
  githubToken: string | null,
): Promise<GitHubPullRequestMetadata> {
  const response = await fetch(`https://api.github.com/repos/${ref.owner}/${ref.repo}/pulls/${ref.number}`, {
    headers: {
      ...(githubToken ? { Authorization: `Bearer ${githubToken}` } : {}),
      'User-Agent': 'prism-codex-runtime',
      Accept: 'application/vnd.github+json',
      'X-GitHub-Api-Version': '2022-11-28',
    },
  }).catch(() => null);
  if (!response) throw new Error(`GITHUB_PR_LOOKUP_FAILED:${ref.owner}/${ref.repo}#${ref.number}`);
  if (!response.ok) {
    throw new Error(`GITHUB_PR_LOOKUP_FAILED:${response.status}:${ref.owner}/${ref.repo}#${ref.number}`);
  }

  const payload = await response.json().catch(() => null) as Record<string, unknown> | null;
  const base = payload?.base && typeof payload.base === 'object' && !Array.isArray(payload.base)
    ? payload.base as Record<string, unknown>
    : null;
  const head = payload?.head && typeof payload.head === 'object' && !Array.isArray(payload.head)
    ? payload.head as Record<string, unknown>
    : null;
  const baseRepo = base?.repo && typeof base.repo === 'object' && !Array.isArray(base.repo)
    ? base.repo as Record<string, unknown>
    : null;
  const baseRef = typeof base?.ref === 'string' ? base.ref : '';
  const baseSha = typeof base?.sha === 'string' ? base.sha : '';
  const headRef = typeof head?.ref === 'string' ? head.ref : '';
  const headSha = typeof head?.sha === 'string' ? head.sha : '';
  const repositoryUrl = typeof baseRepo?.clone_url === 'string'
    ? baseRepo.clone_url
    : `https://github.com/${ref.owner}/${ref.repo}.git`;
  if (!baseRef || !baseSha || !headSha) {
    throw new Error(`GITHUB_PR_LOOKUP_INVALID:${ref.owner}/${ref.repo}#${ref.number}`);
  }

  return {
    ...ref,
    title: typeof payload?.title === 'string' ? payload.title : null,
    baseRef,
    baseSha,
    headRef,
    headSha,
    repositoryUrl,
  };
}

async function normalizeGitHubRepoError(
  repoUrl: string,
  operation: 'clone' | 'fetch' | 'push',
  error: unknown,
  githubToken: string | null,
): Promise<Error> {
  const message = error instanceof Error ? error.message : String(error);
  if (!looksLikeGitHubAuthError(message)) {
    return error instanceof Error ? error : new Error(message);
  }

  const parsed = parseGitHubRepoSlug(repoUrl);
  const access = await inspectGitHubRepoAccess(repoUrl, githubToken);
  const repoSlug = access?.repoSlug || parsed?.slug || repoUrl;
  const login = access?.login || 'configured GitHub token';

  if (access?.canPull === true && access?.canPush === false) {
    return new Error(
      `TARGET_REPO_AUTH_FAILED: GitHub token for ${login} can read but cannot push branches to ${repoSlug}. Check TARGET_REPO_GITHUB_TOKEN and repo collaborator/team access.`,
    );
  }

  if (access?.canPull === false) {
    return new Error(
      `TARGET_REPO_AUTH_FAILED: GitHub token for ${login} cannot read ${repoSlug}. Check TARGET_REPO_GITHUB_TOKEN and repo access.`,
    );
  }

  if (operation === 'push') {
    return new Error(
      `TARGET_REPO_AUTH_FAILED: GitHub push failed for ${repoSlug} using ${login}. Check TARGET_REPO_GITHUB_TOKEN and repo write access. Original error: ${message}`,
    );
  }

  return new Error(
    `TARGET_REPO_AUTH_FAILED: GitHub ${operation} failed for ${repoSlug} using ${login}. Check TARGET_REPO_GITHUB_TOKEN and repo access. Original error: ${message}`,
  );
}

function buildGitHubAuthArgs(repoUrl: string, githubToken: string | null) {
  if (!repoUrl.startsWith('https://github.com/')) {
    return [];
  }

  if (!githubToken) {
    throw new Error('TARGET_REPO_AUTH_MISSING:GITHUB_TOKEN');
  }

  const basicAuth = Buffer.from(`x-access-token:${githubToken}`).toString('base64');
  return ['-c', `http.extraheader=AUTHORIZATION: basic ${basicAuth}`];
}

function isGitHubHttpsRepo(repoUrl: string) {
  return repoUrl.startsWith('https://github.com/');
}

async function runGitHubReadCommand(
  repoUrl: string,
  gitArgs: string[],
  githubToken: string | null,
  options: {
    cwd?: string;
    env?: NodeJS.ProcessEnv;
  } = {},
) {
  if (!isGitHubHttpsRepo(repoUrl)) {
    await runCommand(['git', ...gitArgs], options);
    return;
  }

  try {
    await runCommand(['git', ...gitArgs], options);
    return;
  } catch (error) {
    if (!githubToken) {
      throw error;
    }
  }

  await runCommand(['git', ...buildGitHubAuthArgs(repoUrl, githubToken), ...gitArgs], options);
}

async function runGitHubReadCapture(
  repoUrl: string,
  gitArgs: string[],
  githubToken: string | null,
  options: {
    cwd?: string;
    env?: NodeJS.ProcessEnv;
  } = {},
) {
  if (!isGitHubHttpsRepo(repoUrl)) {
    return await runCommandCapture(['git', ...gitArgs], options);
  }

  try {
    return await runCommandCapture(['git', ...gitArgs], options);
  } catch (error) {
    if (!githubToken) {
      throw error;
    }
  }

  return await runCommandCapture(['git', ...buildGitHubAuthArgs(repoUrl, githubToken), ...gitArgs], options);
}

async function runCommand(
  args: string[],
  options: {
    cwd?: string;
    env?: NodeJS.ProcessEnv;
  } = {},
) {
  return await new Promise<void>((resolve, reject) => {
    const child = spawn(args[0]!, args.slice(1), {
      cwd: options.cwd,
      env: options.env ?? process.env,
      stdio: ['ignore', 'pipe', 'pipe'],
    });

    let stderr = '';

    child.stderr.on('data', (chunk) => {
      stderr += String(chunk);
    });

    child.on('error', reject);
    child.on('close', (code) => {
      if (code === 0) {
        resolve();
        return;
      }

      reject(new Error(`${args[0]} exited with code ${code}: ${stderr.trim().slice(0, 400)}`));
    });
  });
}

async function runCommandCapture(
  args: string[],
  options: {
    cwd?: string;
    env?: NodeJS.ProcessEnv;
  } = {},
) {
  return await new Promise<string>((resolve, reject) => {
    const child = spawn(args[0]!, args.slice(1), {
      cwd: options.cwd,
      env: options.env ?? process.env,
      stdio: ['ignore', 'pipe', 'pipe'],
    });

    let stdout = '';
    let stderr = '';

    child.stdout.on('data', (chunk) => {
      stdout += String(chunk);
    });

    child.stderr.on('data', (chunk) => {
      stderr += String(chunk);
    });

    child.on('error', reject);
    child.on('close', (code) => {
      if (code === 0) {
        resolve(stdout.trim());
        return;
      }

      reject(new Error(`${args[0]} exited with code ${code}: ${stderr.trim().slice(0, 400)}`));
    });
  });
}

async function pathExists(candidatePath: string) {
  try {
    await fs.access(candidatePath);
    return true;
  } catch {
    return false;
  }
}

function buildChangeRequestBranchName(linkedChangeRequest: LinkedChangeRequestMetadata | null, fallbackSessionId: string) {
  const requestToken = linkedChangeRequest?.requestNumber
    ? `cr-${linkedChangeRequest.requestNumber}`
    : slugifySegment(linkedChangeRequest?.id || fallbackSessionId) || fallbackSessionId;
  const titleToken = slugifySegment(linkedChangeRequest?.title || '').slice(0, 40);
  return titleToken ? `codex/${requestToken}-${titleToken}` : `codex/${requestToken}`;
}

async function gitRefExists(ref: string, cwd: string) {
  try {
    await runCommand(['git', 'rev-parse', '--verify', '--quiet', ref], { cwd });
    return true;
  } catch {
    return false;
  }
}

async function captureGitState(cwd: string, baseBranch: string) {
  const [branchName, commitSha] = await Promise.all([
    runCommandCapture(['git', 'rev-parse', '--abbrev-ref', 'HEAD'], { cwd }).catch(() => ''),
    runCommandCapture(['git', 'rev-parse', 'HEAD'], { cwd }).catch(() => ''),
  ]);

  let baseCommitSha = '';
  try {
    baseCommitSha = await runCommandCapture(['git', 'merge-base', 'HEAD', `origin/${baseBranch}`], { cwd });
  } catch {
    baseCommitSha = '';
  }

  return {
    branchName: branchName || null,
    commitSha: commitSha || null,
    baseBranch: baseBranch || null,
    baseCommitSha: baseCommitSha || null,
  };
}

async function ensureGitIdentity(cwd: string, trace: CodexRuntimeResult['trace']) {
  await runCommand(['git', 'config', 'user.name', config.gitAuthorName], { cwd });
  await runCommand(['git', 'config', 'user.email', config.gitAuthorEmail], { cwd });
  await runCommand(['git', 'config', 'author.name', config.gitAuthorName], { cwd }).catch(() => undefined);
  await runCommand(['git', 'config', 'author.email', config.gitAuthorEmail], { cwd }).catch(() => undefined);
  await runCommand(['git', 'config', 'committer.name', config.gitCommitterName], { cwd }).catch(() => undefined);
  await runCommand(['git', 'config', 'committer.email', config.gitCommitterEmail], { cwd }).catch(() => undefined);
  appendTrace(
    trace,
    'git.identity',
    `Configured git identity ${config.gitAuthorName} <${config.gitAuthorEmail}>`,
  );
}

type PreparedExecutionWorkspace = {
  workspacePath: string;
  repoUrl: string | null;
  branchName: string | null;
  commitSha: string | null;
  baseBranch: string | null;
  baseCommitSha: string | null;
};

async function preparePullRequestReviewWorkspace(
  input: CodexRuntimeInput,
  pullRequestRef: GitHubPullRequestRef,
  trace: CodexRuntimeResult['trace'],
  githubToken: string | null,
): Promise<PreparedExecutionWorkspace> {
  const pullRequest = await inspectGitHubPullRequest(pullRequestRef, githubToken);
  const targetSlug = slugifySegment(`${pullRequest.owner}-${pullRequest.repo}`) || 'github-pr';
  const workspacePath = path.resolve(config.targetWorkspaceRoot, 'reviews', targetSlug, `pr-${pullRequest.number}`);
  const gitDir = path.join(workspacePath, '.git');
  await fs.mkdir(path.dirname(workspacePath), { recursive: true });

  if (!(await pathExists(gitDir))) {
    appendTrace(trace, 'workspace.clone', `Cloning ${pullRequest.owner}/${pullRequest.repo} for PR #${pullRequest.number}`);
    try {
      await runGitHubReadCommand(pullRequest.repositoryUrl, [
        'clone', '--no-checkout', pullRequest.repositoryUrl, workspacePath,
      ], githubToken);
    } catch (error) {
      throw await normalizeGitHubRepoError(pullRequest.repositoryUrl, 'clone', error, githubToken);
    }
  } else {
    appendTrace(trace, 'workspace.reuse', `Refreshing review workspace for ${pullRequest.owner}/${pullRequest.repo}#${pullRequest.number}`);
    await runCommand(['git', 'remote', 'set-url', 'origin', pullRequest.repositoryUrl], { cwd: workspacePath }).catch(() => undefined);
  }

  const reviewRef = `refs/remotes/origin/pr-${pullRequest.number}`;
  try {
    await runGitHubReadCommand(pullRequest.repositoryUrl, [
      'fetch', '--force', 'origin',
      `+refs/heads/${pullRequest.baseRef}:refs/remotes/origin/${pullRequest.baseRef}`,
      `+refs/pull/${pullRequest.number}/head:${reviewRef}`,
    ], githubToken, { cwd: workspacePath });
  } catch (error) {
    throw await normalizeGitHubRepoError(pullRequest.repositoryUrl, 'fetch', error, githubToken);
  }
  await runCommand(['git', 'checkout', '--detach', reviewRef], { cwd: workspacePath });
  const checkedOutHead = await runCommandCapture(['git', 'rev-parse', 'HEAD'], { cwd: workspacePath });
  if (checkedOutHead !== pullRequest.headSha) {
    throw new Error(`GITHUB_PR_HEAD_MISMATCH:expected=${pullRequest.headSha}:actual=${checkedOutHead}`);
  }

  input.metadata = {
    ...(input.metadata ?? {}),
    linkedPullRequest: pullRequest,
  };
  appendTrace(trace, 'workspace.review_ready', `Checked out ${pullRequest.owner}/${pullRequest.repo}#${pullRequest.number} at ${pullRequest.headSha}`);
  return {
    workspacePath,
    repoUrl: pullRequest.repositoryUrl,
    branchName: pullRequest.headRef || `pull/${pullRequest.number}/head`,
    commitSha: pullRequest.headSha,
    baseBranch: pullRequest.baseRef,
    baseCommitSha: pullRequest.baseSha,
  };
}

async function prepareExecutionWorkspace(
  input: CodexRuntimeInput,
  trace: CodexRuntimeResult['trace'],
  githubToken: string | null,
) : Promise<PreparedExecutionWorkspace> {
  const directPullRequest = isReviewerExecution(input) ? extractGitHubPullRequestRef(input) : null;
  if (directPullRequest && !shouldHydrateExternalWorkspace(input.metadata)) {
    return await preparePullRequestReviewWorkspace(input, directPullRequest, trace, githubToken);
  }

  if (!shouldHydrateExternalWorkspace(input.metadata)) {
    return {
      workspacePath: config.codexWorkspaceRoot,
      repoUrl: null,
      branchName: null,
      commitSha: null,
      baseBranch: null,
      baseCommitSha: null,
    };
  }

  const targetApp = parseLinkedTargetApp(input.metadata);
  const targetEnvironment = parseLinkedTargetEnvironment(input.metadata);
  const linkedChangeRequest = parseLinkedChangeRequest(input.metadata);
  const linkedLatestExecution = parseLinkedLatestExecution(input.metadata);

  if (!targetApp?.repoUrl || typeof targetApp.repoUrl !== 'string') {
    appendTrace(trace, 'workspace.default', `Using default workspace ${config.codexWorkspaceRoot}`);
    return {
      workspacePath: config.codexWorkspaceRoot,
      repoUrl: null,
      branchName: null,
      commitSha: null,
      baseBranch: null,
      baseCommitSha: null,
    };
  }

  const targetSlug = slugifySegment(targetApp.slug || targetApp.name || 'target-app') || 'target-app';
  const requestSlug = linkedChangeRequest?.requestNumber
    ? `cr-${linkedChangeRequest.requestNumber}`
    : slugifySegment(linkedChangeRequest?.id || input.sessionId) || input.sessionId;
  const repoBranch =
    (typeof targetEnvironment?.branch === 'string' && targetEnvironment.branch.trim())
    || (typeof targetApp.defaultBranch === 'string' && targetApp.defaultBranch.trim())
    || 'main';
  const workspacePath = path.resolve(config.targetWorkspaceRoot, targetSlug, requestSlug);
  const gitDir = path.join(workspacePath, '.git');
  const changeRequestBranch =
    (typeof linkedLatestExecution?.branchName === 'string' && linkedLatestExecution.branchName.trim())
    || buildChangeRequestBranchName(linkedChangeRequest, input.sessionId);

  await fs.mkdir(path.dirname(workspacePath), { recursive: true });

  if (!(await pathExists(gitDir))) {
    appendTrace(trace, 'workspace.clone', `Cloning ${targetApp.repoUrl} into ${workspacePath}`);
    try {
      await runGitHubReadCommand(targetApp.repoUrl, [
        'clone',
        '--branch',
        repoBranch,
        '--single-branch',
        targetApp.repoUrl,
        workspacePath,
      ], githubToken);
    } catch (error) {
      throw await normalizeGitHubRepoError(targetApp.repoUrl, 'clone', error, githubToken);
    }
  } else {
    appendTrace(trace, 'workspace.reuse', `Reusing existing workspace ${workspacePath}`);
    const remoteOriginUrl = targetApp.repoUrl;
    await runCommand(['git', 'remote', 'set-url', 'origin', remoteOriginUrl], { cwd: workspacePath }).catch(() => undefined);
    await runGitHubReadCommand(remoteOriginUrl, ['fetch', 'origin', repoBranch, changeRequestBranch], githubToken, { cwd: workspacePath }).catch((error) => {
      appendTrace(trace, 'workspace.fetch_failed', error instanceof Error ? error.message : 'git fetch failed');
    });
  }

  const localBranchRef = `refs/heads/${changeRequestBranch}`;
  const remoteBranchRef = `refs/remotes/origin/${changeRequestBranch}`;
  const localBranchExists = await gitRefExists(localBranchRef, workspacePath);
  const remoteBranchExists = await gitRefExists(remoteBranchRef, workspacePath);

  if (localBranchExists) {
    appendTrace(trace, 'branch.checkout', `Checking out existing local branch ${changeRequestBranch}`);
    await runCommand(['git', 'checkout', changeRequestBranch], { cwd: workspacePath });

    if (remoteBranchExists) {
      appendTrace(trace, 'branch.fast_forward', `Fast-forwarding ${changeRequestBranch} from origin/${changeRequestBranch}`);
      await runCommand(['git', 'merge', '--ff-only', remoteBranchRef], { cwd: workspacePath }).catch((error) => {
        appendTrace(trace, 'branch.fast_forward_failed', error instanceof Error ? error.message : 'git ff-only merge failed');
      });
    }
  } else if (remoteBranchExists) {
    appendTrace(trace, 'branch.checkout_remote', `Creating local branch ${changeRequestBranch} from origin/${changeRequestBranch}`);
    await runCommand(['git', 'checkout', '-B', changeRequestBranch, remoteBranchRef], { cwd: workspacePath });
  } else {
    appendTrace(trace, 'branch.create', `Creating new CR branch ${changeRequestBranch} from origin/${repoBranch}`);
    await runCommand(['git', 'checkout', '-B', changeRequestBranch, `origin/${repoBranch}`], { cwd: workspacePath });
  }

  await ensureGitIdentity(workspacePath, trace);

  const gitState = await captureGitState(workspacePath, repoBranch);
  appendTrace(trace, 'workspace.ready', `Using execution workspace ${workspacePath}`);
  return {
    workspacePath,
    repoUrl: targetApp.repoUrl,
    branchName: gitState.branchName,
    commitSha: gitState.commitSha,
    baseBranch: gitState.baseBranch,
    baseCommitSha: gitState.baseCommitSha,
  };
}

function buildBranchUrl(repoUrl: string | null, branchName: string | null) {
  if (!repoUrl || !branchName) {
    return null;
  }

  const githubMatch = repoUrl.match(/^https:\/\/github\.com\/([^/]+)\/([^/.]+)(?:\.git)?$/);
  if (!githubMatch) {
    return null;
  }

  const [, owner, repo] = githubMatch;
  return `https://github.com/${owner}/${repo}/tree/${encodeURIComponent(branchName)}`;
}

async function gitHasChanges(cwd: string) {
  const status = await runCommandCapture(['git', 'status', '--porcelain'], { cwd }).catch(() => '');
  return Boolean(status.trim());
}

async function gitHasTrackedChanges(cwd: string) {
  const status = await runCommandCapture(['git', 'status', '--porcelain', '--untracked-files=no'], { cwd }).catch(() => '');
  return Boolean(status.trim());
}

export function isReviewerExecution(input: Pick<CodexRuntimeInput, 'metadata'>) {
  const profile = input.metadata?.agentProfile;
  return Boolean(
    profile
    && typeof profile === 'object'
    && !Array.isArray(profile)
    && (profile as Record<string, unknown>).executionMode === 'reviewer',
  );
}

async function remoteBranchExists(repoUrl: string, branchName: string, cwd: string, githubToken: string | null) {
  const output = await runGitHubReadCapture(
    repoUrl,
    ['ls-remote', '--heads', repoUrl, branchName],
    githubToken,
    { cwd },
  ).catch(() => '');
  return Boolean(output.trim());
}

function buildChangeRequestCommitMessage(input: CodexRuntimeInput) {
  const linkedChangeRequest = parseLinkedChangeRequest(input.metadata);
  const requestNumber = linkedChangeRequest?.requestNumber ? `CR #${linkedChangeRequest.requestNumber}` : 'CR update';
  const title = linkedChangeRequest?.title?.trim() || input.prompt.trim().slice(0, 72) || 'workspace update';
  return `${requestNumber}: ${title}`;
}

export async function finalizeGitWorkspace(
  input: CodexRuntimeInput,
  preparedWorkspace: PreparedExecutionWorkspace,
  trace: CodexRuntimeResult['trace'],
  githubToken: string | null,
) {
  const workspacePath = preparedWorkspace.workspacePath;
  const profile = input.metadata?.agentProfile;
  const verification = Boolean(profile && typeof profile === 'object' && !Array.isArray(profile)
    && (profile as Record<string, unknown>).executionMode === 'verifier');
  if (isReviewerExecution(input) || verification) {
    if (await gitHasTrackedChanges(workspacePath)) {
      appendTrace(trace, verification ? 'git.verify_modified' : 'git.review_modified', 'Independent evaluator modified tracked repository files; refusing to commit or push');
      throw new Error(verification ? 'VERIFIER_TRACKED_WORKSPACE_MODIFIED' : 'REVIEWER_TRACKED_WORKSPACE_MODIFIED');
    }
    appendTrace(trace, verification ? 'git.verify_readonly' : 'git.review_readonly', 'Independent evaluator left tracked files unchanged; skipped commit and push');
    return await captureGitState(workspacePath, preparedWorkspace.baseBranch || 'main').catch(() => preparedWorkspace);
  }

  if (!preparedWorkspace.repoUrl || preparedWorkspace.workspacePath === config.codexWorkspaceRoot) {
    return await captureGitState(
      preparedWorkspace.workspacePath,
      preparedWorkspace.baseBranch || 'main',
    ).catch(() => preparedWorkspace);
  }

  const currentBranch = await runCommandCapture(['git', 'rev-parse', '--abbrev-ref', 'HEAD'], { cwd: workspacePath })
    .catch(() => preparedWorkspace.branchName || '');

  if (!currentBranch) {
    return await captureGitState(workspacePath, preparedWorkspace.baseBranch || 'main').catch(() => preparedWorkspace);
  }

  if (await gitHasChanges(workspacePath)) {
    appendTrace(trace, 'git.commit', `Committing workspace changes on ${currentBranch}`);
    await runCommand(['git', 'add', '-A'], { cwd: workspacePath });
    await runCommand(['git', 'commit', '-m', buildChangeRequestCommitMessage(input)], { cwd: workspacePath });
  } else {
    appendTrace(trace, 'git.clean', `No uncommitted changes detected on ${currentBranch}`);
  }

  appendTrace(trace, 'git.push', `Pushing ${currentBranch} to origin`);
  try {
    await runCommand(
      ['git', ...buildGitHubAuthArgs(preparedWorkspace.repoUrl, githubToken), 'push', '-u', 'origin', currentBranch],
      { cwd: workspacePath },
    );
  } catch (error) {
    throw await normalizeGitHubRepoError(preparedWorkspace.repoUrl, 'push', error, githubToken);
  }

  const pushed = await remoteBranchExists(preparedWorkspace.repoUrl, currentBranch, workspacePath, githubToken);
  if (!pushed) {
    throw new Error(`GIT_PUSH_VERIFICATION_FAILED:${currentBranch}`);
  }
  appendTrace(trace, 'git.push_succeeded', `Verified remote branch ${currentBranch} on origin`);

  const gitState = await captureGitState(workspacePath, preparedWorkspace.baseBranch || 'main').catch(() => preparedWorkspace);
  return {
    ...gitState,
    branchUrl: buildBranchUrl(preparedWorkspace.repoUrl, gitState.branchName),
  };
}

type LoadedPrismSkills = Awaited<ReturnType<typeof loadRelevantPrismSkills>>;

function recordValue(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

export function workflowDelegationPolicy(
  input: Pick<CodexRuntimeInput, 'metadata'>,
): WorkflowDelegationPolicy | null {
  const workflow = recordValue(input.metadata?.workflow);
  if (!workflow) return null;
  const agentConfig = recordValue(workflow.agentConfig);
  const delegation = recordValue(agentConfig?.delegation);
  if (delegation?.allowed !== true) return { allowed: false, maxAgents: 0 };

  const requestedMax = typeof delegation.maxAgents === 'number' && Number.isInteger(delegation.maxAgents)
    ? delegation.maxAgents
    : 1;
  if (requestedMax < 1) return { allowed: false, maxAgents: 0 };
  return { allowed: true, maxAgents: Math.min(requestedMax, 8) };
}

export function buildPrompt(
  input: CodexRuntimeInput,
  isResume: boolean,
  prismSkills: LoadedPrismSkills,
) {
  const isReadOnlyUtility = input.authorityMode === 'read_only_utility';
  const isReviewer = isReviewerExecution(input);
  const delegation = workflowDelegationPolicy(input);
  const history = input.recentHistory
    .slice(-20)
    .map((entry) => `${entry.role === 'assistant' ? 'Assistant' : 'User'}: ${entry.content}`)
    .join('\n');
  const policyInstructions = typeof input.metadata?.policyInstructions === 'string'
    ? input.metadata.policyInstructions.trim().slice(0, 40_000)
    : '';
  const sessionMetadata = Object.fromEntries(
    Object.entries(input.metadata ?? {}).filter(([key]) => key !== 'policyInstructions'),
  );

  const fixedSections = [
    'You are Codex replying through a transport adapter.',
    'Behave like direct Codex chat, not like a fixed retrieval bot.',
    'Keep replies concise unless the user asks for more detail.',
    'Prism memory is optional. Only use it if it materially helps answer the user.',
    ...(isReadOnlyUtility
      ? [
          'This is a runtime-enforced read-only utility invocation. Inspect and explain only.',
          'Do not modify files, repository state, workflows, requests, external services, or other persistent state.',
          'No Site, adapter, Gateway, or repository mutation credentials are available.',
        ]
      : [
          'If Prism memory is useful, query it from the shell with curl against $PRISM_API_BASE and send X-Prism-Api-Key using $PRISM_API_READ_KEY or $PRISM_API_KEY.',
        ]),
    ...(isReviewer
      ? [
          'This is a reviewer execution. Do not modify tracked repository files.',
          'The runtime will never auto-commit or push this review, and it will fail the run if tracked files are changed.',
        ]
      : []),
    ...(delegation?.allowed
      ? [
          `This workflow step permits at most ${delegation.maxAgents} concurrently open subagent threads. Delegate only independent, bounded work and keep integration, final validation, and external mutations in the parent run.`,
        ]
      : delegation
        ? ['Subagent delegation is disabled for this workflow step. Complete the work in the parent run.']
        : []),
    'Prism skills are authoritative when they apply. Select relevant Site-hosted skills through Codex native skill discovery before probing ad hoc local paths or browser admin routes.',
    ...(isReadOnlyUtility
      ? []
      : ['Do not treat missing local files under /data/codex/skills, /data/workflows, or /app as a blocker for Prism-managed content. Skills, workflows, tasks, hooks, artifacts, and settings are owned by the site service and should be managed through /agent/* routes with service-token auth.']),
    'Avoid unnecessary tool use. Return only the assistant reply text.',
    '',
    `External session id: ${input.sessionId}`,
    `Runtime mode: ${isResume ? 'resume' : 'start'}`,
  ];
  const sections = [...fixedSections];
  if (!isReadOnlyUtility) sections.push('', browserToolInstructions);

  if (policyInstructions) {
    sections.push('', 'Trusted transport policy instructions:', policyInstructions);
  }

  if (Object.keys(sessionMetadata).length) {
    sections.push(`Session metadata: ${JSON.stringify(sessionMetadata)}`);
  }

  if (prismSkills.selectedSkills.length) {
    for (const skill of prismSkills.selectedSkills) {
      sections.push('', `Prism skill loaded: ${skill.name}`, skill.content.trim());
    }
  }

  if (history) {
    sections.push('', 'Recent source conversation snapshot:', history);
  }

  sections.push('', `Latest user message: ${input.prompt}`);
  const prompt = sections.join('\n');
  const bytes = (value: string | null | undefined) => Buffer.byteLength(value ?? '', 'utf8');
  return {
    prompt,
    metrics: {
      totalBytes: bytes(prompt),
      sectionBytes: {
        fixed: bytes(fixedSections.join('\n')),
        metadata: bytes(JSON.stringify(sessionMetadata)) + bytes(policyInstructions),
        skillCatalog: 0,
        selectedSkills: prismSkills.selectedSkills.reduce((total, skill) => total + bytes(skill.content), 0),
        history: bytes(history),
        latestMessage: bytes(input.prompt),
      },
      selectedSkillCount: prismSkills.selectedSkills.length,
      historyMessageCount: input.recentHistory.slice(-20).length,
      transport: 'stdin',
    },
  };
}

function parseJsonEvent(rawLine: string) {
  try {
    return JSON.parse(rawLine) as CodexJsonEvent;
  } catch {
    return null;
  }
}

export function codexSubagentTraceEvent(event: CodexJsonEvent) {
  const item = event.item;
  if (!item || item.type !== 'collab_tool_call' || typeof item.tool !== 'string') return null;
  if (!['item.started', 'item.updated', 'item.completed'].includes(event.type ?? '')) return null;

  const phase = event.type === 'item.started' ? 'started' : event.type === 'item.updated' ? 'updated' : 'completed';
  const tool = item.tool.trim().toLowerCase();
  const receivers = Array.from(new Set([
    ...(Array.isArray(item.receiver_thread_ids) ? item.receiver_thread_ids : []),
    ...Object.keys(item.agents_states ?? {}),
  ].filter(Boolean)));
  const details = [
    item.id ? `item=${item.id}` : null,
    item.sender_thread_id ? `parent=${item.sender_thread_id}` : null,
    receivers.length ? `children=${receivers.join(',')}` : null,
    item.status ? `status=${item.status}` : null,
  ].filter(Boolean).join('; ');
  const label = tool === 'spawn_agent' ? 'spawn' : tool === 'send_input' ? 'message' : tool;
  return {
    kind: `subagent.${label}_${phase}`,
    message: `${tool} ${phase}${details ? `; ${details}` : ''}`,
  };
}

export function codexRolloutSubagentTraceEvents(rawJsonl: string) {
  const events: Array<{ kind: string; message: string }> = [];
  const seen = new Set<string>();
  for (const line of rawJsonl.split('\n')) {
    if (!line.trim()) continue;
    let record: Record<string, unknown>;
    try {
      record = JSON.parse(line) as Record<string, unknown>;
    } catch {
      continue;
    }
    const payload = recordValue(record.payload);
    const item = recordValue(payload?.item);
    if (record.type !== 'event_msg' || payload?.type !== 'item_completed' || item?.type !== 'SubAgentActivity') {
      continue;
    }
    const activity = typeof item.kind === 'string' ? item.kind.trim().toLowerCase() : '';
    if (activity !== 'started' && activity !== 'completed') continue;
    const child = typeof item.agent_thread_id === 'string' ? item.agent_thread_id.trim() : '';
    const agentPath = typeof item.agent_path === 'string' ? item.agent_path.trim() : '';
    const key = `${activity}:${child}:${agentPath}`;
    if (seen.has(key)) continue;
    seen.add(key);
    const details = [child ? `child=${child}` : null, agentPath ? `agent=${agentPath}` : null]
      .filter(Boolean)
      .join('; ');
    events.push({
      kind: `subagent.activity_${activity}`,
      message: `subagent ${activity}${details ? `; ${details}` : ''}`,
    });
  }
  return events;
}

async function findCodexRolloutFile(directory: string, threadId: string, depth = 0): Promise<string | null> {
  if (depth > 5) return null;
  const entries = await fs.readdir(directory, { withFileTypes: true }).catch(() => []);
  for (const entry of entries) {
    if (entry.isFile() && entry.name.includes(threadId) && entry.name.endsWith('.jsonl')) {
      return path.join(directory, entry.name);
    }
  }
  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    const found = await findCodexRolloutFile(path.join(directory, entry.name), threadId, depth + 1);
    if (found) return found;
  }
  return null;
}

async function recordRolloutSubagentProvenance(
  threadId: string,
  env: NodeJS.ProcessEnv,
  trace: CodexRuntimeResult['trace'],
  onTrace?: (trace: CodexRuntimeResult['trace']) => void,
) {
  const codexHome = env.CODEX_HOME?.trim() || path.join(env.HOME || os.homedir(), '.codex');
  const rolloutFile = await findCodexRolloutFile(path.join(codexHome, 'sessions'), threadId);
  if (!rolloutFile) return;
  const stats = await fs.stat(rolloutFile).catch(() => null);
  if (!stats || stats.size > 25 * 1024 * 1024) return;
  const rawJsonl = await fs.readFile(rolloutFile, 'utf8').catch(() => '');
  for (const event of codexRolloutSubagentTraceEvents(rawJsonl)) {
    const duplicate = trace.some((entry) => entry.kind === event.kind && entry.message === event.message);
    if (!duplicate) appendTrace(trace, event.kind, event.message, onTrace);
  }
}

function codexEventErrorMessage(event: ReturnType<typeof parseJsonEvent>) {
  if (!event) {
    return null;
  }

  if (event.type === 'error') {
    return typeof event.message === 'string'
      ? event.message
      : typeof event.error === 'string'
        ? event.error
        : event.error?.message ?? null;
  }

  if (event.type === 'turn.failed') {
    return typeof event.error === 'string' ? event.error : event.error?.message ?? null;
  }

  return null;
}

function meaningfulStderr(stderr: string) {
  return stderr
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line && line !== 'Reading additional input from stdin...')
    .join('\n')
    .trim();
}

function appendTrace(
  trace: CodexRuntimeResult['trace'],
  kind: string,
  message: string,
  onTrace?: (trace: CodexRuntimeResult['trace']) => void,
) {
  trace.push({
    at: new Date().toISOString(),
    kind,
    message: message.slice(0, 500),
  });

  while (trace.length > 80) {
    const removableIndex = trace.findIndex((entry) => !entry.kind.startsWith('subagent.'));
    trace.splice(removableIndex >= 0 ? removableIndex : 0, 1);
  }
  onTrace?.([...trace]);
}

function booleanMetadata(metadata: Record<string, unknown> | undefined, key: string) {
  return metadata?.[key] === true;
}

const readOnlyEnvironmentKeys = [
  'PATH', 'HOME', 'USER', 'LOGNAME', 'TMPDIR', 'TMP', 'TEMP', 'LANG', 'LC_ALL', 'LC_CTYPE', 'TZ',
  'SSL_CERT_FILE', 'SSL_CERT_DIR', 'NODE_EXTRA_CA_CERTS',
  'HTTP_PROXY', 'HTTPS_PROXY', 'ALL_PROXY', 'NO_PROXY',
  'http_proxy', 'https_proxy', 'all_proxy', 'no_proxy',
  // Provider authentication is the sole credential class allowed in this mode.
  'OPENAI_API_KEY', 'CODEX_API_KEY', 'OPENAI_BASE_URL', 'OPENAI_ORGANIZATION',
  'OPENAI_ORG_ID', 'OPENAI_PROJECT_ID', 'AZURE_OPENAI_API_KEY',
  'AZURE_OPENAI_ENDPOINT', 'AZURE_OPENAI_API_VERSION',
] as const;

export function buildCodexChildEnvironment(
  authorityMode: 'full' | 'read_only_utility',
  inherited: NodeJS.ProcessEnv,
  leasedEnv: Record<string, string>,
  githubToken: string | null,
  runtimeHome?: string,
) {
  if (authorityMode === 'read_only_utility') {
    const env: NodeJS.ProcessEnv = {};
    for (const key of readOnlyEnvironmentKeys) {
      if (inherited[key]) env[key] = inherited[key];
    }
    if (config.codexHome) env.CODEX_HOME = config.codexHome;
    return env;
  }

  const env: NodeJS.ProcessEnv = {
    ...inherited,
    ...leasedEnv,
    ...(runtimeHome ? { HOME: runtimeHome } : {}),
    ...browserToolEnvironment,
    GIT_AUTHOR_NAME: config.gitAuthorName,
    GIT_AUTHOR_EMAIL: config.gitAuthorEmail,
    GIT_COMMITTER_NAME: config.gitCommitterName,
    GIT_COMMITTER_EMAIL: config.gitCommitterEmail,
    ...(config.codexHome ? { CODEX_HOME: config.codexHome } : {}),
    ...(config.appApiBaseUrl ? { PRISM_AGENT_API_BASE_URL: config.appApiBaseUrl } : {}),
    ...(config.appServiceToken ? { PRISM_AGENT_SERVICE_TOKEN: config.appServiceToken } : {}),
    ...(githubToken
      ? {
          TARGET_REPO_GITHUB_TOKEN: githubToken,
          GITHUB_TOKEN: inherited.GITHUB_TOKEN?.trim() || githubToken,
          GH_TOKEN: inherited.GH_TOKEN?.trim() || githubToken,
        }
      : {}),
  };
  delete env.PRISM_GATEWAY_TOKEN;
  return env;
}

export function buildCodexArgs(
  input: Pick<CodexRuntimeInput, 'codexThreadId' | 'authorityMode' | 'metadata'>,
  outputFile: string,
  executionWorkspaceRoot: string,
) {
  const isResume = Boolean(input.codexThreadId);
  const delegation = workflowDelegationPolicy(input);
  const delegationArgs = delegation?.allowed
    ? ['-c', 'agents.enabled=true', '-c', `agents.max_concurrent_threads_per_session=${delegation.maxAgents}`]
    : delegation
      ? ['-c', 'agents.enabled=false']
      : [];
  if (input.authorityMode === 'read_only_utility') {
    // This mode is intentionally text-in/text-out: the evidence required to
    // answer must be supplied in the prompt. Disabling every model-facing
    // execution/integration surface keeps provider auth usable by the CLI
    // without making it observable to the model through a tool.
    const disabledFeatures = [
      'shell_tool', 'unified_exec', 'code_mode', 'code_mode_host',
      'browser_use', 'browser_use_external', 'browser_use_full_cdp_access', 'in_app_browser', 'computer_use',
      'apps', 'enable_mcp_apps', 'hooks', 'image_generation',
      'multi_agent', 'multi_agent_v2', 'remote_plugin', 'plugin_sharing',
      'skill_mcp_dependency_install', 'tool_suggest',
      'auth_elicitation', 'tool_call_mcp_elicitation',
    ].flatMap((feature) => ['--disable', feature]);
    return [
      'exec', '--json', '--skip-git-repo-check', '--sandbox', 'read-only',
      '--ephemeral', '--ignore-user-config', '--ignore-rules',
      '-c', 'mcp_servers={}',
      '-c', 'agents.enabled=false',
      ...disabledFeatures,
      '-o', outputFile, '-C', executionWorkspaceRoot,
    ];
  }
  return isResume
    ? ['exec', 'resume', input.codexThreadId!, '--json', '--skip-git-repo-check', '--dangerously-bypass-approvals-and-sandbox', ...delegationArgs, '-o', outputFile]
    : ['exec', '--json', '--skip-git-repo-check', '--dangerously-bypass-approvals-and-sandbox', ...delegationArgs, '-o', outputFile, '-C', executionWorkspaceRoot];
}

function emptyResponseFallback(input: CodexRuntimeInput) {
  if (!booleanMetadata(input.metadata, 'allowEmptyResponse')) {
    return null;
  }

  const taskKey = typeof input.metadata?.taskKey === 'string' && input.metadata.taskKey.trim()
    ? input.metadata.taskKey.trim()
    : null;
  return taskKey
    ? `Task ${taskKey} completed without returning assistant text.`
    : 'Codex completed without returning assistant text.';
}

async function runCodexProcess(input: CodexRuntimeInput) {
  const outputFile = path.join(os.tmpdir(), `codex-runtime-${randomUUID()}.txt`);
  const isResume = Boolean(input.codexThreadId);
  const trace: CodexRuntimeResult['trace'] = [];
  const authorityMode = input.authorityMode ?? 'full';
  const prismSkills: LoadedPrismSkills = authorityMode === 'read_only_utility'
    ? { availableSkills: [], selectedSkills: [] }
    : await loadRelevantPrismSkills(input.prompt, input.metadata);
  const effectiveCredentials = Array.from(new Set([
    ...(input.credentials ?? []),
    ...prismSkills.selectedSkills.flatMap((skill) => skill.requiredCredentials),
  ]));
  const credentialLeaseKeys = authorityMode === 'read_only_utility' ? [] : effectiveCredentials;
  const lease = credentialLeaseKeys.length
    ? await gatewayClient.leaseCredentials({
        credentials: credentialLeaseKeys,
        context: input.gatewayContext || {},
      })
    : { env: {} };
  const leasedEnv = lease.env;
  const githubToken = authorityMode === 'read_only_utility'
    ? null
    : leasedEnv.TARGET_REPO_GITHUB_TOKEN || config.githubToken;
  const preparedWorkspace = authorityMode === 'read_only_utility'
    ? {
        workspacePath: config.codexWorkspaceRoot,
        repoUrl: null,
        branchName: null,
        commitSha: null,
        baseBranch: null,
        baseCommitSha: null,
      }
    : await prepareExecutionWorkspace(input, trace, githubToken);
  input.onTrace?.([...trace]);
  const executionWorkspaceRoot = preparedWorkspace.workspacePath;
  const composedPrompt = buildPrompt(input, isResume, prismSkills);
  const prompt = composedPrompt.prompt;
  const args = buildCodexArgs(input, outputFile, executionWorkspaceRoot);
  const modelPolicy = resolveCodexModelPolicy({
    tier: input.modelTier ?? null,
    defaultModel: config.codexModel,
    economyModel: config.codexModelEconomy,
    standardModel: config.codexModelStandard,
    deepModel: config.codexModelDeep,
    economyReasoningEffort: config.codexReasoningEffortEconomy,
    standardReasoningEffort: config.codexReasoningEffortStandard,
    deepReasoningEffort: config.codexReasoningEffortDeep,
  });

  if (authorityMode === 'full' && config.codexImageGenerationEnabled) {
    args.push('--enable', 'image_generation');
  }

  if (modelPolicy.model) {
    args.push('-m', modelPolicy.model);
  }
  if (modelPolicy.reasoningEffort) {
    args.push('-c', `model_reasoning_effort=${JSON.stringify(modelPolicy.reasoningEffort)}`);
  }

  args.push('-');

  appendTrace(trace, 'prompt.composed', JSON.stringify(composedPrompt.metrics), input.onTrace);
  appendTrace(trace, 'model.selected', JSON.stringify(modelPolicy), input.onTrace);
  if (config.codexRuntimePromptWarnBytes && composedPrompt.metrics.totalBytes > config.codexRuntimePromptWarnBytes) {
    appendTrace(
      trace,
      'prompt.warning',
      JSON.stringify({ totalBytes: composedPrompt.metrics.totalBytes, warnBytes: config.codexRuntimePromptWarnBytes }),
      input.onTrace,
    );
  }
  if (config.codexRuntimePromptMaxBytes && composedPrompt.metrics.totalBytes > config.codexRuntimePromptMaxBytes) {
    const error = new Error(`RUNTIME_PROMPT_TOO_LARGE:${JSON.stringify(composedPrompt.metrics)}`) as CodexRuntimeError;
    error.trace = trace;
    throw error;
  }

  const nativeSkillHome = authorityMode === 'read_only_utility'
    ? null
    : await createNativePrismSkillHome(process.env.HOME || os.homedir(), prismSkills, input.metadata);
  const env = buildCodexChildEnvironment(authorityMode, process.env, leasedEnv, githubToken, nativeSkillHome?.path);
  const invocationMetrics = processInvocationSizeMetrics(env, args);
  console.log(
    `[codex-runtime] spawn resume=${isResume ? 'yes' : 'no'} session=${input.sessionId} workspace=${executionWorkspaceRoot}`,
  );
  if (nativeSkillHome) {
    appendTrace(
      trace,
      'skills.native_ready',
      `Exposed ${nativeSkillHome.skillCount} Site-hosted skills through Codex native discovery`,
      input.onTrace,
    );
    if (nativeSkillHome.failedSkillNames.length) {
      appendTrace(
        trace,
        'skills.native_partial',
        `Skipped ${nativeSkillHome.failedSkillNames.length} unavailable hosted skill bundles`,
        input.onTrace,
      );
    }
  }

  try {
    return await new Promise<CodexRuntimeResult>((resolve, reject) => {
      const child = spawn(config.codexBinary, args, {
      cwd: executionWorkspaceRoot,
      env,
      stdio: ['pipe', 'pipe', 'pipe'],
    });

    let stderr = '';
    let stdoutBuffer = '';
    let threadId = input.codexThreadId ?? null;
    let lastAgentText = '';
    let runtimeErrorMessage = '';
    let settled = false;

    const recordTrace = (kind: string, message: string) => appendTrace(trace, kind, message, input.onTrace);

    recordTrace('run.started', isResume ? 'Resuming Codex thread' : 'Starting Codex thread');

    const cancelRun = () => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      input.signal?.removeEventListener('abort', cancelRun);
      child.kill('SIGTERM');
      child.stdin.destroy();
      const forceKill = setTimeout(() => {
        if (child.exitCode === null && child.signalCode === null) child.kill('SIGKILL');
      }, 5_000);
      forceKill.unref();
      void fs.unlink(outputFile).catch(() => undefined);
      recordTrace('run.canceled', 'Codex runtime job was canceled');
      const error = new Error('RUNTIME_JOB_CANCELED') as CodexRuntimeError;
      error.codexThreadId = threadId;
      error.trace = trace;
      reject(error);
    };

    const workflowConfig = recordValue(recordValue(input.metadata?.workflow)?.agentConfig);
    const limits = resolveRunBudget(workflowConfig?.executionBudget, {
      idleMs: config.codexRuntimeIdleTimeoutMs, maxMs: config.codexRuntimeMaxDurationMs,
    });
    const budget = new RunBudget(Date.now(), limits.idleMs, limits.maxMs);
    recordTrace('run.budget', `Idle timeout ${budget.idleMs}ms; maximum duration ${budget.maxMs}ms`);
    const timeout = setInterval(() => {
      if (settled) return;
      const reason = budget.expired(Date.now());
      if (!reason) return;
      settled = true;
      clearInterval(timeout);
      input.signal?.removeEventListener('abort', cancelRun);
      child.kill('SIGTERM');
      child.stdin.destroy();
      const forceKill = setTimeout(() => {
        if (child.exitCode === null && child.signalCode === null) child.kill('SIGKILL');
      }, 5_000);
      forceKill.unref();
      const error = new Error(reason === 'idle' ? 'CODEX_RUNTIME_IDLE_TIMEOUT' : 'CODEX_RUNTIME_BUDGET_EXCEEDED') as CodexRuntimeError;
      error.codexThreadId = threadId;
      error.trace = trace;
      recordTrace('run.timeout', `Codex runtime ${reason === 'idle' ? 'stopped making progress' : 'exhausted its maximum duration'} before completion`);
      reject(error);
    }, 1_000);

    if (input.signal?.aborted) {
      cancelRun();
      return;
    }
    input.signal?.addEventListener('abort', cancelRun, { once: true });

    child.stdin.on('error', (stdinError) => {
      if (settled || child.exitCode !== null || child.signalCode !== null) return;
      settled = true;
      clearTimeout(timeout);
      input.signal?.removeEventListener('abort', cancelRun);
      child.kill('SIGTERM');
      recordTrace('prompt.stdin_failed', 'Codex prompt delivery through stdin failed');
      const error = new Error(`RUNTIME_PROMPT_STDIN_FAILED:${stdinError.message}`) as CodexRuntimeError;
      error.codexThreadId = threadId;
      error.trace = trace;
      reject(error);
    });
    child.stdin.end(prompt, 'utf8');

    child.stdout.on('data', (chunk) => {
      stdoutBuffer += String(chunk);
      const lines = stdoutBuffer.split('\n');
      stdoutBuffer = lines.pop() ?? '';

      for (const line of lines) {
        const event = parseJsonEvent(line.trim());
        if (!event) continue;
        if (isExecutionProgress(event)) budget.progress(Date.now());
        const subagentTrace = codexSubagentTraceEvent(event);
        if (subagentTrace) {
          recordTrace(subagentTrace.kind, subagentTrace.message);
        }
        if (event.type === 'thread.started' && event.thread_id) {
          threadId = event.thread_id;
          recordTrace('thread.started', `Thread ${event.thread_id} started`);
        }
        if (event.type === 'item.completed' && event.item?.type === 'agent_message' && event.item.text?.trim()) {
          lastAgentText = event.item.text.trim();
          recordTrace('agent_message.completed', 'Assistant message completed');
        }
        if (event.type === 'item.started' && event.item?.type && event.item.type !== 'collab_tool_call') {
          recordTrace('item.started', `${event.item.type} started`);
        }
        if (
          event.type === 'item.completed'
          && event.item?.type
          && event.item.type !== 'agent_message'
          && event.item.type !== 'collab_tool_call'
        ) {
          recordTrace('item.completed', `${event.item.type} completed`);
        }
        const eventErrorMessage = codexEventErrorMessage(event);
        if (eventErrorMessage) {
          runtimeErrorMessage = eventErrorMessage;
          const message = eventErrorMessage || 'Codex emitted an error event';
          recordTrace('runtime.error', message);
        }
      }
    });

    child.stderr.on('data', (chunk) => {
      stderr += String(chunk);
      const lines = String(chunk)
        .split('\n')
        .map((line) => line.trim())
        .filter(Boolean);
      for (const line of lines.slice(-5)) {
        recordTrace('stderr', line);
      }
    });

    child.on('error', (error) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      input.signal?.removeEventListener('abort', cancelRun);
      const errorCode = (error as NodeJS.ErrnoException).code;
      const runtimeError = (errorCode === 'E2BIG'
        ? new Error(`RUNTIME_SPAWN_E2BIG:${JSON.stringify({
            ...invocationMetrics,
            promptTransport: composedPrompt.metrics.transport,
            promptBytes: composedPrompt.metrics.totalBytes,
          })}`)
        : error) as CodexRuntimeError;
      if (errorCode === 'E2BIG') {
        recordTrace('spawn.e2big', JSON.stringify(invocationMetrics));
      }
      runtimeError.codexThreadId = threadId;
      runtimeError.trace = trace;
      reject(runtimeError);
    });

    child.on('close', async (code) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      input.signal?.removeEventListener('abort', cancelRun);

      try {
        const outputText = await fs.readFile(outputFile, 'utf8').catch(() => '');
        await fs.unlink(outputFile).catch(() => undefined);
        const responseText = outputText.trim() || lastAgentText.trim();

        if (threadId && workflowDelegationPolicy(input)?.allowed) {
          await recordRolloutSubagentProvenance(threadId, env, trace, input.onTrace).catch(() => undefined);
        }

        if (code !== 0) {
          recordTrace('run.failed', `Codex exited with code ${code}`);
          const failureDetails = runtimeErrorMessage || meaningfulStderr(stderr) || `Codex exited with code ${code}`;
          const error = new Error(`CODEX_RUNTIME_FAILED:${code}:${failureDetails.slice(0, 500)}`) as CodexRuntimeError;
          error.codexThreadId = threadId;
          error.trace = trace;
          reject(error);
          return;
        }

        const finalResponseText = responseText || emptyResponseFallback(input);

        if (!finalResponseText) {
          recordTrace('run.empty', 'Codex completed without returning assistant text');
          const error = new Error('CODEX_RUNTIME_EMPTY_RESPONSE') as CodexRuntimeError;
          error.codexThreadId = threadId;
          error.trace = trace;
          reject(error);
          return;
        }

        if (!responseText) {
          recordTrace('run.empty_tolerated', 'Codex completed without assistant text; returning task fallback text');
        }
        recordTrace('run.completed', 'Codex completed successfully');
        const finalGitState = await finalizeGitWorkspace(input, preparedWorkspace, trace, githubToken).catch((error) => {
          recordTrace('git.finalize_failed', error instanceof Error ? error.message : 'git finalize failed');
          throw error;
        });
        resolve({
          provider: 'codex-cli',
          model: modelPolicy.model,
          modelTier: modelPolicy.modelTier,
          reasoningEffort: modelPolicy.reasoningEffort,
          responseText: finalResponseText,
          codexThreadId: threadId,
          branchName: finalGitState.branchName,
          commitSha: finalGitState.commitSha,
          branchUrl: 'branchUrl' in finalGitState ? finalGitState.branchUrl ?? null : buildBranchUrl(preparedWorkspace.repoUrl, finalGitState.branchName),
          baseBranch: finalGitState.baseBranch,
          baseCommitSha: finalGitState.baseCommitSha,
          trace,
        });
      } catch (error) {
        reject(error);
      }
    });
    });
  } finally {
    await nativeSkillHome?.cleanup();
    // The leased child environment is discarded when the process exits.
  }
}

export async function generateCodexCliReply(input: CodexRuntimeInput) {
  if (!config.codexRuntimeEnabled) {
    throw new Error('CODEX_RUNTIME_DISABLED');
  }

  return await runCodexProcess(input);
}
