import { NextResponse } from "next/server"

import { deleteSkillSource, getSkillSource } from "@/lib/app-core"
import { readRouteParam, requireLocalAdminAccess } from "@/lib/local-admin-api"

type RouteContext = {
  params: Promise<{ key: string }>
}

export async function GET(_request: Request, context: RouteContext) {
  const access = await requireLocalAdminAccess()
  if (!access.ok) {
    return NextResponse.json({ ok: false, error: access.error }, { status: access.status })
  }
  const { key } = await context.params
  const source = getSkillSource(readRouteParam(key))
  return source
    ? NextResponse.json({ ok: true, source })
    : NextResponse.json({ ok: false, error: "Skill source not found" }, { status: 404 })
}

export async function DELETE(_request: Request, context: RouteContext) {
  const access = await requireLocalAdminAccess()
  if (!access.ok) {
    return NextResponse.json({ ok: false, error: access.error }, { status: access.status })
  }
  const { key } = await context.params
  const source = deleteSkillSource(readRouteParam(key))
  return source
    ? NextResponse.json({ ok: true, source })
    : NextResponse.json({ ok: false, error: "Skill source not found" }, { status: 404 })
}
