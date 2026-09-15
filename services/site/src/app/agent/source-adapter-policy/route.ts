import { NextResponse } from "next/server"

import { loadConfig, readSourceAdapterPolicy } from "@/lib/app-core"
import { requireServiceAccess } from "@/lib/internal-service"

export async function GET() {
  const access = await requireServiceAccess()
  if (!access.ok) {
    return NextResponse.json({ ok: false, error: access.error }, { status: access.status })
  }

  return NextResponse.json({ ok: true, policy: readSourceAdapterPolicy(loadConfig()) })
}

export async function PATCH(_request: Request) {
  const access = await requireServiceAccess()
  if (!access.ok) {
    return NextResponse.json({ ok: false, error: access.error }, { status: access.status })
  }

  return NextResponse.json({ ok: false, error: "SOURCE_POLICY_READ_ONLY_USE_AGENT_PROFILE_BINDINGS" }, { status: 410 })
}
