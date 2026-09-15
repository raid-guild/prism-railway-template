"use client"

import { useEffect, useMemo, useState } from "react"
import {
  AlertTriangle,
  Bot,
  ExternalLink,
  FileText,
  GitBranch,
  MessageSquareText,
  TerminalSquare,
} from "lucide-react"

import { Badge } from "@/components/ui/badge"
import { Button, buttonVariants } from "@/components/ui/button"
import type { RequestTimelineItem } from "@/lib/prism-lab/request-timeline"
import { cn } from "@/lib/utils"

const initialVisibleCount = 60
const pageSize = 60

function displayTime(value: string) {
  const date = new Date(value)
  if (!Number.isFinite(date.getTime())) return "Unknown time"
  return new Intl.DateTimeFormat("en", {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
    second: "2-digit",
  }).format(date)
}
function TimelineIcon({ kind }: { kind: RequestTimelineItem["kind"] }) {
  if (kind === "message") return <MessageSquareText aria-hidden="true" />
  if (kind === "workflow_event") return <GitBranch aria-hidden="true" />
  if (kind === "agent_run") return <TerminalSquare aria-hidden="true" />
  if (kind === "artifact") return <FileText aria-hidden="true" />
  if (kind === "external_ref") return <ExternalLink aria-hidden="true" />
  return <Bot aria-hidden="true" />
}

function kindLabel(kind: RequestTimelineItem["kind"]) {
  if (kind === "workflow_event") return "Workflow"
  if (kind === "agent_run") return "Run"
  if (kind === "external_ref") return "External"
  return kind.charAt(0).toUpperCase() + kind.slice(1)
}

export function RequestTimeline({
  requestId,
  items,
  canViewArtifacts,
}: {
  requestId: string
  items: RequestTimelineItem[]
  canViewArtifacts: boolean
}) {
  const [visibleCount, setVisibleCount] = useState(initialVisibleCount)
  useEffect(() => setVisibleCount(initialVisibleCount), [requestId])
  const visibleItems = useMemo(() => items.slice(-visibleCount), [items, visibleCount])
  const hiddenCount = Math.max(0, items.length - visibleItems.length)

  return (
    <section aria-labelledby="timeline-heading" className="mt-5 border border-border/60 bg-card/30">
      <div className="flex flex-wrap items-end justify-between gap-3 border-b border-border/60 px-4 py-4">
        <div>
          <h3 id="timeline-heading" className="text-lg font-semibold">Unified timeline</h3>
          <p className="mt-1 text-xs text-muted-foreground">
            Messages, workflow changes, runs, artifacts, and external side effects in stable chronological order
          </p>
        </div>
        <Badge variant="muted">{items.length} events</Badge>
      </div>

      {hiddenCount ? (
        <div className="border-b border-border/50 px-4 py-3 text-center">
          <Button type="button" variant="outline" size="sm" onClick={() => setVisibleCount((value) => value + pageSize)}>
            Show {Math.min(pageSize, hiddenCount)} older events
          </Button>
          <p className="mt-1 text-[0.6875rem] text-muted-foreground">{hiddenCount} older events remain collapsed</p>
        </div>
      ) : null}

      {visibleItems.length ? (
        <ol className="divide-y divide-border/50">
          {visibleItems.map((item) => (
            <li
              key={item.id}
              id={item.runId && item.kind === "agent_run" ? `run-${item.runId}` : undefined}
              className={cn("scroll-mt-24 px-4 py-3", item.needsAttention && "bg-destructive/5")}
            >
              <article className="grid grid-cols-[2rem_minmax(0,1fr)] gap-3">
                <div className={cn(
                  "flex h-8 w-8 items-center justify-center rounded-full border bg-background text-muted-foreground",
                  item.needsAttention && "border-destructive/40 text-destructive",
                )}>
                  {item.needsAttention ? <AlertTriangle aria-hidden="true" /> : <TimelineIcon kind={item.kind} />}
                </div>
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                    <Badge variant={item.needsAttention ? "destructive" : "outline"}>{kindLabel(item.kind)}</Badge>
                    <p className="min-w-0 font-medium">{item.summary}</p>
                    <time className="text-xs text-muted-foreground" dateTime={item.occurredAt}>{displayTime(item.occurredAt)}</time>
                  </div>
                  <div className="mt-1 flex flex-wrap gap-x-3 text-xs text-muted-foreground">
                    {item.stepKey ? <span>Step · {item.stepKey}</span> : null}
                    {item.actor ? <span>Actor · {item.actor}</span> : null}
                    {item.status ? <span>Status · {item.status}</span> : null}
                  </div>
                  {item.detail ? (
                    item.kind === "message" ? (
                      <details className="mt-2">
                        <summary className="cursor-pointer text-xs font-medium text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">Read message</summary>
                        <p className="mt-2 whitespace-pre-wrap border-l-2 border-border pl-3 text-sm leading-6">{item.detail}</p>
                      </details>
                    ) : <p className={cn("mt-2 text-sm", item.needsAttention ? "text-destructive" : "text-muted-foreground")}>{item.detail}</p>
                  ) : null}
                  <div className="mt-2 flex flex-wrap gap-2">
                    {item.runId && item.kind !== "agent_run" ? (
                      <a href={`#run-${item.runId}`} className="text-xs font-medium text-primary hover:underline">Producing run</a>
                    ) : null}
                    {item.artifactId && canViewArtifacts ? (
                      <a
                        href={`/admin/change-requests/${encodeURIComponent(requestId)}/artifacts/${encodeURIComponent(item.artifactId)}/content`}
                        className={buttonVariants({ variant: "ghost", size: "sm" })}
                      >
                        <FileText aria-hidden="true" />Open artifact
                      </a>
                    ) : null}
                    {item.externalUrl ? (
                      <a href={item.externalUrl} target="_blank" rel="noreferrer" className={buttonVariants({ variant: "ghost", size: "sm" })}>
                        <ExternalLink aria-hidden="true" />Open reference
                      </a>
                    ) : null}
                  </div>
                </div>
              </article>
            </li>
          ))}
        </ol>
      ) : (
        <div className="px-5 py-12 text-center text-sm text-muted-foreground">No durable request activity has been recorded yet.</div>
      )}
    </section>
  )
}
