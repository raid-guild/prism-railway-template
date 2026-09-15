import { NextResponse } from "next/server";
import { getCaptureManifest } from "@/lib/app-core";
import { requireCapabilityAccess } from "@/lib/admin-auth";

type RouteContext = {
  params: Promise<{ id: string }>;
};

export async function GET(_request: Request, context: RouteContext) {
  const access = await requireCapabilityAccess("canRunAgent");
  if (!access.ok) {
    return NextResponse.json({ ok: false, error: access.error }, { status: access.status });
  }

  const { id } = await context.params;
  const capture = await getCaptureManifest(id);
  if (!capture) {
    return NextResponse.json({ ok: false, error: "Capture not found" }, { status: 404 });
  }

  return NextResponse.json({ ok: true, capture });
}
