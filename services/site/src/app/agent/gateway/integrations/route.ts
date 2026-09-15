import { NextResponse } from "next/server";
import {
  gatewayCredentialPath,
  nextcrmGatewayPreset,
  normalizeGatewayPresetOrigin,
  plausibleGatewayPreset,
} from "@/lib/gateway-presets";
import { requireServiceAccess } from "@/lib/internal-service";
import { getPrismGatewayOverview, prismGatewayRequest, PrismGatewayError } from "@/lib/prism-gateway";
import { publicUrlFromRequest } from "@/lib/public-url";

type GatewayConnection = {
  id?: unknown;
  key?: unknown;
  provider?: unknown;
  secretNames?: unknown;
  configuration?: unknown;
};

function text(value: unknown, maxLength = 200) {
  return typeof value === "string" ? value.trim().slice(0, maxLength) : "";
}

function stringRecord(value: unknown) {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}

function credentialResponse(request: Request, connection: GatewayConnection, defaultSecretName: string) {
  const connectionId = typeof connection.id === "string" ? connection.id : "";
  const secretNames = Array.isArray(connection.secretNames)
    ? connection.secretNames.filter((entry): entry is string => typeof entry === "string")
    : [];
  const secretName = secretNames[0] || defaultSecretName;
  const credentialPath = connectionId ? gatewayCredentialPath({ connectionId, secretName }) : null;
  return {
    credentialPath,
    credentialUrl: credentialPath ? publicUrlFromRequest(request, credentialPath) : null,
  };
}

export async function POST(request: Request) {
  const access = await requireServiceAccess();
  if (!access.ok) return NextResponse.json({ ok: false, error: access.error }, { status: access.status });
  const body = await request.json().catch(() => null) as Record<string, unknown> | null;
  if (!body || body.credentials !== undefined || body.credential !== undefined || body.secretValue !== undefined) {
    return NextResponse.json({ ok: false, error: "GATEWAY_AGENT_CREDENTIALS_FORBIDDEN" }, { status: 400 });
  }
  const presetKey = text(body.preset, 80).toLowerCase();
  const preset = presetKey === plausibleGatewayPreset.key
    ? plausibleGatewayPreset
    : presetKey === nextcrmGatewayPreset.key
      ? nextcrmGatewayPreset
      : null;
  if (!preset) return NextResponse.json({ ok: false, error: "GATEWAY_INTEGRATION_PRESET_UNSUPPORTED" }, { status: 400 });
  const origin = normalizeGatewayPresetOrigin(body.origin);
  if (!origin) return NextResponse.json({ ok: false, error: "GATEWAY_INTEGRATION_ORIGIN_INVALID" }, { status: 400 });

  try {
    const overview = await getPrismGatewayOverview() as unknown as { connections?: unknown };
    const connections = Array.isArray(overview.connections) ? overview.connections as GatewayConnection[] : [];
    const existing = connections.find((connection) => connection.key === preset.key);
    if (existing) {
      const configuredOrigin = text(stringRecord(existing.configuration)[preset.baseUrlEnvironmentName], 2_000) || null;
      return NextResponse.json({
        ok: true,
        existing: true,
        preset: preset.key,
        connection: existing,
        ...credentialResponse(request, existing, preset.secretName),
        requestedOrigin: origin,
        configuredOrigin,
        requiresReview: Boolean(configuredOrigin && configuredOrigin !== origin),
        nextStep: "Add or replace the credential in Settings. It is immediately available to trusted runs.",
      });
    }

    const result = await prismGatewayRequest<{ connection?: GatewayConnection }>("/connections", {
      method: "POST",
      body: JSON.stringify({
        key: preset.key,
        provider: preset.provider,
        label: text(body.label) || preset.defaultLabel,
        authType: preset.authType,
        credentials: {},
        configuration: { [preset.baseUrlEnvironmentName]: origin },
        envBindings: { [preset.credentialEnvironmentName]: preset.secretName },
      }),
    });
    const connection = result.connection ?? {};
    return NextResponse.json({
      ok: true,
      existing: false,
      preset: preset.key,
      connection,
      ...credentialResponse(request, connection, preset.secretName),
      nextStep: "Add the credential in Settings. It is immediately available to trusted runs.",
    }, { status: 201 });
  } catch (error) {
    const status = error instanceof PrismGatewayError ? error.status : 500;
    return NextResponse.json({ ok: false, error: error instanceof Error ? error.message : "GATEWAY_INTEGRATION_CREATE_FAILED" }, { status });
  }
}
