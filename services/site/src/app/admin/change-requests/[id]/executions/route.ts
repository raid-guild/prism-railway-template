import { NextResponse } from "next/server"
import { getChangeRequest, listAgentRuns, listChangeRequestExecutions } from "@/lib/app-core"

import { adminFetch } from "@/lib/admin"
import { readRouteParam, requireLocalMemberAccess, useLocalAppApi } from "@/lib/local-admin-api"

type RouteContext = {
  params: Promise<{ id: string }>
}

export async function GET(_request: Request, context: RouteContext) {
  const { id } = await context.params

  if (useLocalAppApi()) {
    const access = await requireLocalMemberAccess()
    if (!access.ok) {
      return NextResponse.json({ ok: false, error: access.error }, { status: access.status })
    }

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

  const response = await adminFetch(`/api/admin/change-board/requests/${id}/executions`)

  const text = await response.text()
  const contentType = response.headers.get("content-type") ?? "application/json"

  return new NextResponse(text, {
    status: response.status,
    headers: {
      "content-type": contentType,
    },
  })
}
