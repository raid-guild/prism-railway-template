import { NextResponse } from "next/server"
import { listHostedSkillSourceRoots, listHostedSkills, loadConfig, upsertCustomSkill } from "@/lib/app-core"

import { requireServiceAccess } from "@/lib/internal-service"

export async function GET() {
  const access = await requireServiceAccess()
  if (!access.ok) {
    return NextResponse.json({ ok: false, error: access.error }, { status: access.status })
  }

  const config = loadConfig()
  const skills = listHostedSkills(config.repoRoot, config.customSkillsRoot, listHostedSkillSourceRoots()).map((skill) => ({
    ...skill,
    downloadPath: `/agent/skills/${skill.name}/download`,
  }))

  return NextResponse.json({ ok: true, skills })
}

export async function POST(request: Request) {
  const access = await requireServiceAccess()
  if (!access.ok) {
    return NextResponse.json({ ok: false, error: access.error }, { status: access.status })
  }

  const body = (await request.json().catch(() => null)) as {
    name?: unknown
    content?: unknown
  } | null
  const name = typeof body?.name === "string" ? body.name.trim() : ""
  const content = typeof body?.content === "string" ? body.content : ""
  if (!name || !content.trim()) {
    return NextResponse.json({ ok: false, error: "name and content are required" }, { status: 400 })
  }

  const config = loadConfig()
  try {
    const skill = upsertCustomSkill(config.customSkillsRoot, name, content)
    return NextResponse.json({
      ok: true,
      skill: {
        ...skill,
        downloadPath: `/agent/skills/${skill.name}/download`,
      },
    })
  } catch (error) {
    return NextResponse.json(
      { ok: false, error: error instanceof Error ? error.message : "Could not save skill" },
      { status: 400 },
    )
  }
}
