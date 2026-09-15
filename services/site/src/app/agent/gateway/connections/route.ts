import { NextResponse } from "next/server";
import { requireServiceAccess } from "@/lib/internal-service";
import { prismGatewayRequest, PrismGatewayError } from "@/lib/prism-gateway";
import { publicUrlFromRequest } from "@/lib/public-url";
import { gatewayCredentialPath } from "@/lib/gateway-presets";

function text(value: unknown, maxLength = 200) {
  return typeof value === "string" ? value.trim().slice(0, maxLength) : "";
}

function stringRecord(value: unknown, maxEntries = 100) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  return Object.fromEntries(Object.entries(value as Record<string, unknown>)
    .flatMap(([key, entry]) => {
      const cleanKey = text(key, 160);
      const cleanValue = text(entry, 2_000);
      return cleanKey && cleanValue ? [[cleanKey, cleanValue]] : [];
    })
    .slice(0, maxEntries));
}

export async function POST(request: Request) {
  const access = await requireServiceAccess();
  if (!access.ok) return NextResponse.json({ ok: false, error: access.error }, { status: access.status });
  const body = await request.json().catch(() => null) as Record<string, unknown> | null;
  if (!body || body.credentials !== undefined || body.credential !== undefined || body.secretValue !== undefined) {
    return NextResponse.json({ ok: false, error: "GATEWAY_AGENT_CREDENTIALS_FORBIDDEN" }, { status: 400 });
  }
  const provider = text(body.provider, 120) || "custom";
  const label = text(body.label);
  const authType = text(body.authType ?? body.auth_type, 80);
  const secretName = text(body.secretName ?? body.secret_name, 120) || "apiKey";
  const key = text(body.key, 120);
  const configuration = stringRecord(body.configuration);
  const requestedBindings = stringRecord(body.envBindings ?? body.env_bindings);
  const environmentName = text(body.environmentName ?? body.environment_name, 160);
  const envBindings = Object.keys(requestedBindings).length
    ? requestedBindings
    : environmentName ? { [environmentName]: secretName } : {};
  if (!label || !authType) {
    return NextResponse.json({ ok: false, error: "GATEWAY_CONNECTION_FIELDS_REQUIRED" }, { status: 400 });
  }
  try {
    const result = await prismGatewayRequest<{ connection?: { id?: unknown }; [key: string]: unknown }>("/connections", {
      method: "POST",
      body: JSON.stringify({ provider, label, authType, key, configuration, envBindings, credentials: {} }),
    });
    const connectionId = typeof result.connection?.id === "string" ? result.connection.id : "";
    const credentialPath = connectionId ? gatewayCredentialPath({ connectionId, secretName }) : null;
    return NextResponse.json({
      ...result,
      credentialPath,
      credentialUrl: credentialPath ? publicUrlFromRequest(request, credentialPath) : null,
      nextStep: "Ask an admin to enter the secret in Settings. The credential is then available to trusted admin sessions and can be assigned to jobs by key.",
    });
  } catch (error) {
    const status = error instanceof PrismGatewayError ? error.status : 500;
    return NextResponse.json({ ok: false, error: error instanceof Error ? error.message : "CONNECTION_CREATE_FAILED" }, { status });
  }
}
