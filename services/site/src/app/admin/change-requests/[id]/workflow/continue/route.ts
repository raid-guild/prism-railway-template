import { NextResponse } from "next/server"

import { getChangeRequest } from "@/lib/app-core"
import { adminFetch } from "@/lib/admin"
import { requireCapabilityAccess } from "@/lib/admin-auth"
import { readRouteParam, useLocalAppApi } from "@/lib/local-admin-api"
import {
  buildPrismLabContinuePrompt,
  buildRemotePrismLabContinueBody,
  normalizeRemotePrismLabContinueResult,
  parsePrismLabContinuePayload,
} from "@/lib/prism-lab-routes/workflow-continue"
import { enqueueWorkflowAgentRun } from "@/lib/workflow-agent-run-queue"

type RouteContext = {
  params: Promise<{ id: string }>
}

async function fetchRemoteJson(dependency: string, path: string, init?: RequestInit) {
  try {
    const response = await adminFetch(path, init)
    const payload = await response.json().catch(() => null) as unknown
    if (!response.ok || !payload || typeof payload !== "object" || Array.isArray(payload)) {
      const upstreamError = payload && typeof payload === "object" && !Array.isArray(payload)
        && typeof (payload as Record<string, unknown>).error === "string"
        ? (payload as Record<string, unknown>).error as string
        : `Upstream returned HTTP ${response.status}`
      return {
        ok: false as const,
        dependency,
        status: response.status >= 400 ? response.status : 502,
        error: upstreamError,
      }
    }
    return { ok: true as const, payload: payload as Record<string, unknown> }
  } catch (error) {
    return {
      ok: false as const,
      dependency,
      status: 502,
      error: error instanceof Error ? error.message : "Upstream request failed",
    }
  }
}

export async function POST(request: Request, context: RouteContext) {
  const access = await requireCapabilityAccess("canRunAgent")
  if (!access.ok) {
    return NextResponse.json({ ok: false, error: access.error }, { status: access.status })
  }

  let payload: unknown
  try {
    payload = await request.json()
  } catch {
    return NextResponse.json({ ok: false, error: "Invalid JSON body" }, { status: 400 })
  }

  const parsedPayload = parsePrismLabContinuePayload(payload)
  if (!parsedPayload.ok) {
    return NextResponse.json({ ok: false, error: parsedPayload.error }, { status: 400 })
  }

  const { id } = await context.params
  const requestId = readRouteParam(id).trim()
  if (!requestId) {
    return NextResponse.json({ ok: false, error: "Invalid change request id" }, { status: 400 })
  }

  if (!useLocalAppApi()) {
    const encodedId = encodeURIComponent(requestId)
    const [detailResult, threadResult] = await Promise.all([
      fetchRemoteJson("request-detail", `/api/admin/change-board/requests/${encodedId}`),
      fetchRemoteJson("agent-thread", `/api/admin/change-board/requests/${encodedId}/agent-session`),
    ])
    if (!detailResult.ok) {
      return NextResponse.json(
        {
          ok: false,
          error: "REMOTE_WORKFLOW_CONTINUE_DEPENDENCY_FAILED",
          dependency: detailResult.dependency,
          upstreamError: detailResult.error,
        },
        { status: detailResult.status },
      )
    }
    if (!threadResult.ok) {
      return NextResponse.json(
        {
          ok: false,
          error: "REMOTE_WORKFLOW_CONTINUE_DEPENDENCY_FAILED",
          dependency: threadResult.dependency,
          upstreamError: threadResult.error,
        },
        { status: threadResult.status },
      )
    }

    const remoteRequest = detailResult.payload.changeRequest
    if (!remoteRequest || typeof remoteRequest !== "object" || Array.isArray(remoteRequest)) {
      return NextResponse.json({ ok: false, error: "REMOTE_REQUEST_DETAIL_INVALID" }, { status: 502 })
    }
    const requestRecord = remoteRequest as Record<string, unknown>
    const requestNumber = Number(requestRecord.requestNumber)
    const requestTitle = typeof requestRecord.title === "string" ? requestRecord.title : "Change request"
    if (!Number.isSafeInteger(requestNumber) || requestNumber <= 0) {
      return NextResponse.json({ ok: false, error: "REMOTE_REQUEST_DETAIL_INVALID" }, { status: 502 })
    }
    const threadRecord = threadResult.payload
    const session = threadRecord.session && typeof threadRecord.session === "object" && !Array.isArray(threadRecord.session)
      ? threadRecord.session as Record<string, unknown>
      : null
    const sessionId = typeof session?.id === "string" ? session.id : null
    const targetEnvironmentId = typeof requestRecord.targetEnvironmentId === "string"
      ? requestRecord.targetEnvironmentId
      : null
    const prompt = buildPrismLabContinuePrompt({
      requestNumber,
      requestTitle,
      comment: parsedPayload.value.comment,
      retryCurrentStep: parsedPayload.value.retryCurrentStep,
    })
    const upstreamResult = await fetchRemoteJson("responses", "/api/v1/responses", {
      method: "POST",
      body: JSON.stringify(buildRemotePrismLabContinueBody({
        prompt,
        requestId,
        targetEnvironmentId,
        sessionId,
      })),
    })
    if (!upstreamResult.ok) {
      return NextResponse.json(
        {
          ok: false,
          error: "REMOTE_WORKFLOW_CONTINUE_FAILED",
          dependency: upstreamResult.dependency,
          upstreamError: upstreamResult.error,
        },
        { status: upstreamResult.status },
      )
    }

    return NextResponse.json(
      normalizeRemotePrismLabContinueResult(upstreamResult.payload),
      { status: 202 },
    )
  }

  const changeRequest = getChangeRequest(requestId)
  if (!changeRequest) {
    return NextResponse.json({ ok: false, error: "Change request not found" }, { status: 404 })
  }

  const result = enqueueWorkflowAgentRun({
    request: changeRequest,
    prompt: buildPrismLabContinuePrompt({
      requestNumber: changeRequest.requestNumber,
      requestTitle: changeRequest.title,
      comment: parsedPayload.value.comment,
      retryCurrentStep: parsedPayload.value.retryCurrentStep,
    }),
    workflowAction: null,
    advanceAttentionStep: !parsedPayload.value.retryCurrentStep,
    requestedSkills: [],
    baseUrl: request.url,
  })

  if (!result.queued) {
    return NextResponse.json(
      { ok: false, error: result.reason ?? "WORKFLOW_AGENT_RUN_QUEUE_FAILED", result },
      { status: result.status ?? 500 },
    )
  }

  return NextResponse.json(
    {
      ok: true,
      accepted: true,
      duplicate: result.duplicate === true,
      advanced: result.advanced === true,
      advancedToStepKey: result.advancedToStepKey ?? null,
      agentRun: result.agentRun ?? null,
    },
    { status: 202 },
  )
}
