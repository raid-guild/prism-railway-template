import { NextResponse } from "next/server"

import { listAgentRuns } from "@/lib/app-core"
import { requireLocalAdminAccess } from "@/lib/local-admin-api"

function parseLimit(value: string | null) {
  const parsed = Number(value ?? 50)
  return Number.isFinite(parsed) ? Math.max(1, Math.min(Math.trunc(parsed), 200)) : 50
}

function parseString(value: string | null) {
  return value?.trim() || null
}

export async function GET(request: Request) {
  const access = await requireLocalAdminAccess()
  if (!access.ok) {
    return NextResponse.json({ ok: false, error: access.error }, { status: access.status })
  }

  const url = new URL(request.url)
  const limit = parseLimit(url.searchParams.get("limit"))
  const kind = parseString(url.searchParams.get("kind"))
  const status = parseString(url.searchParams.get("status"))
  const requestId = parseString(url.searchParams.get("requestId") ?? url.searchParams.get("request_id"))
  const taskKey = parseString(url.searchParams.get("taskKey") ?? url.searchParams.get("task_key"))
  const hookKey = parseString(url.searchParams.get("hookKey") ?? url.searchParams.get("hook_key"))

  return NextResponse.json({
    ok: true,
    runs: listAgentRuns({ kind, status, requestId, taskKey, hookKey, limit }),
  })
}
