import Link from "next/link"

import { AgentConsoleWorkspace } from "@/components/prism-lab/agent-console-workspace"
import { RequestInboxUnavailable } from "@/components/prism-lab/request-inbox"
import { getAdminWorkspaceData } from "@/lib/admin"
import { getAgentProfile, getAgentProfileSessionDetail, listAgentProfileActivity, listAgentProfileSessions } from "@/lib/app-core"
import { isPrismLabEnabled } from "@/lib/prism-lab/feature-flag"

export default async function LabAgentPage({ params, searchParams }: { params: Promise<{ key: string }>; searchParams: Promise<{ memorySession?: string }> }) {
  if (!isPrismLabEnabled(process.env.PRISM_LAB_ENABLED)) return null
  const workspace = await getAdminWorkspaceData()
  if (!workspace.ok) return <RequestInboxUnavailable reason={workspace.reason} />
  if (!workspace.data.session.capabilities.includes("canChatAgents")) return <RequestInboxUnavailable reason="unauthorized" />
  const profile = getAgentProfile((await params).key)
  if (!profile) return <div className="p-8"><h1 className="text-xl font-semibold">Agent not found</h1><Link href="/admin/lab/agents" className="mt-4 inline-block text-sm underline">Return to Agents</Link></div>
  const canRunAgent = workspace.data.session.capabilities.includes("canRunAgent")
  if (profile.systemKey === "admin-agent" && !canRunAgent) return <RequestInboxUnavailable reason="unauthorized" />
  const memorySessionId = (await searchParams).memorySession?.trim() || null
  if (memorySessionId) {
    const memorySession = getAgentProfileSessionDetail(profile.id, memorySessionId)
    if (!memorySession || memorySession.source !== "prism-memory-explorer" || (!canRunAgent && memorySession.createdByUserId !== workspace.data.session.userId)) return <RequestInboxUnavailable reason="unauthorized" />
  }
  return <AgentConsoleWorkspace key={profile.id} profile={profile} activity={canRunAgent ? listAgentProfileActivity(profile.id, 100) : []} sessions={canRunAgent ? listAgentProfileSessions(profile.id, 100) : []} canManageSettings={workspace.data.session.capabilities.includes("canManageSettings")} canRunAgent={canRunAgent} memorySessionId={memorySessionId} />
}
