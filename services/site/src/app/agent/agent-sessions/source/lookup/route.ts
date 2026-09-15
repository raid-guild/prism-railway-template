import { NextResponse } from "next/server"
import { findAgentSessionBySourceContext, listAgentMessages } from "@/lib/app-core"

import { parseString, readOptionalInteger, requireServiceAccess } from "@/lib/internal-service"

export async function GET(request: Request) {
  const access = await requireServiceAccess()
  if (!access.ok) {
    return NextResponse.json({ ok: false, error: access.error }, { status: access.status })
  }

  const url = new URL(request.url)
  const source = parseString(url.searchParams.get("source"))
  const contextKey = parseString(url.searchParams.get("contextKey") ?? url.searchParams.get("context_key"))
  if (!source || !contextKey) {
    return NextResponse.json({ ok: false, error: "source and contextKey are required" }, { status: 400 })
  }

  const session = findAgentSessionBySourceContext({ source, contextKey })
  if (!session) {
    return NextResponse.json({ ok: false, error: "Agent session not found" }, { status: 404 })
  }

  const limit = readOptionalInteger(url.searchParams.get("limit")) ?? 100
  return NextResponse.json({ ok: true, session, messages: listAgentMessages(session.id, limit) })
}
