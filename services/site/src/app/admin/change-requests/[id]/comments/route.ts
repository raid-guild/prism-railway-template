import { NextResponse } from "next/server"
import {
  createAgentMessage,
  createAgentSession,
  getChangeRequest,
  getSessionSummary,
  listAgentMessages,
  findLatestAgentSessionByChangeRequest,
  updateAgentSession,
} from "@/lib/app-core"

import { adminFetch } from "@/lib/admin"
import {
  parseString,
  readRouteParam,
  requireLocalCommentAccess,
  useLocalAppApi,
} from "@/lib/local-admin-api"

type RouteContext = {
  params: Promise<{ id: string }>
}

export async function POST(request: Request, context: RouteContext) {
  let payload: unknown = null

  try {
    payload = await request.json()
  } catch {
    return NextResponse.json({ ok: false, error: "Invalid JSON body" }, { status: 400 })
  }

  const { id } = await context.params

  if (useLocalAppApi()) {
    const access = await requireLocalCommentAccess()
    if (!access.ok) {
      return NextResponse.json({ ok: false, error: access.error }, { status: access.status })
    }

    const changeRequestId = readRouteParam(id)
    const changeRequest = getChangeRequest(changeRequestId)
    if (!changeRequest) {
      return NextResponse.json({ ok: false, error: "Change request not found" }, { status: 404 })
    }
    const actor = access.userId ? getSessionSummary(access.userId) : null

    const body = payload as Record<string, unknown>
    const content = parseString(body.content)
    if (!content) {
      return NextResponse.json({ ok: false, error: "content is required" }, { status: 400 })
    }

    let session = findLatestAgentSessionByChangeRequest(changeRequestId)
    if (!session) {
      session = createAgentSession({
        source: "admin-console",
        status: "active",
        title: changeRequest.title,
        linkedChangeRequestId: changeRequest.id,
        linkedTargetEnvironmentId: changeRequest.targetEnvironmentId,
        createdByUserId: access.userId,
        meta: {
          transport: "site",
        },
        lastMessageAt: new Date().toISOString(),
      })
    }

    if (!session) {
      return NextResponse.json({ ok: false, error: "AGENT_SESSION_CREATE_FAILED" }, { status: 500 })
    }

    const message = createAgentMessage({
      sessionId: session.id,
      role: "user",
      source: "site-comment",
      sourceMessageId: null,
      content,
      meta: {
        transport: "site",
        kind: "comment",
        actorUserId: access.userId,
        actorDisplayName: actor?.displayName ?? actor?.handle ?? actor?.email ?? null,
        actorHandle: actor?.handle ?? null,
      },
    })

    const updatedSession = updateAgentSession(session.id, {
      linkedChangeRequestId: changeRequest.id,
      linkedTargetEnvironmentId: changeRequest.targetEnvironmentId,
      lastMessageAt: new Date().toISOString(),
      meta: {
        ...session.meta,
        transport: "site",
      },
    })

    return NextResponse.json({
      ok: true,
      session: updatedSession,
      message,
      messages: listAgentMessages(session.id, 100),
    }, { status: 201 })
  }

  const response = await adminFetch(`/api/admin/change-board/requests/${id}/agent-session/messages`, {
    method: "POST",
    body: JSON.stringify(payload),
  })

  const text = await response.text()
  const contentType = response.headers.get("content-type") ?? "application/json"

  return new NextResponse(text, {
    status: response.status,
    headers: {
      "content-type": contentType,
    },
  })
}
