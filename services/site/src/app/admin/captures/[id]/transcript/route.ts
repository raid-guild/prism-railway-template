import { NextResponse } from "next/server";
import { readCaptureTranscriptFile } from "@/lib/app-core";
import { requireCapabilityAccess } from "@/lib/admin-auth";

type RouteContext = {
  params: Promise<{ id: string }>;
};

function transcriptFormat(request: Request) {
  return new URL(request.url).searchParams.get("format") === "json" ? "json" : "markdown";
}

export async function GET(request: Request, context: RouteContext) {
  const access = await requireCapabilityAccess("canRunAgent");
  if (!access.ok) {
    return NextResponse.json({ ok: false, error: access.error }, { status: access.status });
  }

  const { id } = await context.params;
  try {
    const transcript = await readCaptureTranscriptFile(id, transcriptFormat(request));
    return new NextResponse(transcript.content, {
      headers: {
        "content-type": transcript.mimeType,
        "content-length": String(transcript.content.byteLength),
        "content-disposition": `inline; filename="${transcript.filename}"`,
      },
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "CAPTURE_TRANSCRIPT_NOT_FOUND";
    const status = message === "CAPTURE_NOT_FOUND" ? 404 : message === "CAPTURE_TRANSCRIPT_NOT_READY" ? 409 : 500;
    return NextResponse.json({ ok: false, error: message }, { status });
  }
}
