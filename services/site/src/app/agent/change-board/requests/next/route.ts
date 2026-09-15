import { NextResponse } from "next/server"
import {
  buildTargetEnvironmentDeployPlan,
  getNextQueuedChangeRequest,
  getTargetApp,
  getTargetEnvironment,
  listAgentRuns,
  listRequestExternalRefs,
} from "@/lib/app-core"

import { requireServiceAccess } from "@/lib/internal-service"

export async function GET(request: Request) {
  const access = await requireServiceAccess()
  if (!access.ok) {
    return NextResponse.json({ ok: false, error: access.error }, { status: access.status })
  }

  const targetAppId = new URL(request.url).searchParams.get("targetAppId") ?? undefined
  const changeRequest = getNextQueuedChangeRequest({ targetAppId })

  if (!changeRequest) {
    return NextResponse.json({ ok: true, changeRequest: null, targetApp: null, targetEnvironment: null, deployPlan: null, latestAgentRun: null, latestExecution: null, externalRefs: [] })
  }

  const targetApp = changeRequest.targetAppId ? getTargetApp(changeRequest.targetAppId) : null
  const targetEnvironment = changeRequest.targetEnvironmentId ? getTargetEnvironment(changeRequest.targetEnvironmentId) : null
  const latestAgentRun = listAgentRuns({ requestId: changeRequest.id, limit: 1 })[0] ?? null
  const externalRefs = listRequestExternalRefs(changeRequest.id)
  const deployPlan = targetApp && targetEnvironment
    ? buildTargetEnvironmentDeployPlan({ request: changeRequest, targetApp, targetEnvironment })
    : null

  return NextResponse.json({ ok: true, changeRequest, targetApp, targetEnvironment, deployPlan, latestAgentRun, latestExecution: null, externalRefs })
}
