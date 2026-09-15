import { NextResponse } from "next/server"
import { reconcileTerminalWorkflowProjection } from "@/lib/app-core"
import { parseString, requireServiceAccess } from "@/lib/internal-service"

type RouteContext = {
  params: Promise<{ requestNumber: string }>
}

function readRequestNumber(value: string) {
  if (!/^\d+$/.test(value)) return null
  const parsed = Number(value)
  return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : null
}

export async function POST(request: Request, context: RouteContext) {
  const access = await requireServiceAccess()
  if (!access.ok) {
    return NextResponse.json({ ok: false, error: access.error }, { status: access.status })
  }

  const rawBody = await request.text().catch(() => "")
  let body: Record<string, unknown> = {}
  if (rawBody.trim()) {
    try {
      const payload = JSON.parse(rawBody) as unknown
      if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
        return NextResponse.json({ ok: false, error: "Invalid JSON body" }, { status: 400 })
      }
      body = payload as Record<string, unknown>
    } catch {
      return NextResponse.json({ ok: false, error: "Invalid JSON body" }, { status: 400 })
    }
  }

  const { requestNumber: rawRequestNumber } = await context.params
  const requestNumber = readRequestNumber(rawRequestNumber)
  if (!requestNumber) {
    return NextResponse.json({ ok: false, error: "Invalid request number" }, { status: 400 })
  }

  const rawTerminalStepKey = body.terminalStepKey ?? body.terminal_step_key
  const terminalStepKey = rawTerminalStepKey == null ? null : parseString(rawTerminalStepKey)
  if (rawTerminalStepKey != null && !terminalStepKey) {
    return NextResponse.json({ ok: false, error: "Invalid terminal step key" }, { status: 400 })
  }
  const dryRun = body.dryRun !== false && body.dry_run !== false
  const result = reconcileTerminalWorkflowProjection({
    requestNumber,
    terminalStepKey,
    dryRun,
    actorType: "service",
    actorId: "agent-api",
    note: parseString(body.comment ?? body.note) || null,
  })

  const status = result.outcome === "not_found" ? 404 : result.outcome === "blocked" ? 409 : 200
  return NextResponse.json({ ok: result.ok, result }, { status })
}
