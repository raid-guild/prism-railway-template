"use client"

import { useState } from "react"
import { useRouter } from "next/navigation"
import { Link2, Loader2 } from "lucide-react"

import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"

export function AgentBindingForm({ profileKey }: { profileKey: string }) {
  const router = useRouter()
  const [pending, setPending] = useState(false)
  const [error, setError] = useState<string | null>(null)
  async function submit(formData: FormData) {
    setPending(true)
    setError(null)
    try {
      const response = await fetch(`/admin/agent-profiles/${encodeURIComponent(profileKey)}/bindings`, {
        method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({
          surfaceType: String(formData.get("surfaceType") ?? ""), surfaceKey: String(formData.get("surfaceKey") ?? ""), label: String(formData.get("label") ?? ""),
          accessMode: String(formData.get("accessMode") ?? "readonly"),
          allowedWorkflows: String(formData.get("allowedWorkflows") ?? ""),
          rateLimitWindowSeconds: Number(formData.get("rateLimitWindowSeconds") ?? 60),
          rateLimitMaxRequests: Number(formData.get("rateLimitMaxRequests") ?? 6),
        }),
      })
      const payload = await response.json().catch(() => null) as { error?: string } | null
      if (!response.ok) throw new Error(payload?.error || "Binding could not be saved")
      router.refresh()
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Binding could not be saved")
    } finally {
      setPending(false)
    }
  }
  return (
    <form action={submit} className="grid gap-3 border border-border/60 p-4 sm:grid-cols-3">
      <div className="space-y-1.5"><Label htmlFor="binding-type">Surface</Label><select id="binding-type" name="surfaceType" className="flex h-10 w-full border border-input bg-background px-3 text-sm">{["buzz", "discord", "telegram", "external", "user"].map((value) => <option key={value}>{value}</option>)}</select></div>
      <div className="space-y-1.5"><Label htmlFor="binding-key">Channel / surface ID</Label><Input id="binding-key" name="surfaceKey" required /></div>
      <div className="space-y-1.5"><Label htmlFor="binding-label">Label</Label><Input id="binding-label" name="label" /></div>
      <div className="space-y-1.5"><Label htmlFor="binding-access">Access on this surface</Label><select id="binding-access" name="accessMode" defaultValue="readonly" className="flex h-10 w-full border border-input bg-background px-3 text-sm">{["off", "readonly", "run-approved", "full"].map((value) => <option key={value}>{value}</option>)}</select></div>
      <div className="space-y-1.5"><Label htmlFor="binding-workflows">Allowed workflows</Label><Input id="binding-workflows" name="allowedWorkflows" placeholder="workflow-one, workflow-two" /></div>
      <div className="grid grid-cols-2 gap-2"><div className="space-y-1.5"><Label htmlFor="binding-window">Rate window</Label><Input id="binding-window" name="rateLimitWindowSeconds" type="number" min="1" defaultValue="60" /></div><div className="space-y-1.5"><Label htmlFor="binding-limit">Max requests</Label><Input id="binding-limit" name="rateLimitMaxRequests" type="number" min="1" defaultValue="6" /></div></div>
      {error ? <p className="text-sm text-destructive sm:col-span-3" role="alert">{error}</p> : null}
      <div className="sm:col-span-3"><Button type="submit" size="sm" disabled={pending}>{pending ? <Loader2 className="animate-spin" aria-hidden="true" /> : <Link2 aria-hidden="true" />}Add binding</Button></div>
    </form>
  )
}

export function AgentBindingToggle({ profileKey, bindingId, enabled }: { profileKey: string; bindingId: string; enabled: boolean }) {
  const router = useRouter()
  const [pending, setPending] = useState(false)
  const [error, setError] = useState<string | null>(null)
  async function toggle() {
    setPending(true)
    setError(null)
    try {
      const response = await fetch(`/admin/agent-profiles/${encodeURIComponent(profileKey)}/bindings`, {
        method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify({ bindingId, enabled: !enabled }),
      })
      const payload = await response.json().catch(() => null) as { error?: string } | null
      if (!response.ok) throw new Error(payload?.error || "Binding could not be updated")
      router.refresh()
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Binding could not be updated")
    } finally {
      setPending(false)
    }
  }
  return (
    <div className="mt-2 flex items-center justify-between gap-2">
      {error ? <span className="text-destructive" role="alert">{error}</span> : <span />}
      <Button type="button" variant="outline" size="sm" disabled={pending} onClick={toggle}>
        {pending ? <Loader2 className="animate-spin" aria-hidden="true" /> : null}
        {enabled ? "Disable" : "Enable"}
      </Button>
    </div>
  )
}
