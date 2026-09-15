import { NextResponse } from "next/server"

import {
  createAgentMessage,
  createAgentSession,
  findAgentSessionBySourceContext,
  getChangeRequest,
  getSessionSummary,
  getWorkflowByKey,
  getWorkflowRunForRequest,
  listAgentMessages,
  listAgentRuns,
  listRequestArtifacts,
  listRequestExternalRefs,
  listWorkflowEventsForRequest,
  requestRuntimeResponse,
  updateAgentSession,
} from "@/lib/app-core"
import { requireCapabilityAccess } from "@/lib/admin-auth"
import { readRouteParam, useLocalAppApi } from "@/lib/local-admin-api"
import {
  parsePrismLabRequestAskPayload,
  PrismLabRequestAskError,
  runPrismLabRequestAsk,
} from "@/lib/prism-lab-routes/request-ask-service"

type RouteContext = {
  params: Promise<{ id: string }>
}

export async function POST(request: Request, context: RouteContext) {
  const access = await requireCapabilityAccess("canRunAgent")
  if (!access.ok) {
    return NextResponse.json({ ok: false, error: access.error }, { status: access.status })
  }

  const payload = await request.json().catch(() => null) as unknown
  const parsed = parsePrismLabRequestAskPayload(payload)
  if (!parsed.ok) {
    return NextResponse.json({ ok: false, error: parsed.error }, { status: 400 })
  }

  const { id } = await context.params
  const requestId = readRouteParam(id).trim()
  if (!requestId) {
    return NextResponse.json({ ok: false, error: "Invalid change request id" }, { status: 400 })
  }

  if (!useLocalAppApi()) {
    return NextResponse.json(
      {
        ok: false,
        error: "LAB_REQUEST_ASK_DURABILITY_UNAVAILABLE",
        detail: "The split admin API has no evidenced non-workflow request conversation contract.",
      },
      { status: 501 },
    )
  }

  try {
    const actor = access.userId ? getSessionSummary(access.userId) : null
    const result = await runPrismLabRequestAsk(
      {
        requestId,
        question: parsed.question,
        actorUserId: access.userId,
        actorDisplayName: actor?.displayName ?? actor?.handle ?? actor?.email ?? null,
        actorHandle: actor?.handle ?? null,
      },
      {
        getRequest: getChangeRequest,
        getWorkflowRun: getWorkflowRunForRequest,
        getWorkflow: getWorkflowByKey,
        listAgentRuns,
        listWorkflowEvents: listWorkflowEventsForRequest,
        listArtifacts: listRequestArtifacts,
        listExternalRefs: listRequestExternalRefs,
        findAdminSession: findAgentSessionBySourceContext,
        createSession: createAgentSession,
        listMessages: listAgentMessages,
        createMessage: createAgentMessage,
        updateSession: updateAgentSession,
        invokeRuntime: requestRuntimeResponse,
      },
    )
    return NextResponse.json({ ok: true, ...result })
  } catch (error) {
    if (error instanceof PrismLabRequestAskError) {
      return NextResponse.json({ ok: false, error: error.code }, { status: error.status })
    }
    console.error("[prism-lab] request ask failed", {
      requestId,
      error: error instanceof Error ? error.message : String(error),
    })
    return NextResponse.json(
      {
        ok: false,
        error: error instanceof Error ? error.message : "REQUEST_ASK_FAILED",
      },
      { status: 502 },
    )
  }
}
