import { NextResponse } from "next/server";
import { transcribeCaptureChunk, writeCaptureChunk } from "@/lib/app-core";
import { requireCapabilityAccess } from "@/lib/admin-auth";

type RouteContext = {
  params: Promise<{ id: string }>;
};

function parseString(value: FormDataEntryValue | null) {
  return typeof value === "string" ? value.trim() : "";
}

function parseInteger(value: FormDataEntryValue | null) {
  const parsed = Number.parseInt(parseString(value), 10);
  return Number.isFinite(parsed) ? parsed : null;
}

export async function POST(request: Request, context: RouteContext) {
  const access = await requireCapabilityAccess("canRunAgent");
  if (!access.ok) {
    return NextResponse.json({ ok: false, error: access.error }, { status: access.status });
  }

  const { id } = await context.params;
  const formData = await request.formData().catch(() => null);
  if (!formData) {
    return NextResponse.json({ ok: false, error: "Invalid form data" }, { status: 400 });
  }

  const file = formData.get("chunk");
  if (!(file instanceof Blob)) {
    return NextResponse.json({ ok: false, error: "chunk is required" }, { status: 400 });
  }

  const index = parseInteger(formData.get("index"));
  if (index === null || index < 0) {
    return NextResponse.json({ ok: false, error: "index must be a non-negative integer" }, { status: 400 });
  }

  const mimeType = parseString(formData.get("mimeType")) || file.type || "application/octet-stream";
  const durationMs = parseInteger(formData.get("durationMs"));
  const content = Buffer.from(await file.arrayBuffer());

  try {
    const result = await writeCaptureChunk({
      captureId: id,
      index,
      content,
      mimeType,
      startedAt: parseString(formData.get("startedAt")) || null,
      endedAt: parseString(formData.get("endedAt")) || null,
      durationMs,
    });

    void transcribeCaptureChunk(id, index).catch((error) => {
      console.warn(JSON.stringify({
        event: "capture_chunk_transcription_failed",
        captureId: id,
        chunkIndex: index,
        error: error instanceof Error ? error.message : "CAPTURE_CHUNK_TRANSCRIPTION_FAILED",
      }));
    });
    return NextResponse.json({
      ok: true,
      manifest: result.manifest,
      chunk: result.chunk,
      transcript: { status: "queued" },
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Could not store capture chunk";
    const status = message === "CAPTURE_NOT_FOUND" ? 404 : message === "CAPTURE_NOT_RECORDING" ? 409 : 500;
    return NextResponse.json({ ok: false, error: message }, { status });
  }
}
