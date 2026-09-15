import { NextResponse } from "next/server";
import { requestRuntimeResponse } from "@/lib/app-core/runtime-client";
import { requireServiceAccess } from "@/lib/internal-service";
import { normalizeModelTier } from "@/lib/model-tier";

function stringValue(value: unknown) {
  return typeof value === "string" ? value.trim() : "";
}

function recordValue(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}

function stringArray(value: unknown) {
  return Array.isArray(value)
    ? value.filter((entry): entry is string => typeof entry === "string" && Boolean(entry.trim()))
    : [];
}

function timeoutMs(value: unknown) {
  const parsed = typeof value === "number" ? value : Number.parseInt(String(value ?? ""), 10);
  if (!Number.isFinite(parsed) || parsed <= 0) return undefined;
  return Math.min(Math.max(parsed, 1_000), 1_200_000);
}

function errorDetails(error: unknown) {
  if (!(error instanceof Error)) return { message: String(error) };
  const cause = error.cause && typeof error.cause === "object"
    ? error.cause as { code?: unknown; message?: unknown }
    : null;
  return {
    message: error.message,
    causeCode: typeof cause?.code === "string" ? cause.code : null,
    causeMessage: typeof cause?.message === "string" ? cause.message : null,
  };
}

export async function POST(request: Request) {
  const access = await requireServiceAccess();
  if (!access.ok) {
    return NextResponse.json({ ok: false, error: access.error }, { status: access.status });
  }

  const body = await request.json().catch(() => null) as Record<string, unknown> | null;
  const prompt = stringValue(body?.prompt);
  const sessionId = stringValue(body?.sessionId);
  if (!prompt || !sessionId) {
    return NextResponse.json({ ok: false, error: "prompt and sessionId are required" }, { status: 400 });
  }
  if (prompt.length > 500_000) {
    return NextResponse.json({ ok: false, error: "RUNTIME_PROMPT_TOO_LARGE" }, { status: 413 });
  }

  const recentHistory = Array.isArray(body?.recentHistory)
    ? body.recentHistory.flatMap((entry) => {
        const record = recordValue(entry);
        const role = stringValue(record.role);
        const content = stringValue(record.content);
        return role && content ? [{ role, content }] : [];
      })
    : [];
  const credentials = Array.isArray(body?.credentials)
    ? body.credentials.filter((entry) => typeof entry === "string" || (entry && typeof entry === "object" && !Array.isArray(entry))) as Array<string | { key: string }>
    : [];
  const metadata = recordValue(body?.metadata);
  const skills = stringArray(body?.skills).length > 0
    ? stringArray(body?.skills)
    : stringArray(metadata.requestedSkills);
  const runtimeKey = stringValue(body?.runtimeProfileKey ?? body?.runtimeKey) || null;
  let modelTier = null;
  try {
    modelTier = normalizeModelTier(body?.modelTier ?? body?.model_tier ?? metadata.modelTier ?? metadata.model_tier);
  } catch (error) {
    return NextResponse.json({ ok: false, error: error instanceof Error ? error.message : "MODEL_TIER_INVALID" }, { status: 400 });
  }

  try {
    const response = await requestRuntimeResponse({
      prompt,
      sessionId,
      continuationId: stringValue(body?.continuationId) || null,
      recentHistory,
      skills,
      credentials,
      context: Object.fromEntries(
        Object.entries(recordValue(body?.context)).map(([key, value]) => [key, value == null ? undefined : String(value)]),
      ),
      metadata,
      runtimeKey,
      modelTier,
      timeoutMs: timeoutMs(body?.timeoutMs),
    });
    return NextResponse.json({ ok: true, response });
  } catch (error) {
    console.error("[site-runtime] invoke failed", {
      sessionId,
      runtimeKey,
      ...errorDetails(error),
    });
    return NextResponse.json({
      ok: false,
      error: error instanceof Error ? error.message : "RUNTIME_REQUEST_FAILED",
    }, { status: 502 });
  }
}
