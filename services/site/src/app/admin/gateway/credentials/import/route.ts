import { NextResponse } from "next/server";
import { requireAdminAccess } from "@/lib/admin-auth";
import { isProtectedGatewayEnvName } from "@/lib/gateway-env-import";
import { PrismGatewayError, prismGatewayRequest } from "@/lib/prism-gateway";

export async function POST(request: Request) {
  const access = await requireAdminAccess();
  if (!access.ok) return NextResponse.json({ ok: false, error: access.error }, { status: access.status });
  const body = await request.json().catch(() => null) as { credentials?: unknown } | null;
  if (!body?.credentials || typeof body.credentials !== "object" || Array.isArray(body.credentials)) {
    return NextResponse.json({ ok: false, error: "Invalid credential import" }, { status: 400 });
  }
  const credentials = body.credentials as Record<string, unknown>;
  const names = Object.keys(credentials);
  if (names.length === 0 || names.length > 100) {
    return NextResponse.json({ ok: false, error: "Credential import must contain 1 to 100 values" }, { status: 400 });
  }
  if (names.some(isProtectedGatewayEnvName)) {
    return NextResponse.json({ ok: false, error: "Protected credentials cannot be imported" }, { status: 400 });
  }
  try {
    return NextResponse.json(await prismGatewayRequest("/credentials/import", {
      method: "POST",
      body: JSON.stringify({ credentials }),
    }), { status: 201 });
  } catch (error) {
    const status = error instanceof PrismGatewayError ? error.status : 500;
    return NextResponse.json({
      ok: false,
      error: error instanceof Error ? error.message : "CREDENTIAL_IMPORT_FAILED",
    }, { status });
  }
}
