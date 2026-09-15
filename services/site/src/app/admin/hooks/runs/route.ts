import { NextResponse } from "next/server"

import { listHookRuns } from "@/lib/app-core"
import { requireLocalAdminAccess } from "@/lib/local-admin-api"

export async function GET(request: Request) {
  const access = await requireLocalAdminAccess()
  if (!access.ok) {
    return NextResponse.json({ ok: false, error: access.error }, { status: access.status })
  }

  const url = new URL(request.url)
  const hookKey = url.searchParams.get("hookKey")
  const limitRaw = Number(url.searchParams.get("limit") ?? 50)
  const limit = Number.isFinite(limitRaw) ? limitRaw : 50

  return NextResponse.json({
    ok: true,
    runs: listHookRuns({ hookKey, limit }),
  })
}
