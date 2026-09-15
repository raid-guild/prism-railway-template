import { NextResponse } from "next/server"
import {
  buildTaskScriptStoragePath,
  deleteTaskScriptByKey,
  deleteTaskScriptFile,
  getTaskScriptByKey,
  listTasks,
  upsertTaskScript,
  writeTaskScriptFile,
} from "@/lib/app-core"
import { createHash } from "node:crypto"
import { parseNullableString, parseString, requireServiceAccess } from "@/lib/internal-service"

type RouteContext = {
  params: Promise<{ key: string }>
}

const supportedRuntimes = new Set(["node-esm"])

function parseBoolean(value: unknown, fallback: boolean) {
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

function taskReferencesScript(task: { inputConfig: Record<string, unknown> }, key: string) {
  const scriptKey = task.inputConfig.scriptKey ?? task.inputConfig.script_key
  return typeof scriptKey === "string" && scriptKey.trim() === key
}

export async function GET(_request: Request, context: RouteContext) {
  const access = await requireServiceAccess()
  if (!access.ok) {
    return NextResponse.json({ ok: false, error: access.error }, { status: access.status })
  }

  const { key } = await context.params
  const script = getTaskScriptByKey(decodeURIComponent(key))
  if (!script) {
    return NextResponse.json({ ok: false, error: "Task script not found" }, { status: 404 })
  }
  return NextResponse.json({ ok: true, script })
}

export async function PATCH(request: Request, context: RouteContext) {
  const access = await requireServiceAccess()
  if (!access.ok) {
    return NextResponse.json({ ok: false, error: access.error }, { status: access.status })
  }

  const { key: rawKey } = await context.params
  const key = decodeURIComponent(rawKey)
  const existing = getTaskScriptByKey(key)
  if (!existing) {
    return NextResponse.json({ ok: false, error: "Task script not found" }, { status: 404 })
  }

  let payload: unknown = null
  try {
    payload = await request.json()
  } catch {
    return NextResponse.json({ ok: false, error: "Invalid JSON body" }, { status: 400 })
  }

  const body = payload && typeof payload === "object" ? payload as Record<string, unknown> : {}
  const runtime = body.runtime === undefined ? existing.runtime : parseString(body.runtime) || existing.runtime
  if (!supportedRuntimes.has(runtime)) {
    return NextResponse.json({ ok: false, error: `Unsupported task script runtime: ${runtime}` }, { status: 400 })
  }

  const content = typeof body.content === "string" ? body.content : null
  const checksum = content === null ? existing.checksum : checksumForContent(content)
  const storagePath = content === null ? existing.storagePath : buildTaskScriptStoragePath({ key, checksum })

  try {
    if (content !== null) {
      if (!content.trim()) {
        return NextResponse.json({ ok: false, error: "content must not be empty" }, { status: 400 })
      }
      await writeTaskScriptFile(storagePath, content)
    }

    const script = upsertTaskScript({
      key,
      name: parseString(body.name) || existing.name,
      description: body.description === undefined
        ? existing.description
        : parseNullableString(body.description) ?? null,
      runtime,
      enabled: parseBoolean(body.enabled, existing.enabled),
      storagePath,
      checksum,
      timeoutMs: parseTimeoutMs(body.timeoutMs ?? body.timeout_ms, existing.timeoutMs),
    })

    if (existing.storagePath !== storagePath) {
      await deleteTaskScriptFile(existing.storagePath).catch(() => undefined)
    }

    return NextResponse.json({ ok: true, script })
  } catch (error) {
    if (storagePath !== existing.storagePath) {
      await deleteTaskScriptFile(storagePath).catch(() => undefined)
    }
    const message = error instanceof Error ? error.message : String(error)
    return NextResponse.json({ ok: false, error: message }, { status: 500 })
  }
}

export async function DELETE(_request: Request, context: RouteContext) {
  const access = await requireServiceAccess()
  if (!access.ok) {
    return NextResponse.json({ ok: false, error: access.error }, { status: access.status })
  }

  const { key: rawKey } = await context.params
  const key = decodeURIComponent(rawKey)
  const referencedBy = listTasks().filter((task) => taskReferencesScript(task, key))
  if (referencedBy.length) {
    return NextResponse.json({
      ok: false,
      error: "Task script is referenced by existing tasks",
      tasks: referencedBy.map((task) => ({ key: task.key, enabled: task.enabled })),
    }, { status: 409 })
  }

  const script = deleteTaskScriptByKey(key)
  if (!script) {
    return NextResponse.json({ ok: false, error: "Task script not found" }, { status: 404 })
  }
  await deleteTaskScriptFile(script.storagePath).catch(() => undefined)
  return NextResponse.json({ ok: true, script })
}
