import { NextResponse } from "next/server"
import { createChangeRequest, getChangeRequest, getDefaultTargetEnvironmentForApp, getTargetApp, getWorkflowByKey, listChangeRequests } from "@/lib/app-core"

import {
  parseNullableString,
  parseString,
  requireServiceAccess,
} from "@/lib/internal-service"
import { trackedChangeRequestPriorities, trackedChangeRequestTypes } from "@/lib/local-admin-api"
import { parseEstimatedHumanHours } from "@/lib/request-estimates"
import { autoStartWorkflowRequest } from "@/lib/workflow-autostart"
import { requireRequestWorkflowKey, workflowSelectionHint } from "@/lib/request-workflow-selection"

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value)
}

function readPositiveInteger(value: string | null, fallback: number) {
  const parsed = Number(value)
  return Number.isFinite(parsed) && parsed > 0 ? Math.trunc(parsed) : fallback
}

function readBooleanQuery(value: string | null) {
  return value ? new Set(["1", "true", "yes", "on"]).has(value.trim().toLowerCase()) : false
}

function readBooleanBody(value: unknown, fallback = false) {
  if (typeof value === "boolean") return value
  if (typeof value === "string") return new Set(["1", "true", "yes", "on"]).has(value.trim().toLowerCase())
  return fallback
}

export async function GET(request: Request) {
  const access = await requireServiceAccess()
  if (!access.ok) {
    return NextResponse.json({ ok: false, error: access.error }, { status: access.status })
  }

  const url = new URL(request.url)
  const targetAppId = parseString(url.searchParams.get("targetAppId") ?? url.searchParams.get("target_app_id")) || undefined
  const source = parseString(url.searchParams.get("source")) || undefined
  const platform = parseString(url.searchParams.get("platform")) || undefined
  const originTargetId = parseString(url.searchParams.get("target")) || undefined
  const interactionProfileKey = parseString(url.searchParams.get("profile")) || undefined
  const originActor = parseString(url.searchParams.get("initiator")) || undefined
  const query = parseString(url.searchParams.get("q")) || undefined
  const openOnly = readBooleanQuery(url.searchParams.get("openOnly") ?? url.searchParams.get("open_only"))
  const limit = Math.min(readPositiveInteger(url.searchParams.get("limit"), 100), 500)

  return NextResponse.json({
    ok: true,
    changeRequests: listChangeRequests({ targetAppId, source, platform, originTargetId, interactionProfileKey, originActor, query, openOnly, limit }),
  })
}

