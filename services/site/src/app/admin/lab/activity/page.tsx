import { ActivityView } from "@/components/prism-lab/activity-view"
import { RequestInboxUnavailable } from "@/components/prism-lab/request-inbox"
import { getAdminWorkspaceData } from "@/lib/admin"
import { buildCrossRequestActivity, buildUnifiedActivityPage, parseLabActivityFilters } from "@/lib/prism-lab/activity-read-model"
import { isPrismLabEnabled } from "@/lib/prism-lab/feature-flag"
import { buildLabRequestListItems } from "@/lib/prism-lab/request-read-model"
import { listAgentProfiles, listAgentProfileSessions } from "@/lib/app-core"

export default async function LabActivityPage({
  searchParams,
}: {
  searchParams?: Promise<Record<string, string | string[] | undefined>>
}) {
  if (!isPrismLabEnabled(process.env.PRISM_LAB_ENABLED)) return null
  const workspace = await getAdminWorkspaceData()
  if (!workspace.ok) return <RequestInboxUnavailable reason={workspace.reason} />
  if (!workspace.data.session.capabilities.includes("canViewRequests")) {
    return <RequestInboxUnavailable reason="unauthorized" />
  }

  const filters = parseLabActivityFilters((await searchParams) ?? {})
  const requests = buildLabRequestListItems(workspace.data, workspace.data.session.capabilities)
  const requestActivity = buildCrossRequestActivity(requests)
  const attentionCount = requestActivity.filter((item) => item.state === "attention").length
  const canInspectAllSessions = workspace.data.session.capabilities.includes("canRunAgent")
  const profiles = listAgentProfiles()
  const conversations = profiles.flatMap((profile) =>
    listAgentProfileSessions(profile.id, 200)
      .filter((session) => canInspectAllSessions || (session.source === "prism-memory-explorer" && session.createdByUserId === workspace.data.session.userId))
      .map((session) => ({ ...session, agentKey: profile.key, agentName: profile.name })),
  )
  const activityPage = buildUnifiedActivityPage({ requests: requestActivity, conversations, filters })

  return <ActivityView activityPage={activityPage} filters={filters} attentionCount={attentionCount} agents={profiles.map((profile) => ({ key: profile.key, name: profile.name }))} />
}
