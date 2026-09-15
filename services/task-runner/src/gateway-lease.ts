export type GatewayLeaseOptions = {
  credentials: string[];
  context: Record<string, unknown>;
  env?: NodeJS.ProcessEnv;
  fetchImpl?: typeof fetch;
  timeoutMs?: number;
};

const protectedEnvNames = new Set([
  "PATH",
  "HOME",
  "SHELL",
  "PWD",
  "TMPDIR",
  "INTERNAL_SERVICE_TOKEN",
  "APP_API_SERVICE_TOKEN",
  "TASK_RUNNER_TOKEN",
  "COMMUNICATION_ADAPTER_TOKEN",
]);

const protectedEnvPrefixes = [
  "PRISM_",
  "RAILWAY_",
  "GATEWAY_",
  "CODEX_",
  "NODE_",
  "NPM_",
  "npm_",
  "LD_",
  "DYLD_",
];

function trimBaseUrl(value: string | undefined): string {
  return (value ?? "").trim().replace(/\/+$/, "");
}

function enabled(value: string | undefined): boolean {
  return new Set(["1", "true", "yes", "on"]).has((value ?? "").trim().toLowerCase());
}

export function validateLeasedEnvironment(value: unknown): Record<string, string> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("SCRIPT_RUNNER_GATEWAY_LEASE_INVALID");
  }
  const leasedEnv: Record<string, string> = {};
  for (const [name, secret] of Object.entries(value as Record<string, unknown>)) {
    if (
      !/^[A-Z_][A-Z0-9_]{0,119}$/.test(name)
      || protectedEnvNames.has(name)
      || protectedEnvPrefixes.some((prefix) => name.startsWith(prefix))
    ) {
      throw new Error(`SCRIPT_RUNNER_GATEWAY_ENV_PROTECTED:${name}`);
    }
    if (typeof secret !== "string" || !secret) {
      throw new Error(`SCRIPT_RUNNER_GATEWAY_ENV_INVALID:${name}`);
    }
    leasedEnv[name] = secret;
  }
  return leasedEnv;
}

export async function leaseGatewayCredentials(options: GatewayLeaseOptions): Promise<Record<string, string>> {
  const credentials = Array.from(new Set(options.credentials.map((key) => key.trim()).filter(Boolean)));
  if (!credentials.length) return {};

  const env = options.env ?? process.env;
  if (!enabled(env.PRISM_GATEWAY_ENABLED)) {
    throw new Error("SCRIPT_RUNNER_GATEWAY_DISABLED");
  }
  const baseUrl = trimBaseUrl(env.PRISM_GATEWAY_BASE_URL);
  const token = (env.PRISM_GATEWAY_TOKEN ?? "").trim();
  if (!baseUrl || !token) {
    throw new Error("SCRIPT_RUNNER_GATEWAY_CONFIG_MISSING");
  }

  const controller = new AbortController();
  const timeoutMs = options.timeoutMs ?? 30_000;
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const requestLease = (path: string, body: Record<string, unknown>) => (options.fetchImpl ?? fetch)(`${baseUrl}${path}`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-gateway-token": token,
      },
      body: JSON.stringify(body),
      signal: controller.signal,
    });
    const response = await requestLease("/credential-bundles/lease", {
      credentials,
      context: options.context,
    });
    const text = await response.text();
    let payload: Record<string, unknown> = {};
    try {
      payload = text ? JSON.parse(text) as Record<string, unknown> : {};
    } catch {
      throw new Error("SCRIPT_RUNNER_GATEWAY_RESPONSE_INVALID");
    }
    if (!response.ok) {
      const error = typeof payload.error === "string"
        ? payload.error
        : payload.error && typeof payload.error === "object" && typeof (payload.error as Record<string, unknown>).code === "string"
          ? String((payload.error as Record<string, unknown>).code)
          : `HTTP_${response.status}`;
      throw new Error(`SCRIPT_RUNNER_GATEWAY_LEASE_FAILED:${error}`);
    }
    return validateLeasedEnvironment(payload.env);
  } catch (error) {
    if (error instanceof Error && error.name === "AbortError") {
      throw new Error(`SCRIPT_RUNNER_GATEWAY_TIMEOUT:${timeoutMs}`);
    }
    throw error;
  } finally {
    clearTimeout(timeout);
  }
}
