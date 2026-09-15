import { NextResponse } from "next/server"
import {
  cancelRuntimeJob,
  cancelActiveAgentRunsForRequest,
  createAgentMessage,
  createAgentSession,
  createWorkflowEvent,
  findAgentSessionBySourceContext,
  findLatestAgentSessionByChangeRequest,
  getChangeRequest,
  getSessionSummary,
  getWorkflowByKey,
  getWorkflowRunForRequest,
  listAgentMessages,
  updateAgentSession,
  updateAgentRun,
  updateChangeRequest,
  updateWorkflowRun,
} from "@/lib/app-core"
import { adminFetch } from "@/lib/admin"
import { requireCapabilityAccess } from "@/lib/admin-auth"
import { parseString, readRouteParam, useLocalAppApi } from "@/lib/local-admin-api"
import { wakeWorkflowAgentRunDispatcher } from "@/lib/workflow-agent-run-queue"

type RouteContext = {
  params: Promise<{ id: string }>
}

function resultString(result: Record<string, unknown>, key: string) {
  const value = result[key]
  return typeof value === "string" && value.trim() ? value.trim() : null
}

export async function POST(request: Request, context: RouteContext) {
  const { id } = await context.params
  const rawBody = await request.text().catch(() => "")

  if (!useLocalAppApi()) {
    const response = await adminFetch(
      `/api/admin/change-board/requests/${id}/workflow/cancel`,
      {
        method: "POST",
        body: rawBody || undefined,
        headers: rawBody
          ? { "content-type": request.headers.get("content-type") ?? "application/json" }
          : undefined,
      },
    )
    const text = await response.text()
    const contentType = response.headers.get("content-type") ?? "application/json"
    return new NextResponse(text, {
      status: response.status,
      headers: { "content-type": contentType },
    })
  }

  const access = await requireCapabilityAccess("canRunAgent")
  if (!access.ok) {
    return NextResponse.json({ ok: false, error: access.error }, { status: access.status })
  }

  let payload: unknown = null
  if (rawBody.trim()) {
    try {
      payload = JSON.parse(rawBody)
    } catch {
      return NextResponse.json({ ok: false, error: "Invalid JSON body" }, { status: 400 })
    }
  }

  const body =
    payload && typeof payload === "object" && !Array.isArray(payload)
      ? (payload as Record<string, unknown>)
      : {}
  const operatorNote =
    parseString(body.comment ?? body.note) || "Canceled by an admin operator."
  const actor = access.userId ? getSessionSummary(access.userId) : null

  const changeRequestId = readRouteParam(id)
  const changeRequest = getChangeRequest(changeRequestId)
  if (!changeRequest) {
    return NextResponse.json({ ok: false, error: "Change request not found" }, { status: 404 })
  }

  const now = new Date().toISOString()
  const workflow = getWorkflowByKey(changeRequest.workflowKey)
  const workflowSteps = Array.isArray(workflow?.definition.steps)
    ? workflow.definition.steps.filter(
        (step): step is Record<string, unknown> =>
          Boolean(step) &&
          typeof step === "object" &&
          !Array.isArray(step) &&
          typeof (step as { key?: unknown }).key === "string",
      )
    : []
  const terminalStep = workflowSteps.find((step) => step.type === "terminal")
  const terminalStepKey =
    typeof terminalStep?.key === "string" && terminalStep.key.trim()
      ? terminalStep.key
      : "closed"

  const workflowRun = getWorkflowRunForRequest(changeRequest.id)
  if (workflowRun?.status === "canceled") {
    return NextResponse.json({
      ok: true,
      duplicate: true,
      canceledAgentRuns: [],
      changeRequest,
      workflowRun,
      messages: null,
    })
  }

  const canceledAgentRuns = cancelActiveAgentRunsForRequest({
    requestId: changeRequest.id,
    reason: operatorNote,
  })
  wakeWorkflowAgentRunDispatcher()
  const canceledAgentRunsWithRuntime = await Promise.all(canceledAgentRuns.map(async (run) => {
    const runtimeJobId = resultString(run.result, "runtimeJobId")
    const runtimeKey = resultString(run.result, "runtimeKey")
    if (!runtimeJobId || !runtimeKey) return run
    let runtimeCancellation: { requested: boolean; status: number | null; error: string | null }
    try {
      const result = await cancelRuntimeJob({ runtimeKey, runtimeJobId })
      runtimeCancellation = { requested: result.requested, status: result.status, error: null }
    } catch (error) {
      runtimeCancellation = {
        requested: false,
        status: null,
        error: error instanceof Error ? error.message : "RUNTIME_JOB_CANCEL_FAILED",
      }
    }
    return updateAgentRun(run.id, {
      result: {
        ...run.result,
        runtimeCancellation,
      },
    }) ?? run
  }))
  updateChangeRequest(changeRequest.id, {
    workflowStepKey: terminalStepKey,
    resolutionSummary: operatorNote,
  })
  if (workflowRun) {
    updateWorkflowRun({
      requestId: changeRequest.id,
      currentStepKey: terminalStepKey,
      status: "canceled",
      completedAt: now,
    })
    createWorkflowEvent({
      workflowRunId: workflowRun.id,
      requestId: changeRequest.id,
      stepKey: terminalStepKey,
      eventType: "workflow.canceled",
      actorType: "admin",
      note: operatorNote,
      payload: {
        canceledAgentRunIds: canceledAgentRunsWithRuntime.map((run) => run.id),
        previousStepKey: workflowRun.currentStepKey,
        terminalStepKey,
        comment: operatorNote,
        actorUserId: access.userId,
        actorDisplayName: actor?.displayName ?? actor?.handle ?? actor?.email ?? null,
      },
    })
  }

  let messages = null
  if (operatorNote) {
    const contextKey = `prism-lab-request:${changeRequest.id}`
    let session = findAgentSessionBySourceContext({ source: "admin-console", contextKey })
      ?? findLatestAgentSessionByChangeRequest(changeRequest.id)
    if (!session) {
      session = createAgentSession({
        source: "admin-console",
        status: "active",
        title: changeRequest.title,
        linkedChangeRequestId: changeRequest.id,
        linkedTargetEnvironmentId: changeRequest.targetEnvironmentId,
        createdByUserId: access.userId,
        meta: { transport: "site", contextKey, kind: "prism-lab-request-ask" },
        lastMessageAt: new Date().toISOString(),
      })
    }

    if (session) {
      createAgentMessage({
        sessionId: session.id,
        role: "user",
        source: "site-comment",
        sourceMessageId: null,
        content: operatorNote,
        meta: {
          transport: "site",
          kind: "comment",
          workflowCanceled: true,
          actorUserId: access.userId,
          actorDisplayName: actor?.displayName ?? actor?.handle ?? actor?.email ?? null,
          actorHandle: actor?.handle ?? null,
        },
      })
      updateAgentSession(session.id, {
        linkedChangeRequestId: changeRequest.id,
        linkedTargetEnvironmentId: changeRequest.targetEnvironmentId,
        lastMessageAt: new Date().toISOString(),
        meta: {
          ...session.meta,
          transport: "site",
          contextKey,
        },
      })
      messages = listAgentMessages(session.id, 100)
    }
  }

  return NextResponse.json({
    ok: true,
    canceledAgentRuns: canceledAgentRunsWithRuntime,
    changeRequest: getChangeRequest(changeRequest.id) ?? changeRequest,
    workflowRun: getWorkflowRunForRequest(changeRequest.id),
    messages,
  })
}
