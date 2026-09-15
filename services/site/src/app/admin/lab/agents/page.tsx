import Link from "next/link"
import { Activity, Cable, ShieldCheck, UserRound } from "lucide-react"

import { AgentProfileCreate } from "@/components/prism-lab/agent-profile-create"
import { AgentAvatar } from "@/components/prism-lab/agent-avatar"
import { LegacyAgentProfileMigration } from "@/components/prism-lab/legacy-agent-profile-migration"
import { RequestInboxUnavailable } from "@/components/prism-lab/request-inbox"
import { Badge } from "@/components/ui/badge"
import { getAdminWorkspaceData } from "@/lib/admin"
import {
  getAccountabilityAssignment,
  listAccountabilityDomains,
  listAgentProfileActivity,
  listAgentProfiles,
} from "@/lib/app-core"
import { isPrismLabEnabled } from "@/lib/prism-lab/feature-flag"

type ProfileAccountability = {
  categoryLabel: string
  domainName: string
  stewards: string[]
}

function ProfileCard({ profile, canInspect, accountability }: { profile: ReturnType<typeof listAgentProfiles>[number]; canInspect: boolean; accountability: ProfileAccountability | null }) {
  const activity = canInspect ? listAgentProfileActivity(profile.id, 10) : []
  const activeRuns = activity.filter((item) => item.kind === "run" && ["queued", "claimed", "running"].includes(item.status)).length
  return (
    <Link href={`/admin/lab/agents/${encodeURIComponent(profile.key)}`} className="block border border-border/60 bg-card/35 p-4 transition-colors hover:border-primary/50 hover:bg-card/60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
      <div className="flex items-start justify-between gap-3">
        <div className="flex min-w-0 gap-3"><AgentAvatar name={profile.name} avatarUrl={profile.avatarUrl} accentColor={profile.accentColor} /><div className="min-w-0"><div className="flex flex-wrap items-center gap-2"><h2 className="font-semibold" style={{ color: `color-mix(in oklab, ${profile.accentColor} 72%, var(--foreground))` }}>{profile.name}</h2><Badge variant={profile.status === "active" ? "outline" : "muted"}>{profile.status}</Badge><Badge variant="muted">{profile.systemKey ? "Built-in" : "Custom"}</Badge></div><p className="mt-1 line-clamp-2 text-sm text-muted-foreground">{profile.description || "No mandate recorded"}</p></div></div>
      </div>
      <dl className="mt-4 grid gap-2 text-xs text-muted-foreground sm:grid-cols-2">
        <div className="flex items-center gap-2"><UserRound className="h-3.5 w-3.5" aria-hidden="true" /><dt className="sr-only">Accountability</dt><dd>{accountability ? `${accountability.categoryLabel} · ${accountability.stewards.join(", ") || "No steward"}` : "Accountability unassigned"}</dd></div>
        <div className="flex items-center gap-2"><Cable className="h-3.5 w-3.5" aria-hidden="true" /><dt className="sr-only">Surfaces</dt><dd>Console{profile.bindings.length ? ` · ${profile.bindings.map((item) => item.label || item.surfaceType).join(" · ")}` : " only"}</dd></div>
        <div className="flex items-center gap-2"><Activity className="h-3.5 w-3.5" aria-hidden="true" /><dt className="sr-only">Activity</dt><dd>{activeRuns} active · {activity.length} recent events</dd></div>
        <div className="flex items-center gap-2"><ShieldCheck className="h-3.5 w-3.5" aria-hidden="true" /><dt className="sr-only">Version</dt><dd>Profile v{profile.version}</dd></div>
      </dl>
    </Link>
  )
}

