export type GatewayInvocationContext = {
  delegatedActorId?: string;
  requestId?: string;
  workflowRunId?: string;
  workflowStepKey?: string;
  runtimeJobId?: string;
};

type GatewayClientConfig = {
  enabled: boolean;
  baseUrl: string | null;
  token: string | null;
  timeoutMs: number;
};

export class GatewayClientError extends Error {
  constructor(
    public readonly code: string,
    public readonly status: number,
    public readonly retryable: boolean,
    public readonly traceId: string | null = null,
  ) {
    super(code);
  }
}

const protectedLeaseNames = new Set([
  'PATH', 'HOME', 'SHELL', 'PWD', 'TMPDIR', 'NODE_OPTIONS',
  'INTERNAL_SERVICE_TOKEN', 'APP_API_SERVICE_TOKEN', 'TASK_RUNNER_TOKEN',
  'COMMUNICATION_ADAPTER_TOKEN',
]);
const protectedLeasePrefixes = [
  'PRISM_', 'RAILWAY_', 'GATEWAY_', 'CODEX_', 'NODE_', 'NPM_', 'npm_', 'LD_', 'DYLD_',
];

function leasedEnvironment(value: unknown) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new GatewayClientError('PRISM_GATEWAY_LEASE_INVALID', 502, false);
  }
  const env: Record<string, string> = {};
  for (const [name, entry] of Object.entries(value as Record<string, unknown>)) {
    if (
      !/^[A-Z_][A-Z0-9_]{0,119}$/.test(name)
      || protectedLeaseNames.has(name)
      || protectedLeasePrefixes.some((prefix) => name.startsWith(prefix))
      || typeof entry !== 'string'
      || !entry
    ) throw new GatewayClientError('PRISM_GATEWAY_LEASE_INVALID', 502, false);
    env[name] = entry;
  }
  return env;
}

function gatewayResponseError(body: Record<string, unknown> | null, status: number) {
  const error = body?.error && typeof body.error === 'object'
    ? body.error as Record<string, unknown>
    : {};
  return new GatewayClientError(
    typeof error.code === 'string' ? error.code : `PRISM_GATEWAY_HTTP_${status}`,
    status,
    error.retryable === true || status >= 500,
    typeof body?.traceId === 'string' ? body.traceId : null,
  );
}

function gatewayTransportError(error: unknown) {
  const name = error && typeof error === 'object' && 'name' in error
    ? String((error as { name?: unknown }).name || '')
    : '';
  if (name === 'AbortError' || name === 'TimeoutError') {
    return new GatewayClientError('PRISM_GATEWAY_TIMEOUT', 504, true);
  }
  return new GatewayClientError('PRISM_GATEWAY_UNREACHABLE', 502, true);
}

export class PrismGatewayClient {
  constructor(
    private readonly config: GatewayClientConfig,
    private readonly fetchImpl: typeof fetch = fetch,
  ) {}

  status() {
    return {
      enabled: this.config.enabled,
      configured: Boolean(this.config.baseUrl && this.config.token),
    };
  }

  async leaseCredentials(input: {
    credentials: string[];
    context?: GatewayInvocationContext;
  }): Promise<{ env: Record<string, string> }> {
    if (!this.config.enabled) throw new GatewayClientError('PRISM_GATEWAY_DISABLED', 503, false);
    if (!this.config.baseUrl || !this.config.token) throw new GatewayClientError('PRISM_GATEWAY_NOT_CONFIGURED', 503, false);
    let response: Response;
    try {
      response = await this.fetchImpl(`${this.config.baseUrl}/credential-bundles/lease`, {
        method: 'POST',
        headers: { accept: 'application/json', 'content-type': 'application/json', 'x-gateway-token': this.config.token },
        body: JSON.stringify({ credentials: input.credentials, context: input.context ?? {} }),
        signal: AbortSignal.timeout(this.config.timeoutMs),
      });
    } catch (error) {
      throw gatewayTransportError(error);
    }
    const body = await response.json().catch(() => null) as Record<string, unknown> | null;
    if (!body || !response.ok || body.ok === false || !body.env || typeof body.env !== 'object' || Array.isArray(body.env)) {
      throw gatewayResponseError(body, response.status);
    }
    const env = leasedEnvironment(body.env);
    return { env };
  }
}
