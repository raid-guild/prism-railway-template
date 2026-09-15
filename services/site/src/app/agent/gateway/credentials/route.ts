import { NextResponse } from "next/server";
import { requireServiceAccess } from "@/lib/internal-service";
import { PrismGatewayError, prismGatewayRequest } from "@/lib/prism-gateway";

export async function GET() {
  const access = await requireServiceAccess();
  if (!access.ok) return NextResponse.json({ ok: false, error: access.error }, { status: access.status });
  try {
    return NextResponse.json(await prismGatewayRequest("/credentials"));
  } catch (error) {
    const status = error instanceof PrismGatewayError ? error.status : 500;
    return NextResponse.json({
      ok: false,
      error: error instanceof Error ? error.message : "CREDENTIAL_LIST_FAILED",
    }, { status });
  }
}
