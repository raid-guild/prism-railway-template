"use client"

import { useState } from "react"
import { useRouter } from "next/navigation"
import { Bot, CheckCircle2, Loader2 } from "lucide-react"

import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Textarea } from "@/components/ui/textarea"
import { agentAccentPalette } from "@/lib/agent-profile-colors"

type AgentPreview = {
  key: string
  name: string
  description: string | null
  accentColor: string
  owner: "operator" | "admin-agent"
  skills: string[]
  persona: { name: string; instructions: string }
  authority: Record<string, unknown>
  memoryScope: Record<string, unknown>
}

function errorMessage(value: unknown) {
  return value && typeof value === "object" && !Array.isArray(value) && typeof (value as Record<string, unknown>).error === "string"
    ? String((value as Record<string, unknown>).error)
    : "Agent Profile could not be created"
}

export function AgentProfileCreate({ hasOperatorIdentity }: { hasOperatorIdentity: boolean }) {
  const router = useRouter()
  const [preview, setPreview] = useState<AgentPreview | null>(null)
  const [payload, setPayload] = useState<Record<string, unknown> | null>(null)
  const [pending, setPending] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function submit(input: Record<string, unknown>) {
    const response = await fetch("/admin/agent-profiles", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(input),
    })
    const result = await response.json().catch(() => null) as Record<string, unknown> | null
    if (!response.ok || !result) throw new Error(errorMessage(result))
    return result
  }

  async function review(formData: FormData) {
    setPending(true)
    setError(null)
    try {
      const next = {
        key: String(formData.get("key") ?? ""),
        name: String(formData.get("name") ?? ""),
        description: String(formData.get("description") ?? ""),
        accentColor: String(formData.get("accentColor") ?? agentAccentPalette[0].value),
        owner: String(formData.get("owner") ?? "operator"),
        skills: String(formData.get("skills") ?? ""),
        personaInstructions: String(formData.get("personaInstructions") ?? ""),
        memoryBuckets: String(formData.get("memoryBuckets") ?? ""),
        memorySources: String(formData.get("memorySources") ?? ""),
      }
      const result = await submit(next)
      setPayload(next)
      setPreview(result.preview as AgentPreview)
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Agent Profile could not be reviewed")
    } finally {
      setPending(false)
    }
  }

  async function confirm() {
    if (!payload) return
    setPending(true)
    setError(null)
    try {
      const result = await submit({ ...payload, confirm: true })
      const profile = result.profile as { key?: string } | undefined
      if (!profile?.key) throw new Error("Confirmed profile was not returned")
      router.push(`/admin/lab/agents/${encodeURIComponent(profile.key)}`)
      router.refresh()
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Agent Profile could not be created")
    } finally {
      setPending(false)
    }
  }

  if (preview) {
    return (
      <section className="border border-primary/40 bg-primary/5 p-4" aria-label="Review Agent Profile">
        <div className="flex items-center gap-2"><Bot className="text-primary" aria-hidden="true" /><h2 className="font-semibold">Review Agent Profile</h2></div>
        <dl className="mt-4 grid gap-3 text-sm sm:grid-cols-2">
          <div><dt className="text-muted-foreground">Identity</dt><dd className="font-medium" style={{ color: preview.accentColor }}>{preview.name} · {preview.key}</dd></div>
          <div><dt className="text-muted-foreground">Ownership</dt><dd className="font-medium">{preview.owner === "admin-agent" ? "Admin Agent" : "Current operator"}</dd></div>
          <div className="sm:col-span-2"><dt className="text-muted-foreground">Mandate</dt><dd>{preview.description || "No description"}</dd></div>
          <div><dt className="text-muted-foreground">Skills</dt><dd>{preview.skills.join(", ") || "None assigned"}</dd></div>
          <div><dt className="text-muted-foreground">Memory scope</dt><dd>{JSON.stringify(preview.memoryScope)}</dd></div>
          <div><dt className="text-muted-foreground">Console access</dt><dd>Full · external surfaces must be bound separately</dd></div>
          <div className="sm:col-span-2"><dt className="text-muted-foreground">Persona instructions</dt><dd className="whitespace-pre-wrap">{preview.persona.instructions || "No additional instructions"}</dd></div>
        </dl>
        <p className="mt-4 text-xs text-muted-foreground">Confirmation creates a versioned operational identity. Credentials are not stored in this profile.</p>
        {error ? <p className="mt-3 text-sm text-destructive" role="alert">{error}</p> : null}
        <div className="mt-4 flex gap-2">
          <Button type="button" onClick={confirm} disabled={pending}>{pending ? <Loader2 className="animate-spin" aria-hidden="true" /> : <CheckCircle2 aria-hidden="true" />}Confirm agent</Button>
          <Button type="button" variant="outline" onClick={() => setPreview(null)} disabled={pending}>Edit</Button>
        </div>
      </section>
    )
  }

  return (
    <form action={review} className="grid gap-4 border border-border/60 bg-card/35 p-4" aria-label="Create Agent Profile">
      <div><h2 className="font-semibold">Create an agent</h2><p className="mt-1 text-xs text-muted-foreground">Prepare a reviewable identity and authority boundary. Every agent receives a Prism Console.</p></div>
      <div className="grid gap-3 sm:grid-cols-2">
        <div className="space-y-1.5"><Label htmlFor="agent-name">Name</Label><Input id="agent-name" name="name" required maxLength={160} placeholder="Veydrift Agent" /></div>
        <div className="space-y-1.5"><Label htmlFor="agent-key">Stable key</Label><Input id="agent-key" name="key" required maxLength={120} placeholder="veydrift-agent" /></div>
        <div className="space-y-1.5 sm:col-span-2"><Label htmlFor="agent-description">Mandate</Label><Textarea id="agent-description" name="description" required rows={3} maxLength={2000} /></div>
        <div className="space-y-1.5"><Label htmlFor="agent-owner">Owner</Label><select id="agent-owner" name="owner" defaultValue={hasOperatorIdentity ? "operator" : "admin-agent"} className="flex h-10 w-full border border-input bg-background px-3 text-sm"><option value="admin-agent">Admin Agent</option>{hasOperatorIdentity ? <option value="operator">Current operator</option> : null}</select></div>
        <div className="space-y-1.5"><Label htmlFor="agent-skills">Skills</Label><Input id="agent-skills" name="skills" placeholder="veydrift-commander, prism-api-reader" /></div>
        <fieldset className="sm:col-span-2"><legend className="text-sm font-medium">Agent color</legend><div className="mt-2 grid grid-cols-4 gap-2 sm:grid-cols-8">{agentAccentPalette.map((color, index) => <label key={color.value} className="cursor-pointer"><input type="radio" name="accentColor" value={color.value} defaultChecked={index === 0} className="peer sr-only" /><span className="flex h-10 items-center justify-center rounded-md border text-[0.62rem] font-semibold peer-focus-visible:ring-2 peer-focus-visible:ring-ring peer-checked:ring-2" title={color.label} style={{ color: color.value, borderColor: color.value, backgroundColor: `${color.value}14` }}><span className="h-3 w-3 rounded-full" style={{ backgroundColor: color.value }} /><span className="sr-only">{color.label}</span></span></label>)}</div></fieldset>
        <div className="space-y-1.5 sm:col-span-2"><Label htmlFor="agent-persona">Persona instructions</Label><Textarea id="agent-persona" name="personaInstructions" rows={4} maxLength={12000} /></div>
        <fieldset className="grid gap-3 border border-border/60 p-3 sm:col-span-2 sm:grid-cols-2"><legend className="px-1 text-xs font-semibold">Memory scope</legend><div className="space-y-1.5"><Label htmlFor="agent-memory-buckets">Rolling buckets</Label><Input id="agent-memory-buckets" name="memoryBuckets" placeholder="meetings, ops, projects" /></div><div className="space-y-1.5"><Label htmlFor="agent-memory-sources">Knowledge source IDs</Label><Input id="agent-memory-sources" name="memorySources" placeholder="handbook, product-docs" /></div><p className="text-xs text-muted-foreground sm:col-span-2">Leave both empty for no Memory access. Workspace-wide scope can be granted later to governed agents.</p></fieldset>
      </div>
      {error ? <p className="text-sm text-destructive" role="alert">{error}</p> : null}
      <div><Button type="submit" disabled={pending}>{pending ? <Loader2 className="animate-spin" aria-hidden="true" /> : <Bot aria-hidden="true" />}{pending ? "Preparing review" : "Review agent"}</Button></div>
    </form>
  )
}
