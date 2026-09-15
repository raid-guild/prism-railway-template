import { NextResponse } from "next/server";
import { requireServiceAccess } from "@/lib/internal-service";
import { prismGatewayRequest, PrismGatewayError } from "@/lib/prism-gateway";

function containsSecretValue(body: Record<string, unknown>) {
  return ["credentials", "credential", "secret", "secretValue", "value"]
    .some((key) => body[key] !== undefined);
}

export async function PATCH(
  request: Request,
  context: { params: Promise<{ id: string }> },
) {
  const access = await requireServiceAccess();
  if (!access.ok) return NextResponse.json({ ok: false, error: access.error }, { status: access.status });
  const body = await request.json().catch(() => null) as Record<string, unknown> | null;
  if (!body || containsSecretValue(body)) {
    return NextResponse.json({ ok: false, error: "GATEWAY_AGENT_CREDENTIALS_FORBIDDEN" }, { status: 400 });
  }
  const { id } = await context.params;
  try {
    return NextResponse.json(await prismGatewayRequest(`/credential-bundles/${encodeURIComponent(id)}`, {
      method: "PATCH",
      body: JSON.stringify({
        configuration: body.configuration,
        envBindings: body.envBindings ?? body.env_bindings,
      }),
    }));
  } catch (error) {
    const status = error instanceof PrismGatewayError ? error.status : 500;
    return NextResponse.json({
      ok: false,
      error: error instanceof Error ? error.message : "CREDENTIAL_UPDATE_FAILED",
    }, { status });
  }
}
