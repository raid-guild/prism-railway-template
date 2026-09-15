import { randomUUID } from "node:crypto"
import { NextResponse } from "next/server"
import {
  buildRequestArtifactStoragePath,
  createWorkflowEvent,
  createRequestArtifact,
  deleteRequestArtifact,
  deleteRequestArtifactFile,
  getAgentRun,
  getChangeRequest,
  getChangeRequestExecution,
  getWorkflowRun,
  getWorkflowRunForRequest,
  listRequestArtifacts,
  writeRequestArtifactFile,
} from "@/lib/app-core"
import { parseString, readOptionalInteger, requireServiceAccess } from "@/lib/internal-service"

type RouteContext = {
  params: Promise<{ id: string }>
}

function parseRecord(value: unknown) {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {}
}

function decodeContent(body: Record<string, unknown>) {
  const encoding = parseString(body.encoding || "utf8").toLowerCase()
  const content = body.content

  if (typeof content !== "string") {
    throw new Error("content is required")
  }

  if (encoding === "base64") {
    return Buffer.from(content, "base64")
  }

  if (encoding !== "utf8" && encoding !== "text") {
    throw new Error("encoding must be utf8 or base64")
  }

  return Buffer.from(content, "utf8")
}

export async function GET(request: Request, context: RouteContext) {
  const access = await requireServiceAccess()
  if (!access.ok) {
    return NextResponse.json({ ok: false, error: access.error }, { status: access.status })
  }

  const { id } = await context.params
  if (!getChangeRequest(id)) {
    return NextResponse.json({ ok: false, error: "Change request not found" }, { status: 404 })
  }

  const url = new URL(request.url)
  const rawLimit = readOptionalInteger(url.searchParams.get("limit")) ?? 100
  const limit = Math.min(500, Math.max(1, rawLimit))
  return NextResponse.json({ ok: true, artifacts: listRequestArtifacts(id, limit) })
}

export async function POST(request: Request, context: RouteContext) {
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

  const { id: requestId } = await context.params
  if (!getChangeRequest(requestId)) {
    return NextResponse.json({ ok: false, error: "Change request not found" }, { status: 404 })
  }

  const body = parseRecord(payload)
  const name = parseString(body.name)
  if (!name) {
    return NextResponse.json({ ok: false, error: "name is required" }, { status: 400 })
  }

  let content: Buffer
  try {
    content = decodeContent(body)
  } catch (error) {
    return NextResponse.json(
      { ok: false, error: error instanceof Error ? error.message : "Invalid content" },
      { status: 400 },
    )
  }

  const artifactId = randomUUID()
  const storagePath = buildRequestArtifactStoragePath({ requestId, artifactId, name })
  const workflowRunId = parseString(body.workflowRunId ?? body.workflow_run_id) || null
  const executionId = parseString(body.executionId ?? body.execution_id) || null
  const agentRunId = parseString(body.agentRunId ?? body.agent_run_id) || null

  if (workflowRunId) {
    const workflowRun = getWorkflowRun(workflowRunId)
    if (!workflowRun || workflowRun.requestId !== requestId) {
      return NextResponse.json({ ok: false, error: "Invalid workflowRunId" }, { status: 400 })
    }
  }

  if (executionId) {
    const execution = getChangeRequestExecution(executionId)
    if (!execution || execution.changeRequestId !== requestId) {
      return NextResponse.json({ ok: false, error: "Invalid executionId" }, { status: 400 })
    }
  }

  if (agentRunId) {
    const agentRun = getAgentRun(agentRunId)
    if (!agentRun || agentRun.requestId !== requestId) {
      return NextResponse.json({ ok: false, error: "Invalid agentRunId" }, { status: 400 })
    }
  }

  try {
    await writeRequestArtifactFile(storagePath, content)
    const artifact = createRequestArtifact({
      id: artifactId,
      agentRunId,
      requestId,
      workflowRunId,
      executionId,
      kind: parseString(body.kind) || "file",
      name,
      description: parseString(body.description) || null,
      mimeType: parseString(body.mimeType ?? body.mime_type) || "application/octet-stream",
      storagePath,
      sizeBytes: content.byteLength,
      metadata: parseRecord(body.metadata),
      createdBy: parseString(body.createdBy ?? body.created_by) || "agent",
    })
    const workflowRun = getWorkflowRunForRequest(requestId)
    if (workflowRun) {
      createWorkflowEvent({
        workflowRunId: workflowRun.id,
        requestId,
        stepKey: workflowRun.currentStepKey,
        eventType: "artifact.created",
        actorType: "agent",
        payload: {
          artifactId: artifact.id,
          agentRunId: artifact.agentRunId,
          kind: artifact.kind,
          name: artifact.name,
          mimeType: artifact.mimeType,
          sizeBytes: artifact.sizeBytes,
        },
      })
    }

    return NextResponse.json({ ok: true, artifact }, { status: 201 })
  } catch (error) {
    deleteRequestArtifact(artifactId)
    await deleteRequestArtifactFile(storagePath).catch(() => undefined)
    const message = error instanceof Error ? error.message : String(error)
    return NextResponse.json({ ok: false, error: message }, { status: 500 })
  }
}
