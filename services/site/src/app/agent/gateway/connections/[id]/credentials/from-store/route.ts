import { NextResponse } from "next/server";
import { requireServiceAccess } from "@/lib/internal-service";
import { PrismGatewayError, prismGatewayRequest } from "@/lib/prism-gateway";

export async function PUT(request: Request, context: { params: Promise<{ id: string }> }) {
  const access = await requireServiceAccess();
  if (!access.ok) return NextResponse.json({ ok: false, error: access.error }, { status: access.status });
  const body = await request.json().catch(() => null) as { bindings?: unknown } | null;
  if (!body?.bindings || typeof body.bindings !== "object" || Array.isArray(body.bindings)) {
    return NextResponse.json({ ok: false, error: "INVALID_CREDENTIAL_BINDINGS" }, { status: 400 });
  }
  const { id } = await context.params;
  try {
    return NextResponse.json(await prismGatewayRequest(
      `/connections/${encodeURIComponent(id)}/credentials/from-store`,
      { method: "PUT", body: JSON.stringify({ bindings: body.bindings }) },
    ));
  } catch (error) {
    const status = error instanceof PrismGatewayError ? error.status : 500;
    return NextResponse.json({
      ok: false,
      error: error instanceof Error ? error.message : "CREDENTIAL_BINDING_FAILED",
    }, { status });
  }
}
