import { NextResponse } from "next/server"

import {
  createAgentMessage,
  createAgentSession,
  createAuditLog,
  createWorkflowEvent,
  ensureWorkflowRunForRequest,
  findAgentSessionBySourceContext,
  findLatestAgentSessionByChangeRequest,
  getChangeRequest,
  getSessionSummary,
  getWorkflowByKey,
  getWorkflowRunForRequest,
  listActiveAgentRunsForRequest,
  listAgentMessages,
  updateAgentSession,
  updateChangeRequest,
  updateWorkflowRun,
} from "@/lib/app-core"
import { adminFetch } from "@/lib/admin"
import { requireCapabilityAccess } from "@/lib/admin-auth"
import { parseString, readRouteParam, useLocalAppApi } from "@/lib/local-admin-api"

type RouteContext = {
  params: Promise<{ id: string }>
}

function workflowSteps(workflow: ReturnType<typeof getWorkflowByKey>) {
  const steps = workflow?.definition.steps
  return Array.isArray(steps)
    ? steps.filter((step): step is Record<string, unknown> => (
        Boolean(step)
        && typeof step === "object"
        && !Array.isArray(step)
        && typeof (step as Record<string, unknown>).key === "string"
      ))
    : []
}

export async function POST(request: Request, context: RouteContext) {
  const access = await requireCapabilityAccess("canRunAgent")
  if (!access.ok) {
    return NextResponse.json({ ok: false, error: access.error }, { status: access.status })
  }

  const { id } = await context.params
  const requestId = readRouteParam(id).trim()
  if (!requestId) {
    return NextResponse.json({ ok: false, error: "Invalid change request id" }, { status: 400 })
  }

  const payload = await request.json().catch(() => null) as unknown
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
    return NextResponse.json({ ok: false, error: "Invalid JSON body" }, { status: 400 })
  }
  const body = payload as Record<string, unknown>
  const targetStepKey = parseString(body.targetStepKey ?? body.target_step_key)
  const reason = parseString(body.reason ?? body.comment)
  if (!targetStepKey) {
    return NextResponse.json({ ok: false, error: "targetStepKey is required" }, { status: 400 })
  }
  if (!reason) {
    return NextResponse.json({ ok: false, error: "reason is required" }, { status: 400 })
  }

  if (!useLocalAppApi()) {
    const response = await adminFetch(
      `/api/admin/change-board/requests/${encodeURIComponent(requestId)}/workflow/step`,
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ targetStepKey, reason }),
      },
    )
    const text = await response.text()
    return new NextResponse(text, {
      status: response.status,
      headers: { "content-type": response.headers.get("content-type") ?? "application/json" },
    })
  }

  const changeRequest = getChangeRequest(requestId)
  if (!changeRequest) {
    return NextResponse.json({ ok: false, error: "Change request not found" }, { status: 404 })
  }
  const actor = access.userId ? getSessionSummary(access.userId) : null
  const workflow = getWorkflowByKey(changeRequest.workflowKey)
  const steps = workflowSteps(workflow)
  const targetStep = steps.find((step) => step.key === targetStepKey) ?? null
  if (!targetStep) {
    return NextResponse.json({ ok: false, error: "Invalid workflow step" }, { status: 400 })
  }
  if (targetStep.type === "terminal") {
    return NextResponse.json(
      { ok: false, error: "Use Cancel request or the normal workflow transition for a terminal step" },
      { status: 409 },
    )
  }

  const workflowRun = getWorkflowRunForRequest(changeRequest.id) ?? ensureWorkflowRunForRequest({
    requestId: changeRequest.id,
    workflowKey: changeRequest.workflowKey,
  })
  const previousStepKey = workflowRun.currentStepKey || changeRequest.currentWorkflowStepKey
  const currentStep = steps.find((step) => step.key === previousStepKey) ?? null
  if (workflowRun.status === "completed" || workflowRun.status === "canceled" || currentStep?.type === "terminal") {
    return NextResponse.json(
      { ok: false, error: "Use the reopen endpoint to move a closed request" },
      { status: 409 },
    )
  }
  const activeAgentRuns = listActiveAgentRunsForRequest(changeRequest.id)
  if (activeAgentRuns.length) {
    return NextResponse.json({ ok: false, error: "AGENT_RUN_ACTIVE", activeAgentRuns }, { status: 409 })
  }
  if (previousStepKey === targetStepKey) {
    return NextResponse.json({
      ok: true,
      duplicate: true,
      changeRequest,
      workflowRun,
      messages: null,
    })
  }

  updateChangeRequest(changeRequest.id, { workflowStepKey: targetStepKey })
  const updatedWorkflowRun = updateWorkflowRun({
    requestId: changeRequest.id,
    currentStepKey: targetStepKey,
    status: "active",
    completedAt: null,
  })
  createWorkflowEvent({
    workflowRunId: updatedWorkflowRun?.id ?? workflowRun.id,
    requestId: changeRequest.id,
    stepKey: targetStepKey,
    eventType: "workflow.step_changed",
    actorType: "admin",
    note: reason,
    payload: {
      previousStepKey,
      nextStepKey: targetStepKey,
      manual: true,
      actorUserId: access.userId,
      actorDisplayName: actor?.displayName ?? actor?.handle ?? actor?.email ?? null,
    },
  })
  createAuditLog({
    actorUserId: access.userId,
    actionType: "admin.change_board_request.workflow_step_change",
    targetType: "change_request",
    targetId: changeRequest.id,
    meta: { previousStepKey, nextStepKey: targetStepKey, reason },
  })

  const contextKey = `prism-lab-request:${changeRequest.id}`
  let session = findAgentSessionBySourceContext({ source: "admin-console", contextKey })
    ?? findLatestAgentSessionByChangeRequest(changeRequest.id)
  if (!session) {
    session = createAgentSession({
      source: "admin-console",
      status: "active",
      title: `Request #${changeRequest.requestNumber}: ${changeRequest.title}`,
      linkedChangeRequestId: changeRequest.id,
      linkedTargetEnvironmentId: changeRequest.targetEnvironmentId,
      createdByUserId: access.userId,
      meta: { transport: "site", contextKey, kind: "prism-lab-request-ask" },
      lastMessageAt: new Date().toISOString(),
    })
  }
  let messages = null
  if (session) {
    createAgentMessage({
      sessionId: session.id,
      role: "user",
      source: "site-request-action",
      sourceMessageId: null,
      content: reason,
      meta: {
        transport: "site",
        kind: "workflow-step-change",
        previousStepKey,
        nextStepKey: targetStepKey,
        actorUserId: access.userId,
        actorDisplayName: actor?.displayName ?? actor?.handle ?? actor?.email ?? null,
        actorHandle: actor?.handle ?? null,
      },
    })
    updateAgentSession(session.id, {
      linkedChangeRequestId: changeRequest.id,
      linkedTargetEnvironmentId: changeRequest.targetEnvironmentId,
      lastMessageAt: new Date().toISOString(),
      meta: { ...session.meta, transport: "site", contextKey },
    })
    messages = listAgentMessages(session.id, 100)
  }

  return NextResponse.json({
    ok: true,
    duplicate: false,
    changeRequest: getChangeRequest(changeRequest.id) ?? changeRequest,
    workflowRun: getWorkflowRunForRequest(changeRequest.id) ?? updatedWorkflowRun,
    messages,
  })
}
