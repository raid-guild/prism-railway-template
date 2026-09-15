import { NextResponse } from "next/server";
import { finalizeCaptureSession } from "@/lib/app-core";
import { requireCapabilityAccess } from "@/lib/admin-auth";
import { queueCapturePostProcessing } from "@/lib/app-core/capture-post-processing";

type RouteContext = {
  params: Promise<{ id: string }>;
};

function parseRecord(value: unknown) {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}

function parseString(value: unknown) {
  return typeof value === "string" ? value.trim() : "";
}

export async function POST(request: Request, context: RouteContext) {
  const access = await requireCapabilityAccess("canRunAgent");
  if (!access.ok) {
    return NextResponse.json({ ok: false, error: access.error }, { status: access.status });
  }

  const { id } = await context.params;
  const payload = await request.json().catch(() => null);
  const body = parseRecord(payload);

  try {
    const capture = await finalizeCaptureSession({
      captureId: id,
      notes: parseString(body.notes),
      requestId: parseString(body.requestId ?? body.request_id),
    });
    const postProcessingQueued = queueCapturePostProcessing(id, {
      baseUrl: new URL(request.url).origin,
    });

    return NextResponse.json({
      ok: true,
      capture,
      postProcessingQueued,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Could not finalize capture";
    const status = message === "CAPTURE_NOT_FOUND" ? 404 : 500;
    return NextResponse.json({ ok: false, error: message }, { status });
  }
}
