import { randomUUID } from "node:crypto"
import { NextResponse } from "next/server"
import {
  buildRequestArtifactStoragePath,
  createRequestArtifact,
  createWorkflowEvent,
  deleteRequestArtifact,
  deleteRequestArtifactFile,
  getAgentRun,
  getChangeRequest,
  getWorkflowRunForRequest,
  loadConfig,
  writeRequestArtifactFile,
} from "@/lib/app-core"
import { parseString, requireServiceAccess } from "@/lib/internal-service"

type AttachmentLane = "request-artifact" | "workflow-input" | "memory-inbox"

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value)
}

function adapterBaseUrl() {
  return (
    process.env.COMMUNICATION_ADAPTER_BASE_URL ??
    process.env.SOURCE_ADAPTER_BASE_URL ??
    ""
  ).trim().replace(/\/+$/, "")
}

function adapterToken() {
  return (
    process.env.COMMUNICATION_ADAPTER_TOKEN ??
    process.env.SOURCE_ADAPTER_TOKEN ??
    ""
  ).trim()
}

function maxAttachmentBytes() {
  const rawMb = Number.parseInt(process.env.ARTIFACT_MAX_UPLOAD_MB ?? "50", 10)
  const safeMb = Number.isFinite(rawMb) ? Math.max(1, Math.min(rawMb, 500)) : 50
  return safeMb * 1024 * 1024
}

function parseLane(value: unknown): AttachmentLane | null {
  const lane = parseString(value) || "request-artifact"
  if (lane === "request-artifact" || lane === "workflow-input" || lane === "memory-inbox") {
    return lane
  }
  return null
}

function decodeMetadataHeader(value: string | null) {
  if (!value) return {}
  try {
    const parsed = JSON.parse(Buffer.from(value, "base64url").toString("utf8")) as unknown
    return isRecord(parsed) ? parsed : {}
  } catch {
    return {}
  }
}

function fallbackFilenameFromDisposition(value: string | null) {
  if (!value) return ""
  const match = value.match(/filename="([^"]+)"/i)
  return match?.[1]?.trim() ?? ""
}

function safeFilename(value: string) {
  return value
    .trim()
    .replace(/[/\\]+/g, "-")
    .replace(/[\x00-\x1F\x7F"\\]/g, "")
    .replace(/[^a-zA-Z0-9._-]+/g, "-")
    .replace(/^-+|-+$/g, "")
    || "attachment"
}

function isTextLikeAttachment(input: { filename: string; contentType: string }) {
  const name = input.filename.toLowerCase()
  const contentType = input.contentType.toLowerCase()
  return (
    contentType.startsWith("text/") ||
    contentType.includes("json") ||
    contentType.includes("xml") ||
    contentType.includes("yaml") ||
    contentType.includes("csv") ||
    /\.(md|markdown|mdx|txt|text|log|json|jsonl|csv|xml|yaml|yml)$/i.test(name)
  )
}

function prismMemoryBaseUrl() {
  return loadConfig().prismMemoryBaseUrl.replace(/\/+$/, "")
}

function prismMemoryWriteKey() {
  return (
    process.env.PRISM_API_WRITE_KEY ??
    process.env.PRISM_API_KEY ??
    ""
  ).trim()
}

function memoryArtifactUrl(pathname: string) {
  const filename = pathname.trim().split("/").filter(Boolean).at(-1) ?? ""
  const artifactId = filename.replace(/\.json$/i, "")
  if (!artifactId || artifactId === filename) {
    return null
  }
  const baseUrl = (
    process.env.PRISM_ARTIFACT_PUBLIC_BASE_URL ??
    process.env.PRISM_MEMORY_PUBLIC_BASE_URL ??
    prismMemoryBaseUrl()
  ).trim().replace(/\/+$/, "")
  return `${baseUrl}/artifacts/${encodeURIComponent(artifactId)}`
}

async function writeMemoryInbox(input: {
  content: string
  fetched: Awaited<ReturnType<typeof fetchSourceAttachment>>
  platform: string
  channelId: string
  messageId: string
  attachmentId: string
  purpose: string
  requestId: string | null
  agentRunId: string | null
  requestedBy: string | null
}) {
  const baseUrl = prismMemoryBaseUrl()
  const writeKey = prismMemoryWriteKey()
  if (!baseUrl || !writeKey) {
    throw new Error("PRISM_MEMORY_BASE_URL and PRISM_API_KEY are required")
  }

  const sourceUrl = parseString(input.fetched.metadata.messageUrl) || parseString(input.fetched.metadata.url) || undefined
  const response = await fetch(`${baseUrl}/memory/inbox`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "X-Prism-Api-Key": writeKey,
    },
    body: JSON.stringify({
      source: `${input.platform}-attachment`,
      ts: new Date().toISOString(),
      type: "session_attachment",
      bucket_hint: "inbox",
      content: input.content,
      author: input.requestedBy ?? "Prism Attachment Handoff",
      url: sourceUrl,
      metadata: {
        source_system: input.platform,
        source_type: "attachment",
        source_id: input.attachmentId,
        channel_id: input.channelId,
        message_id: input.messageId,
        attachment_id: input.attachmentId,
        request_id: input.requestId,
        agent_run_id: input.agentRunId,
        purpose: input.purpose,
        ephemeral_intent: true,
        visibility: "internal",
        filename: input.fetched.filename,
        content_type: input.fetched.contentType,
        size_bytes: input.fetched.content.byteLength,
        source_attachment: input.fetched.metadata,
      },
    }),
  })
  const payload = (await response.json().catch(() => null)) as { path?: string; error?: unknown } | null
  if (!response.ok) {
    throw new Error(`PRISM_MEMORY_INBOX_FAILED:${response.status}:${JSON.stringify(payload ?? {}).slice(0, 300)}`)
  }
  const path = typeof payload?.path === "string" ? payload.path.trim() : ""
  if (!path) {
    throw new Error("PRISM_MEMORY_INBOX_FAILED:missing_path")
  }
  return {
    path,
    artifactUrl: memoryArtifactUrl(path),
  }
}

