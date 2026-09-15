import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import test from 'node:test';
import { requestRuntimeResponseWithProfile } from './runtime-client';
import type { RuntimeProfileRecord } from './runtime-profiles';

for (const completes of [true, false]) {
  test(`deadline poll reconciliation ${completes ? 'accepts late success' : 'cancels unfinished job'}`, async (t) => {
    let posts = 0, polls = 0, cancels = 0;
    const server = createServer((req, res) => {
      req.resume();
      if (req.method === 'POST' && req.url === '/v1/runtime/jobs') {
        posts++;
        res.writeHead(202, { 'content-type': 'application/json' }).end(JSON.stringify({ jobId: 'late-job' }));
      } else if (req.url?.endsWith('/cancel')) {
        cancels++; res.writeHead(200).end('{}');
      } else if (req.method === 'GET') {
        polls++;
        if (polls === 1) return; // abort at the polling deadline
        res.writeHead(200, { 'content-type': 'application/json' }).end(JSON.stringify({
          job: { id: 'late-job', status: completes ? 'succeeded' : 'running', result: completes ? { responseText: 'LATE_SUCCESS' } : null },
        }));
      } else res.writeHead(404).end();
    });
    await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
    t.after(() => { server.closeAllConnections(); server.close(); });
    const addr = server.address(); assert.ok(addr && typeof addr === 'object');
    const profile: RuntimeProfileRecord = { key: 'late', name: 'Late', adapter: 'codex-cli', baseUrl: `http://127.0.0.1:${addr.port}`, enabled: true, isDefault: true, contractVersion: '2026-07-10', features: [], createdAt: '', updatedAt: '' };
    const response = requestRuntimeResponseWithProfile(profile, { prompt: 'test', sessionId: 'deadline', timeoutMs: 2200 });
    if (completes) assert.equal((await response).responseText, 'LATE_SUCCESS');
    else await assert.rejects(response, /RUNTIME_REQUEST_TIMEOUT:2200/);
    assert.equal(posts, 1);
    assert.equal(polls, 2);
    assert.equal(cancels, completes ? 0 : 1);
  });
}

