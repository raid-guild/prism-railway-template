import { NextResponse } from "next/server";
import { readCaptureRecapFile, recapCaptureSession } from "@/lib/app-core";
import { requireCapabilityAccess } from "@/lib/admin-auth";

type RouteContext = {
  params: Promise<{ id: string }>;
};

function recapFormat(request: Request) {
  return new URL(request.url).searchParams.get("format") === "json" ? "json" : "markdown";
}

function recapErrorStatus(message: string) {
  if (message === "CAPTURE_NOT_FOUND") return 404;
  if (message === "CAPTURE_RECAP_NOT_READY" || message === "CAPTURE_TRANSCRIPT_CHUNKS_NOT_READY") return 409;
  if (message === "CODEX_RUNTIME_BASE_URL_MISSING") return 501;
  return 500;
}

export async function GET(request: Request, context: RouteContext) {
  const access = await requireCapabilityAccess("canRunAgent");
  if (!access.ok) {
    return NextResponse.json({ ok: false, error: access.error }, { status: access.status });
  }

  const { id } = await context.params;
  try {
    const recap = await readCaptureRecapFile(id, recapFormat(request));
    return new NextResponse(recap.content, {
      headers: {
        "content-type": recap.mimeType,
        "content-length": String(recap.content.byteLength),
        "content-disposition": `inline; filename="${recap.filename}"`,
      },
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "CAPTURE_RECAP_NOT_FOUND";
    return NextResponse.json({ ok: false, error: message }, { status: recapErrorStatus(message) });
  }
}

export async function POST(request: Request, context: RouteContext) {
  const access = await requireCapabilityAccess("canRunAgent");
  if (!access.ok) {
    return NextResponse.json({ ok: false, error: access.error }, { status: access.status });
  }

  const { id } = await context.params;
  try {
    const body = await request.json().catch(() => ({})) as { steering?: unknown; prompt?: unknown };
    const steering = typeof body.steering === "string"
      ? body.steering
      : typeof body.prompt === "string"
        ? body.prompt
        : null;
    const result = await recapCaptureSession({ captureId: id, steering });
    return NextResponse.json({ ok: true, capture: result.manifest, recap: result.recap });
  } catch (error) {
    const message = error instanceof Error ? error.message : "CAPTURE_RECAP_FAILED";
    return NextResponse.json({ ok: false, error: message }, { status: recapErrorStatus(message) });
  }
}
