import Link from "next/link"
import { AlertCircle } from "lucide-react"

import { RequestInbox, RequestInboxUnavailable } from "@/components/prism-lab/request-inbox"
import { RequestWorkspace } from "@/components/prism-lab/request-workspace"
import { buttonVariants } from "@/components/ui/button"
import { getAdminWorkspaceData } from "@/lib/admin"
import { isPrismLabEnabled } from "@/lib/prism-lab/feature-flag"
import { buildLabRequestListItems } from "@/lib/prism-lab/request-read-model"
import {
  filterAndSortLabRequests,
  labRequestFiltersToSearchParams,
  parseLabRequestFilters,
} from "@/lib/prism-lab/request-filters"
import { cn } from "@/lib/utils"

function searchParamsRecord(input: Record<string, string | string[] | undefined>) {
  const params = new URLSearchParams()
  for (const [key, value] of Object.entries(input)) {
    const first = Array.isArray(value) ? value[0] : value
    if (first !== undefined) params.set(key, first)
  }
  return params
}

export default async function LabRequestPage({
  params,
  searchParams,
}: {
  params: Promise<{ requestNumber: string }>
  searchParams?: Promise<Record<string, string | string[] | undefined>>
}) {
  if (!isPrismLabEnabled(process.env.PRISM_LAB_ENABLED)) return null

  const workspace = await getAdminWorkspaceData()
  if (!workspace.ok) return <RequestInboxUnavailable reason={workspace.reason} />
  if (!workspace.data.session.capabilities.includes("canViewRequests")) {
    return <RequestInboxUnavailable reason="unauthorized" />
  }

  const rawParams = searchParamsRecord((await searchParams) ?? {})
  const filters = parseLabRequestFilters(rawParams)
  const allRequests = buildLabRequestListItems(workspace.data, workspace.data.session.capabilities)
  const rawNumber = (await params).requestNumber
  const requestNumber = /^\d+$/.test(rawNumber) ? Number(rawNumber) : null
  const selected = Number.isSafeInteger(requestNumber) && requestNumber! > 0
    ? allRequests.find((request) => request.requestNumber === requestNumber) ?? null
    : null

  if (!selected) {
    return (
      <div className="mx-auto flex min-h-[55vh] max-w-2xl items-center px-5 py-12">
        <div className="w-full border border-border/70 bg-card/60 p-6 sm:p-8">
          <AlertCircle className="h-6 w-6 text-muted-foreground" aria-hidden="true" />
          <h1 className="mt-4 text-2xl font-semibold">Request not found</h1>
          <p className="mt-3 text-sm leading-6 text-muted-foreground">
            No canonical request matches this request number. The URL was not resolved to another request.
          </p>
          <Link href="/admin/lab" className={cn(buttonVariants({ variant: "outline" }), "mt-6")}>Return to inbox</Link>
        </div>
      </div>
    )
  }

  const filterQuery = labRequestFiltersToSearchParams(filters).toString()
  return (
    <RequestInbox
      allRequests={allRequests}
      requests={filterAndSortLabRequests(allRequests, filters)}
      filters={filters}
      selectedRequestNumber={selected.requestNumber}
      detail={(
        <RequestWorkspace
          request={selected}
          backHref={filterQuery ? `/admin/lab?${filterQuery}` : "/admin/lab"}
        />
      )}
    />
  )
}
