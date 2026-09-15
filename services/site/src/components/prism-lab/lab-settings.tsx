import Link from "next/link"
import {
  ArrowUpRight,
  Bot,
  Cable,
  KeyRound,
  MessageSquareText,
  RadioTower,
  Route,
  Settings2,
  ShieldCheck,
} from "lucide-react"

import { Badge } from "@/components/ui/badge"
import { buttonVariants } from "@/components/ui/button"
import { cn } from "@/lib/utils"

const settingsAreas = [
  {
    key: "gateway",
    title: "Gateway",
    description: "Create encrypted organization connections, assign credentials, and review lease activity.",
    href: "/admin?tab=settings&settings=gateway",
    icon: KeyRound,
  },
  {
    key: "interfaces",
    title: "Interfaces",
    description: "Configure named inbound HTTP interfaces and rotate their credentials through the secure settings flow.",
    href: "/admin?tab=settings&settings=interfaces",
    icon: Cable,
  },
  {
    key: "runtimes",
    title: "Runtimes",
    description: "Choose the default runtime adapter, review health, and inspect supported feature contracts.",
    href: "/admin?tab=settings&settings=runtimes",
    icon: Bot,
  },
  {
    key: "sources",
    title: "Agent access and bindings",
    description: "Manage agent profiles and their Discord, Telegram, Buzz, and external interface bindings in Lab.",
    href: "/admin/lab/agents",
    icon: RadioTower,
  },
] as const

export function LabSettings() {
  return (
    <div className="px-4 py-5 sm:px-6 lg:px-8">
      <div className="mx-auto max-w-6xl">
        <header className="border-b border-border/60 pb-5">
          <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-[0.16em] text-primary"><span>Live instance</span><span aria-hidden="true">·</span><span>Settings</span></div>
          <h1 className="mt-2 text-2xl font-semibold tracking-tight sm:text-3xl">Focused configuration</h1>
          <p className="mt-1 max-w-3xl text-sm leading-6 text-muted-foreground">Manage agent access in Lab. Gateway, Interfaces, and Runtimes open their existing secure forms in the legacy workspace; use Return to Prism Lab to come back.</p>
        </header>

        <section aria-labelledby="settings-areas-heading" className="mt-5">
          <div className="flex items-center gap-2"><Settings2 className="text-primary" aria-hidden="true" /><h2 id="settings-areas-heading" className="text-lg font-semibold">Configuration areas</h2></div>
          <div className="mt-3 grid gap-3 md:grid-cols-2">
            {settingsAreas.map((area) => {
              const Icon = area.icon
              return (
                <article key={area.key} className="border border-border/60 bg-card/40 p-4">
                  <div className="flex items-start gap-3">
                    <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full border border-primary/30 bg-primary/8 text-primary"><Icon aria-hidden="true" /></div>
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center justify-between gap-2"><h3 className="font-semibold">{area.title}</h3><Badge variant="outline">{area.key === "sources" ? "Lab" : "Legacy settings"}</Badge></div>
                      <p className="mt-1 text-sm leading-6 text-muted-foreground">{area.description}</p>
                      <div className="mt-4 flex flex-wrap gap-2">
                        <Link href={area.href} className={buttonVariants({ variant: "outline", size: "sm" })}>Open settings<ArrowUpRight aria-hidden="true" /></Link>
                        <Link href="/admin/lab/agents/admin-agent" className={buttonVariants({ variant: "ghost", size: "sm" })}><MessageSquareText aria-hidden="true" />Open Admin Console</Link>
                      </div>
                    </div>
                  </div>
                </article>
              )
            })}
          </div>
        </section>

        <section aria-labelledby="credential-boundary-heading" className="mt-5 grid gap-4 border border-primary/30 bg-primary/5 p-5 md:grid-cols-[auto_minmax(0,1fr)]">
          <ShieldCheck className="h-6 w-6 text-primary" aria-hidden="true" />
          <div>
            <h2 id="credential-boundary-heading" className="font-semibold">Credential boundary</h2>
            <p className="mt-1 text-sm leading-6 text-muted-foreground">Console can help draft non-secret configuration for review. Credential values, API-key generation, and rotation stay in explicit Gateway or Interface settings and never belong in prompts, request artifacts, or chat.</p>
          </div>
        </section>

        <section aria-labelledby="legacy-settings-heading" className="mt-5 border border-border/60 bg-card/30 p-5">
          <div className="flex items-start gap-3">
            <Route className="mt-0.5 text-muted-foreground" aria-hidden="true" />
            <div>
              <h2 id="legacy-settings-heading" className="font-semibold">Everything else remains available</h2>
              <p className="mt-1 text-sm leading-6 text-muted-foreground">Branding, members, repository targets, environment setup, capture dispatch, and service diagnostics have not been duplicated in Lab.</p>
              <Link href="/admin?tab=settings&settings=status" className={cn(buttonVariants({ variant: "outline", size: "sm" }), "mt-3")}>Open legacy settings<ArrowUpRight aria-hidden="true" /></Link>
            </div>
          </div>
        </section>
      </div>
    </div>
  )
}
