"use client"

import { useEffect, useState } from "react"
import { useRouter } from "next/navigation"
import { ArrowRightLeft, Loader2 } from "lucide-react"

import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"

type Candidate = {
  interactionProfileKey: string
  name: string
  description: string | null
  alreadyMigrated: boolean
  surfaces: Array<{ surfaceType: string; surfaceKey: string; label: string | null; accessMode: string }>
}

export function LegacyAgentProfileMigration() {
  const router = useRouter()
  const [candidates, setCandidates] = useState<Candidate[]>([])
  const [pending, setPending] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  useEffect(() => {
    void fetch("/admin/agent-profiles/migrations/legacy-interactions", { cache: "no-store" })
      .then(async (response) => {
        const payload = await response.json().catch(() => null) as { candidates?: Candidate[]; error?: string } | null
        if (!response.ok) throw new Error(payload?.error || "Could not inspect existing channel profiles")
        setCandidates(payload?.candidates ?? [])
      })
      .catch((cause) => setError(cause instanceof Error ? cause.message : "Could not inspect existing channel profiles"))
  }, [])
  async function migrate(candidate: Candidate) {
    setPending(candidate.interactionProfileKey)
    setError(null)
    try {
      const response = await fetch("/admin/agent-profiles/migrations/legacy-interactions", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ interactionProfileKey: candidate.interactionProfileKey, owner: "admin-agent", confirm: true }),
      })
      const payload = await response.json().catch(() => null) as { error?: string } | null
      if (!response.ok) throw new Error(payload?.error || "Profile migration failed")
      setCandidates((current) => current.filter((item) => item.interactionProfileKey !== candidate.interactionProfileKey))
      router.refresh()
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Profile migration failed")
    } finally {
      setPending(null)
    }
  }
  if (!candidates.length && !error) return null
  return (
    <section className="mt-8 border border-amber-500/40 bg-amber-500/5 p-4">
      <div className="flex items-center gap-2"><ArrowRightLeft className="text-amber-500" aria-hidden="true" /><h2 className="font-semibold">Move existing channel profiles into Agents</h2></div>
      <p className="mt-1 text-xs text-muted-foreground">This is a one-time reviewed migration. Agent Profiles become canonical; existing policy records remain read-only compatibility data.</p>
      {error ? <p className="mt-3 text-sm text-destructive" role="alert">{error}</p> : null}
      <div className="mt-4 divide-y divide-border/60 border border-border/60">
        {candidates.map((candidate) => <div key={candidate.interactionProfileKey} className="p-3"><div className="flex flex-wrap items-start justify-between gap-3"><div><div className="font-medium">{candidate.name}</div><div className="mt-1 text-xs text-muted-foreground">{candidate.interactionProfileKey} · {candidate.surfaces.length} bound surfaces</div></div><Button size="sm" type="button" onClick={() => void migrate(candidate)} disabled={pending !== null}>{pending === candidate.interactionProfileKey ? <Loader2 className="animate-spin" aria-hidden="true" /> : <ArrowRightLeft aria-hidden="true" />}Move to Agents</Button></div><div className="mt-2 flex flex-wrap gap-2">{candidate.surfaces.map((surface) => <Badge key={`${surface.surfaceType}:${surface.surfaceKey}`} variant="outline">{surface.surfaceType} · {surface.label || surface.surfaceKey} · {surface.accessMode}</Badge>)}</div></div>)}
      </div>
    </section>
  )
}
