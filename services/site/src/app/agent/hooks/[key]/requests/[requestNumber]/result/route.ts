import { NextResponse } from "next/server"

import {
  getChangeRequestByNumber,
  getHookByKey,
  getRequestArtifactByName,
  getWorkflowRunForRequest,
  readRequestArtifactFile,
} from "@/lib/app-core"
import { authorizeHookAccess, hookResultArtifactNames } from "@/lib/hook-auth"

type RouteContext = {
  params: Promise<{ key: string; requestNumber: string }>
}

function requestNumber(value: string) {
  if (!/^\d+$/.test(value)) return null
  const parsed = Number(value)
  return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : null
}

export async function GET(request: Request, context: RouteContext) {
  const params = await context.params
  const key = decodeURIComponent(params.key)
  const hook = getHookByKey(key)
  if (!hook) {
    return NextResponse.json({ ok: false, error: "HOOK_NOT_FOUND" }, { status: 404 })
  }
  const access = await authorizeHookAccess(request, hook)
  if (!access.ok) {
    return NextResponse.json({ ok: false, error: access.error }, { status: access.status })
  }

  const parsedRequestNumber = requestNumber(params.requestNumber)
  if (!parsedRequestNumber) {
    return NextResponse.json({ ok: false, error: "INVALID_REQUEST_NUMBER" }, { status: 400 })
  }
  const changeRequest = getChangeRequestByNumber(parsedRequestNumber)
  if (!changeRequest || changeRequest.workflowKey !== hook.workflowKey) {
    return NextResponse.json({ ok: false, error: "HOOK_REQUEST_NOT_FOUND" }, { status: 404 })
  }
  if (
    access.principal.kind === "interface"
    && changeRequest.source !== `hook:${hook.key}:external-interface:${access.principal.interfaceKey}`
  ) {
    return NextResponse.json({ ok: false, error: "HOOK_REQUEST_NOT_FOUND" }, { status: 404 })
  }

  const workflowRun = getWorkflowRunForRequest(changeRequest.id)
  if (!workflowRun || workflowRun.status === "active") {
    return NextResponse.json({
      ok: true,
      status: "running",
      requestNumber: changeRequest.requestNumber,
      currentWorkflowStepKey: changeRequest.currentWorkflowStepKey,
    }, { status: 202 })
  }
  if (workflowRun.status !== "completed") {
    return NextResponse.json({
      ok: false,
      status: workflowRun.status,
      error: "HOOK_WORKFLOW_DID_NOT_COMPLETE",
      requestNumber: changeRequest.requestNumber,
    }, { status: 409 })
  }

  const allowedArtifactNames = hookResultArtifactNames(hook)
  if (!allowedArtifactNames.length) {
    return NextResponse.json({ ok: false, error: "HOOK_RESULT_ARTIFACT_NOT_CONFIGURED" }, { status: 409 })
  }
  const requestedArtifactName = new URL(request.url).searchParams.get("name")?.trim()
    || (allowedArtifactNames.length === 1 ? allowedArtifactNames[0] : "")
  if (!requestedArtifactName || !allowedArtifactNames.includes(requestedArtifactName)) {
    return NextResponse.json({
      ok: false,
      error: "HOOK_RESULT_ARTIFACT_NOT_ALLOWED",
      allowedArtifactNames,
    }, { status: 403 })
  }

  const artifact = getRequestArtifactByName(changeRequest.id, requestedArtifactName)
  if (!artifact) {
    return NextResponse.json({
      ok: false,
      status: "completed",
      error: "HOOK_RESULT_ARTIFACT_MISSING",
      requestNumber: changeRequest.requestNumber,
    }, { status: 409 })
  }

  const content = await readRequestArtifactFile(artifact)
  if (content.byteLength > 1_000_000) {
    return NextResponse.json({ ok: false, error: "HOOK_RESULT_ARTIFACT_TOO_LARGE" }, { status: 413 })
  }
  const text = content.toString("utf8")
  let result: unknown = text
  if (artifact.mimeType?.toLowerCase().includes("json") || artifact.name.toLowerCase().endsWith(".json")) {
    try {
      result = JSON.parse(text)
    } catch {
      return NextResponse.json({ ok: false, error: "HOOK_RESULT_ARTIFACT_INVALID_JSON" }, { status: 502 })
    }
  }

  return NextResponse.json({
    ok: true,
    status: "completed",
    requestNumber: changeRequest.requestNumber,
    artifact: {
      id: artifact.id,
      name: artifact.name,
      kind: artifact.kind,
      mimeType: artifact.mimeType,
      createdAt: artifact.createdAt,
    },
    result,
  })
}
