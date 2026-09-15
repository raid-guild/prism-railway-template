import { NextResponse } from "next/server"

import {
  cancelRuntimeJob,
  createAgentMessage,
  createAuditLog,
  getAgentRun,
  getAgentResponseJob,
  updateAgentRun,
  updateAgentResponseJob,
} from "@/lib/app-core"
import { requireLocalAdminAccess } from "@/lib/local-admin-api"

const activeStatuses = new Set(["queued", "claimed", "running"])

function resultString(result: Record<string, unknown>, key: string) {
  const value = result[key]
  return typeof value === "string" && value.trim() ? value.trim() : null
}

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const access = await requireLocalAdminAccess()
  if (!access.ok) {
    return NextResponse.json({ ok: false, error: access.error }, { status: access.status })
  }

  const { id } = await params
  const agentRun = getAgentRun(id)
  if (agentRun) {
    const outputText =
      typeof agentRun.result.output_text === "string"
        ? agentRun.result.output_text
        : typeof agentRun.result.outputText === "string"
          ? agentRun.result.outputText
          : null
    return NextResponse.json({
      ok: true,
      agentRun,
      job: {
        id: agentRun.id,
        status: agentRun.status,
        sessionId: agentRun.sessionId,
        outputText,
        errorMessage: agentRun.errorMessage,
        trace: agentRun.trace,
        startedAt: agentRun.startedAt,
        finishedAt: agentRun.finishedAt,
      },
    })
  }

  const job = getAgentResponseJob(id)
  if (!job) {
    return NextResponse.json({ ok: false, error: "Console job not found" }, { status: 404 })
  }

  return NextResponse.json({ ok: true, job })
}

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const access = await requireLocalAdminAccess()
  if (!access.ok) {
    return NextResponse.json({ ok: false, error: access.error }, { status: access.status })
  }

  const { id } = await params
  const agentRun = getAgentRun(id)
  if (!agentRun || agentRun.kind !== "console" || agentRun.source !== "admin-console") {
    return NextResponse.json({ ok: false, error: "Console run not found" }, { status: 404 })
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

  const body = await request.json().catch(() => ({})) as Record<string, unknown>
  const suppliedReason = typeof body.reason === "string" ? body.reason.trim() : ""
  const reason = suppliedReason || "Stopped by an operator from the Agent chat."
  const now = new Date().toISOString()
  const responseJobId = resultString(agentRun.result, "responseJobId")
  const runtimeJobId = resultString(agentRun.result, "runtimeJobId")
  const runtimeKey = resultString(agentRun.result, "runtimeKey")

  let canceledRun = updateAgentRun(agentRun.id, {
    status: "canceled",
    result: {
      ...agentRun.result,
      canceledReason: reason,
      canceledByUserId: access.userId,
      cancelRequestedAt: now,
    },
    errorMessage: null,
    leaseExpiresAt: null,
    queueReason: null,
    finishedAt: now,
  })
  if (responseJobId) {
    const responseJob = getAgentResponseJob(responseJobId)
    if (responseJob && activeStatuses.has(responseJob.status)) {
      updateAgentResponseJob(responseJob.id, {
        status: "canceled",
        errorMessage: null,
        finishedAt: now,
      })
    }
  }

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
        result: { ...canceledRun.result, runtimeCancellation },
      })
    }
  }

  if (agentRun.sessionId) {
    createAgentMessage({
      sessionId: agentRun.sessionId,
      role: "assistant",
      source: "site",
      sourceMessageId: null,
      content: "Run stopped. You can revise the request or start another message in this session.",
      meta: {
        transport: "site",
        systemEvent: "agent_run.canceled",
        agentRunId: agentRun.id,
        canceledByUserId: access.userId,
      },
    })
  }
  createAuditLog({
    actorUserId: access.userId,
    actionType: "admin.console.run.cancel",
    targetType: "agent_run",
    targetId: agentRun.id,
    meta: {
      previousStatus: agentRun.status,
      responseJobId,
      runtimeJobId,
      runtimeKey,
      runtimeCancellation,
      reason,
    },
  })

  return NextResponse.json({
    ok: true,
    duplicate: false,
    agentRun: canceledRun ?? getAgentRun(agentRun.id),
    runtimeCancellation,
  })
}
