import { NextResponse } from "next/server"

import { listSkillSources, upsertSkillSource } from "@/lib/app-core"
import { parseString, requireLocalAdminAccess } from "@/lib/local-admin-api"

function parseBoolean(value: unknown, fallback = true) {
  if (typeof value === "boolean") return value
  if (typeof value === "string") {
    const normalized = value.trim().toLowerCase()
    if (new Set(["1", "true", "yes", "on"]).has(normalized)) return true
    if (new Set(["0", "false", "no", "off"]).has(normalized)) return false
  }
  return fallback
}

export async function GET() {
  const access = await requireLocalAdminAccess()
  if (!access.ok) {
    return NextResponse.json({ ok: false, error: access.error }, { status: access.status })
  }

  return NextResponse.json({ ok: true, sources: listSkillSources() })
}

export async function POST(request: Request) {
  const access = await requireLocalAdminAccess()
  if (!access.ok) {
    return NextResponse.json({ ok: false, error: access.error }, { status: access.status })
  }

  const body = (await request.json().catch(() => null)) as Record<string, unknown> | null
  const key = parseString(body?.key)
  const repoUrl = parseString(body?.repoUrl ?? body?.repo_url)
  if (!key || !repoUrl) {
    return NextResponse.json({ ok: false, error: "key and repoUrl are required" }, { status: 400 })
  }

  try {
    const source = upsertSkillSource({
      key,
      name: parseString(body?.name) || key,
      repoUrl,
      branch: parseString(body?.branch) || "main",
      sourcePath: parseString(body?.sourcePath ?? body?.source_path) || "skills",
      enabled: parseBoolean(body?.enabled, true),
    })
    return NextResponse.json({ ok: true, source })
  } catch (error) {
    return NextResponse.json(
      { ok: false, error: error instanceof Error ? error.message : "Could not save skill source" },
      { status: 400 },
    )
  }
}
