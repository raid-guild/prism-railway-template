import type { ReactNode } from "react"
import Link from "next/link"
import {
  AlertCircle,
  ArrowRight,
  Bot,
  Clock3,
  Filter,
  GitBranch,
  Inbox,
  RotateCcw,
  Search,
  ShieldAlert,
  UserRound,
} from "lucide-react"

import { Badge } from "@/components/ui/badge"
import { Button, buttonVariants } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { RequestInboxRefresh } from "@/components/prism-lab/request-inbox-refresh"
import { cn } from "@/lib/utils"
import type {
  LabRequestFilterState,
  LabRequestListItem,
} from "@/lib/prism-lab/contracts"
import {
  labRequestFilterOptions,
  labRequestFiltersToSearchParams,
} from "@/lib/prism-lab/request-filters"
import {
  labRequestHref,
  selectedRequestWorkspaceId,
} from "@/lib/prism-lab/request-links"

const lifecycleOptions = [
  { value: "open", label: "Open" },
  { value: "attention", label: "Attention" },
  { value: "running", label: "Running" },
  { value: "completed", label: "Completed" },
  { value: "all", label: "All" },
] as const

const attentionOptions = [
  { value: "all", label: "Any attention" },
  { value: "attention", label: "Needs attention" },
  { value: "blocked", label: "Blocked" },
  { value: "clear", label: "Clear" },
] as const

const sortOptions = [
  { value: "attention", label: "Attention first" },
  { value: "updated-desc", label: "Recently updated" },
  { value: "created-desc", label: "Recently created" },
  { value: "priority-desc", label: "Highest priority" },
] as const

function formatUpdatedAt(value: string) {
  const date = new Date(value)
  if (!Number.isFinite(date.getTime())) return "Unknown update time"
  return new Intl.DateTimeFormat("en", {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  }).format(date)
}

function lifecycleHref(filters: LabRequestFilterState, lifecycle: LabRequestFilterState["lifecycle"]) {
  const params = labRequestFiltersToSearchParams({ ...filters, lifecycle })
  const query = params.toString()
  return query ? `/admin/lab?${query}` : "/admin/lab"
}

function RequestStatus({ request }: { request: LabRequestListItem }) {
  if (request.attention.blocked) {
    return (
      <Badge variant="destructive" className="gap-1">
        <ShieldAlert aria-hidden="true" />
        Blocked{request.attention.blockerCount ? ` · ${request.attention.blockerCount}` : ""}
      </Badge>
    )
  }
  if (request.attention.required) {
    return (
      <Badge variant="outline" className="gap-1 border-amber-500/50 text-amber-700 dark:text-amber-300">
        <AlertCircle aria-hidden="true" />
        Needs attention
      </Badge>
    )
  }
  if (request.run.active) {
    return (
      <Badge variant="outline" className="gap-1 border-primary/40 text-primary">
        <Bot aria-hidden="true" />
        Active run
      </Badge>
    )
  }
  if (request.run.failed) {
    return <Badge variant="destructive">Run failed</Badge>
  }
  if (request.lifecycle === "completed") {
    return <Badge variant="muted">Completed</Badge>
  }
  return <Badge variant="muted">Open</Badge>
}

function RequestRow({
  request,
  filters,
  selected,
}: {
  request: LabRequestListItem
  filters: LabRequestFilterState
  selected: boolean
}) {
  return (
    <li>
      <Link
        href={labRequestHref(request.requestNumber, filters)}
        aria-current={selected ? "page" : undefined}
        className={cn(
          "group block border-b border-border/60 px-4 py-4 transition-colors last:border-b-0 sm:px-5",
          "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring",
          selected ? "bg-primary/10" : "hover:bg-muted/55",
        )}
      >
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
              <span className="font-mono font-semibold text-foreground">#{request.requestNumber}</span>
              <span className="capitalize">{request.priority}</span>
              <span aria-hidden="true">·</span>
              <span>{request.workflowKey}</span>
            </div>
            <h2 className="mt-1 line-clamp-2 text-sm font-semibold leading-5 text-foreground sm:text-base">
              {request.title}
            </h2>
          </div>
          <ArrowRight
            className="mt-1 h-4 w-4 shrink-0 text-muted-foreground transition-transform group-hover:translate-x-0.5"
            aria-hidden="true"
          />
        </div>

        <div className="mt-3 flex flex-wrap items-center gap-2">
          <RequestStatus request={request} />
          {request.hasHumanGate ? <Badge variant="outline">Human gate</Badge> : null}
        </div>

        <dl className="mt-3 grid gap-x-4 gap-y-2 text-xs text-muted-foreground sm:grid-cols-2">
          <div className="flex min-w-0 items-center gap-2">
            <GitBranch className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
            <dt className="sr-only">Current phase</dt>
            <dd className="truncate">
              {request.phase.label}
              {!request.phase.known ? " · unknown" : ""}
            </dd>
          </div>
          <div className="flex min-w-0 items-center gap-2">
            <Inbox className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
            <dt className="sr-only">Source</dt>
            <dd className="truncate">{request.source.label}</dd>
          </div>
          {request.origin?.targetId ? (
            <div className="flex min-w-0 items-center gap-2">
              <Inbox className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
              <dt className="sr-only">Target or channel</dt>
              <dd className="truncate">{request.origin.targetName || request.origin.targetId}</dd>
            </div>
          ) : null}
          <div className="flex min-w-0 items-center gap-2">
            <UserRound className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
            <dt className="sr-only">Initiator</dt>
            <dd className="truncate">{request.requestedByDisplayName || "Unknown initiator"}</dd>
          </div>
          {request.origin?.interactionProfileKey ? (
            <div className="flex min-w-0 items-center gap-2">
              <Bot className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
              <dt className="sr-only">Interaction profile</dt>
              <dd className="truncate">{request.origin.interactionProfileKey}</dd>
            </div>
          ) : null}
          <div className="flex min-w-0 items-center gap-2">
            <Clock3 className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
            <dt className="sr-only">Human estimate and last update</dt>
            <dd className="truncate">
              {request.estimatedHumanHoursLabel || "No human estimate"} · {formatUpdatedAt(request.updatedAt)}
            </dd>
          </div>
        </dl>
      </Link>
    </li>
  )
}

