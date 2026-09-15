"use client"

import { legacyAdminHref } from "@/lib/prism-lab/admin-entry"

import type { ReactNode } from "react"
import { useEffect, useState } from "react"
import Link from "next/link"
import { usePathname } from "next/navigation"
import { Activity, ArrowUpRight, Brain, FlaskConical, Inbox, LoaderCircle, Menu, PanelLeftClose, Settings, X } from "lucide-react"

import { AgentAvatar } from "@/components/prism-lab/agent-avatar"
import { ThemeToggle } from "@/components/shared/theme-toggle"
import { Badge } from "@/components/ui/badge"
import { Button, buttonVariants } from "@/components/ui/button"
import { cn } from "@/lib/utils"
import type { Capability } from "@/lib/role-access"

type LabAgentQueue = { queued: number; claimed: number; running: number }
export type LabAgentNavigationItem = {
  key: string
  name: string
  avatarUrl: string | null
  accentColor: string
  systemKey: string | null
  status: string
  domainKey: string | null
  domainName: string | null
  categoryLabel: string | null
  categoryOrder: number
  domainStewards: string[]
  queue: LabAgentQueue
}

const workspaceSections = [
  { label: "Requests", href: "/admin/lab", icon: Inbox, capability: "canViewRequests" as const },
  { label: "Activity", href: "/admin/lab/activity", icon: Activity, capability: "canViewRequests" as const },
  { label: "Memory", href: "/admin/lab/memory", icon: Brain, capability: "canViewMemory" as const, requiresMemory: true },
  { label: "Settings", href: "/admin/lab/settings", icon: Settings, capability: "canManageSettings" as const },
]

function activeFor(pathname: string, href: string) {
  return pathname === href || (href === "/admin/lab" ? pathname.startsWith("/admin/lab/requests") : pathname.startsWith(`${href}/`))
}

function AgentQueueIndicator({ queue, accentColor }: { queue: LabAgentQueue; accentColor: string }) {
  const working = queue.claimed + queue.running
  if (working > 0) return <span className="flex h-5 w-5 items-center justify-center" aria-label={`${working} working, ${queue.queued} queued`} title={`${working} working · ${queue.queued} queued`}><LoaderCircle className="h-3.5 w-3.5 animate-spin" style={{ color: accentColor }} aria-hidden="true" /></span>
  if (queue.queued > 0) return <span className="flex h-5 w-5 items-center justify-center" aria-label={`${queue.queued} queued`} title={`${queue.queued} queued`}><span className="h-2.5 w-2.5 animate-pulse rounded-full" style={{ backgroundColor: accentColor }} aria-hidden="true" /></span>
  return null
}

function AgentNavigationList({ agents, pathname, listLabel, onNavigate }: { agents: readonly LabAgentNavigationItem[]; pathname: string; listLabel: string; onNavigate?: () => void }) {
  return <ul className="mt-1 space-y-0.5" aria-label={listLabel}>
    {agents.map((agent) => {
      const href = `/admin/lab/agents/${encodeURIComponent(agent.key)}`
      const active = activeFor(pathname, href)
      const labelColor = `color-mix(in oklab, ${agent.accentColor} 72%, var(--foreground))`
      const systemLabel = agent.systemKey === "admin-agent" ? "Admin" : agent.systemKey ? "Built-in" : "Custom"
      return <li key={agent.key}><Link href={href} onClick={onNavigate} aria-current={active ? "page" : undefined} className={cn("flex min-h-11 items-center gap-2.5 rounded-md border-l-2 px-2 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring", active ? "bg-primary/12 text-foreground" : "text-muted-foreground hover:bg-muted/60 hover:text-foreground")} style={{ borderLeftColor: active ? agent.accentColor : "transparent" }}><AgentAvatar name={agent.name} avatarUrl={agent.avatarUrl} accentColor={agent.accentColor} className="h-7 w-7 rounded-md" /><span className="min-w-0 flex-1 truncate font-medium" style={{ color: labelColor }}>{agent.name}</span>{systemLabel ? <span className="text-[0.58rem] uppercase tracking-wider" style={{ color: labelColor }}>{systemLabel}</span> : null}<AgentQueueIndicator queue={agent.queue} accentColor={agent.accentColor} /></Link></li>
    })}
  </ul>
}

