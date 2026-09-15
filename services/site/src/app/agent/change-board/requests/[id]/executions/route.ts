import { NextResponse } from "next/server"
import { getChangeRequest, listAgentRuns, listChangeRequestExecutions } from "@/lib/app-core"

import { requireServiceAccess } from "@/lib/internal-service"
import { readRouteParam } from "@/lib/local-admin-api"

type RouteContext = {
  params: Promise<{ id: string }>
}

export async function GET(_request: Request, context: RouteContext) {
  const access = await requireServiceAccess()
  if (!access.ok) {
    return NextResponse.json({ ok: false, error: access.error }, { status: access.status })
  }

  const { id } = await context.params
  const changeRequestId = readRouteParam(id)
  const changeRequest = getChangeRequest(changeRequestId)
  if (!changeRequest) {
    return NextResponse.json({ ok: false, error: "Change request not found" }, { status: 404 })
  }

  const legacyExecutions = listChangeRequestExecutions(changeRequestId)
  return NextResponse.json({
    ok: true,
    legacyExecutions,
    executions: legacyExecutions,
    agentRuns: listAgentRuns({ requestId: changeRequestId, limit: 100 }),
  })
}

export async function POST(_request: Request, context: RouteContext) {
  const access = await requireServiceAccess()
  if (!access.ok) {
    return NextResponse.json({ ok: false, error: access.error }, { status: access.status })
  }

  const { id } = await context.params
  const changeRequestId = readRouteParam(id)
  const changeRequest = getChangeRequest(changeRequestId)
  if (!changeRequest) {
    return NextResponse.json({ ok: false, error: "Change request not found" }, { status: 404 })
  }

  return NextResponse.json(
    {
      ok: false,
      error: "CHANGE_REQUEST_EXECUTIONS_DEPRECATED",
      message: "Create or continue workflow work through agent_runs and the workflow continue route.",
    },
    { status: 410 },
  )
}
