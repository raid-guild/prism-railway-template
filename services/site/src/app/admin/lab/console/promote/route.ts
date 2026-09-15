import { NextResponse } from "next/server"

import {
  autoStartWorkflowRequest,
} from "@/lib/workflow-autostart"
import {
  createAgentSession,
  createAuditLog,
  createChangeRequest,
  getAgentSession,
  getDefaultTargetEnvironmentForApp,
  getTargetApp,
  getWorkflowByKey,
} from "@/lib/app-core"
import { adminFetch } from "@/lib/admin"
import { requireCapabilityAccess } from "@/lib/admin-auth"
import {
  useLocalAppApi,
} from "@/lib/local-admin-api"
import { parseConsolePromotion } from "@/lib/prism-lab/console-promotion"

function record(value: unknown) {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {}
}

function workflowNeedsTarget(workflow: NonNullable<ReturnType<typeof getWorkflowByKey>>) {
  const target = record(workflow.definition.target)
  return workflow.key === "change-request-default" || target.required === true
}

export async function POST(request: Request) {
  const access = await requireCapabilityAccess("canRunAgent")
  if (!access.ok) return NextResponse.json({ ok: false, error: access.error }, { status: access.status })
  const parsed = parseConsolePromotion(await request.json().catch(() => null))
  if (!parsed.ok) return NextResponse.json({ ok: false, error: parsed.error }, { status: 400 })
  const { sessionId, title, description, workflowKey, targetAppId, requestType, priority } = parsed.value

  if (!useLocalAppApi()) {
    const response = await adminFetch("/api/admin/change-board/requests", {
      method: "POST",
      body: JSON.stringify({ sessionId, sourceSessionId: sessionId, title, description, workflowKey, targetAppId, requestType, priority, source: "admin-console" }),
    })
    const payload = await response.json().catch(() => null)
    if (!response.ok || !payload || typeof payload !== "object" || Array.isArray(payload)) {
      return NextResponse.json(payload ?? { ok: false, error: "Remote promotion failed" }, { status: response.status || 502 })
    }
    const result = payload as Record<string, unknown>
    const promotedRequest = result.request ?? result.changeRequest
    return NextResponse.json({ ...result, request: promotedRequest }, { status: response.status })
  }

  const session = getAgentSession(sessionId)
  if (!session || session.source !== "admin-console") {
    return NextResponse.json({ ok: false, error: "Console session not found" }, { status: 404 })
  }
  if (session.linkedChangeRequestId) {
    return NextResponse.json({ ok: false, error: "This console session has already been promoted to a request" }, { status: 409 })
  }
  const workflow = getWorkflowByKey(workflowKey)
  if (!workflow || !workflow.enabled) {
    return NextResponse.json({ ok: false, error: "Workflow is unavailable" }, { status: 400 })
  }
  const target = targetAppId ? getTargetApp(targetAppId) : null
  if ((workflowNeedsTarget(workflow) && !targetAppId) || (targetAppId && (!target || !target.agentEnabled))) {
    return NextResponse.json({ ok: false, error: "Select an active target for this workflow" }, { status: 400 })
  }

  let changeRequest: ReturnType<typeof createChangeRequest>
  try {
    changeRequest = createChangeRequest({
      title,
      description,
      workflowKey,
      requestType,
      priority,
      source: "admin-console",
      sourceSessionId: session.id,
      requestedByUserId: access.userId,
      targetAppId,
      targetEnvironmentId: targetAppId ? getDefaultTargetEnvironmentForApp(targetAppId)?.id ?? null : null,
      acceptanceCriteria: [],
      constraints: {},
      attachments: [],
    })
  } catch (error) {
    return NextResponse.json({ ok: false, error: error instanceof Error ? error.message : "REQUEST_PROMOTION_FAILED" }, { status: 400 })
  }
  if (!changeRequest) return NextResponse.json({ ok: false, error: "REQUEST_CREATE_FAILED" }, { status: 500 })

  const warnings: string[] = []
  try {
    createAgentSession({
      source: "admin-console",
      status: "active",
      title: `Request #${changeRequest.requestNumber}: ${changeRequest.title}`,
      linkedChangeRequestId: changeRequest.id,
      linkedTargetEnvironmentId: changeRequest.targetEnvironmentId,
      createdByUserId: access.userId,
      meta: {
        transport: "site",
        contextKey: `prism-lab-request:${changeRequest.id}`,
        kind: "prism-lab-request-conversation",
        promotedFromSessionId: session.id,
      },
      lastMessageAt: new Date().toISOString(),
    })
  } catch {
    warnings.push("REQUEST_CONVERSATION_CREATE_FAILED")
  }
  try {
    createAuditLog({
      actorUserId: access.userId,
      actionType: "admin.lab.console.promote",
      targetType: "change_request",
      targetId: changeRequest.id,
      meta: { sourceSessionId: session.id, workflowKey, targetAppId },
    })
  } catch {
    warnings.push("PROMOTION_AUDIT_LOG_FAILED")
  }
  const autoStart = await autoStartWorkflowRequest(changeRequest, { baseUrl: new URL(request.url).origin })
    .catch((error) => ({ started: false, reason: "autostart_error", error: error instanceof Error ? error.message : "WORKFLOW_AUTOSTART_FAILED" }))
  return NextResponse.json({ ok: true, request: changeRequest, autoStart, warnings }, { status: 201 })
}
