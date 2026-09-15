import { MemoryLabExplorer } from "@/components/prism-lab/memory-lab-explorer"
import { RequestInboxUnavailable } from "@/components/prism-lab/request-inbox"
import { getAdminWorkspaceData } from "@/lib/admin"

export const dynamic = "force-dynamic"

export default async function LabMemoryPage() {
  const workspace = await getAdminWorkspaceData()
  if (!workspace.ok) return <RequestInboxUnavailable reason={workspace.reason} />
  if (!workspace.data.session.capabilities.includes("canViewMemory")) return <RequestInboxUnavailable reason="unauthorized" />
  return <MemoryLabExplorer setup={workspace.data.setup.prismMemory} canChatAgents={workspace.data.session.capabilities.includes("canChatAgents")} canManageSources={workspace.data.session.capabilities.includes("canManageMemorySources")} />
}