async function fetchSourceAttachment(input: {
  platform: string
  channelId: string
  messageId: string
  attachmentId: string
  purpose: string
}) {
  const baseUrl = adapterBaseUrl()
  const token = adapterToken()
  if (!baseUrl || !token) {
    throw new Error("COMMUNICATION_ADAPTER_BASE_URL and COMMUNICATION_ADAPTER_TOKEN are required")
  }

  const response = await fetch(`${baseUrl}/attachments/fetch`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "X-Adapter-Token": token,
    },
    body: JSON.stringify(input),
  })
  if (!response.ok) {
    const errorBody = await response.text().catch(() => "")
    throw new Error(`ATTACHMENT_FETCH_FAILED:${response.status}:${errorBody.slice(0, 300)}`)
  }

  const content = Buffer.from(await response.arrayBuffer())
  const maxBytes = maxAttachmentBytes()
  if (content.byteLength > maxBytes) {
    throw new Error(`ATTACHMENT_TOO_LARGE:${content.byteLength}:${maxBytes}`)
  }

  const metadata = decodeMetadataHeader(response.headers.get("x-prism-attachment-metadata"))
  const filename =
    parseString(metadata.filename) ||
    fallbackFilenameFromDisposition(response.headers.get("content-disposition")) ||
    `${input.attachmentId}.bin`
  const contentType =
    parseString(metadata.contentType ?? metadata.content_type) ||
    response.headers.get("content-type")?.split(";")[0]?.trim() ||
    "application/octet-stream"

  return {
    content,
    metadata,
    filename: safeFilename(filename),
    contentType,
  }
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
  const body = isRecord(payload) ? payload : {}

  const platform = parseString(body.platform) || "discord"
  const requestId = parseString(body.requestId ?? body.request_id) || null
  const channelId = parseString(body.channelId ?? body.channel_id)
  const messageId = parseString(body.messageId ?? body.message_id)
  const attachmentId = parseString(body.attachmentId ?? body.attachment_id)
  const purpose = parseString(body.purpose) || "request-artifact"
  const lane = parseLane(body.lane)
  const agentRunId = parseString(body.agentRunId ?? body.agent_run_id) || null

  if (!lane) {
    return NextResponse.json(
      { ok: false, error: "Unsupported lane. Use request-artifact, workflow-input, or memory-inbox." },
      { status: 400 },
    )
  }
  if (platform !== "discord") {
    return NextResponse.json({ ok: false, error: "Unsupported platform" }, { status: 400 })
  }
  if (!channelId || !messageId || !attachmentId) {
    return NextResponse.json(
      { ok: false, error: "channelId, messageId, and attachmentId are required" },
      { status: 400 },
    )
  }
  const changeRequest = requestId ? getChangeRequest(requestId) : null
  if (requestId && !changeRequest) {
    return NextResponse.json({ ok: false, error: "Change request not found" }, { status: 404 })
  }
  if (!requestId && lane !== "memory-inbox") {
    return NextResponse.json({ ok: false, error: "requestId is required unless lane is memory-inbox" }, { status: 400 })
  }
  if (agentRunId) {
    const agentRun = getAgentRun(agentRunId)
    if (!agentRun || agentRun.requestId !== requestId) {
      return NextResponse.json({ ok: false, error: "Invalid agentRunId" }, { status: 400 })
    }
  }

  let fetched: Awaited<ReturnType<typeof fetchSourceAttachment>>
  try {
    fetched = await fetchSourceAttachment({ platform, channelId, messageId, attachmentId, purpose })
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    const status =
      message.startsWith("ATTACHMENT_FETCH_FAILED:404:") ? 404
      : message.startsWith("ATTACHMENT_TOO_LARGE:") ? 413
      : message.includes("COMMUNICATION_ADAPTER_BASE_URL") ? 503
      : 502
    return NextResponse.json({ ok: false, error: message }, { status })
  }

  const artifactId = randomUUID()
  const name = safeFilename(parseString(body.name) || fetched.filename)
  const storagePath = requestId ? buildRequestArtifactStoragePath({ requestId, artifactId, name }) : null
  const workflowRun = requestId ? getWorkflowRunForRequest(requestId) : null
  let memoryInbox: { path: string; artifactUrl: string | null } | null = null

  if (lane === "memory-inbox") {
    if (!isTextLikeAttachment({ filename: name, contentType: fetched.contentType })) {
      return NextResponse.json(
        { ok: false, error: "Only text-like attachments can be promoted directly to memory inbox" },
        { status: 400 },
      )
    }
    const content = fetched.content.toString("utf8").trim()
    if (!content) {
      return NextResponse.json({ ok: false, error: "Attachment content is empty" }, { status: 400 })
    }
    try {
      memoryInbox = await writeMemoryInbox({
        content,
        fetched,
        platform,
        channelId,
        messageId,
        attachmentId,
        purpose,
        requestId,
        agentRunId,
        requestedBy: parseString(body.requestedBy ?? body.requested_by) || null,
      })
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      return NextResponse.json({ ok: false, error: message }, { status: 502 })
    }
  }

  if (!requestId || !storagePath) {
    return NextResponse.json({ ok: true, memoryInbox }, { status: 201 })
  }

  try {
    await writeRequestArtifactFile(storagePath, fetched.content)
    const artifact = createRequestArtifact({
      id: artifactId,
      agentRunId,
      requestId,
      workflowRunId: workflowRun?.id ?? null,
      executionId: null,
      kind: lane === "workflow-input" ? "workflow-input" : "source-attachment",
      name,
      description: parseString(body.description) || `Fetched ${platform} attachment ${attachmentId}`,
      mimeType: fetched.contentType,
      storagePath,
      sizeBytes: fetched.content.byteLength,
      metadata: {
        source: "source-attachment",
        platform,
        lane,
        purpose,
        fetchedAt: new Date().toISOString(),
        sourceAttachment: fetched.metadata,
        memoryInbox,
        requestedBy: parseString(body.requestedBy ?? body.requested_by) || null,
      },
      createdBy: "source-attachment",
    })

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
          source: "source-attachment",
          platform,
        },
      })
    }

    return NextResponse.json({ ok: true, artifact, memoryInbox }, { status: 201 })
  } catch (error) {
    deleteRequestArtifact(artifactId)
    await deleteRequestArtifactFile(storagePath).catch(() => undefined)
    const message = error instanceof Error ? error.message : String(error)
    return NextResponse.json({ ok: false, error: message }, { status: 500 })
  }
}
