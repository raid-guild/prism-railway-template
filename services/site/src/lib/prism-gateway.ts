import "server-only";
import { leaseReadyGatewayCredentials } from "./gateway-credential-catalog";

export class PrismGatewayError extends Error {
  constructor(
    message: string,
    public readonly status: number,
  ) {
    super(message);
  }
}

function gatewayEnabled() {
  return process.env.PRISM_GATEWAY_ENABLED?.trim().toLowerCase() === "true";
}

function gatewayBaseUrl() {
  return process.env.PRISM_GATEWAY_BASE_URL?.trim().replace(/\/+$/, "") || "";
}

function gatewayToken() {
  return process.env.PRISM_GATEWAY_TOKEN?.trim() || "";
}

export function getPrismGatewayStatus() {
  return {
    enabled: gatewayEnabled(),
    configured: Boolean(gatewayBaseUrl() && gatewayToken()),
  };
}

export async function listEnabledGatewayCredentialsOrEmpty(): Promise<Array<{
  key: string;
}>> {
  const status = getPrismGatewayStatus();
  if (!status.enabled || !status.configured) return [];
  try {
    const payload = await prismGatewayRequest<{
      credentials?: Array<{
        key?: unknown;
        status?: unknown;
        secretNames?: unknown;
        envBindings?: unknown;
      }>;
    }>("/credential-bundles");
    return leaseReadyGatewayCredentials(payload.credentials ?? []);
  } catch (error) {
    console.warn(JSON.stringify({
      event: "prism_gateway.credential_catalog_unavailable",
      error: error instanceof Error ? error.message : "PRISM_GATEWAY_CREDENTIAL_CATALOG_FAILED",
    }));
    return [];
  }
}

export async function prismGatewayRequest<T = Record<string, unknown>>(
  path: string,
  init: RequestInit = {},
): Promise<T> {
  const status = getPrismGatewayStatus();
  if (!status.enabled)
    throw new PrismGatewayError("PRISM_GATEWAY_DISABLED", 503);
  const baseUrl = gatewayBaseUrl();
  const token = gatewayToken();
  if (!baseUrl || !token)
    throw new PrismGatewayError("PRISM_GATEWAY_NOT_CONFIGURED", 503);
  if (!path.startsWith("/") || path.includes("://")) {
    throw new PrismGatewayError("PRISM_GATEWAY_PATH_INVALID", 400);
  }

  let response: Response;
  try {
    response = await fetch(`${baseUrl}${path}`, {
      ...init,
      cache: "no-store",
      signal: AbortSignal.timeout(20_000),
      headers: {
        accept: "application/json",
        "content-type": "application/json",
        "x-gateway-token": token,
        ...init.headers,
      },
    });
  } catch {
    throw new PrismGatewayError("PRISM_GATEWAY_UNREACHABLE", 502);
  }

  const text = await response.text();
  let body: Record<string, unknown> = {};
  try {
    body = text ? (JSON.parse(text) as Record<string, unknown>) : {};
  } catch {
    throw new PrismGatewayError("PRISM_GATEWAY_RESPONSE_INVALID", 502);
  }
  if (!response.ok || body.ok === false) {
    throw new PrismGatewayError(
      typeof body.error === "string"
        ? body.error
        : `PRISM_GATEWAY_HTTP_${response.status}`,
      response.status,
    );
  }
  return body as T;
}

export async function getPrismGatewayOverview() {
  const status = getPrismGatewayStatus();
  if (!status.enabled || !status.configured) {
    return { ...status, reachable: false };
  }

  const [health, credentials, connections, audit] =
    await Promise.all([
      prismGatewayRequest("/health"),
      prismGatewayRequest("/credentials"),
      prismGatewayRequest("/connections"),
      prismGatewayRequest("/audit-events?limit=50"),
    ]);

  return {
    ...status,
    reachable: true,
    health,
    credentials: credentials.credentials ?? [],
    connections: connections.connections ?? [],
    auditEvents: audit.events ?? [],
  };
}
