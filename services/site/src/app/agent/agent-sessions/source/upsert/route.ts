import { NextResponse } from "next/server"
import { assignAgentProfileToSession, resolveAgentProfileInteraction, upsertAgentSessionFromSource } from "@/lib/app-core"

import { parseNullableString, parseString, requireServiceAccess } from "@/lib/internal-service"

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
  const source = parseString(body.source)
  const contextKey = parseString(body.contextKey ?? body.context_key)
  if (!source || !contextKey) {
    return NextResponse.json({ ok: false, error: "source and contextKey are required" }, { status: 400 })
  }

  const meta = body.meta && typeof body.meta === "object" && !Array.isArray(body.meta) ? body.meta as Record<string, unknown> : {}
  const surfaceType = source === "buzz" || source === "telegram" || source === "external" ? source : null
  const surfaceKey = surfaceType === "buzz"
    ? parseString(meta.channelId)
    : surfaceType === "telegram"
      ? parseString(meta.chatId)
      : surfaceType === "external"
        ? parseString(meta.externalInterfaceKey)
        : ""
  const resolvedAgent = surfaceType && surfaceKey ? resolveAgentProfileInteraction({ surfaceType, surfaceKey }) : null
  const boundProfile = resolvedAgent?.profile ?? null
  const session = upsertAgentSessionFromSource({
    source,
    contextKey,
    status: parseString(body.status) || undefined,
    title: parseNullableString(body.title) ?? undefined,
    linkedChangeRequestId: parseNullableString(body.linkedChangeRequestId ?? body.linked_change_request_id) ?? undefined,
    linkedTargetEnvironmentId: parseNullableString(body.linkedTargetEnvironmentId ?? body.linked_target_environment_id) ?? undefined,
    meta: { ...meta, ...(boundProfile ? { agentProfileKey: boundProfile.key, agentProfileVersion: boundProfile.version, agentBindingId: resolvedAgent?.binding.id, accessPolicy: resolvedAgent?.policy } : {}) },
    createdByUserId: parseNullableString(body.createdByUserId ?? body.created_by_user_id) ?? undefined,
    lastMessageAt: parseNullableString(body.lastMessageAt ?? body.last_message_at) ?? undefined,
  })
  if (session && boundProfile) {
    try {
      assignAgentProfileToSession({
        sessionId: session.id,
        profileId: boundProfile.id,
        conversationScope: surfaceType === "external" ? "individual" : "channel",
      })
    } catch (error) {
      if (!(error instanceof Error) || error.message !== "AGENT_SESSION_PROFILE_MISMATCH") throw error
    }
  }

  return NextResponse.json({ ok: true, session }, { status: 201 })
}
