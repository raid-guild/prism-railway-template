import { NextResponse } from "next/server";
import { readCaptureSummaryFile, summarizeCaptureSession } from "@/lib/app-core";
import { requireServiceAccess } from "@/lib/internal-service";

type RouteContext = {
  params: Promise<{ id: string }>;
};

function summaryFormat(request: Request) {
  const url = new URL(request.url);
  return url.searchParams.get("format") === "json" ? "json" : "markdown";
}

function summaryErrorStatus(message: string) {
  if (message === "CAPTURE_NOT_FOUND") return 404;
  if (message === "CAPTURE_TRANSCRIPT_NOT_READY" || message === "CAPTURE_SUMMARY_NOT_READY") return 409;
  if (message === "CODEX_RUNTIME_BASE_URL_MISSING") return 501;
  return 500;
}

export async function GET(request: Request, context: RouteContext) {
  const access = await requireServiceAccess();
  if (!access.ok) {
    return NextResponse.json({ ok: false, error: access.error }, { status: access.status });
  }

  const { id } = await context.params;
  try {
    const summary = await readCaptureSummaryFile(id, summaryFormat(request));
    return new NextResponse(summary.content, {
      headers: {
        "content-type": summary.mimeType,
        "content-length": String(summary.content.byteLength),
        "content-disposition": `inline; filename="${summary.filename}"`,
      },
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "CAPTURE_SUMMARY_NOT_FOUND";
    return NextResponse.json({ ok: false, error: message }, { status: summaryErrorStatus(message) });
  }
}

export async function POST(_request: Request, context: RouteContext) {
  const access = await requireServiceAccess();
  if (!access.ok) {
    return NextResponse.json({ ok: false, error: access.error }, { status: access.status });
  }

  const { id } = await context.params;
  try {
    const result = await summarizeCaptureSession(id);
    return NextResponse.json({ ok: true, capture: result.manifest, summary: result.summary });
  } catch (error) {
    const message = error instanceof Error ? error.message : "CAPTURE_SUMMARY_FAILED";
    return NextResponse.json({ ok: false, error: message }, { status: summaryErrorStatus(message) });
  }
}
