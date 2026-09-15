import { NextResponse } from "next/server"
import {
  clearChangeRequestClosedAt,
  createAgentMessage,
  createAgentSession,
  createAuditLog,
  createWorkflowEvent,
  ensureWorkflowRunForRequest,
  findLatestAgentSessionByChangeRequest,
  getChangeRequest,
  getSessionSummary,
  getWorkflowByKey,
  getWorkflowRunForRequest,
  listAgentMessages,
  updateAgentSession,
  updateWorkflowRun,
} from "@/lib/app-core"
import { adminFetch } from "@/lib/admin"
import { parseString, readRouteParam, requireLocalAdminAccess, useLocalAppApi } from "@/lib/local-admin-api"
import { autoStartWorkflowRequest } from "@/lib/workflow-autostart"

type RouteContext = {
  params: Promise<{ id: string }>
}

function isWorkflowStep(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value) && typeof (value as { key?: unknown }).key === "string"
}

function stepType(step: Record<string, unknown> | null | undefined) {
  return typeof step?.type === "string" && step.type.trim() ? step.type.trim() : "agent"
}

export async function POST(request: Request, context: RouteContext) {
  let payload: unknown = null

  try {
    payload = await request.json()
  } catch {
    return NextResponse.json({ ok: false, error: "Invalid JSON body" }, { status: 400 })
  }

  const { id } = await context.params

  if (!useLocalAppApi()) {
    const response = await adminFetch(`/api/admin/change-board/requests/${id}/reopen`, {
      method: "POST",
      body: JSON.stringify(payload),
    })
    const text = await response.text()
    const contentType = response.headers.get("content-type") ?? "application/json"
    return new NextResponse(text, {
      status: response.status,
      headers: { "content-type": contentType },
    })
  }

  const access = await requireLocalAdminAccess()
  if (!access.ok) {
    return NextResponse.json({ ok: false, error: access.error }, { status: access.status })
  }

  if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
    return NextResponse.json({ ok: false, error: "Invalid JSON body" }, { status: 400 })
  }

  const body = payload as Record<string, unknown>
  const actor = access.userId ? getSessionSummary(access.userId) : null
  const changeRequestId = readRouteParam(id)
  const targetStepKey = parseString(body.targetStepKey ?? body.target_step_key)
  const note = parseString(body.comment ?? body.note)
  if (!targetStepKey) {
    return NextResponse.json({ ok: false, error: "targetStepKey is required" }, { status: 400 })
  }

  const changeRequest = getChangeRequest(changeRequestId)
  if (!changeRequest) {
    return NextResponse.json({ ok: false, error: "Change request not found" }, { status: 404 })
  }

  const workflow = getWorkflowByKey(changeRequest.workflowKey)
  const workflowSteps = Array.isArray(workflow?.definition.steps) ? workflow.definition.steps.filter(isWorkflowStep) : []
  const targetStep = workflowSteps.find((step) => step.key === targetStepKey) ?? null
  if (!targetStep) {
    return NextResponse.json({ ok: false, error: "Invalid workflow step" }, { status: 400 })
  }
  if (stepType(targetStep) === "terminal") {
    return NextResponse.json({ ok: false, error: "Cannot reopen to a terminal step" }, { status: 400 })
  }

  const existingRun = getWorkflowRunForRequest(changeRequestId)
  const wasClosed =
    existingRun?.status === "completed" ||
    workflowSteps.find((step) => step.key === (existingRun?.currentStepKey ?? changeRequest.currentWorkflowStepKey))?.type === "terminal"
  if (!wasClosed) {
    return NextResponse.json({ ok: false, error: "Request is not closed" }, { status: 409 })
  }

  const workflowRun = existingRun ?? ensureWorkflowRunForRequest({
    requestId: changeRequest.id,
    workflowKey: changeRequest.workflowKey,
    currentStepKey: targetStepKey,
  })
  const previousStepKey = workflowRun.currentStepKey
  const updatedRun = updateWorkflowRun({
    requestId: changeRequest.id,
    currentStepKey: targetStepKey,
    status: "active",
    completedAt: null,
  })
  const reopenedRequest = clearChangeRequestClosedAt(changeRequest.id) ?? changeRequest

  if (updatedRun) {
    createWorkflowEvent({
      workflowRunId: updatedRun.id,
      requestId: changeRequest.id,
      stepKey: targetStepKey,
      eventType: "workflow.reopened",
      actorType: "admin",
      note: note || null,
      payload: {
        previousStepKey,
        nextStepKey: targetStepKey,
      },
    })
  }

  let messages = null
  if (note) {
    let session = findLatestAgentSessionByChangeRequest(changeRequest.id)
    if (!session) {
      session = createAgentSession({
        source: "admin-console",
        status: "active",
        title: changeRequest.title,
        linkedChangeRequestId: changeRequest.id,
        linkedTargetEnvironmentId: changeRequest.targetEnvironmentId,
        createdByUserId: access.userId,
        meta: { transport: "site" },
        lastMessageAt: new Date().toISOString(),
      })
    }

    if (session) {
      createAgentMessage({
        sessionId: session.id,
        role: "user",
        source: "site-comment",
        sourceMessageId: null,
        content: note,
        meta: {
          transport: "site",
          kind: "comment",
          workflowReopen: true,
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
        },
      })
      messages = listAgentMessages(session.id, 100)
    }
  }

  createAuditLog({
    actorUserId: access.userId,
    actionType: "admin.change_board_request.reopen",
    targetType: "change_request",
    targetId: changeRequest.id,
    meta: {
      previousStepKey,
      nextStepKey: targetStepKey,
    },
  })

  const autoStart = stepType(targetStep) === "agent"
    ? await autoStartWorkflowRequest(reopenedRequest, { baseUrl: new URL(request.url).origin })
    : null

  return NextResponse.json({
    ok: true,
    changeRequest: getChangeRequest(changeRequest.id) ?? reopenedRequest,
    workflowRun: getWorkflowRunForRequest(changeRequest.id),
    messages,
    autoStart,
  })
}
