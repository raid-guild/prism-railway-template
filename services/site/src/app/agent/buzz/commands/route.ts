import { NextResponse } from "next/server"

import { executeBuzzCommand, parseBuzzCommandArgs } from "@/lib/buzz-agent-api"
import { requireServiceAccess } from "@/lib/internal-service"

export async function POST(request: Request) {
  const access = await requireServiceAccess()
  if (!access.ok) return NextResponse.json({ ok: false, error: access.error }, { status: access.status })
  const body = await request.json().catch(() => null) as Record<string, unknown> | null
  const args = parseBuzzCommandArgs(body?.args)
  if (!args) return NextResponse.json({ ok: false, error: "A bounded Buzz args array is required" }, { status: 400 })
  try {
    return NextResponse.json({ ok: true, result: await executeBuzzCommand(args) })
  } catch (error) {
    return NextResponse.json({ ok: false, error: error instanceof Error ? error.message : "BUZZ_COMMAND_FAILED" }, { status: 502 })
  }
}
