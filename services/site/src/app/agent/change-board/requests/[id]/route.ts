import { NextResponse } from "next/server"
import {
  buildTargetEnvironmentDeployPlan,
  createWorkflowEvent,
  ensureWorkflowRunForRequest,
  getChangeRequest,
  getTargetApp,
  getTargetEnvironment,
  getWorkflowByKey,
  getWorkflowRunForRequest,
  listAgentRuns,
  listActiveAgentRunsForRequest,
  listRequestExternalRefs,
  updateChangeRequest,
  updateWorkflowRun,
} from "@/lib/app-core"

import { parseNullableString, requireServiceAccess } from "@/lib/internal-service"
import { readRouteParam, trackedChangeRequestPriorities } from "@/lib/local-admin-api"
import { parseEstimatedHumanHours } from "@/lib/request-estimates"

type RouteContext = {
  params: Promise<{ id: string }>
}

function isWorkflowStep(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value) && typeof (value as { key?: unknown }).key === "string"
}

export async function GET(_request: Request, context: RouteContext) {
  const access = await requireServiceAccess()
  if (!access.ok) {
    return NextResponse.json({ ok: false, error: access.error }, { status: access.status })
  }

  const { id } = await context.params
  const changeRequest = getChangeRequest(readRouteParam(id))
  if (!changeRequest) {
    return NextResponse.json({ ok: false, error: "Change request not found" }, { status: 404 })
  }

  const targetApp = changeRequest.targetAppId ? getTargetApp(changeRequest.targetAppId) : null
  const targetEnvironment = changeRequest.targetEnvironmentId ? getTargetEnvironment(changeRequest.targetEnvironmentId) : null
  const agentRuns = listAgentRuns({ requestId: changeRequest.id, limit: 50 })
  const latestAgentRun = agentRuns[0] ?? null
  const externalRefs = listRequestExternalRefs(changeRequest.id)
  const deployPlan = targetApp && targetEnvironment
    ? buildTargetEnvironmentDeployPlan({ request: changeRequest, targetApp, targetEnvironment })
    : null

  return NextResponse.json({ ok: true, changeRequest, targetApp, targetEnvironment, deployPlan, latestAgentRun, latestExecution: null, agentRuns, externalRefs })
}

export async function PATCH(request: Request, context: RouteContext) {
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

  const { id } = await context.params
  const changeRequestId = readRouteParam(id)
  const existingChangeRequest = getChangeRequest(changeRequestId)
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
    return NextResponse.json({ ok: false, error: "Invalid JSON body" }, { status: 400 })
  }
  const body = payload as Record<string, unknown>
  const nextPriority = typeof body.priority === "string" ? body.priority : undefined
  const hasEstimatedHumanHours = body.estimatedHumanHours !== undefined || body.estimated_human_hours !== undefined
  const estimatedHumanHours = parseEstimatedHumanHours(body.estimatedHumanHours ?? body.estimated_human_hours)
  const rawWorkflowStepKey = body.currentWorkflowStepKey ?? body.current_workflow_step_key
  const nextWorkflowStepKey =
    typeof rawWorkflowStepKey === "string"
      ? rawWorkflowStepKey.trim()
      : undefined
  if (rawWorkflowStepKey !== undefined && nextWorkflowStepKey === "") {
    return NextResponse.json({ ok: false, error: "Invalid workflow step" }, { status: 400 })
  }

  if (!existingChangeRequest) {
    return NextResponse.json({ ok: false, error: "Change request not found" }, { status: 404 })
  }

  const workflow = nextWorkflowStepKey ? getWorkflowByKey(existingChangeRequest.workflowKey) : null
  const workflowSteps = Array.isArray(workflow?.definition.steps) ? workflow.definition.steps.filter(isWorkflowStep) : []
  const nextWorkflowStep = nextWorkflowStepKey
    ? workflowSteps.find((step) => step.key === nextWorkflowStepKey) ?? null
    : null
  if (nextPriority && !trackedChangeRequestPriorities.includes(nextPriority as typeof trackedChangeRequestPriorities[number])) {
    return NextResponse.json({ ok: false, error: "Invalid priority" }, { status: 400 })
  }
  if (hasEstimatedHumanHours && estimatedHumanHours === undefined) {
    return NextResponse.json({ ok: false, error: "Invalid estimatedHumanHours" }, { status: 400 })
  }
  if (nextWorkflowStepKey) {
    if (!nextWorkflowStep) {
      return NextResponse.json({ ok: false, error: "Invalid workflow step" }, { status: 400 })
    }
    const activeAgentRuns = listActiveAgentRunsForRequest(changeRequestId)
    if (activeAgentRuns.length) {
      return NextResponse.json(
        { ok: false, error: "AGENT_RUN_ACTIVE", activeAgentRuns },
        { status: 409 },
      )
    }
  }

  const changeRequest = updateChangeRequest(changeRequestId, {
    workflowStepKey: nextWorkflowStepKey,
    priority: nextPriority,
    targetEnvironmentId:
      body.targetEnvironmentId !== undefined || body.target_environment_id !== undefined
        ? parseNullableString(body.targetEnvironmentId ?? body.target_environment_id) ?? null
        : undefined,
    triageSummary:
      body.triageSummary !== undefined || body.triage_summary !== undefined
        ? parseNullableString(body.triageSummary ?? body.triage_summary) ?? null
        : undefined,
    estimatedHumanHours: hasEstimatedHumanHours ? estimatedHumanHours ?? null : undefined,
    reviewNotes:
      body.reviewNotes !== undefined || body.review_notes !== undefined
        ? parseNullableString(body.reviewNotes ?? body.review_notes) ?? null
        : undefined,
    resolutionSummary:
      body.resolutionSummary !== undefined || body.resolution_summary !== undefined
        ? parseNullableString(body.resolutionSummary ?? body.resolution_summary) ?? null
        : undefined,
    agentRecommendation:
      body.agentRecommendation !== undefined || body.agent_recommendation !== undefined
        ? parseNullableString(body.agentRecommendation ?? body.agent_recommendation) ?? null
        : undefined,
  })

  if (!changeRequest) {
    return NextResponse.json({ ok: false, error: "Change request not found" }, { status: 404 })
  }
  if (nextWorkflowStepKey) {
    const workflowRun = getWorkflowRunForRequest(changeRequestId) ?? ensureWorkflowRunForRequest({
      requestId: changeRequestId,
      workflowKey: changeRequest.workflowKey,
      currentStepKey: nextWorkflowStepKey,
    })
    const previousStepKey = workflowRun?.currentStepKey ?? null
    const isTerminalWorkflowStep = nextWorkflowStep?.type === "terminal"
    const updatedRun = updateWorkflowRun({
      requestId: changeRequestId,
      currentStepKey: nextWorkflowStepKey,
      status: isTerminalWorkflowStep ? "completed" : "active",
      completedAt: isTerminalWorkflowStep ? new Date().toISOString() : null,
    })
    if (updatedRun && previousStepKey !== nextWorkflowStepKey) {
      createWorkflowEvent({
        workflowRunId: updatedRun.id,
        requestId: changeRequestId,
        stepKey: nextWorkflowStepKey,
        eventType: "workflow.step_changed",
        actorType: "system",
        payload: {
          previousStepKey,
          nextStepKey: nextWorkflowStepKey,
        },
      })
    }
  }

  return NextResponse.json({ ok: true, changeRequest: getChangeRequest(changeRequestId) ?? changeRequest })
}
