import { LabSettings } from "@/components/prism-lab/lab-settings"
import { RequestInboxUnavailable } from "@/components/prism-lab/request-inbox"
import { getAdminWorkspaceData } from "@/lib/admin"
import { isPrismLabEnabled } from "@/lib/prism-lab/feature-flag"

export default async function LabSettingsPage() {
  if (!isPrismLabEnabled(process.env.PRISM_LAB_ENABLED)) return null
  const workspace = await getAdminWorkspaceData()
  if (!workspace.ok) return <RequestInboxUnavailable reason={workspace.reason} />
  if (!workspace.data.session.capabilities.includes("canManageSettings")) {
    return <RequestInboxUnavailable reason="unauthorized" />
  }
  return <LabSettings />
}
