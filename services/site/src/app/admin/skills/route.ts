import { NextResponse } from "next/server"

import { listHostedSkillSourceRoots, listHostedSkills, loadConfig } from "@/lib/app-core"
import { requireLocalAdminAccess } from "@/lib/local-admin-api"

export async function GET() {
  const access = await requireLocalAdminAccess()
  if (!access.ok) {
    return NextResponse.json({ ok: false, error: access.error }, { status: access.status })
  }

  const config = loadConfig()
  return NextResponse.json({
    ok: true,
    skills: listHostedSkills(config.repoRoot, config.customSkillsRoot, listHostedSkillSourceRoots()),
  })
}
