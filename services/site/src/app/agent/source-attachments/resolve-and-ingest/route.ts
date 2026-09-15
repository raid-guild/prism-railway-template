import { NextResponse } from "next/server"
import {
  getInternalServiceToken,
  parseString,
  requireServiceAccess,
} from "@/lib/internal-service"

type AttachmentIntent = "summarize" | "promote-memory" | "request-artifact" | "workflow-input" | "promote-knowledge"

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

function parseDiscordMessageUrl(value: string) {
  const match = value.match(/discord(?:app)?\.com\/channels\/([^/?#]+)\/([^/?#]+)\/([^/?#]+)/i)
  if (!match) return null
  return {
    guildId: match[1],
    channelId: match[2],
    messageId: match[3],
  }
}

function parseIntent(value: unknown): AttachmentIntent {
  const intent = parseString(value).toLowerCase()
  if (
    intent === "summarize" ||
    intent === "promote-memory" ||
    intent === "request-artifact" ||
    intent === "workflow-input" ||
    intent === "promote-knowledge"
  ) {
    return intent
  }
  if (intent === "memory" || intent === "memory-inbox") return "promote-memory"
  if (intent === "knowledge" || intent === "knowledge-inbox") return "promote-knowledge"
  return "summarize"
}

function laneForIntent(intent: AttachmentIntent) {
  switch (intent) {
    case "request-artifact":
      return "request-artifact"
    case "workflow-input":
      return "workflow-input"
    case "summarize":
    case "promote-memory":
      return "memory-inbox"
    case "promote-knowledge":
      return null
  }
}

async function resolveAttachments(input: {
  platform: string
  channelId: string
  messageId: string
}) {
  const baseUrl = adapterBaseUrl()
  const token = adapterToken()
  if (!baseUrl || !token) {
    throw new Error("COMMUNICATION_ADAPTER_BASE_URL and COMMUNICATION_ADAPTER_TOKEN are required")
  }
  const response = await fetch(`${baseUrl}/attachments/resolve`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "X-Adapter-Token": token,
    },
    body: JSON.stringify(input),
  })
  const payload = (await response.json().catch(() => null)) as Record<string, unknown> | null
  if (!response.ok) {
    throw new Error(`ATTACHMENT_RESOLVE_FAILED:${response.status}:${JSON.stringify(payload ?? {}).slice(0, 300)}`)
  }
  return payload ?? {}
}

function attachmentsFromPayload(payload: Record<string, unknown>) {
  return Array.isArray(payload.attachments)
    ? payload.attachments.filter((item): item is Record<string, unknown> => isRecord(item))
    : []
}

async function callIngest(request: Request, body: Record<string, unknown>) {
  const response = await fetch(new URL("/agent/source-attachments/ingest", request.url), {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-service-token": getInternalServiceToken(),
    },
    body: JSON.stringify(body),
  })
  const payload = (await response.json().catch(() => null)) as Record<string, unknown> | null
  return { response, payload }
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
  if (platform !== "discord") {
    return NextResponse.json({ ok: false, error: "Unsupported platform" }, { status: 400 })
  }

  const messageUrl = parseString(body.messageUrl ?? body.message_url)
  const parsedUrl = messageUrl ? parseDiscordMessageUrl(messageUrl) : null
  const channelId = parseString(body.channelId ?? body.channel_id) || parsedUrl?.channelId || ""
  const messageId = parseString(body.messageId ?? body.message_id) || parsedUrl?.messageId || ""
  if (!channelId || !messageId) {
    return NextResponse.json({ ok: false, error: "messageUrl or channelId/messageId is required" }, { status: 400 })
  }

  const intent = parseIntent(body.intent ?? body.purpose ?? body.lane)
  if (intent === "promote-knowledge" && body.confirmKnowledge !== true && body.confirm_knowledge !== true) {
    return NextResponse.json(
      {
        ok: false,
        confirmationRequired: true,
        intent,
        message:
          "Knowledge is for reusable or canonical docs. A linked GitHub/source-backed knowledge source is usually better for long-term maintenance. Confirm before writing an attachment to Knowledge inbox.",
      },
      { status: 409 },
    )
  }
  if (intent === "promote-knowledge") {
    return NextResponse.json(
      {
        ok: false,
        error: "Knowledge inbox attachment promotion is not implemented yet. Use promote-memory or create a source-backed Knowledge doc.",
      },
      { status: 501 },
    )
  }

  let resolved: Record<string, unknown>
  try {
    resolved = await resolveAttachments({ platform, channelId, messageId })
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    return NextResponse.json({ ok: false, error: message }, { status: 502 })
  }

  const attachments = attachmentsFromPayload(resolved)
  if (!attachments.length) {
    return NextResponse.json({ ok: false, error: "No attachments found on message", resolved }, { status: 404 })
  }

  const requestedAttachmentId = parseString(body.attachmentId ?? body.attachment_id)
  const selectedAttachment = requestedAttachmentId
    ? attachments.find((attachment) => parseString(attachment.id) === requestedAttachmentId)
    : attachments.length === 1
      ? attachments[0]
      : null
  if (!selectedAttachment) {
    return NextResponse.json(
      {
        ok: false,
        error: requestedAttachmentId ? "Requested attachment not found on message" : "Message has multiple attachments; choose attachmentId",
        attachments,
        resolved,
      },
      { status: 409 },
    )
  }

  const lane = parseString(body.lane) || laneForIntent(intent)
  if (!lane) {
    return NextResponse.json({ ok: false, error: "Could not resolve attachment lane" }, { status: 400 })
  }

  const { response, payload: ingestPayload } = await callIngest(request, {
    platform,
    channelId,
    messageId,
    attachmentId: parseString(selectedAttachment.id),
    requestId: parseString(body.requestId ?? body.request_id) || undefined,
    agentRunId: parseString(body.agentRunId ?? body.agent_run_id) || undefined,
    lane,
    purpose: intent,
    requestedBy: parseString(body.requestedBy ?? body.requested_by) || undefined,
  })
  if (!response.ok || ingestPayload?.ok === false) {
    return NextResponse.json(
      { ok: false, error: ingestPayload?.error ?? `ATTACHMENT_INGEST_FAILED:${response.status}`, resolved, attachment: selectedAttachment },
      { status: response.status },
    )
  }

  return NextResponse.json(
    {
      ok: true,
      intent,
      lane,
      resolved,
      attachment: selectedAttachment,
      ingest: ingestPayload,
    },
    { status: 201 },
  )
}