test('runtime client uses the normalized contract without adapter-specific parsing', async (t) => {
  const submitted: { body?: Record<string, unknown> } = {};
  const progress: Array<{ runtimeJobId: string; runtimeKey: string; status: string }> = [];
  let capabilitiesCalls = 0;
  const server = createServer((request, response) => {
    if (request.method === 'GET' && request.url === '/v1/runtime/capabilities') {
      capabilitiesCalls += 1;
      response.writeHead(200, { 'content-type': 'application/json' });
      response.end(JSON.stringify({
        contractVersion: '2026-07-10',
        runtimeKey: 'grok-local',
        adapter: 'grok-build',
        features: ['read-only-utility-authority'],
      }));
      return;
    }
    if (request.method === 'POST' && request.url === '/v1/runtime/jobs') {
      const chunks: Buffer[] = [];
      request.on('data', (chunk) => chunks.push(Buffer.from(chunk)));
      request.on('end', () => {
        submitted.body = JSON.parse(Buffer.concat(chunks).toString('utf8')) as Record<string, unknown>;
        response.writeHead(202, { 'content-type': 'application/json' });
        response.end(JSON.stringify({ ok: true, jobId: 'job-1', job: { id: 'job-1', status: 'queued' } }));
      });
      return;
    }
    if (request.method === 'GET' && request.url === '/v1/runtime/jobs/job-1') {
      response.writeHead(200, { 'content-type': 'application/json' });
      response.end(JSON.stringify({
        ok: true,
        job: {
          id: 'job-1',
          status: 'succeeded',
          result: {
            responseText: 'GROK_NORMALIZED_OK',
            continuationId: 'grok-session-1',
            providerMetadata: { model: 'grok-build-fast', modelTier: 'economy', reasoningEffort: 'low' },
          },
          trace: [{ at: '2026-07-13T00:00:00.000Z', kind: 'run.completed', message: 'done' }],
        },
      }));
      return;
    }
    response.writeHead(404).end();
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  t.after(() => server.close());
  const address = server.address();
  assert.ok(address && typeof address === 'object');

  const profile: RuntimeProfileRecord = {
    key: 'grok-local',
    name: 'Grok Build',
    adapter: 'grok-build',
    baseUrl: `http://127.0.0.1:${address.port}`,
    enabled: true,
    isDefault: true,
    contractVersion: '2026-07-10',
    features: ['continuations', 'read-only-utility-authority'],
    createdAt: '2026-07-13T00:00:00.000Z',
    updatedAt: '2026-07-13T00:00:00.000Z',
  };
  const result = await requestRuntimeResponseWithProfile(profile, {
    prompt: 'test',
    sessionId: 'site-session',
    authorityMode: 'read_only_utility',
    continuationId: 'existing-session',
    skills: ['test-skill'],
    credentials: ['sendgrid'],
    modelTier: 'economy',
    timeoutMs: 10_000,
    onProgress: (entry) => progress.push(entry),
  });

  assert.equal(result.responseText, 'GROK_NORMALIZED_OK');
  assert.equal(result.thread_id, 'grok-session-1');
  assert.equal(result.provider, 'grok-build');
  assert.equal(result.runtimeKey, 'grok-local');
  assert.equal(result.modelTier, 'economy');
  assert.equal(result.reasoningEffort, 'low');
  assert.equal(submitted.body?.contractVersion, '2026-07-10');
  assert.equal(submitted.body?.authorityMode, 'read_only_utility');
  assert.equal(submitted.body?.continuationId, 'existing-session');
  assert.deepEqual(submitted.body?.skills, []);
  assert.deepEqual(submitted.body?.credentials, []);
  assert.equal(submitted.body?.modelTier, 'economy');
  assert.equal(capabilitiesCalls, 1);
  assert.ok(progress.length >= 1);
  assert.equal(progress[0]?.runtimeJobId, 'job-1');
  assert.equal(progress[0]?.runtimeKey, 'grok-local');
  assert.equal(progress[0]?.status, 'queued');
});

test('restricted authority fails closed when live capabilities omit support', async (t) => {
  let jobPosts = 0;
  const server = createServer((request, response) => {
    if (request.method === 'GET' && request.url === '/v1/runtime/capabilities') {
      response.writeHead(200, { 'content-type': 'application/json' });
      response.end(JSON.stringify({
        contractVersion: '2026-07-10',
        runtimeKey: 'profile-only',
        adapter: 'custom-runtime',
        features: [],
      }));
      return;
    }
    if (request.method === 'POST') jobPosts += 1;
    response.writeHead(404).end();
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  t.after(() => server.close());
  const address = server.address();
  assert.ok(address && typeof address === 'object');

  const profile: RuntimeProfileRecord = {
    key: 'profile-only',
    name: 'Profile only',
    adapter: 'custom-runtime',
    baseUrl: `http://127.0.0.1:${address.port}`,
    enabled: true,
    isDefault: true,
    contractVersion: '2026-07-10',
    features: ['read-only-utility-authority'],
    createdAt: '2026-08-19T00:00:00.000Z',
    updatedAt: '2026-08-19T00:00:00.000Z',
  };

  await assert.rejects(
    requestRuntimeResponseWithProfile(profile, {
      prompt: 'restricted',
      sessionId: 'profile-only-session',
      authorityMode: 'read_only_utility',
      timeoutMs: 2_000,
    }),
    /RUNTIME_AUTHORITY_MODE_UNSUPPORTED:capabilities/,
  );
  assert.equal(jobPosts, 0);
});

test('runtime client keeps observing the same job after exhausting one poll retry batch', async (t) => {
  let createAttempts = 0;
  let pollAttempts = 0;
  const idempotencyKeys: string[] = [];
  const server = createServer((request, response) => {
    if (request.method === 'POST' && request.url === '/v1/runtime/jobs') {
      idempotencyKeys.push(String(request.headers['idempotency-key'] ?? ''));
      request.resume();
      request.on('end', () => {
        createAttempts += 1;
        if (createAttempts === 1) {
          request.socket.destroy();
          return;
        }
        response.writeHead(202, { 'content-type': 'application/json' });
        response.end(JSON.stringify({ ok: true, jobId: 'retry-job', job: { id: 'retry-job', status: 'queued' } }));
      });
      return;
    }
    if (request.method === 'GET' && request.url === '/v1/runtime/jobs/retry-job') {
      pollAttempts += 1;
      if (pollAttempts <= 3) {
        request.socket.destroy();
        return;
      }
      response.writeHead(200, { 'content-type': 'application/json' });
      response.end(JSON.stringify({
        ok: true,
        job: {
          id: 'retry-job',
          status: 'succeeded',
          result: { responseText: 'RETRY_OK', continuationId: 'retry-thread' },
        },
      }));
      return;
    }
    response.writeHead(404).end();
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  t.after(() => server.close());
  const address = server.address();
  assert.ok(address && typeof address === 'object');

  const profile: RuntimeProfileRecord = {
    key: 'codex-default',
    name: 'Codex Default',
    adapter: 'codex-cli',
    baseUrl: `http://127.0.0.1:${address.port}`,
    enabled: true,
    isDefault: true,
    contractVersion: '2026-07-10',
    features: [],
    createdAt: '2026-07-18T00:00:00.000Z',
    updatedAt: '2026-07-18T00:00:00.000Z',
  };
  const result = await requestRuntimeResponseWithProfile(profile, {
    prompt: 'retry transport failures',
    sessionId: 'retry-session',
    timeoutMs: 10_000,
  });

  assert.equal(result.responseText, 'RETRY_OK');
  assert.equal(createAttempts, 2);
  assert.equal(pollAttempts, 4);
  assert.equal(idempotencyKeys.length, 2);
  assert.ok(idempotencyKeys[0]);
  assert.equal(idempotencyKeys[1], idempotencyKeys[0]);
});

test('ordinary full requests preserve normalized and legacy payload shapes', async (t) => {
  const normalizedBodies: Array<Record<string, unknown>> = [];
  const normalizedServer = createServer((request, response) => {
    if (request.method === 'POST' && request.url === '/v1/runtime/jobs') {
      const chunks: Buffer[] = [];
      request.on('data', (chunk) => chunks.push(Buffer.from(chunk)));
      request.on('end', () => {
        const body = JSON.parse(Buffer.concat(chunks).toString('utf8')) as Record<string, unknown>;
        normalizedBodies.push(body);
        if (Object.prototype.hasOwnProperty.call(body, 'authorityMode')) {
          response.writeHead(400).end('unexpected authorityMode');
          return;
        }
        response.writeHead(202, { 'content-type': 'application/json' });
        response.end(JSON.stringify({ ok: true, jobId: 'full-job' }));
      });
      return;
    }
    if (request.method === 'GET' && request.url === '/v1/runtime/jobs/full-job') {
      response.writeHead(200, { 'content-type': 'application/json' });
      response.end(JSON.stringify({
        ok: true,
        job: { status: 'succeeded', result: { responseText: 'NORMALIZED_FULL_OK' } },
      }));
      return;
    }
    response.writeHead(404).end();
  });
  await new Promise<void>((resolve) => normalizedServer.listen(0, '127.0.0.1', resolve));
  t.after(() => normalizedServer.close());
  const normalizedAddress = normalizedServer.address();
  assert.ok(normalizedAddress && typeof normalizedAddress === 'object');
  const normalizedProfile: RuntimeProfileRecord = {
    key: 'strict-normalized',
    name: 'Strict normalized',
    adapter: 'custom-runtime',
    baseUrl: `http://127.0.0.1:${normalizedAddress.port}`,
    enabled: true,
    isDefault: true,
    contractVersion: '2026-07-10',
    features: [],
    createdAt: '2026-08-19T00:00:00.000Z',
    updatedAt: '2026-08-19T00:00:00.000Z',
  };
  const normalizedResult = await requestRuntimeResponseWithProfile(normalizedProfile, {
    prompt: 'ordinary full normalized request',
    sessionId: 'ordinary-normalized',
    authorityMode: 'full',
    timeoutMs: 5_000,
  });
  assert.equal(normalizedResult.responseText, 'NORMALIZED_FULL_OK');
  assert.equal(normalizedBodies.length, 1);
  assert.equal(Object.hasOwn(normalizedBodies[0]!, 'authorityMode'), false);

  const legacyBodies: Array<Record<string, unknown>> = [];
  const legacyServer = createServer((request, response) => {
    if (request.method === 'POST' && [
      '/v1/runtime/jobs', '/v1/responses/jobs', '/v1/responses',
    ].includes(request.url || '')) {
      const chunks: Buffer[] = [];
      request.on('data', (chunk) => chunks.push(Buffer.from(chunk)));
      request.on('end', () => {
        const body = JSON.parse(Buffer.concat(chunks).toString('utf8')) as Record<string, unknown>;
        legacyBodies.push(body);
        if (Object.prototype.hasOwnProperty.call(body, 'authorityMode')) {
          response.writeHead(400).end('unexpected authorityMode');
          return;
        }
        if (request.url !== '/v1/responses') {
          response.writeHead(404).end();
          return;
        }
        response.writeHead(200, { 'content-type': 'application/json' });
        response.end(JSON.stringify({ responseText: 'LEGACY_FULL_OK' }));
      });
      return;
    }
    response.writeHead(404).end();
  });
  await new Promise<void>((resolve) => legacyServer.listen(0, '127.0.0.1', resolve));
  t.after(() => legacyServer.close());
  const legacyAddress = legacyServer.address();
  assert.ok(legacyAddress && typeof legacyAddress === 'object');
  const legacyProfile: RuntimeProfileRecord = {
    ...normalizedProfile,
    key: 'strict-legacy',
    name: 'Strict legacy',
    baseUrl: `http://127.0.0.1:${legacyAddress.port}`,
  };
  const legacyResult = await requestRuntimeResponseWithProfile(legacyProfile, {
    prompt: 'ordinary full legacy request',
    sessionId: 'ordinary-legacy',
    timeoutMs: 5_000,
  });
  assert.equal(legacyResult.responseText, 'LEGACY_FULL_OK');
  assert.equal(legacyBodies.length, 3);
  assert.ok(legacyBodies.every((body) => !Object.hasOwn(body, 'authorityMode')));
});

test('restricted authority never falls back to a legacy adapter contract', async (t) => {
  let legacyCalls = 0;
  const server = createServer((request, response) => {
    if (request.url === '/v1/runtime/jobs') {
      request.resume();
      request.on('end', () => response.writeHead(404).end());
      return;
    }
    legacyCalls += 1;
    response.writeHead(500).end();
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  t.after(() => server.close());
  const address = server.address();
  assert.ok(address && typeof address === 'object');

  const profile: RuntimeProfileRecord = {
    key: 'legacy-only',
    name: 'Legacy only',
    adapter: 'codex-cli',
    baseUrl: `http://127.0.0.1:${address.port}`,
    enabled: true,
    isDefault: true,
    contractVersion: '2026-07-10',
    features: [],
    createdAt: '2026-08-19T00:00:00.000Z',
    updatedAt: '2026-08-19T00:00:00.000Z',
  };

  await assert.rejects(
    requestRuntimeResponseWithProfile(profile, {
      prompt: 'restricted',
      sessionId: 'restricted-session',
      authorityMode: 'read_only_utility',
      timeoutMs: 2_000,
    }),
    /RUNTIME_AUTHORITY_MODE_UNSUPPORTED/,
  );
  assert.equal(legacyCalls, 0);
});
