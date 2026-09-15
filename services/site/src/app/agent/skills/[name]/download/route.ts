import { NextResponse } from "next/server"
import { buildHostedSkillArchive, listHostedSkillSourceRoots, loadConfig } from "@/lib/app-core"

import { requireServiceAccess } from "@/lib/internal-service"
import { readRouteParam } from "@/lib/local-admin-api"

type RouteContext = {
  params: Promise<{ name: string }>
}

export async function GET(_request: Request, context: RouteContext) {
  const access = await requireServiceAccess()
  if (!access.ok) {
    return NextResponse.json({ ok: false, error: access.error }, { status: access.status })
  }

  const { name } = await context.params
  const config = loadConfig()
  const skillName = readRouteParam(name)
  const archive = buildHostedSkillArchive(config.repoRoot, skillName, config.customSkillsRoot, listHostedSkillSourceRoots())

  if (!archive) {
    return NextResponse.json({ ok: false, error: "Hosted skill not found" }, { status: 404 })
  }

  return new NextResponse(archive, {
    status: 200,
    headers: {
      "Content-Type": "application/gzip",
      "Content-Disposition": `attachment; filename="${skillName}.tar.gz"`,
    },
  })
}
