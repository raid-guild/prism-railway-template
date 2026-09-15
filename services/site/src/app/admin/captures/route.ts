import { NextResponse } from "next/server";
import { createCaptureSession, listCaptureManifests, readCaptureDispatchSettings } from "@/lib/app-core";
import { requireCapabilityAccess } from "@/lib/admin-auth";

function parseRecord(value: unknown) {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}

function parseString(value: unknown) {
  return typeof value === "string" ? value.trim() : "";
}

function parseNumber(value: unknown) {
  const parsed = typeof value === "number" ? value : Number.parseInt(parseString(value), 10);
  return Number.isFinite(parsed) ? parsed : null;
}

export async function POST(request: Request) {
  const access = await requireCapabilityAccess("canRunAgent");
  if (!access.ok) {
    return NextResponse.json({ ok: false, error: access.error }, { status: access.status });
  }

  let payload: unknown = null;
  try {
    payload = await request.json();
  } catch {
    return NextResponse.json({ ok: false, error: "Invalid JSON body" }, { status: 400 });
  }

  const body = parseRecord(payload);
  const manifest = await createCaptureSession({
    title: parseString(body.title),
    requestId: parseString(body.requestId ?? body.request_id),
    sourcePlatform: parseString(body.sourcePlatform ?? body.source_platform),
    notes: parseString(body.notes),
    mimeType: parseString(body.mimeType ?? body.mime_type),
    audioBitsPerSecond: parseNumber(body.audioBitsPerSecond ?? body.audio_bits_per_second),
    chunkSeconds: parseNumber(body.chunkSeconds ?? body.chunk_seconds),
  });

  return NextResponse.json({ ok: true, capture: manifest }, { status: 201 });
}

export async function GET(request: Request) {
  const access = await requireCapabilityAccess("canRunAgent");
  if (!access.ok) {
    return NextResponse.json({ ok: false, error: access.error }, { status: access.status });
  }

  const url = new URL(request.url);
  const limit = Number.parseInt(url.searchParams.get("limit") ?? "50", 10);
  const [captures, settings] = await Promise.all([
    listCaptureManifests(Number.isFinite(limit) ? limit : 50),
    readCaptureDispatchSettings(),
  ]);
  return NextResponse.json({ ok: true, captures, settings });
}
