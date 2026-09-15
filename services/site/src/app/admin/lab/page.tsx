import { RequestInbox, RequestInboxUnavailable } from "@/components/prism-lab/request-inbox"
import { getAdminWorkspaceData } from "@/lib/admin"
import { isPrismLabEnabled } from "@/lib/prism-lab/feature-flag"
import { buildLabRequestListItems } from "@/lib/prism-lab/request-read-model"
import { filterAndSortLabRequests, parseLabRequestFilters } from "@/lib/prism-lab/request-filters"

function searchParamsRecord(input: Record<string, string | string[] | undefined>) {
  const params = new URLSearchParams()
  for (const [key, value] of Object.entries(input)) {
    const first = Array.isArray(value) ? value[0] : value
    if (first !== undefined) params.set(key, first)
  }
  return params
}

export default async function LabPage({
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

  const filters = parseLabRequestFilters(searchParamsRecord((await searchParams) ?? {}))
  const allRequests = buildLabRequestListItems(workspace.data, workspace.data.session.capabilities)

  return (
    <RequestInbox
      allRequests={allRequests}
      requests={filterAndSortLabRequests(allRequests, filters)}
      filters={filters}
    />
  )
}
