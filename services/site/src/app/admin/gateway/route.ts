import { NextResponse } from "next/server";
import { requireAdminAccess } from "@/lib/admin-auth";
import {
  getPrismGatewayOverview,
  PrismGatewayError,
} from "@/lib/prism-gateway";

export async function GET() {
  const access = await requireAdminAccess();
  if (!access.ok)
    return NextResponse.json(
      { ok: false, error: access.error },
      { status: access.status },
    );
  try {
    return NextResponse.json({
      ok: true,
      gateway: await getPrismGatewayOverview(),
    });
  } catch (error) {
    const status = error instanceof PrismGatewayError ? error.status : 500;
    const message =
      error instanceof Error ? error.message : "PRISM_GATEWAY_OVERVIEW_FAILED";
    return NextResponse.json({ ok: false, error: message }, { status });
  }
}
