import { NextResponse } from "next/server";
import { requireCapabilityAccess } from "@/lib/admin-auth";
import { dispatchCaptureTranscript } from "@/lib/app-core/capture-dispatch";

type RouteContext = {
  params: Promise<{ id: string }>;
};

function dispatchErrorStatus(message: string) {
  if (message === "CAPTURE_NOT_FOUND") return 404;
  if (message === "CAPTURE_TRANSCRIPT_NOT_READY") return 409;
  if (message === "CAPTURE_DISPATCH_NOT_CONFIGURED" || message === "CAPTURE_DISPATCH_DESTINATION_REQUIRED") return 400;
  if (message === "HOOK_NOT_FOUND") return 404;
  if (message === "HOOK_DISABLED" || message === "WORKFLOW_DISABLED") return 409;
  return 500;
}

export async function POST(request: Request, context: RouteContext) {
  const access = await requireCapabilityAccess("canRunAgent");
  if (!access.ok) {
    return NextResponse.json({ ok: false, error: access.error }, { status: access.status });
  }

  const { id } = await context.params;
  try {
    const result = await dispatchCaptureTranscript(id, {
      baseUrl: new URL(request.url).origin,
    });
    return NextResponse.json({ ok: true, capture: result.manifest, dispatch: result.result, settings: result.settings });
  } catch (error) {
    const message = error instanceof Error ? error.message : "CAPTURE_DISPATCH_FAILED";
    return NextResponse.json({ ok: false, error: message }, { status: dispatchErrorStatus(message) });
  }
}