function Navigator({ capabilities, agents, memoryConfigured, onNavigate }: { capabilities: readonly Capability[]; agents: readonly LabAgentNavigationItem[]; memoryConfigured: boolean; onNavigate?: () => void }) {
  const pathname = usePathname()
  const visibleWorkspace = workspaceSections.filter((item) => capabilities.includes(item.capability) && (!("requiresMemory" in item) || !item.requiresMemory || memoryConfigured))
  const visibleAgents = capabilities.includes("canChatAgents") ? agents.filter((agent) => agent.status !== "archived") : []
  const controlPlaneAgents = visibleAgents.filter((agent) => agent.systemKey === "admin-agent")
  const categoryGroups = Array.from(
    visibleAgents
      .filter((agent) => agent.systemKey !== "admin-agent")
      .reduce((groups, agent) => {
        const label = agent.categoryLabel ?? agent.domainName ?? "Unassigned"
        const key = label.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "") || "unassigned"
        const current = groups.get(key) ?? {
          key,
          label,
          domainNames: [] as string[],
          order: agent.categoryOrder,
          stewards: agent.domainStewards,
          agents: [] as LabAgentNavigationItem[],
        }
        if (agent.domainName && !current.domainNames.includes(agent.domainName)) current.domainNames.push(agent.domainName)
        current.order = Math.min(current.order, agent.categoryOrder)
        current.stewards = Array.from(new Set([...current.stewards, ...agent.domainStewards]))
        current.agents.push(agent)
        groups.set(key, current)
        return groups
      }, new Map<string, { key: string; label: string; domainNames: string[]; order: number; stewards: string[]; agents: LabAgentNavigationItem[] }>())
      .values(),
  ).sort((a, b) => a.order - b.order || a.label.localeCompare(b.label))
  return (
    <nav aria-label="Prism workspace and agents" className="flex h-full min-h-0 flex-col">
      <div className="px-3">
        <p className="text-[0.68rem] font-semibold uppercase tracking-[0.18em] text-muted-foreground">Workspace</p>
        <ul className="mt-2 space-y-0.5">
          {visibleWorkspace.map((item) => {
            const Icon = item.icon
            const active = activeFor(pathname, item.href)
            return <li key={item.href}><Link href={item.href} onClick={onNavigate} aria-current={active ? "page" : undefined} className={cn("flex min-h-10 items-center gap-3 rounded-md px-2.5 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring", active ? "bg-primary/12 font-medium text-foreground" : "text-muted-foreground hover:bg-muted/60 hover:text-foreground")}><Icon className={cn("h-4 w-4", active && "text-primary")} aria-hidden="true" />{item.label}</Link></li>
          })}
        </ul>
      </div>
      {visibleAgents.length ? <div className="mt-6 flex min-h-0 flex-1 flex-col border-t border-border/50 pt-5">
        <div className="flex items-center justify-between px-3"><p className="text-[0.68rem] font-semibold uppercase tracking-[0.18em] text-muted-foreground">Agents</p><Link href="/admin/lab/agents" onClick={onNavigate} className="text-[0.68rem] text-muted-foreground underline-offset-4 hover:text-foreground hover:underline">Manage</Link></div>
        <div className="mt-3 min-h-0 flex-1 space-y-5 overflow-y-auto px-2 pb-2">
          {controlPlaneAgents.length ? <section aria-label="Control Plane"><p className="px-2 text-[0.62rem] font-medium uppercase tracking-[0.16em] text-muted-foreground/80">Control Plane</p><AgentNavigationList agents={controlPlaneAgents} pathname={pathname} listLabel="Control Plane" onNavigate={onNavigate} /></section> : null}
          {categoryGroups.map((group) => <section key={group.key} aria-label={group.label}>
            <div className="px-2" title={group.stewards.length ? `Stewarded by ${group.stewards.join(", ")}` : undefined}>
              <p className="text-[0.62rem] font-medium uppercase tracking-[0.16em] text-muted-foreground/80">{group.label}</p>
              {group.domainNames.some((name) => name !== group.label) ? <p className="mt-0.5 truncate text-[0.58rem] text-muted-foreground/60">{group.domainNames.join(" · ")}</p> : null}
            </div>
            <AgentNavigationList agents={group.agents} pathname={pathname} listLabel={group.label} onNavigate={onNavigate} />
          </section>)}
        </div>
      </div> : null}
      <div className="mt-auto border-t border-border/50 p-3"><Link href={legacyAdminHref} onClick={onNavigate} className={cn(buttonVariants({ variant: "ghost", size: "sm" }), "w-full justify-between text-muted-foreground")}>Legacy workspace<ArrowUpRight aria-hidden="true" /></Link></div>
    </nav>
  )
}

function LabUnavailable() {
  return <section className="mx-auto flex min-h-[55vh] max-w-2xl items-center px-5 py-12"><div className="w-full border border-border/70 bg-card/70 p-6"><Badge variant="muted">Feature disabled</Badge><h1 className="mt-4 text-2xl font-semibold">Prism Lab is not enabled</h1><p className="mt-3 text-sm text-muted-foreground">Enable PRISM_LAB_ENABLED to use this field-test workspace.</p><Button asChild className="mt-6"><Link href="/admin">Open current admin UI</Link></Button></div></section>
}

