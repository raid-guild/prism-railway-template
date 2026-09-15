import { NextResponse } from "next/server"

import {
  cancelRuntimeJob,
  createWorkflowEvent,
  getAgentRun,
  getChangeRequest,
  getWorkflowRunForRequest,
  updateAgentRun,
} from "@/lib/app-core"
import { adminFetch } from "@/lib/admin"
import { requireCapabilityAccess } from "@/lib/admin-auth"
import { parseString, readRouteParam, useLocalAppApi } from "@/lib/local-admin-api"
import { wakeWorkflowAgentRunDispatcher } from "@/lib/workflow-agent-run-queue"

type RouteContext = {
  params: Promise<{ id: string; runId: string }>
}

const activeStatuses = new Set(["queued", "claimed", "running"])

function resultString(result: Record<string, unknown>, key: string) {
  const value = result[key]
  return typeof value === "string" && value.trim() ? value.trim() : null
}

export async function POST(request: Request, context: RouteContext) {
  const access = await requireCapabilityAccess("canRunAgent")
  if (!access.ok) {
    return NextResponse.json({ ok: false, error: access.error }, { status: access.status })
  }

  const { id, runId } = await context.params
  const requestId = readRouteParam(id).trim()
  const agentRunId = readRouteParam(runId).trim()
  if (!requestId || !agentRunId) {
    return NextResponse.json({ ok: false, error: "Invalid request or agent run id" }, { status: 400 })
  }

  const rawBody = await request.text().catch(() => "")
  let body: Record<string, unknown> = {}
  if (rawBody.trim()) {
    try {
      const parsed = JSON.parse(rawBody) as unknown
      if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) throw new Error("invalid")
      body = parsed as Record<string, unknown>
    } catch {
      return NextResponse.json({ ok: false, error: "Invalid JSON body" }, { status: 400 })
    }
  }
  const reason = parseString(body.reason ?? body.comment)
  if (!reason) {
    return NextResponse.json({ ok: false, error: "reason is required" }, { status: 400 })
  }

  if (!useLocalAppApi()) {
    const response = await adminFetch(
      `/api/admin/change-board/requests/${encodeURIComponent(requestId)}/runs/${encodeURIComponent(agentRunId)}/cancel`,
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ reason }),
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
  const agentRun = getAgentRun(agentRunId)
  if (!agentRun || agentRun.requestId !== changeRequest.id) {
    return NextResponse.json({ ok: false, error: "Agent run not found for request" }, { status: 404 })
  }
  if (agentRun.status === "canceled") {
    return NextResponse.json({ ok: true, duplicate: true, agentRun })
  }
  if (!activeStatuses.has(agentRun.status)) {
    return NextResponse.json(
      { ok: false, error: "AGENT_RUN_NOT_ACTIVE", agentRun },
      { status: 409 },
    )
  }

  const now = new Date().toISOString()
  let canceledRun = updateAgentRun(agentRun.id, {
    status: "canceled",
    result: {
      ...agentRun.result,
      canceledReason: reason,
      canceledByUserId: access.userId,
      cancelRequestedAt: now,
    },
    errorMessage: reason,
    leaseExpiresAt: null,
    queueReason: null,
    finishedAt: now,
  })
  wakeWorkflowAgentRunDispatcher()

  const runtimeJobId = resultString(agentRun.result, "runtimeJobId")
  const runtimeKey = resultString(agentRun.result, "runtimeKey")
  let runtimeCancellation: { requested: boolean; status: number | null; error: string | null } = {
    requested: false,
    status: null,
    error: null,
  }
  if (runtimeJobId && runtimeKey) {
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
    if (canceledRun) {
      canceledRun = updateAgentRun(canceledRun.id, {
        result: {
          ...canceledRun.result,
          runtimeCancellation,
        },
      })
    }
  }

  const workflowRun = getWorkflowRunForRequest(changeRequest.id)
  if (workflowRun) {
    createWorkflowEvent({
      workflowRunId: workflowRun.id,
      requestId: changeRequest.id,
      stepKey: agentRun.workflowStepKey ?? workflowRun.currentStepKey,
      eventType: "agent.canceled",
      actorType: "admin",
      note: reason,
      payload: {
        agentRunId: agentRun.id,
        previousStatus: agentRun.status,
        workflowPreserved: true,
        canceledByUserId: access.userId,
        runtimeJobId,
        runtimeKey,
        runtimeCancellation,
      },
    })
  }

  return NextResponse.json({
    ok: true,
    duplicate: false,
    workflowPreserved: true,
    agentRun: canceledRun ?? getAgentRun(agentRun.id),
    runtimeCancellation,
  })
}
