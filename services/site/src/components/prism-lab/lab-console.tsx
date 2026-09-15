"use client"

import { useCallback, useMemo, useState } from "react"
import { useRouter } from "next/navigation"
import { AudioLines, Bot, CheckCircle2, FlaskConical, Loader2, MessageSquareText, SendToBack } from "lucide-react"

import { CaptureWorkspace } from "@/components/admin/capture-workspace"
import { CodexConsole, type ConsoleSessionSnapshot } from "@/components/admin/codex-console"
import { AgentProfileCreate } from "@/components/prism-lab/agent-profile-create"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Textarea } from "@/components/ui/textarea"

type ConsoleWorkflow = {
  key: string
  name: string
  enabled: boolean
  targetRequired: boolean
}

type ConsoleTarget = {
  id: string
  name: string
  agentEnabled: boolean
}

type ConsoleMode = "conversation" | "capture"

function readError(value: unknown, fallback: string) {
  if (value && typeof value === "object" && !Array.isArray(value) && typeof (value as Record<string, unknown>).error === "string") {
    return (value as Record<string, unknown>).error as string
  }
  return fallback
}

export function LabConsole({
  workflows,
  targets,
  initialPrompt,
  canCreateAgents,
}: {
  workflows: ConsoleWorkflow[]
  targets: ConsoleTarget[]
  initialPrompt: string
  canCreateAgents: boolean
}) {
  const router = useRouter()
  const [mode, setMode] = useState<ConsoleMode>("conversation")
  const [snapshot, setSnapshot] = useState<ConsoleSessionSnapshot>({ sessionId: null, messages: [], pending: false })
  const [promoting, setPromoting] = useState(false)
  const [promotionError, setPromotionError] = useState<string | null>(null)
  const [promotionOpen, setPromotionOpen] = useState(false)
  const [agentCreationOpen, setAgentCreationOpen] = useState(false)
  const enabledWorkflows = useMemo(() => workflows.filter((workflow) => workflow.enabled), [workflows])
  const defaultWorkflow = enabledWorkflows.find((workflow) => workflow.key === "change-request-default") ?? enabledWorkflows[0] ?? null
  const [promotionWorkflowKey, setPromotionWorkflowKey] = useState(defaultWorkflow?.key ?? "")
  const promotionTargetRequired = enabledWorkflows.find((workflow) => workflow.key === promotionWorkflowKey)?.targetRequired === true
  const onSnapshot = useCallback((value: ConsoleSessionSnapshot) => setSnapshot(value), [])

  async function promote(formData: FormData) {
    if (!snapshot.sessionId || !defaultWorkflow) return
    setPromoting(true)
    setPromotionError(null)
    try {
      const response = await fetch("/admin/lab/console/promote", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          sessionId: snapshot.sessionId,
          title: String(formData.get("title") ?? ""),
          description: String(formData.get("description") ?? ""),
          workflowKey: String(formData.get("workflowKey") ?? ""),
          targetAppId: String(formData.get("targetAppId") ?? "") || null,
          requestType: String(formData.get("requestType") ?? "issue"),
          priority: String(formData.get("priority") ?? "normal"),
        }),
      })
      const payload = await response.json().catch(() => null) as Record<string, unknown> | null
      if (!response.ok) throw new Error(readError(payload, `Promotion failed with HTTP ${response.status}`))
      const request = payload?.request as Record<string, unknown> | undefined
      if (typeof request?.requestNumber !== "number") throw new Error("Promotion did not return a request number")
      router.push(`/admin/lab/requests/${request.requestNumber}#selected-request-workspace`)
    } catch (error) {
      setPromotionError(error instanceof Error ? error.message : "Could not promote this console session")
    } finally {
      setPromoting(false)
    }
  }

  return (
    <div className="px-4 py-5 sm:px-6 lg:px-8">
      <div className="mx-auto max-w-6xl">
        <header className="flex flex-col gap-4 border-b border-border/60 pb-5 md:flex-row md:items-end md:justify-between">
          <div>
            <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-[0.16em] text-primary"><span>Live instance</span><span aria-hidden="true">·</span><span>Console</span></div>
            <h1 className="mt-2 text-2xl font-semibold tracking-tight sm:text-3xl">Admin Console</h1>
            <p className="mt-1 text-sm text-muted-foreground">A durable Admin Agent conversation. It is observable by authorized workspace operators and separate from every request conversation.</p>
          </div>
          <div className="flex flex-wrap gap-2" role="group" aria-label="Console input mode">
            <Button type="button" size="sm" variant={mode === "conversation" ? "secondary" : "ghost"} onClick={() => setMode("conversation")}><MessageSquareText aria-hidden="true" />Conversation</Button>
            <Button type="button" size="sm" variant={mode === "capture" ? "secondary" : "ghost"} onClick={() => setMode("capture")}><AudioLines aria-hidden="true" />Capture context</Button>
          </div>
        </header>

        {mode === "conversation" ? (
          <div className="mt-4 border border-border/60 bg-card/35">
            <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border/60 px-4 py-3">
              <div className="flex items-center gap-2 text-sm text-muted-foreground">
                <FlaskConical className="text-primary" aria-hidden="true" />
                <span>{snapshot.sessionId ? `${snapshot.messages.length} durable messages` : "A session is created when you send the first message"}</span>
              </div>
              <Button type="button" variant="outline" size="sm" disabled={!snapshot.sessionId || snapshot.pending} onClick={() => setPromotionOpen((value) => !value)}>
                <SendToBack aria-hidden="true" />Promote to request
              </Button>
              {canCreateAgents ? <Button type="button" variant="outline" size="sm" onClick={() => setAgentCreationOpen((value) => !value)}><Bot aria-hidden="true" />Create agent</Button> : null}
            </div>

            {agentCreationOpen ? <div className="border-b border-border/60 bg-background/45 p-4"><AgentProfileCreate hasOperatorIdentity /></div> : null}

            {promotionOpen ? (
              <form action={promote} className="grid gap-4 border-b border-border/60 bg-background/45 p-4" aria-label="Promote console conversation to request">
                <div>
                  <h2 className="font-semibold">Create a request from this session</h2>
                  <p className="mt-1 text-xs leading-5 text-muted-foreground">The request records this console session as immutable provenance. Its request conversation starts separately.</p>
                </div>
                <div className="grid gap-3 md:grid-cols-2">
                  <div className="space-y-1.5 md:col-span-2"><Label htmlFor="promotion-title">Title</Label><Input id="promotion-title" name="title" required maxLength={200} /></div>
                  <div className="space-y-1.5 md:col-span-2"><Label htmlFor="promotion-description">Goal and acceptance context</Label><Textarea id="promotion-description" name="description" required maxLength={12000} rows={4} /></div>
                  <div className="space-y-1.5"><Label htmlFor="promotion-workflow">Workflow</Label><select id="promotion-workflow" name="workflowKey" value={promotionWorkflowKey} onChange={(event) => setPromotionWorkflowKey(event.target.value)} className="flex h-10 w-full border border-input bg-background px-3 text-sm" required>{enabledWorkflows.map((workflow) => <option key={workflow.key} value={workflow.key}>{workflow.name}</option>)}</select></div>
                  <div className="space-y-1.5"><Label htmlFor="promotion-target">Target repository{promotionTargetRequired ? " · required" : ""}</Label><select id="promotion-target" name="targetAppId" defaultValue="" required={promotionTargetRequired} className="flex h-10 w-full border border-input bg-background px-3 text-sm"><option value="">{promotionTargetRequired ? "Select a target" : "No target"}</option>{targets.filter((target) => target.agentEnabled).map((target) => <option key={target.id} value={target.id}>{target.name}</option>)}</select></div>
                  <div className="space-y-1.5"><Label htmlFor="promotion-type">Request type</Label><select id="promotion-type" name="requestType" defaultValue="issue" className="flex h-10 w-full border border-input bg-background px-3 text-sm">{["issue", "feature", "bug", "content", "design", "config", "ops"].map((value) => <option key={value} value={value}>{value}</option>)}</select></div>
                  <div className="space-y-1.5"><Label htmlFor="promotion-priority">Priority</Label><select id="promotion-priority" name="priority" defaultValue="normal" className="flex h-10 w-full border border-input bg-background px-3 text-sm">{["low", "normal", "high", "urgent"].map((value) => <option key={value} value={value}>{value}</option>)}</select></div>
                </div>
                {promotionError ? <p className="text-sm text-destructive" role="alert">{promotionError}</p> : null}
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <p className="text-xs text-muted-foreground">Promotion uses the normal workflow auto-start and capability checks.</p>
                  <Button type="submit" disabled={!snapshot.sessionId || promoting || !enabledWorkflows.length}>{promoting ? <Loader2 className="animate-spin" aria-hidden="true" /> : <CheckCircle2 aria-hidden="true" />}{promoting ? "Creating request" : "Create request"}</Button>
                </div>
              </form>
            ) : null}

            <CodexConsole isActive agentProfileKey="admin-agent" executionMode="orchestrator" initialDraft={initialPrompt} onSessionSnapshot={onSnapshot} />
          </div>
        ) : (
          <div className="mt-4 border border-border/60 bg-card/35">
            <div className="border-b border-border/60 px-4 py-3">
              <div className="flex items-center gap-2"><AudioLines className="text-primary" aria-hidden="true" /><h2 className="font-semibold">Capture context</h2><Badge variant="outline">Console mode</Badge></div>
              <p className="mt-1 text-xs text-muted-foreground">Record and transcribe browser or microphone context. Dispatch and credential behavior remain in the existing secure capture flow.</p>
            </div>
            <CaptureWorkspace />
          </div>
        )}
      </div>
    </div>
  )
}
