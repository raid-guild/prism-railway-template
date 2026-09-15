#!/usr/bin/env node

import fs from 'node:fs/promises';
import { pathToFileURL } from 'node:url';

const token = process.env.GH_TOKEN?.trim()
  || process.env.GITHUB_TOKEN?.trim()
  || process.env.TARGET_REPO_GITHUB_TOKEN?.trim()
  || '';

export function parsePullRequestUrl(value) {
  const match = String(value || '').trim().match(/^https:\/\/github\.com\/([A-Za-z0-9_.-]+)\/([A-Za-z0-9_.-]+)\/pull\/(\d+)(?:\/?(?:[?#].*)?)$/i);
  if (!match) throw new Error('A canonical https://github.com/OWNER/REPO/pull/NUMBER URL is required');
  const number = Number.parseInt(match[3], 10);
  if (!Number.isSafeInteger(number) || number < 1) throw new Error('Pull request number is invalid');
  return { owner: match[1], repo: match[2].replace(/\.git$/i, ''), number };
}

function argsFrom(argv) {
  const [command, pullRequestUrl, ...rest] = argv;
  const options = {};
  for (let index = 0; index < rest.length; index += 1) {
    const key = rest[index];
    if (!key?.startsWith('--')) throw new Error(`Unexpected argument: ${key}`);
    const value = rest[index + 1];
    if (!value || value.startsWith('--')) throw new Error(`Missing value for ${key}`);
    options[key.slice(2)] = value;
    index += 1;
  }
  return { command, pullRequestUrl, options };
}

async function github(path, init = {}) {
  if (!token) throw new Error('GitHub credential is unavailable');
  const response = await fetch(`https://api.github.com${path}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: 'application/vnd.github+json',
      'Content-Type': 'application/json',
      'User-Agent': 'prism-code-review-agent',
      'X-GitHub-Api-Version': '2022-11-28',
      ...(init.headers || {}),
    },
  });
  const payload = await response.json().catch(() => null);
  if (!response.ok) {
    const message = payload && typeof payload.message === 'string' ? payload.message : `HTTP ${response.status}`;
    throw new Error(`GitHub API ${response.status}: ${message}`);
  }
  return payload;
}

async function listAll(path) {
  const items = [];
  for (let page = 1; page <= 20; page += 1) {
    const separator = path.includes('?') ? '&' : '?';
    const payload = await github(`${path}${separator}per_page=100&page=${page}`);
    if (!Array.isArray(payload)) throw new Error('Expected a GitHub list response');
    items.push(...payload);
    if (payload.length < 100) break;
  }
  return items;
}

function scopeMarker(scope, findingId = null) {
  const normalizedScope = String(scope || '').trim();
  if (!/^(?:console|[1-9]\d*)$/.test(normalizedScope)) throw new Error('--scope must be console or a Prism request number');
  if (findingId !== null && !/^[a-z0-9][a-z0-9._-]{0,119}$/i.test(findingId)) throw new Error('--finding must be a stable identifier');
  const prefix = normalizedScope === 'console'
    ? '<!-- prism-code-review console'
    : `<!-- prism-code-review request:${normalizedScope}`;
  return findingId ? `${prefix} finding:${findingId} -->` : `${prefix} -->`;
}

async function readBody(options, marker) {
  if (!options['body-file']) throw new Error('--body-file is required');
  const body = (await fs.readFile(options['body-file'], 'utf8')).trim();
  if (!body) throw new Error('Comment body is empty');
  return body.includes(marker) ? body : `${body}\n\n${marker}`;
}

async function currentUser() {
  const user = await github('/user');
  if (!user || typeof user.login !== 'string') throw new Error('Could not resolve the authenticated GitHub identity');
  return user.login;
}

async function pullRequest(ref) {
  const pull = await github(`/repos/${ref.owner}/${ref.repo}/pulls/${ref.number}`);
  const headSha = pull?.head?.sha;
  if (typeof headSha !== 'string' || !headSha) throw new Error('Pull request head SHA is unavailable');
  return { pull, headSha };
}

function requireExpectedHead(options, actualHead) {
  if (!options['head-sha']) throw new Error('--head-sha is required before publishing review feedback');
  if (options['head-sha'] !== actualHead) {
    throw new Error(`Pull request head changed: expected ${options['head-sha']}, current ${actualHead}`);
  }
}

async function inspect(ref) {
  const [{ pull, headSha }, files, issueComments, reviewComments] = await Promise.all([
    pullRequest(ref),
    listAll(`/repos/${ref.owner}/${ref.repo}/pulls/${ref.number}/files`),
    listAll(`/repos/${ref.owner}/${ref.repo}/issues/${ref.number}/comments`),
    listAll(`/repos/${ref.owner}/${ref.repo}/pulls/${ref.number}/comments`),
  ]);
  return {
    pullRequest: {
      number: pull.number,
      title: pull.title,
      body: pull.body,
      state: pull.state,
      draft: pull.draft,
      url: pull.html_url,
      baseRef: pull.base?.ref,
      baseSha: pull.base?.sha,
      headRef: pull.head?.ref,
      headSha,
    },
    files: files.map((file) => ({
      filename: file.filename,
      status: file.status,
      additions: file.additions,
      deletions: file.deletions,
      changes: file.changes,
      patch: file.patch ?? null,
    })),
    prismSummaryComments: issueComments.filter((comment) => String(comment.body || '').includes('<!-- prism-code-review ')),
    prismInlineComments: reviewComments.filter((comment) => String(comment.body || '').includes('<!-- prism-code-review ')),
  };
}

async function upsertSummary(ref, options) {
  const marker = scopeMarker(options.scope);
  const body = await readBody(options, marker);
  const [{ headSha }, login, comments] = await Promise.all([
    pullRequest(ref),
    currentUser(),
    listAll(`/repos/${ref.owner}/${ref.repo}/issues/${ref.number}/comments`),
  ]);
  requireExpectedHead(options, headSha);
  const existing = comments.find((comment) => comment?.user?.login === login && String(comment.body || '').includes(marker));
  const result = existing
    ? await github(`/repos/${ref.owner}/${ref.repo}/issues/comments/${existing.id}`, { method: 'PATCH', body: JSON.stringify({ body }) })
    : await github(`/repos/${ref.owner}/${ref.repo}/issues/${ref.number}/comments`, { method: 'POST', body: JSON.stringify({ body }) });
  return { action: existing ? 'updated' : 'created', id: result.id, url: result.html_url, headSha };
}

async function upsertInline(ref, options) {
  if (!options.finding) throw new Error('--finding is required');
  const marker = scopeMarker(options.scope, options.finding);
  const body = await readBody(options, marker);
  const [{ headSha }, login, comments] = await Promise.all([
    pullRequest(ref),
    currentUser(),
    listAll(`/repos/${ref.owner}/${ref.repo}/pulls/${ref.number}/comments`),
  ]);
  requireExpectedHead(options, headSha);
  const existing = comments.find((comment) => comment?.user?.login === login && String(comment.body || '').includes(marker));
  if (existing) {
    const result = await github(`/repos/${ref.owner}/${ref.repo}/pulls/comments/${existing.id}`, {
      method: 'PATCH', body: JSON.stringify({ body }),
    });
    return { action: 'updated', id: result.id, url: result.html_url, headSha };
  }

  if (!options.path || !options.line) throw new Error('--path and --line are required for a new inline comment');
  const line = Number.parseInt(options.line, 10);
  if (!Number.isSafeInteger(line) || line < 1) throw new Error('--line must be a positive integer');
  const side = String(options.side || 'RIGHT').toUpperCase();
  if (side !== 'LEFT' && side !== 'RIGHT') throw new Error('--side must be LEFT or RIGHT');
  const result = await github(`/repos/${ref.owner}/${ref.repo}/pulls/${ref.number}/comments`, {
    method: 'POST',
    body: JSON.stringify({ body, commit_id: headSha, path: options.path, line, side }),
  });
  return { action: 'created', id: result.id, url: result.html_url, headSha };
}

export async function main(argv = process.argv.slice(2)) {
  const { command, pullRequestUrl, options } = argsFrom(argv);
  if (command === 'help' || !command) {
    return {
      usage: [
        'inspect PR_URL',
        'upsert-summary PR_URL --scope console|REQUEST_NUMBER --head-sha SHA --body-file FILE',
        'upsert-inline PR_URL --scope console|REQUEST_NUMBER --finding ID --head-sha SHA --body-file FILE --path PATH --line LINE [--side RIGHT|LEFT]',
      ],
    };
  }
  const ref = parsePullRequestUrl(pullRequestUrl);
  if (command === 'inspect') return await inspect(ref);
  if (command === 'upsert-summary') return await upsertSummary(ref, options);
  if (command === 'upsert-inline') return await upsertInline(ref, options);
  throw new Error(`Unknown command: ${command}`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main()
    .then((result) => process.stdout.write(`${JSON.stringify(result, null, 2)}\n`))
    .catch((error) => {
      process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
      process.exitCode = 1;
    });
}
