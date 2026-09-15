import { NextResponse } from "next/server";

import { requireCapabilityAccess } from "@/lib/admin-auth";
import { fetchPrismMemoryJson } from "@/lib/prism-memory";

function record(value: unknown) {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ slug: string[] }> },
) {
  const access = await requireCapabilityAccess("canViewMemory");
  if (!access.ok)
    return NextResponse.json(
      { ok: false, error: access.error },
      { status: access.status },
    );
  const { slug } = await params;
  const safe = slug.filter(
    (segment) => segment && segment !== "." && segment !== "..",
  );
  if (!safe.length || safe.length !== slug.length)
    return NextResponse.json(
      { ok: false, error: "Invalid knowledge slug" },
      { status: 400 },
    );
  const path = safe.map(encodeURIComponent).join("/");
  const result = await fetchPrismMemoryJson(`/knowledge/docs/${path}`);
  if (!result.ok)
    return NextResponse.json(
      { ok: false, error: result.error },
      { status: result.status },
    );
  const payload = record(result.data);
  const metadata = record(payload.metadata);
  const audience =
    typeof (metadata.audience ?? payload.audience) === "string"
      ? String(metadata.audience ?? payload.audience).toLowerCase()
      : "workspace";
  if (
    ["admin", "administrator", "operator", "internal", "restricted"].includes(
      audience,
    ) &&
    !access.capabilities.includes("canRunAgent") &&
    !access.capabilities.includes("canManageMemorySources")
  )
    return NextResponse.json(
      { ok: false, error: "Forbidden" },
      { status: 403 },
    );
  return NextResponse.json(payload);
}
