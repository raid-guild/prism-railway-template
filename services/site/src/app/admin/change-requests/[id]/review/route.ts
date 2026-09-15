import { NextResponse } from "next/server"

import {
  buildTargetEnvironmentDeployPlan,
  findAgentSessionBySourceContext,
  findLatestAgentSessionByChangeRequest,
  getAgentSession,
  getAgentProfileById,
  getSessionSummary,
  getChangeRequest,
  getTargetApp,
  getTargetEnvironment,
  getWorkflowByKey,
  getWorkflowRunForRequest,
  listAgentMessages,
  listAgentRuns,
  listChangeRequestExecutions,
  listRequestArtifacts,
  listRequestExternalRefs,
  listWorkflowEventsForRequest,
} from "@/lib/app-core"
import { adminFetch } from "@/lib/admin"
import { requireCapabilityAccess } from "@/lib/admin-auth"
import { readRouteParam, useLocalAppApi } from "@/lib/local-admin-api"
import {
  composeRemotePrismLabReview,
  readPrismLabReviewLimits,
} from "@/lib/prism-lab-routes/request-review"
import { resolveRequestMessageActor } from "@/lib/prism-lab/request-message-actor"

type RouteContext = {
  params: Promise<{ id: string }>
}

async function fetchRemoteReviewPart(dependency: string, path: string) {
  try {
    const response = await adminFetch(path)
    const payload = await response.json().catch(() => null) as unknown
    if (!response.ok) {
      const upstreamError = payload && typeof payload === "object" && !Array.isArray(payload)
        && typeof (payload as Record<string, unknown>).error === "string"
        ? (payload as Record<string, unknown>).error as string
        : `Upstream returned HTTP ${response.status}`
      return { ok: false as const, dependency, status: response.status, error: upstreamError }
    }
    if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
      return { ok: false as const, dependency, status: 502, error: "Upstream returned an invalid payload" }
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

export async function GET(request: Request, context: RouteContext) {
  const access = await requireCapabilityAccess("canViewRequests")
  if (!access.ok) {
    return NextResponse.json({ ok: false, error: access.error }, { status: access.status })
  }

  const { id } = await context.params
  const requestId = readRouteParam(id).trim()
  if (!requestId) {
    return NextResponse.json({ ok: false, error: "Invalid change request id" }, { status: 400 })
  }
  const limits = readPrismLabReviewLimits(new URL(request.url))

  if (!useLocalAppApi()) {
    const encodedId = encodeURIComponent(requestId)
    const parts = await Promise.all([
      fetchRemoteReviewPart("request-detail", `/api/admin/change-board/requests/${encodedId}`),
      fetchRemoteReviewPart("executions", `/api/admin/change-board/requests/${encodedId}/executions`),
      fetchRemoteReviewPart("workflow-events", `/api/admin/change-board/requests/${encodedId}/workflow-events`),
      fetchRemoteReviewPart(
        "artifacts",
        `/api/admin/change-board/requests/${encodedId}/artifacts?limit=${limits.artifactLimit}`,
      ),
      fetchRemoteReviewPart("external-refs", `/api/admin/change-board/requests/${encodedId}/external-refs?limit=500`),
      fetchRemoteReviewPart("agent-thread", `/api/admin/change-board/requests/${encodedId}/agent-session`),
    ] as const)
    const failed = parts.find((part) => !part.ok)
    if (failed && !failed.ok) {
      return NextResponse.json(
        {
          ok: false,
          error: "REMOTE_REQUEST_REVIEW_DEPENDENCY_FAILED",
          dependency: failed.dependency,
          upstreamError: failed.error,
        },
        { status: failed.status >= 400 && failed.status < 500 ? failed.status : 502 },
      )
    }
    if (!parts.every((part) => part.ok)) {
      return NextResponse.json({ ok: false, error: "REMOTE_REQUEST_REVIEW_DEPENDENCY_FAILED" }, { status: 502 })
    }

    const review = composeRemotePrismLabReview(
      {
        detail: parts[0].ok ? parts[0].payload : {},
        executions: parts[1].ok ? parts[1].payload : {},
        events: parts[2].ok ? parts[2].payload : {},
        artifacts: parts[3].ok ? parts[3].payload : {},
        externalRefs: parts[4].ok ? parts[4].payload : {},
        agentThread: parts[5].ok ? parts[5].payload : {},
      },
      limits,
      {
        canRunAgent: access.capabilities.includes("canRunAgent"),
        canComment: access.capabilities.includes("canComment"),
      },
    )
    return NextResponse.json(review, { status: review.ok ? 200 : 502 })
  }

  const changeRequest = getChangeRequest(requestId)
  if (!changeRequest) {
    return NextResponse.json({ ok: false, error: "Change request not found" }, { status: 404 })
  }

  const { messageLimit, eventLimit, artifactLimit } = limits
  const targetApp = changeRequest.targetAppId ? getTargetApp(changeRequest.targetAppId) : null
  const targetEnvironment = changeRequest.targetEnvironmentId
    ? getTargetEnvironment(changeRequest.targetEnvironmentId)
    : null
  const deployPlan = targetApp && targetEnvironment
    ? buildTargetEnvironmentDeployPlan({ request: changeRequest, targetApp, targetEnvironment })
    : null
  const workflow = getWorkflowByKey(changeRequest.workflowKey)
  const workflowRun = getWorkflowRunForRequest(changeRequest.id)
  const legacyExecutions = listChangeRequestExecutions(changeRequest.id)
  const agentRuns = listAgentRuns({ requestId: changeRequest.id, limit: 100 })
  const agentRunsWithProfiles = agentRuns.map((run) => {
    const profile = run.agentProfileId ? getAgentProfileById(run.agentProfileId) : null
    return {
      ...run,
      agentProfileKey: profile?.key ?? null,
      agentProfileName: profile?.name ?? null,
    }
  })
  const workflowEvents = listWorkflowEventsForRequest(changeRequest.id, eventLimit)
  const artifacts = listRequestArtifacts(changeRequest.id, artifactLimit)
  const externalRefs = listRequestExternalRefs(changeRequest.id)
  const requestConversation = findAgentSessionBySourceContext({
    source: "admin-console",
    contextKey: `prism-lab-request:${changeRequest.id}`,
  })
  const originSession = changeRequest.origin?.sourceSessionId ? getAgentSession(changeRequest.origin.sourceSessionId) : null
  const latestLinkedSession = findLatestAgentSessionByChangeRequest(changeRequest.id)
  const agentSession = requestConversation
    ?? (originSession?.source !== "admin-console" ? originSession : null)
    ?? (latestLinkedSession?.id !== originSession?.id ? latestLinkedSession : null)
  const agentMessages = agentSession
    ? listAgentMessages(agentSession.id, messageLimit).map((message) => {
        const actor = resolveRequestMessageActor(message, agentSession, getSessionSummary)
        return actor ? { ...message, actor } : message
      })
    : []

  return NextResponse.json({
    ok: true,
    capabilities: {
      canViewRequests: true,
      canRunAgent: access.capabilities.includes("canRunAgent"),
      canComment: access.capabilities.includes("canComment"),
    },
    changeRequest,
    targetApp,
    targetEnvironment,
    deployPlan,
    workflow,
    workflowRun,
    latestAgentRun: agentRunsWithProfiles[0] ?? null,
    latestExecution: null,
    legacyExecutions,
    executions: legacyExecutions,
    agentRuns: agentRunsWithProfiles,
    workflowEvents,
    artifacts,
    externalRefs,
    agentSession,
    agentMessages,
  })
}
