import Link from "next/link"
import { AlertTriangle, CheckCircle2, ChevronLeft, ChevronRight, Clock3, GitBranch, Loader2, MessageSquare, Search } from "lucide-react"

import { RequestInboxRefresh } from "@/components/prism-lab/request-inbox-refresh"
import { Badge } from "@/components/ui/badge"
import { Button, buttonVariants } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import {
  labActivitySearchParams,
  type LabActivityFilters,
  type LabActivityPage,
  type LabCrossRequestActivity,
} from "@/lib/prism-lab/activity-read-model"
import { cn } from "@/lib/utils"

function displayTime(value: string) {
  const date = new Date(value)
  if (!Number.isFinite(date.getTime())) return "Unknown time"
  return new Intl.DateTimeFormat("en", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" }).format(date)
}

function ActivityIcon({ state }: { state: LabCrossRequestActivity["state"] }) {
  if (state === "attention") return <AlertTriangle aria-hidden="true" />
  if (state === "running") return <Loader2 className="animate-spin" aria-hidden="true" />
  if (state === "completed") return <CheckCircle2 aria-hidden="true" />
  return <Clock3 aria-hidden="true" />
}

function activityHref(filters: LabActivityFilters, page: number) {
  const query = labActivitySearchParams(filters, page).toString()
  return query ? `/admin/lab/activity?${query}` : "/admin/lab/activity"
}

export function ActivityView({
  activityPage,
  filters,
  attentionCount,
  agents,
}: {
  activityPage: LabActivityPage
  filters: LabActivityFilters
  attentionCount: number
  agents: Array<{ key: string; name: string }>
}) {
  const firstResult = activityPage.totalItems ? (activityPage.page - 1) * activityPage.pageSize + 1 : 0
  const lastResult = Math.min(activityPage.page * activityPage.pageSize, activityPage.totalItems)
  const filtering = Boolean(filters.query || filters.kind !== "all" || filters.state !== "all" || filters.agent)

  return (
    <div className="px-4 py-5 sm:px-6 lg:px-8">
      <div className="mx-auto max-w-5xl">
        <header className="flex flex-col gap-3 border-b border-border/60 pb-5 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-[0.16em] text-primary">
              <span>Live instance</span><span aria-hidden="true">·</span><span>Activity</span>
            </div>
            <h1 className="mt-2 text-2xl font-semibold tracking-tight sm:text-3xl">Workspace activity</h1>
            <p className="mt-1 text-sm text-muted-foreground">Newest request operations and observable agent conversations</p>
          </div>
          <RequestInboxRefresh />
        </header>

        <nav aria-label="Activity shortcuts" className="flex flex-wrap gap-2 py-4">
          <Link href="/admin/lab/activity" aria-current={!filtering ? "page" : undefined} className={buttonVariants({ variant: !filtering ? "secondary" : "ghost", size: "sm" })}>All activity</Link>
          <Link href="/admin/lab/activity?kind=request&state=attention" aria-current={filters.kind === "request" && filters.state === "attention" ? "page" : undefined} className={buttonVariants({ variant: filters.kind === "request" && filters.state === "attention" ? "secondary" : "ghost", size: "sm" })}>
            Needs attention <Badge variant={attentionCount ? "destructive" : "muted"}>{attentionCount}</Badge>
          </Link>
          <Link href="/admin/lab/activity?kind=conversation" aria-current={filters.kind === "conversation" && !filters.agent ? "page" : undefined} className={buttonVariants({ variant: filters.kind === "conversation" && !filters.agent ? "secondary" : "ghost", size: "sm" })}>Conversations</Link>
        </nav>

        <form action="/admin/lab/activity" method="get" className="border border-border/60 bg-card/35 p-4">
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-[minmax(14rem,2fr)_1fr_1fr_1fr_auto] lg:items-end">
            <div className="space-y-1.5">
              <Label htmlFor="activity-query">Search activity</Label>
              <div className="relative">
                <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" aria-hidden="true" />
                <Input id="activity-query" name="q" type="search" defaultValue={filters.query} placeholder="Request, workflow, agent, conversation…" className="pl-9" />
              </div>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="activity-kind">Type</Label>
              <select id="activity-kind" name="kind" defaultValue={filters.kind} className="flex h-10 w-full border border-input bg-background px-3 text-sm">
                <option value="all">All types</option><option value="request">Requests</option><option value="conversation">Conversations</option>
              </select>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="activity-state">Request state</Label>
              <select id="activity-state" name="state" defaultValue={filters.state} className="flex h-10 w-full border border-input bg-background px-3 text-sm">
                <option value="all">All states</option><option value="attention">Attention</option><option value="running">Running</option><option value="completed">Completed</option><option value="updated">Updated</option>
              </select>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="activity-agent">Conversation agent</Label>
              <select id="activity-agent" name="agent" defaultValue={filters.agent ?? ""} className="flex h-10 w-full border border-input bg-background px-3 text-sm">
                <option value="">All agents</option>{agents.map((agent) => <option key={agent.key} value={agent.key}>{agent.name}</option>)}
              </select>
            </div>
            <div className="flex gap-2">
              <Button type="submit">Apply</Button>
              {filtering ? <Link href="/admin/lab/activity" className={buttonVariants({ variant: "ghost" })}>Reset</Link> : null}
            </div>
          </div>
          {filters.agent ? <p className="mt-2 text-xs text-muted-foreground">Agent filtering shows attributed conversations; request participation filtering is not inferred.</p> : null}
        </form>

        <div className="mt-4 flex flex-wrap items-center justify-between gap-2 text-xs text-muted-foreground" aria-live="polite">
          <span>{firstResult}–{lastResult} of {activityPage.totalItems} matching activities</span>
          <span>Page {activityPage.page} of {activityPage.totalPages}</span>
        </div>

        <section aria-label="Chronological workspace activity" className="mt-3 border border-border/60 bg-card/35">
          {activityPage.items.length ? (
            <ol className="divide-y divide-border/60">
              {activityPage.items.map((item) => item.kind === "request" ? (
                <li key={item.key} className={cn("p-4", item.request.state === "attention" && "bg-destructive/5")}>
                  <article className="grid grid-cols-[2.25rem_minmax(0,1fr)] gap-3">
                    <div className={cn("flex h-9 w-9 items-center justify-center rounded-full border bg-background", item.request.state === "attention" ? "border-destructive/40 text-destructive" : "text-primary")}><ActivityIcon state={item.request.state} /></div>
                    <div className="min-w-0">
                      <div className="flex flex-wrap items-center gap-2"><Link href={`/admin/lab/requests/${item.request.request.requestNumber}#selected-request-workspace`} className="font-semibold hover:text-primary hover:underline">#{item.request.request.requestNumber} · {item.request.request.title}</Link><Badge variant={item.request.state === "attention" ? "destructive" : "outline"}>{item.request.state}</Badge></div>
                      <p className="mt-1 text-sm text-muted-foreground">{item.request.summary}</p>
                      <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground"><span className="flex items-center gap-1"><GitBranch aria-hidden="true" />{item.request.request.phase.label}</span><span>{item.request.request.source.label}</span><time dateTime={item.occurredAt}>{displayTime(item.occurredAt)}</time></div>
                    </div>
                  </article>
                </li>
              ) : (
                <li key={item.key} className="p-4">
                  <article className="grid grid-cols-[2.25rem_minmax(0,1fr)] gap-3">
                    <div className="flex h-9 w-9 items-center justify-center rounded-full border border-primary/40 bg-background text-primary"><MessageSquare aria-hidden="true" /></div>
                    <div className="min-w-0">
                      <div className="flex flex-wrap items-center gap-2"><Link href={`/admin/lab/agents/${encodeURIComponent(item.conversation.agentKey)}/sessions/${encodeURIComponent(item.conversation.id)}`} className="font-semibold hover:text-primary hover:underline">{item.conversation.title || `${item.conversation.agentName} conversation`}</Link><Badge variant="outline">conversation</Badge></div>
                      <p className="mt-1 text-sm text-muted-foreground">{item.conversation.agentName} · {item.conversation.source} · {item.conversation.createdByDisplayName || "Unknown participant"}</p>
                      <div className="mt-2 flex flex-wrap items-center gap-3 text-xs text-muted-foreground"><span>{item.conversation.messageCount} messages</span><time dateTime={item.occurredAt}>{displayTime(item.occurredAt)}</time></div>
                    </div>
                  </article>
                </li>
              ))}
            </ol>
          ) : (
            <div className="px-6 py-16 text-center"><Clock3 className="mx-auto h-7 w-7 text-primary" aria-hidden="true" /><h2 className="mt-3 font-semibold">No matching activity</h2><p className="mt-1 text-sm text-muted-foreground">Adjust the filters or reset the activity view.</p></div>
          )}
        </section>

        {activityPage.totalPages > 1 ? (
          <nav aria-label="Activity pagination" className="mt-4 flex items-center justify-between gap-3">
            {activityPage.page > 1 ? <Link href={activityHref(filters, activityPage.page - 1)} className={buttonVariants({ variant: "outline" })}><ChevronLeft aria-hidden="true" />Previous</Link> : <span />}
            {activityPage.page < activityPage.totalPages ? <Link href={activityHref(filters, activityPage.page + 1)} className={buttonVariants({ variant: "outline" })}>Next<ChevronRight aria-hidden="true" /></Link> : <span />}
          </nav>
        ) : null}
      </div>
    </div>
  )
}
