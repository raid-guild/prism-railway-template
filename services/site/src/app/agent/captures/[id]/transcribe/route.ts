import { NextResponse } from "next/server";
import { readCaptureDispatchSettings, transcribeCaptureSession } from "@/lib/app-core";
import { requireServiceAccess } from "@/lib/internal-service";
import { dispatchCaptureTranscript } from "@/lib/app-core/capture-dispatch";

type RouteContext = {
  params: Promise<{ id: string }>;
};

function transcriptionErrorStatus(message: string) {
  if (message === "CAPTURE_NOT_FOUND") return 404;
  if (message === "CAPTURE_NOT_FINALIZED" || message === "CAPTURE_HAS_NO_CHUNKS") return 409;
  if (message === "CAPTURE_TRANSCRIPTION_NOT_CONFIGURED") return 501;
  return 500;
}

export async function POST(request: Request, context: RouteContext) {
  const access = await requireServiceAccess();
  if (!access.ok) {
    return NextResponse.json({ ok: false, error: access.error }, { status: access.status });
  }

  const { id } = await context.params;
  try {
    const result = await transcribeCaptureSession(id);
    const settings = await readCaptureDispatchSettings();
    const dispatch = settings.autoDispatchOnTranscript && settings.destinationType !== "none"
      ? await dispatchCaptureTranscript(id, { baseUrl: new URL(request.url).origin, settings })
      : null;
    return NextResponse.json({
      ok: true,
      capture: dispatch?.manifest ?? result.manifest,
      transcript: result.transcript,
      dispatch: dispatch?.result ?? null,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "CAPTURE_TRANSCRIPTION_FAILED";
    return NextResponse.json({ ok: false, error: message }, { status: transcriptionErrorStatus(message) });
  }
}
