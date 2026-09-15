import { NextResponse } from "next/server"
import { getTaskScriptByKey, readTaskScriptFile } from "@/lib/app-core"
import { requireServiceAccess } from "@/lib/internal-service"

type RouteContext = {
  params: Promise<{ key: string }>
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

  try {
    const content = await readTaskScriptFile(script)
    return NextResponse.json({ ok: true, script, content })
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    return NextResponse.json({ ok: false, error: message }, { status: 500 })
  }
}
