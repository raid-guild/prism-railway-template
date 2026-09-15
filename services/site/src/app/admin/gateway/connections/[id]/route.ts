import { NextResponse } from "next/server";
import { requireAdminAccess } from "@/lib/admin-auth";
import { prismGatewayRequest, PrismGatewayError } from "@/lib/prism-gateway";

type RouteContext = { params: Promise<{ id: string }> };

function failure(error: unknown) {
  const status = error instanceof PrismGatewayError ? error.status : 500;
  return NextResponse.json(
    {
      ok: false,
      error:
        error instanceof Error ? error.message : "CONNECTION_UPDATE_FAILED",
    },
    { status },
  );
}

export async function PUT(request: Request, context: RouteContext) {
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
  const { id } = await context.params;
  try {
    return NextResponse.json(
      await prismGatewayRequest(
        `/connections/${encodeURIComponent(id)}/credentials`,
        {
          method: "PUT",
          body: JSON.stringify(body),
        },
      ),
    );
  } catch (error) {
    return failure(error);
  }
}

export async function PATCH(request: Request, context: RouteContext) {
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
  const { id } = await context.params;
  try {
    return NextResponse.json(
      await prismGatewayRequest(`/credential-bundles/${encodeURIComponent(id)}`, {
        method: "PATCH",
        body: JSON.stringify(body),
      }),
    );
  } catch (error) {
    return failure(error);
  }
}

export async function DELETE(_request: Request, context: RouteContext) {
  const access = await requireAdminAccess();
  if (!access.ok)
    return NextResponse.json(
      { ok: false, error: access.error },
      { status: access.status },
    );
  const { id } = await context.params;
  try {
    return NextResponse.json(
      await prismGatewayRequest(`/connections/${encodeURIComponent(id)}`, {
        method: "DELETE",
      }),
    );
  } catch (error) {
    return failure(error);
  }
}
