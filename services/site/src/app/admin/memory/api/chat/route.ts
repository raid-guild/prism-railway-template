import { NextResponse } from "next/server"

import {
  assignAgentProfileToSession,
  createAgentMessage,
  createAgentSession,
  getAgentProfile,
  getAgentProfileVersion,
  getAgentSession,
  getAgentSessionProfileAssignment,
  listAgentMessages,
  requestRuntimeResponse,
  updateAgentSession,
} from "@/lib/app-core"
import { requireCapabilityAccess } from "@/lib/admin-auth"
import { resolveAgentProfileRuntimeScope } from "@/lib/agent-profile-runtime-scope"
import { fetchPrismMemoryJson } from "@/lib/prism-memory"
import { buildMemoryConversationPrompt, eligibleMemoryAgents, resolveLabMemoryReferences } from "@/lib/prism-lab-routes/memory-context-service"

function text(value: unknown, max = 12_000) {
  return typeof value === "string" && value.trim() ? value.trim().slice(0, max) : null
}

export async function GET(request: Request) {
  const access = await requireCapabilityAccess("canChatAgents")
  if (!access.ok) return NextResponse.json({ ok: false, error: access.error }, { status: access.status })
  const sessionId = new URL(request.url).searchParams.get("sessionId")?.trim()
  const session = sessionId ? getAgentSession(sessionId) : null
  if (!session || session.source !== "prism-memory-explorer") return NextResponse.json({ ok: false, error: "Memory conversation not found" }, { status: 404 })
  if (!access.capabilities.includes("canRunAgent") && session.createdByUserId !== access.userId) return NextResponse.json({ ok: false, error: "Forbidden" }, { status: 403 })
  return NextResponse.json({ ok: true, session, assignment: getAgentSessionProfileAssignment(session.id), messages: listAgentMessages(session.id, 150) })
}

export async function POST(request: Request) {
  const access = await requireCapabilityAccess("canChatAgents")
  if (!access.ok) return NextResponse.json({ ok: false, error: access.error }, { status: access.status })
  const body = await request.json().catch(() => null) as Record<string, unknown> | null
  if (!body) return NextResponse.json({ ok: false, error: "Invalid JSON body" }, { status: 400 })
  const question = text(body.question)
  const agentProfileKey = text(body.agentProfileKey, 160)
  if (!question || !agentProfileKey) return NextResponse.json({ ok: false, error: "question and agentProfileKey are required" }, { status: 400 })
  const profile = getAgentProfile(agentProfileKey)
  if (!profile) return NextResponse.json({ ok: false, error: "Agent Profile not found" }, { status: 404 })

  try {
    const requestedSessionId = text(body.sessionId, 200)
    let session = requestedSessionId ? getAgentSession(requestedSessionId) : null
    if (requestedSessionId && (!session || session.source !== "prism-memory-explorer")) return NextResponse.json({ ok: false, error: "Memory conversation not found" }, { status: 404 })
    if (session && !access.capabilities.includes("canRunAgent") && session.createdByUserId !== access.userId) return NextResponse.json({ ok: false, error: "Forbidden" }, { status: 403 })
    if (session) {
      const assignment = getAgentSessionProfileAssignment(session.id)
      if (assignment?.profileId !== profile.id) return NextResponse.json({ ok: false, error: "Memory conversation belongs to another Agent Profile" }, { status: 409 })
    }
    const assignedVersion = session ? getAgentSessionProfileAssignment(session.id)?.profileVersion : profile.version
    const resolvedProfile = getAgentProfileVersion(profile.id, assignedVersion) ?? profile
    const references = await resolveLabMemoryReferences(session ? session.meta.memoryReferences : body.references, (path) => fetchPrismMemoryJson(path))
    const eligible = eligibleMemoryAgents({ profiles: [resolvedProfile], references, capabilities: access.capabilities })
    if (!eligible.length) return NextResponse.json({ ok: false, error: "Agent Profile is not eligible for every selected Memory record" }, { status: 403 })

    const now = new Date().toISOString()
    const referenceIds = references.map((item) => item.reference.type === "rolling-day"
      ? { type: item.reference.type, date: item.reference.date }
      : { type: item.reference.type, slug: item.reference.slug })
    if (!session) {
      session = createAgentSession({
        source: "prism-memory-explorer",
        status: "active",
        title: `Memory · ${references.map((item) => item.label).slice(0, 2).join(", ")}`.slice(0, 160),
        createdByUserId: access.userId,
        meta: { transport: "site", kind: "memory-read", authorityMode: "read_only_utility", memoryReferences: referenceIds, citations: references.map((item) => item.citation), agentProfileKey: profile.key, agentProfileVersion: profile.version },
        lastMessageAt: now,
      })
      if (!session) throw new Error("MEMORY_SESSION_CREATE_FAILED")
      assignAgentProfileToSession({ sessionId: session.id, profileId: profile.id, conversationScope: "individual" })
    }

    const priorMessages = listAgentMessages(session.id, 20)
    createAgentMessage({ sessionId: session.id, role: "user", source: "site-memory-chat", sourceMessageId: null, content: question, meta: { readOnlyUtility: true, memoryReferences: referenceIds } })
    const runtimeScope = resolveAgentProfileRuntimeScope({ profile: resolvedProfile, assignedVersion: getAgentSessionProfileAssignment(session.id)?.profileVersion, executionMode: "worker" })
    const prompt = buildMemoryConversationPrompt({ profileInstructions: runtimeScope.policyInstructions ?? "", references, question })
    const continuationId = typeof session.meta.runtimeContinuationId === "string" ? session.meta.runtimeContinuationId : null
    const result = await requestRuntimeResponse({
      prompt,
      sessionId: session.id,
      authorityMode: "read_only_utility",
      continuationId,
      recentHistory: priorMessages.slice(-12).map((message) => ({ role: message.role, content: message.content })),
      skills: [], credentials: [], runtimeKey: runtimeScope.runtimeProfileKey,
      context: { surface: "prism-memory-explorer", agentProfileKey: profile.key },
      metadata: { kind: "memory-read", readOnlyUtility: true, agentProfile: runtimeScope.metadata, sessionRuntimeKey: typeof session.meta.runtimeKey === "string" ? session.meta.runtimeKey : null },
    })
    const assistantMessage = createAgentMessage({ sessionId: session.id, role: "assistant", source: "site-memory-chat", sourceMessageId: null, content: result.responseText, meta: { readOnlyUtility: true, citations: references.map((item) => item.citation), runtimeKey: result.runtimeKey } })
    if (!assistantMessage) throw new Error("MEMORY_MESSAGE_CREATE_FAILED")
    session = updateAgentSession(session.id, { lastMessageAt: new Date().toISOString(), meta: { ...session.meta, runtimeContinuationId: result.thread_id ?? continuationId, runtimeKey: result.runtimeKey } }) ?? session
    return NextResponse.json({ ok: true, session, assignment: getAgentSessionProfileAssignment(session.id), messages: listAgentMessages(session.id, 150), answer: result.responseText })
  } catch (error) {
    const message = error instanceof Error ? error.message : "Memory conversation failed"
    return NextResponse.json({ ok: false, error: message }, { status: message.includes("UNAVAILABLE") ? 502 : 400 })
  }
}
