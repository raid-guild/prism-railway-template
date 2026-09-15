import { createHash } from "node:crypto"
import { NextResponse } from "next/server"
import {
  buildTaskScriptStoragePath,
  deleteTaskScriptFile,
  getTaskScriptByKey,
  listTaskScripts,
  upsertTaskScript,
  writeTaskScriptFile,
} from "@/lib/app-core"
import { parseNullableString, parseString, requireServiceAccess } from "@/lib/internal-service"

const taskScriptKeyPattern = /^[a-z0-9][a-z0-9-]{1,80}[a-z0-9]$/
const supportedRuntimes = new Set(["node-esm"])

function parseBoolean(value: unknown, fallback = false) {
  if (typeof value === "boolean") return value
  if (typeof value === "string") return new Set(["1", "true", "yes", "on"]).has(value.trim().toLowerCase())
  return fallback
}

function parseTimeoutMs(value: unknown, fallback: number | null) {
  if (value === undefined) return fallback
  if (value === null || value === "") return null
  const parsed = typeof value === "number" ? value : typeof value === "string" ? Number.parseInt(value, 10) : null
  return typeof parsed === "number" && Number.isFinite(parsed)
    ? Math.max(1_000, Math.min(3_600_000, Math.trunc(parsed)))
    : fallback
}

function checksumForContent(content: string) {
  return `sha256:${createHash("sha256").update(content.trimEnd() + "\n", "utf8").digest("hex")}`
}

export async function GET() {
  const access = await requireServiceAccess()
  if (!access.ok) {
    return NextResponse.json({ ok: false, error: access.error }, { status: access.status })
  }

  return NextResponse.json({ ok: true, scripts: listTaskScripts() })
}

export async function POST(request: Request) {
  const access = await requireServiceAccess()
  if (!access.ok) {
    return NextResponse.json({ ok: false, error: access.error }, { status: access.status })
  }

  let payload: unknown = null
  try {
    payload = await request.json()
  } catch {
    return NextResponse.json({ ok: false, error: "Invalid JSON body" }, { status: 400 })
  }

  const body = payload && typeof payload === "object" ? payload as Record<string, unknown> : {}
  const key = parseString(body.key).toLowerCase()
  const name = parseString(body.name)
  const content = typeof body.content === "string" ? body.content : ""
  const runtime = parseString(body.runtime) || "node-esm"

  if (!taskScriptKeyPattern.test(key)) {
    return NextResponse.json({ ok: false, error: "Invalid task script key" }, { status: 400 })
  }
  if (!name || !content.trim()) {
    return NextResponse.json({ ok: false, error: "name and content are required" }, { status: 400 })
  }
  if (!supportedRuntimes.has(runtime)) {
    return NextResponse.json({ ok: false, error: `Unsupported task script runtime: ${runtime}` }, { status: 400 })
  }

  const existing = getTaskScriptByKey(key)
  const checksum = checksumForContent(content)
  const storagePath = buildTaskScriptStoragePath({ key, checksum })

  try {
    await writeTaskScriptFile(storagePath, content)
    const script = upsertTaskScript({
      key,
      name,
      description: parseNullableString(body.description) ?? null,
      runtime,
      enabled: parseBoolean(body.enabled, existing?.enabled ?? false),
      storagePath,
      checksum,
      timeoutMs: parseTimeoutMs(body.timeoutMs ?? body.timeout_ms, existing?.timeoutMs ?? null),
    })
    if (existing && existing.storagePath !== storagePath) {
      await deleteTaskScriptFile(existing.storagePath).catch(() => undefined)
    }
    return NextResponse.json({ ok: true, script }, { status: 201 })
  } catch (error) {
    if (!existing || existing.storagePath !== storagePath) {
      await deleteTaskScriptFile(storagePath).catch(() => undefined)
    }
    const message = error instanceof Error ? error.message : String(error)
    return NextResponse.json({ ok: false, error: message }, { status: 500 })
  }
}