export async function POST(request: Request) {
  const access = await requireServiceAccess()
  if (!access.ok) {
    return NextResponse.json({ ok: false, error: access.error }, { status: access.status })
  }

  let payload: unknown = null
  try {
    payload = await request.json()
  } catch {
    return NextResponse.json({ ok: false, error: "Invalid JSON body" }, { status: 400 })
  }

  const body = payload && typeof payload === "object" ? payload as Record<string, unknown> : {}
  const origin = new URL(request.url).origin
  const title = parseString(body.title)
  const description = parseString(body.description)
  const requestType = parseString(body.requestType ?? body.request_type)
  const targetAppId = parseString(body.targetAppId ?? body.target_app_id)
  let workflowKey: string
  try {
    workflowKey = requireRequestWorkflowKey(body.workflowKey ?? body.workflow_key)
  } catch {
    return NextResponse.json({ ok: false, error: "WORKFLOW_KEY_REQUIRED", hint: workflowSelectionHint }, { status: 400 })
  }
  const priority = parseString(body.priority) || "normal"
  const hasEstimatedHumanHours = body.estimatedHumanHours !== undefined || body.estimated_human_hours !== undefined
  const estimatedHumanHours = parseEstimatedHumanHours(body.estimatedHumanHours ?? body.estimated_human_hours)
  const workflow = getWorkflowByKey(workflowKey)
  const target = workflow?.definition?.target
  const allowTargetless = readBooleanBody(body.allowTargetless ?? body.allow_targetless)
  const isTargetlessRequest = allowTargetless && !targetAppId
  const targetRequired = workflowKey === "change-request-default"
    || (isRecord(target) && target.required === true)

  if (!title || !description || !requestType) {
    return NextResponse.json({ ok: false, error: "title, description, and requestType are required" }, { status: 400 })
  }
  if (!workflow) {
    return NextResponse.json({ ok: false, error: `Workflow not found: ${workflowKey}` }, { status: 400 })
  }
  if (!workflow.enabled) {
    return NextResponse.json({ ok: false, error: `Workflow disabled: ${workflowKey}` }, { status: 400 })
  }
  if (targetRequired && !targetAppId && !allowTargetless) {
    return NextResponse.json({ ok: false, error: `Workflow ${workflowKey} requires targetAppId` }, { status: 400 })
  }
  const targetApp = targetAppId ? getTargetApp(targetAppId) : null
  if (targetAppId && (!targetApp || !targetApp.agentEnabled)) {
    return NextResponse.json({ ok: false, error: "Target app is inactive or unavailable" }, { status: 400 })
  }
  if (!trackedChangeRequestTypes.includes(requestType as typeof trackedChangeRequestTypes[number])) {
    return NextResponse.json({
      ok: false,
      error: "Invalid request type",
      validRequestTypes: trackedChangeRequestTypes,
    }, { status: 400 })
  }
  if (!trackedChangeRequestPriorities.includes(priority as typeof trackedChangeRequestPriorities[number])) {
    return NextResponse.json({
      ok: false,
      error: "Invalid priority",
      validPriorities: trackedChangeRequestPriorities,
    }, { status: 400 })
  }
  if (hasEstimatedHumanHours && estimatedHumanHours === undefined) {
    return NextResponse.json({ ok: false, error: "Invalid estimatedHumanHours" }, { status: 400 })
  }

  let changeRequest
  try {
    changeRequest = createChangeRequest({
    title,
    description,
    workflowKey,
    requestType,
    priority,
    source: parseString(body.source) || "chat",
    requestedByUserId: null,
    sourceSessionId: parseNullableString(body.sourceSessionId ?? body.source_session_id) ?? null,
    sourceMessageId: parseNullableString(body.sourceMessageId ?? body.source_message_id) ?? null,
    targetAppId: targetAppId || null,
    targetEnvironmentId:
      targetAppId
        ? parseNullableString(body.targetEnvironmentId ?? body.target_environment_id)
          ?? getDefaultTargetEnvironmentForApp(targetAppId)?.id
          ?? null
        : null,
    triageSummary: parseNullableString(body.triageSummary ?? body.triage_summary) ?? null,
    estimatedHumanHours: estimatedHumanHours ?? null,
    acceptanceCriteria: Array.isArray(body.acceptanceCriteria) ? body.acceptanceCriteria : [],
    constraints: body.constraints && typeof body.constraints === "object" && !Array.isArray(body.constraints) ? body.constraints as Record<string, unknown> : {},
    attachments: Array.isArray(body.attachments) ? body.attachments : [],
    agentRecommendation: parseNullableString(body.agentRecommendation ?? body.agent_recommendation) ?? null,
    })
  } catch (error) {
    const code = error instanceof Error ? error.message : ""
    if (code === "SOURCE_SESSION_NOT_FOUND" || code === "SOURCE_SESSION_REQUIRED" || code === "SOURCE_MESSAGE_NOT_FOUND") {
      return NextResponse.json({ ok: false, error: code }, { status: 400 })
    }
    throw error
  }

  const autoStartRequested = !isTargetlessRequest && body.autoStart !== false && body.auto_start !== false
  const rawRequestedSkills = body.requestedSkills ?? body.requested_skills
  const requestedSkills = Array.isArray(rawRequestedSkills)
    ? rawRequestedSkills
      .filter((item): item is string => typeof item === "string" && item.trim().length > 0)
      .map((item: string) => item.trim())
    : []
  const autoStart = changeRequest && autoStartRequested
    ? await autoStartWorkflowRequest(changeRequest, { baseUrl: origin, requestedSkills })
    : null
  const refreshedChangeRequest = changeRequest ? getChangeRequest(changeRequest.id) : null

  return NextResponse.json({
    ok: true,
    changeRequest: refreshedChangeRequest ?? changeRequest,
    autoStart,
  }, { status: 201 })
}
