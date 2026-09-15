import { NextResponse } from "next/server";
import { requireAdminAccess } from "@/lib/admin-auth";
import { prismGatewayRequest, PrismGatewayError } from "@/lib/prism-gateway";

export async function POST(request: Request) {
  const access = await requireAdminAccess();
  if (!access.ok)
    return NextResponse.json(
      { ok: false, error: access.error },
      { status: access.status },
    );
  const body = await request.json().catch(() => null);
  if (!body)
    return NextResponse.json(
      { ok: false, error: "Invalid JSON body" },
      { status: 400 },
    );
  try {
    return NextResponse.json(
      await prismGatewayRequest("/connections", {
        method: "POST",
        body: JSON.stringify(body),
      }),
    );
  } catch (error) {
    const status = error instanceof PrismGatewayError ? error.status : 500;
    return NextResponse.json(
      {
        ok: false,
        error:
          error instanceof Error ? error.message : "CONNECTION_CREATE_FAILED",
      },
      { status },
    );
  }
}
