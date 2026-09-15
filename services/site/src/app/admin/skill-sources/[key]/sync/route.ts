import { NextResponse } from "next/server"

import { syncSkillSource } from "@/lib/app-core"
import { readRouteParam, requireLocalAdminAccess } from "@/lib/local-admin-api"

type RouteContext = {
  params: Promise<{ key: string }>
}

export async function POST(_request: Request, context: RouteContext) {
  const access = await requireLocalAdminAccess()
  if (!access.ok) {
    return NextResponse.json({ ok: false, error: access.error }, { status: access.status })
  }
  const { key } = await context.params
  try {
    const source = syncSkillSource(readRouteParam(key))
    return NextResponse.json({ ok: true, source })
  } catch (error) {
    return NextResponse.json(
      { ok: false, error: error instanceof Error ? error.message : "Could not sync skill source" },
      { status: 400 },
    )
  }
}
