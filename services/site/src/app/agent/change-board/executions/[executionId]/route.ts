import { NextResponse } from "next/server"

import { requireServiceAccess } from "@/lib/internal-service"

type RouteContext = {
  params: Promise<{ executionId: string }>
}

export async function PATCH(_request: Request, _context: RouteContext) {
  const access = await requireServiceAccess()
  if (!access.ok) {
    return NextResponse.json({ ok: false, error: access.error }, { status: access.status })
  }

  return NextResponse.json(
    {
      ok: false,
      error: "CHANGE_REQUEST_EXECUTIONS_DEPRECATED",
      message: "Update agent_runs instead of change_request_executions.",
    },
    { status: 410 },
  )
}
