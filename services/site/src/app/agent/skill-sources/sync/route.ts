import { NextResponse } from "next/server"

import { syncSkillSources } from "@/lib/app-core"
import { requireServiceAccess } from "@/lib/internal-service"

export async function POST() {
  const access = await requireServiceAccess()
  if (!access.ok) {
    return NextResponse.json({ ok: false, error: access.error }, { status: access.status })
  }

  const result = syncSkillSources({ enabledOnly: true })
  return NextResponse.json(result, { status: result.ok ? 200 : 207 })
}