export function LabShell({ children, enabled = true, capabilities = [], agents = [], memoryConfigured = false, branding }: { children: ReactNode; enabled?: boolean; capabilities?: readonly Capability[]; agents?: readonly LabAgentNavigationItem[]; memoryConfigured?: boolean; branding?: { brandName?: string; logoUrl?: string; logoAlt?: string; workspaceLabel?: string } }) {
  const showNavigation = enabled && capabilities.length > 0
  const [leftOpen, setLeftOpen] = useState(true)
  const [mobileOpen, setMobileOpen] = useState(false)
  const [liveQueues, setLiveQueues] = useState<Record<string, LabAgentQueue>>(() => Object.fromEntries(agents.map((agent) => [agent.key, agent.queue])))
  useEffect(() => { setLeftOpen(window.localStorage.getItem("prism-lab-left-nav") !== "closed") }, [])
  useEffect(() => { setLiveQueues(Object.fromEntries(agents.map((agent) => [agent.key, agent.queue]))) }, [agents])
  useEffect(() => {
    if (!showNavigation || !agents.length) return
    let stopped = false
    let pending = false
    const load = async () => {
      if (pending || document.visibilityState === "hidden") return
      pending = true
      try {
        const response = await fetch("/admin/agent-profiles/queue", { cache: "no-store" })
        const payload = await response.json().catch(() => null) as { queues?: Array<{ key: string } & LabAgentQueue> } | null
        if (!stopped && response.ok && payload?.queues) setLiveQueues(Object.fromEntries(payload.queues.map((queue) => [queue.key, queue])))
      } catch {
        // Preserve the last canonical queue snapshot during transient network failures.
      } finally { pending = false }
    }
    void load()
    const timer = window.setInterval(() => void load(), 5000)
    return () => { stopped = true; window.clearInterval(timer) }
  }, [showNavigation, agents.length])
  const agentsWithLiveQueues = agents.map((agent) => ({ ...agent, queue: liveQueues[agent.key] ?? { queued: 0, claimed: 0, running: 0 } }))
  function toggleLeft() { setLeftOpen((open) => { window.localStorage.setItem("prism-lab-left-nav", open ? "closed" : "open"); return !open }) }
  return <div data-lab-shell className="min-h-screen w-full bg-background text-foreground">
    <a href="#lab-content" className="fixed left-3 top-3 z-[70] -translate-y-20 bg-background px-3 py-2 text-sm focus:translate-y-0 focus:ring-2 focus:ring-ring">Skip to content</a>
    <header className="sticky top-0 z-50 flex h-14 items-center border-b border-border/60 bg-background/95 px-3 backdrop-blur">
      {showNavigation ? <><Button type="button" variant="ghost" size="icon" className="lg:hidden" onClick={() => setMobileOpen(true)} aria-label="Open navigator"><Menu /></Button><Button type="button" variant="ghost" size="icon" className="hidden lg:inline-flex" onClick={toggleLeft} aria-expanded={leftOpen} aria-controls="lab-agent-navigator" aria-label={leftOpen ? "Collapse navigator" : "Open navigator"}>{leftOpen ? <PanelLeftClose /> : <Menu />}</Button></> : null}
      <Link href="/admin/lab" className="ml-1 flex min-w-0 items-center gap-2" title={branding?.workspaceLabel || branding?.brandName || "Prism Lab"}><span className="flex h-8 w-8 shrink-0 items-center justify-center overflow-hidden rounded-md border border-border/70 bg-primary/10 text-primary">{branding?.logoUrl ? <img src={branding.logoUrl} alt={branding.logoAlt || `${branding.brandName || "Workspace"} avatar`} className="h-full w-full object-cover" /> : <FlaskConical className="h-4 w-4" />}</span><span className="truncate text-sm font-semibold">Prism</span><Badge className="text-[0.58rem] uppercase tracking-wider">Lab</Badge><span className="hidden max-w-48 truncate border-l border-border/60 pl-2 text-xs text-muted-foreground sm:inline">{branding?.workspaceLabel || branding?.brandName || "Workspace"}</span></Link>
      <div className="ml-auto"><ThemeToggle /></div>
    </header>
    {showNavigation && mobileOpen ? <div className="fixed inset-0 z-[60] lg:hidden"><button className="absolute inset-0 bg-black/55" aria-label="Close navigator" onClick={() => setMobileOpen(false)} /><aside className="relative h-full w-[18rem] max-w-[88vw] border-r border-border bg-background pt-3 shadow-2xl"><div className="flex items-center justify-between px-3 pb-3"><span className="text-sm font-semibold">Navigator</span><Button variant="ghost" size="icon" onClick={() => setMobileOpen(false)} aria-label="Close navigator"><X /></Button></div><Navigator capabilities={capabilities} agents={agentsWithLiveQueues} memoryConfigured={memoryConfigured} onNavigate={() => setMobileOpen(false)} /></aside></div> : null}
    <div className={cn("min-h-[calc(100vh-3.5rem)]", showNavigation && leftOpen && "lg:grid lg:grid-cols-[17rem_minmax(0,1fr)]")}>
      {showNavigation && leftOpen ? <aside id="lab-agent-navigator" className="sticky top-14 hidden h-[calc(100vh-3.5rem)] border-r border-border/60 bg-card/20 py-5 lg:block"><Navigator capabilities={capabilities} agents={agentsWithLiveQueues} memoryConfigured={memoryConfigured} /></aside> : null}
      <main id="lab-content" tabIndex={-1} className="min-w-0 outline-none">{enabled ? children : <LabUnavailable />}</main>
    </div>
  </div>
}