export default async function LabAgentsPage() {
  if (!isPrismLabEnabled(process.env.PRISM_LAB_ENABLED)) return null
  const workspace = await getAdminWorkspaceData()
  if (!workspace.ok) return <RequestInboxUnavailable reason={workspace.reason} />
  if (!workspace.data.session.capabilities.includes("canChatAgents")) return <RequestInboxUnavailable reason="unauthorized" />
  const profiles = listAgentProfiles()
  const domains = new Map(listAccountabilityDomains({ includeArchived: true }).map((domain) => [domain.id, domain]))
  const profileView = (profile: ReturnType<typeof listAgentProfiles>[number]) => {
    const assignment = getAccountabilityAssignment("agent_profile", profile.id)
    const domain = assignment ? domains.get(assignment.domainId) ?? null : null
    const categoryLabel = typeof domain?.governanceRef.stewardMandate === "string"
      ? domain.governanceRef.stewardMandate
      : domain?.name ?? "Unassigned"
    const categoryOrder = typeof domain?.governanceRef.displayOrder === "number"
      ? domain.governanceRef.displayOrder
      : 999
    return {
      profile,
      domainKey: domain?.key ?? "unassigned",
      categoryOrder,
      accountability: domain ? {
        categoryLabel,
        domainName: domain.name,
        stewards: domain.stewards.map((steward) => steward.displayName || steward.userId),
      } : null,
    }
  }
  const canInspect = workspace.data.session.capabilities.includes("canRunAgent")
  const admin = profiles.find((profile) => profile.systemKey === "admin-agent")
  const adminView = admin ? profileView(admin) : null
  const groups = Array.from(
    profiles
      .filter((profile) => profile.systemKey !== "admin-agent")
      .map(profileView)
      .reduce((current, item) => {
        const label = item.accountability?.categoryLabel ?? "Unassigned"
        const key = label.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "") || "unassigned"
        const group = current.get(key) ?? {
          key,
          label,
          domainNames: [] as string[],
          order: item.categoryOrder,
          profiles: [] as ReturnType<typeof profileView>[],
        }
        if (item.accountability?.domainName && !group.domainNames.includes(item.accountability.domainName)) group.domainNames.push(item.accountability.domainName)
        group.order = Math.min(group.order, item.categoryOrder)
        group.profiles.push(item)
        current.set(key, group)
        return current
      }, new Map<string, { key: string; label: string; domainNames: string[]; order: number; profiles: Array<ReturnType<typeof profileView>> }>())
      .values(),
  ).sort((a, b) => a.order - b.order || a.label.localeCompare(b.label))
  return (
    <div className="px-4 py-5 sm:px-6 lg:px-8"><div className="mx-auto max-w-6xl">
      <header className="border-b border-border/60 pb-5"><div className="text-xs font-semibold uppercase tracking-[0.16em] text-primary">Live instance · Agents</div><h1 className="mt-2 text-2xl font-semibold sm:text-3xl">Agent organization</h1><p className="mt-1 text-sm text-muted-foreground">Durable identities, human stewardship, conversations, execution, and external communication bindings.</p></header>
      {adminView && canInspect ? <section className="mt-5"><div className="mb-2"><div className="text-xs font-semibold uppercase tracking-[0.16em] text-muted-foreground">Control Plane</div><div className="mt-1 text-xs text-muted-foreground">Cross-agent administration and bounded repair</div></div><ProfileCard profile={adminView.profile} accountability={adminView.accountability} canInspect /></section> : null}
      <section className="mt-7 space-y-8"><div className="flex items-center justify-between border-b border-border/60 pb-2"><h2 className="text-xs font-semibold uppercase tracking-[0.16em] text-muted-foreground">Steward categories</h2><span className="text-xs text-muted-foreground">{profiles.length - (admin ? 1 : 0)} agents</span></div>{groups.length ? groups.map((group) => <section key={group.key}><div className="mb-2"><h3 className="text-xs font-semibold uppercase tracking-[0.16em] text-foreground">{group.label}</h3>{group.domainNames.some((name) => name !== group.label) ? <p className="mt-1 text-xs text-muted-foreground">{group.domainNames.join(" · ")}</p> : null}</div><div className="grid gap-3 lg:grid-cols-2">{group.profiles.map((item) => <ProfileCard key={item.profile.id} profile={item.profile} accountability={item.accountability} canInspect={canInspect} />)}</div></section>) : <div className="border border-dashed border-border/70 p-6 text-sm text-muted-foreground">No additional agents yet. Every created agent receives a Console and may later be connected to external channels.</div>}</section>
      {workspace.data.session.capabilities.includes("canManageSettings") ? <section className="mt-8"><AgentProfileCreate hasOperatorIdentity={Boolean(workspace.data.session.userId)} /></section> : null}
      {workspace.data.session.capabilities.includes("canManageSettings") ? <LegacyAgentProfileMigration /> : null}
    </div></div>
  )
}
