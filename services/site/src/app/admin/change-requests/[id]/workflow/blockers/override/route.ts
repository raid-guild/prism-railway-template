import { NextResponse } from "next/server"
import {
  createAuditLog,
  createWorkflowEvent,
  getChangeRequest,
  getWorkflowAttentionForRequest,
  getWorkflowRunForRequest,
} from "@/lib/app-core"
import { adminFetch } from "@/lib/admin"
import { parseString, readRouteParam, requireLocalAdminAccess, useLocalAppApi } from "@/lib/local-admin-api"

type RouteContext = {
  params: Promise<{ id: string }>
}

function stringArray(value: unknown) {
  return Array.isArray(value)
    ? value.filter((entry): entry is string => typeof entry === "string" && entry.trim().length > 0)
      .map((entry) => entry.trim())
    : []
}

function blockerKey(blocker: Record<string, unknown>) {
  return parseString(blocker.key)
}

function blockerSeverity(blocker: Record<string, unknown>) {
  return parseString(blocker.severity)?.toLowerCase().replace(/-/g, "_") ?? null
}

function blockerCanOverride(blocker: Record<string, unknown>) {
  return blocker.canOverride !== false && blocker.can_override !== false && blockerSeverity(blocker) !== "non_overridable"
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
    const response = await adminFetch(`/api/admin/change-board/requests/${id}/workflow/blockers/override`, {
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
  const changeRequestId = readRouteParam(id)
  const comment = parseString(body.comment ?? body.note)
  if (!comment) {
    return NextResponse.json({ ok: false, error: "Override comment is required" }, { status: 400 })
  }

  const changeRequest = getChangeRequest(changeRequestId)
  if (!changeRequest) {
    return NextResponse.json({ ok: false, error: "Change request not found" }, { status: 404 })
  }

  const attention = getWorkflowAttentionForRequest(changeRequestId)
  if (!attention) {
    return NextResponse.json({ ok: false, error: "No unresolved workflow attention state found" }, { status: 409 })
  }

  const workflowRun = getWorkflowRunForRequest(changeRequestId)
  const workflowRunId = workflowRun?.id ?? attention.workflowRunId
  if (!workflowRunId) {
    return NextResponse.json({ ok: false, error: "Workflow run not found" }, { status: 409 })
  }
  const blockerKeys = stringArray(body.blockerKeys ?? body.blocker_keys)
  const resolvedBlockerKeys = blockerKeys.length
    ? blockerKeys
    : attention.blockers
      .map(blockerKey)
      .filter((key): key is string => Boolean(key))
  const nonOverridableBlocker = attention.blockers.find((blocker) => !blockerCanOverride(blocker))
  if (nonOverridableBlocker) {
    return NextResponse.json(
      {
        ok: false,
        error: "BLOCKER_NOT_OVERRIDABLE",
        blockerKey: blockerKey(nonOverridableBlocker),
      },
      { status: 409 },
    )
  }

  const event = createWorkflowEvent({
    workflowRunId,
    requestId: changeRequestId,
    stepKey: attention.workflowStepKey ?? changeRequest.currentWorkflowStepKey,
    eventType: "operator.blocker_overridden",
    actorType: "admin",
    note: comment,
    payload: {
      agentRunId: attention.agentRunId,
      blockerKeys: resolvedBlockerKeys,
      workflowOutcomeStatus: attention.status,
      workflowAction: "continue_anyway",
    },
  })

  createAuditLog({
    actorUserId: null,
    actionType: "admin.change_board_request.blocker_override",
    targetType: "change_request",
    targetId: changeRequest.id,
    meta: {
      requestNumber: changeRequest.requestNumber,
      agentRunId: attention.agentRunId,
      blockerKeys: resolvedBlockerKeys,
    },
  })

  return NextResponse.json({
    ok: true,
    event,
    changeRequest: getChangeRequest(changeRequestId) ?? changeRequest,
  })
}
