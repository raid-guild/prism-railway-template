import assert from 'node:assert/strict';
import test from 'node:test';
import { GatewayClientError, PrismGatewayClient } from './gateway-client.js';

test('gateway client leases credential bundles for trusted runtime jobs', async () => {
  let observedToken = '';
  let observedBody: Record<string, unknown> = {};
  const client = new PrismGatewayClient(
    { enabled: true, baseUrl: 'http://gateway.internal', token: 'runtime-secret', timeoutMs: 5000 },
    (async (url, init) => {
      assert.equal(String(url), 'http://gateway.internal/credential-bundles/lease');
      observedToken = new Headers(init?.headers).get('x-gateway-token') || '';
      observedBody = JSON.parse(String(init?.body || '{}')) as Record<string, unknown>;
      return new Response(JSON.stringify({
        ok: true,
        env: { SENDGRID_API_KEY: 'secret' },
        leasedCredentials: ['sendgrid'],
      }), { status: 200, headers: { 'content-type': 'application/json' } });
    }) as typeof fetch,
  );

  const lease = await client.leaseCredentials({
    credentials: ['sendgrid'],
    context: { runtimeJobId: 'job-2' },
  });

  assert.equal(observedToken, 'runtime-secret');
  assert.deepEqual(observedBody, { credentials: ['sendgrid'], context: { runtimeJobId: 'job-2' } });
  assert.deepEqual(lease, { env: { SENDGRID_API_KEY: 'secret' } });
});

test('gateway client preserves credential lease failures', async () => {
  const client = new PrismGatewayClient(
    { enabled: true, baseUrl: 'http://gateway.internal', token: 'runtime-token', timeoutMs: 1000 },
    async () => new Response(JSON.stringify({
      ok: false,
      traceId: 'trace-lease-invalid',
      error: { code: 'CREDENTIAL_LEASE_KEYS_INVALID', retryable: false },
    }), { status: 400, headers: { 'content-type': 'application/json' } }),
  );

  await assert.rejects(
    client.leaseCredentials({ credentials: ['one'] }),
    (error: unknown) => error instanceof GatewayClientError
      && error.code === 'CREDENTIAL_LEASE_KEYS_INVALID'
      && error.traceId === 'trace-lease-invalid',
  );
});

test('gateway client rejects leased runtime bootstrap variables', async () => {
  const client = new PrismGatewayClient(
    { enabled: true, baseUrl: 'http://gateway.internal', token: 'runtime-secret', timeoutMs: 5000 },
    (async () => new Response(JSON.stringify({
      ok: true,
      env: { NODE_OPTIONS: '--require=/tmp/untrusted.js' },
      leasedCredentials: ['unsafe'],
    }), { status: 200, headers: { 'content-type': 'application/json' } })) as typeof fetch,
  );

  await assert.rejects(
    client.leaseCredentials({ credentials: ['unsafe'] }),
    (error: unknown) => error instanceof GatewayClientError && error.code === 'PRISM_GATEWAY_LEASE_INVALID',
  );
});