function FilterSelect({
  id,
  name,
  label,
  value,
  children,
}: {
  id: string
  name: string
  label: string
  value: string
  children: ReactNode
}) {
  return (
    <div className="min-w-0 space-y-1.5">
      <Label htmlFor={id} className="text-xs text-muted-foreground">{label}</Label>
      <select
        id={id}
        name={name}
        defaultValue={value}
        className="flex h-9 w-full rounded-md border border-input bg-background px-3 py-1 text-sm shadow-sm outline-none focus-visible:ring-1 focus-visible:ring-ring"
      >
        {children}
      </select>
    </div>
  )
}

export function RequestInbox({
  requests,
  allRequests,
  filters,
  selectedRequestNumber,
  detail,
}: {
  requests: LabRequestListItem[]
  allRequests: LabRequestListItem[]
  filters: LabRequestFilterState
  selectedRequestNumber?: number
  detail?: ReactNode
}) {
  const options = labRequestFilterOptions(allRequests)
  const activeFilterCount = [
    filters.query,
    filters.lifecycle !== "open" ? filters.lifecycle : null,
    filters.phase,
    filters.priority,
    filters.source,
    filters.target,
    filters.profile,
    filters.initiator,
    filters.attention !== "all" ? filters.attention : null,
    filters.sort !== "attention" ? filters.sort : null,
  ].filter(Boolean).length

  return (
    <div className="px-4 py-5 sm:px-6 lg:px-8">
      <div className="mx-auto max-w-[96rem]">
        <header className="flex flex-col gap-3 border-b border-border/60 pb-5 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-[0.16em] text-primary">
              <span>Live instance</span>
              <span aria-hidden="true">·</span>
              <span>Requests</span>
            </div>
            <h1 className="mt-2 text-2xl font-semibold tracking-tight sm:text-3xl">Operational inbox</h1>
            <p className="mt-1 text-sm text-muted-foreground">
              {requests.length} shown of {allRequests.length} canonical requests
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <Badge variant={activeFilterCount ? "secondary" : "muted"} className="w-fit gap-1">
              <Filter aria-hidden="true" />
              {activeFilterCount ? `${activeFilterCount} active filter${activeFilterCount === 1 ? "" : "s"}` : "Default open view"}
            </Badge>
            <RequestInboxRefresh />
          </div>
        </header>

        <nav aria-label="Request lifecycle" className="overflow-x-auto py-3">
          <ul className="flex min-w-max gap-1">
            {lifecycleOptions.map((option) => (
              <li key={option.value}>
                <Link
                  href={lifecycleHref(filters, option.value)}
                  aria-current={filters.lifecycle === option.value ? "page" : undefined}
                  className={buttonVariants({
                    variant: filters.lifecycle === option.value ? "secondary" : "ghost",
                    size: "sm",
                  })}
                >
                  {option.label}
                </Link>
              </li>
            ))}
          </ul>
        </nav>

        <form action="/admin/lab" method="get" className="border border-border/60 bg-card/40 p-3 sm:p-4">
          <input type="hidden" name="lifecycle" value={filters.lifecycle} />
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-8">
            <div className="space-y-1.5 sm:col-span-2 lg:col-span-2">
              <Label htmlFor="lab-request-search" className="text-xs text-muted-foreground">Search requests</Label>
              <div className="relative">
                <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" aria-hidden="true" />
                <Input
                  id="lab-request-search"
                  name="q"
                  type="search"
                  defaultValue={filters.query}
                  placeholder="Number, title, workflow, source…"
                  className="pl-9"
                />
              </div>
            </div>
            <FilterSelect id="lab-phase" name="phase" label="Current phase" value={filters.phase ?? ""}>
              <option value="">All phases</option>
              {options.phases.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
            </FilterSelect>
            <FilterSelect id="lab-priority" name="priority" label="Priority" value={filters.priority ?? ""}>
              <option value="">All priorities</option>
              {options.priorities.map((priority) => <option key={priority} value={priority}>{priority}</option>)}
            </FilterSelect>
            <FilterSelect id="lab-source" name="platform" label="Platform" value={filters.source ?? ""}>
              <option value="">All platforms</option>
              {options.sources.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
            </FilterSelect>
            <FilterSelect id="lab-target" name="target" label="Target / channel" value={filters.target ?? ""}>
              <option value="">All targets</option>
              {options.targets.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
            </FilterSelect>
            <FilterSelect id="lab-profile" name="profile" label="Interaction profile" value={filters.profile ?? ""}>
              <option value="">All profiles</option>
              {options.profiles.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
            </FilterSelect>
            <FilterSelect id="lab-initiator" name="initiator" label="Initiator" value={filters.initiator ?? ""}>
              <option value="">All initiators</option>
              {options.initiators.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
            </FilterSelect>
            <FilterSelect id="lab-attention" name="attention" label="Attention" value={filters.attention}>
              {attentionOptions.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
            </FilterSelect>
            <FilterSelect id="lab-sort" name="sort" label="Sort" value={filters.sort}>
              {sortOptions.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
            </FilterSelect>
            <div className="flex items-end gap-2 sm:col-span-2 lg:col-span-8 lg:justify-end">
              <Button type="submit" size="sm">Apply filters</Button>
              <Link href="/admin/lab" className={buttonVariants({ variant: "ghost", size: "sm" })}>
                <RotateCcw aria-hidden="true" />
                Reset
              </Link>
            </div>
          </div>
        </form>

        <div className={cn(
          "mt-4 border border-border/60 bg-card/35",
          detail && "flex flex-col lg:grid lg:grid-cols-[minmax(20rem,0.8fr)_minmax(28rem,1.4fr)]",
        )}>
          {detail ? (
            <section
              id={selectedRequestWorkspaceId}
              tabIndex={-1}
              aria-label="Selected request"
              className="order-1 min-w-0 scroll-mt-4 border-b border-border/60 lg:order-2 lg:border-b-0"
            >
              {detail}
            </section>
          ) : null}
          <section
            aria-label="Request results"
            className={cn(detail && "order-2 lg:order-1 lg:border-r lg:border-border/60")}
          >
            {requests.length ? (
              <ul className={cn(detail && "lg:max-h-[calc(100vh-18rem)] lg:overflow-y-auto")}>
                {requests.map((request) => (
                  <RequestRow
                    key={request.id}
                    request={request}
                    filters={filters}
                    selected={request.requestNumber === selectedRequestNumber}
                  />
                ))}
              </ul>
            ) : (
              <div className="flex min-h-64 flex-col items-center justify-center px-6 py-12 text-center">
                <Search className="h-6 w-6 text-muted-foreground" aria-hidden="true" />
                <h2 className="mt-4 text-lg font-semibold">No matching requests</h2>
                <p className="mt-2 max-w-sm text-sm leading-6 text-muted-foreground">
                  The live request set has no results for these filters. Clear filters to return to the default open view.
                </p>
                <Link href="/admin/lab" className={cn(buttonVariants({ variant: "outline", size: "sm" }), "mt-5")}>
                  Reset filters
                </Link>
              </div>
            )}
          </section>
        </div>
      </div>
    </div>
  )
}

export function RequestInboxUnavailable({ reason }: { reason: "unauthorized" | "error" | "missing-password" }) {
  const message = reason === "error"
    ? "Prism could not read canonical request state. No cached or inferred request list is being shown."
    : "Your current admin session cannot read the request inbox. Sign in again through the current admin UI."

  return (
    <section className="mx-auto flex min-h-[55vh] max-w-2xl items-center px-5 py-12" aria-labelledby="inbox-unavailable-title">
      <div className="w-full border border-destructive/40 bg-card/70 p-6 sm:p-8">
        <AlertCircle className="h-6 w-6 text-destructive" aria-hidden="true" />
        <h1 id="inbox-unavailable-title" className="mt-4 text-2xl font-semibold">Request inbox unavailable</h1>
        <p className="mt-3 text-sm leading-6 text-muted-foreground">{message}</p>
        <Link href="/admin" className={cn(buttonVariants({ variant: "outline" }), "mt-6")}>Open current admin UI</Link>
      </div>
    </section>
  )
}
