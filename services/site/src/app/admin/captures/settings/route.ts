import { NextResponse } from "next/server";
import { readCaptureDispatchSettings, writeCaptureDispatchSettings } from "@/lib/app-core";
import { requireCapabilityAccess } from "@/lib/admin-auth";

export async function GET() {
  const access = await requireCapabilityAccess("canRunAgent");
  if (!access.ok) {
    return NextResponse.json({ ok: false, error: access.error }, { status: access.status });
  }

  return NextResponse.json({ ok: true, settings: await readCaptureDispatchSettings() });
}

export async function PATCH(request: Request) {
  const access = await requireCapabilityAccess("canRunAgent");
  if (!access.ok) {
    return NextResponse.json({ ok: false, error: access.error }, { status: access.status });
  }

  const payload = await request.json().catch(() => null);
  const settings = await writeCaptureDispatchSettings(payload);
  return NextResponse.json({ ok: true, settings });
}
