import { NextResponse } from "next/server"
import {
  buildTargetEnvironmentDeployPlan,
  findLatestAgentSessionByChangeRequest,
  getChangeRequestByNumber,
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
import { readOptionalInteger, requireServiceAccess } from "@/lib/internal-service"

type RouteContext = {
  params: Promise<{ requestNumber: string }>
}

function readRequestNumber(value: string) {
  if (!/^\d+$/.test(value)) {
    return null
  }
  const parsed = Number(value)
  return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : null
}

export async function GET(request: Request, context: RouteContext) {
  const access = await requireServiceAccess()
  if (!access.ok) {
    return NextResponse.json({ ok: false, error: access.error }, { status: access.status })
  }

  const { requestNumber: rawRequestNumber } = await context.params
  const requestNumber = readRequestNumber(rawRequestNumber)
  if (!requestNumber) {
    return NextResponse.json({ ok: false, error: "Invalid request number" }, { status: 400 })
  }

  const changeRequest = getChangeRequestByNumber(requestNumber)
  if (!changeRequest) {
    return NextResponse.json({ ok: false, error: "Change request not found" }, { status: 404 })
  }

  const url = new URL(request.url)
  const messageLimit = Math.min(500, Math.max(1, readOptionalInteger(url.searchParams.get("messageLimit")) ?? 150))
  const eventLimit = Math.min(500, Math.max(1, readOptionalInteger(url.searchParams.get("eventLimit")) ?? 200))
  const artifactLimit = Math.min(500, Math.max(1, readOptionalInteger(url.searchParams.get("artifactLimit")) ?? 200))

  const targetApp = changeRequest.targetAppId ? getTargetApp(changeRequest.targetAppId) : null
  const targetEnvironment = changeRequest.targetEnvironmentId ? getTargetEnvironment(changeRequest.targetEnvironmentId) : null
  const deployPlan = targetApp && targetEnvironment
    ? buildTargetEnvironmentDeployPlan({ request: changeRequest, targetApp, targetEnvironment })
    : null
  const workflow = getWorkflowByKey(changeRequest.workflowKey)
  const workflowRun = getWorkflowRunForRequest(changeRequest.id)
  const legacyExecutions = listChangeRequestExecutions(changeRequest.id)
  const agentRuns = listAgentRuns({ requestId: changeRequest.id, limit: 100 })
  const workflowEvents = listWorkflowEventsForRequest(changeRequest.id, eventLimit)
  const artifacts = listRequestArtifacts(changeRequest.id, artifactLimit)
  const externalRefs = listRequestExternalRefs(changeRequest.id)
  const agentSession = findLatestAgentSessionByChangeRequest(changeRequest.id)
  const agentMessages = agentSession ? listAgentMessages(agentSession.id, messageLimit) : []

  return NextResponse.json({
    ok: true,
    changeRequest,
    targetApp,
    targetEnvironment,
    deployPlan,
    workflow,
    workflowRun,
    latestAgentRun: agentRuns[0] ?? null,
    latestExecution: null,
    legacyExecutions,
    executions: legacyExecutions,
    agentRuns,
    workflowEvents,
    artifacts,
    externalRefs,
    agentSession,
    agentMessages,
  })
}
