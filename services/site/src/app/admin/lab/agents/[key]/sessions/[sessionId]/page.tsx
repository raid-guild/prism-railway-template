import Link from "next/link"
import { ArrowLeft, Bot, MessageSquareText, UserRound } from "lucide-react"

import { RequestInboxUnavailable } from "@/components/prism-lab/request-inbox"
import { Badge } from "@/components/ui/badge"
import { getAdminWorkspaceData } from "@/lib/admin"
import { createAuditLog, getAgentProfile, getAgentProfileSessionDetail } from "@/lib/app-core"
import { isPrismLabEnabled } from "@/lib/prism-lab/feature-flag"

function formatDate(value: string | null) {
  if (!value) return "Unknown"
  const date = new Date(value)
  return Number.isNaN(date.getTime()) ? value : date.toLocaleString()
}

export default async function AgentSessionPage({ params }: { params: Promise<{ key: string; sessionId: string }> }) {
  if (!isPrismLabEnabled(process.env.PRISM_LAB_ENABLED)) return null
  const workspace = await getAdminWorkspaceData()
  if (!workspace.ok) return <RequestInboxUnavailable reason={workspace.reason} />
  if (!workspace.data.session.capabilities.includes("canChatAgents")) return <RequestInboxUnavailable reason="unauthorized" />
  const route = await params
  const profile = getAgentProfile(route.key)
  const session = profile ? getAgentProfileSessionDetail(profile.id, route.sessionId) : null
  if (!profile || !session) return <div className="p-8"><h1 className="text-xl font-semibold">Session not found</h1><Link href="/admin/lab/agents" className="mt-4 inline-block text-sm underline">Return to Agents</Link></div>
  const canInspectAll = workspace.data.session.capabilities.includes("canRunAgent")
  if (!canInspectAll && (session.source !== "prism-memory-explorer" || session.createdByUserId !== workspace.data.session.userId)) return <RequestInboxUnavailable reason="unauthorized" />
  createAuditLog({ actorUserId: workspace.data.session.userId, actionType: "admin.agent_session.transcript.view", targetType: "agent_session", targetId: session.id, meta: { agentProfileId: profile.id, messageCount: session.messages.length } })
  return (
    <div className="px-4 py-5 sm:px-6 lg:px-8"><div className="mx-auto max-w-5xl">
      <header className="border-b border-border/60 pb-5"><Link href={`/admin/lab/agents/${encodeURIComponent(profile.key)}`} className="inline-flex items-center gap-2 text-xs text-muted-foreground hover:text-foreground"><ArrowLeft className="h-3.5 w-3.5" />{profile.name}</Link><div className="mt-4 flex flex-wrap items-center gap-2"><MessageSquareText className="text-primary" /><h1 className="text-2xl font-semibold">{session.title || "Console session"}</h1><Badge variant="outline">{session.conversationScope}</Badge><Badge variant="outline">{session.source}</Badge></div><p className="mt-2 text-sm text-muted-foreground">Operational transcript visible to authorized workspace operators. Viewed access is audited.</p><div className="mt-3 flex flex-wrap gap-4 text-xs text-muted-foreground"><span>Agent · {profile.name} v{session.profileVersion || profile.version}</span><span>Participant · {session.createdByDisplayName || session.createdByUserId || "Unknown"}</span><span>{session.messageCount} messages</span><span>Last activity · {formatDate(session.lastMessageAt)}</span>{session.linkedRequestNumber ? <Link className="underline" href={`/admin/lab/requests/${session.linkedRequestNumber}#selected-request-workspace`}>Request #{session.linkedRequestNumber}</Link> : null}</div></header>
      <section className="mt-5" aria-label="Session transcript"><h2 className="font-semibold">Transcript</h2><div className="mt-3 space-y-3">{session.messages.length ? session.messages.map((message) => <article key={message.id} className={`border p-4 ${message.role === "user" ? "ml-auto max-w-[90%] border-primary/40 bg-primary/5" : "mr-auto max-w-[94%] border-border/60 bg-card/35"}`}><div className="flex flex-wrap items-center gap-2 text-xs font-medium uppercase tracking-wide text-muted-foreground">{message.role === "user" ? <UserRound className="h-4 w-4" /> : <Bot className="h-4 w-4" />}<span>{message.authorName || (message.role === "user" ? session.createdByDisplayName || "Operator" : profile.name)}</span><span>·</span><span>{formatDate(message.createdAt)}</span></div><div className="mt-3 whitespace-pre-wrap text-sm leading-6">{message.content}</div></article>) : <div className="border border-dashed border-border/70 p-5 text-sm text-muted-foreground">No durable messages are recorded for this session.</div>}</div></section>
      <section className="mt-7"><h2 className="font-semibold">Resulting execution</h2><div className="mt-3 divide-y divide-border/60 border border-border/60">{session.runs.length ? session.runs.map((run) => <div key={run.id} className="p-3"><div className="flex flex-wrap items-center justify-between gap-2"><span className="font-medium">{run.workflowStepKey || run.kind}</span><Badge variant="outline">{run.status}</Badge></div><div className="mt-1 text-xs text-muted-foreground">Mode · {run.executionMode || "legacy"} · Started {formatDate(run.startedAt || run.createdAt)}{run.finishedAt ? ` · Finished ${formatDate(run.finishedAt)}` : ""}</div>{run.errorMessage ? <p className="mt-2 text-sm text-destructive">{run.errorMessage}</p> : null}</div>) : <div className="p-4 text-sm text-muted-foreground">No attributed runs were produced by this session.</div>}</div></section>
    </div></div>
  )
}
