"use client"

import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react"
import Link from "next/link"
import {
  AlertCircle,
  ArrowLeft,
  ArrowRightLeft,
  Bot,
  CheckCircle2,
  ChevronDown,
  Clock3,
  ExternalLink,
  FileText,
  GitBranch,
  Loader2,
  MessageSquareText,
  Paperclip,
  Play,
  RefreshCw,
  Send,
  ShieldAlert,
  TerminalSquare,
  Upload,
  UserRound,
  UsersRound,
  XCircle,
} from "lucide-react"

import { Badge } from "@/components/ui/badge"
import { Button, buttonVariants } from "@/components/ui/button"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { Label } from "@/components/ui/label"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { Textarea } from "@/components/ui/textarea"
import { RequestTimeline } from "@/components/prism-lab/request-timeline"
import { WorkflowExplorer } from "@/components/prism-lab/workflow-explorer"
import { cn } from "@/lib/utils"
import type { LabRequestListItem } from "@/lib/prism-lab/contracts"
import { decideConversationViewportUpdate } from "@/lib/prism-lab/conversation-viewport"
import { buildRequestTimeline } from "@/lib/prism-lab/request-timeline"
import {
  beginRequestReviewLoad,
  captureRequestReviewScope,
  createRequestReviewScope,
  isCurrentRequestReviewLoad,
  isCurrentRequestReviewScope,
  selectRequestReviewScope,
} from "@/lib/prism-lab/request-review-coordinator"
import { buildWorkflowExplorer } from "@/lib/prism-lab/workflow-explorer"
import {
  resolveRequestManagementIntent,
  type RequestManagementStep,
} from "@/lib/prism-lab/request-management-intent"

type ReviewCapabilities = {
  canViewRequests: boolean
  canRunAgent: boolean
  canComment: boolean
}

type ReviewMessage = {
  id: string
  role: string
  source: string
  content: string
  createdAt: string
  actor?: {
    id: string | null
    displayName: string | null
    handle: string | null
    kind: "site-user" | "external" | "unknown"
    basis: "message-snapshot" | "session-owner" | "external-message" | "unknown"
  } | null
}

type ReviewRun = {
  id: string
  status: string
  kind: string
  workflowStepKey: string | null
  errorMessage: string | null
  queuedAt: string
  startedAt: string | null
  finishedAt: string | null
  result: Record<string, unknown>
  trace: Array<Record<string, unknown>>
  agentProfileId?: string | null
  agentProfileVersion?: number | null
  agentProfileKey?: string | null
  agentProfileName?: string | null
  executionMode?: string | null
}

type ReviewArtifact = {
  id: string
  name: string
  kind: string
  description: string | null
  mimeType: string
  sizeBytes: number
  createdAt: string
  agentRunId: string | null
}

type ReviewEvent = {
  id: string
  eventType: string
  stepKey: string | null
  actorType: string
  note: string | null
  payload: Record<string, unknown>
  createdAt: string
}

type ReviewExternalRef = {
  id: string
  provider: string
  kind: string
  title: string | null
  url: string
  state: string | null
  createdAt: string
}

type RequestReview = {
  ok: true
  capabilities: ReviewCapabilities
  changeRequest: {
    id: string
    requestNumber: number
    title: string
    description: string
    currentWorkflowStepKey: string | null
    targetEnvironmentId: string | null
    closedAt: string | null
    workflowAttention: {
      status: string
      summary: string
      suggestedFix: string | null
      blockers: Array<{ key?: string; summary?: string }>
    } | null
  }
  workflow: {
    key?: string
    name?: string
    definition?: {
      steps?: Array<Record<string, unknown>>
    }
  } | null
  workflowRun: {
    status: string
    currentStepKey: string
  } | null
  agentSession: { id: string; source: string } | null
  agentMessages: ReviewMessage[]
  agentRuns: ReviewRun[]
  artifacts: ReviewArtifact[]
  workflowEvents: ReviewEvent[]
  externalRefs: ReviewExternalRef[]
}

type WorkspaceState = "queued" | "running" | "failed" | "blocked" | "attention" | "checkpoint-passed" | "completed" | "ready"
type MutationKind = "ask" | "comment" | "continue" | "upload" | "stop-run" | "cancel-request" | "move-step" | null
type InterruptionDialog = "stop-run" | "cancel-request" | "move-step" | "retry-step" | "check-status" | null
type RequestActionProposal =
  | { kind: "cancel-request"; reason: string; summary: string }
  | { kind: "retry-step"; reason: string; summary: string }
  | { kind: "check-status"; reason: string; summary: string }
  | { kind: "move-step"; targetStepKey: string; runAfterMove: boolean; reason: string; summary: string }

const activeRunStatuses = new Set(["queued", "claimed", "running"])
const failedRunStatuses = new Set(["failed", "canceled"])

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value)
}

function parseReview(value: unknown): RequestReview | null {
  if (!isRecord(value) || value.ok !== true || !isRecord(value.capabilities) || !isRecord(value.changeRequest)) {
    return null
  }
  return value as unknown as RequestReview
}

function readableError(value: unknown, fallback: string) {
  if (!isRecord(value)) return fallback
  if (typeof value.error === "string" && value.error.trim()) return value.error
  return fallback
}

function requestActionProposal(value: unknown): RequestActionProposal | null {
  if (!isRecord(value) || typeof value.kind !== "string" || typeof value.reason !== "string" || typeof value.summary !== "string") return null
  if (value.kind === "cancel-request" || value.kind === "retry-step" || value.kind === "check-status") {
    return { kind: value.kind, reason: value.reason, summary: value.summary }
  }
  if (value.kind === "move-step" && typeof value.targetStepKey === "string" && typeof value.runAfterMove === "boolean") {
    return {
      kind: value.kind,
      targetStepKey: value.targetStepKey,
      runAfterMove: value.runAfterMove,
      reason: value.reason,
      summary: value.summary,
    }
  }
  return null
}

function displayTime(value: string | null | undefined) {
  if (!value) return "Unknown time"
  const date = new Date(value)
  if (!Number.isFinite(date.getTime())) return "Unknown time"
  return new Intl.DateTimeFormat("en", {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  }).format(date)
}

function fileSize(value: number) {
  if (!Number.isFinite(value) || value < 0) return "Unknown size"
  if (value < 1024) return `${value} B`
  if (value < 1024 * 1024) return `${Math.round(value / 1024)} KB`
  return `${(value / 1024 / 1024).toFixed(1)} MB`
}

function currentStep(review: RequestReview) {
  const key = review.workflowRun?.currentStepKey || review.changeRequest.currentWorkflowStepKey
  const steps = Array.isArray(review.workflow?.definition?.steps) ? review.workflow.definition.steps : []
  const step = steps.find((candidate) => candidate.key === key)
  return {
    key: key || null,
    label: typeof step?.label === "string" ? step.label : key || "Unknown phase",
    type: typeof step?.type === "string" ? step.type : "unknown",
  }
}

function workspaceState(review: RequestReview): WorkspaceState {
  const workflowStatus = review.workflowRun?.status.toLowerCase()
  if (workflowStatus === "completed" || workflowStatus === "canceled" || review.changeRequest.closedAt) return "completed"
  const active = review.agentRuns.find((run) => activeRunStatuses.has(run.status.toLowerCase()))
  const activeStatus = active?.status.toLowerCase()
  if (activeStatus === "queued" || activeStatus === "claimed") return "queued"
  if (activeStatus === "running") return "running"
  const attention = review.changeRequest.workflowAttention
  if (attention?.status === "blocked") return "blocked"
  if (attention) return "attention"
  const latest = review.agentRuns[0]
  const runStatus = latest?.status.toLowerCase()
  const step = currentStep(review)
  if (step.type === "checkpoint" && runStatus === "succeeded" && latest?.workflowStepKey === step.key) {
    return "checkpoint-passed"
  }
  if (runStatus && failedRunStatuses.has(runStatus)) return "failed"
  return "ready"
}

const statePresentation: Record<WorkspaceState, { label: string; description: string }> = {
  queued: { label: "Queued", description: "A run is waiting for workflow capacity." },
  running: { label: "Running", description: "An agent run is actively working on this request." },
  failed: { label: "Failed", description: "The latest run failed. Review its error and evidence before retrying." },
  blocked: { label: "Blocked", description: "The workflow reported a blocker that needs attention." },
  attention: { label: "Needs attention", description: "The workflow is waiting for operator review or additional context." },
  "checkpoint-passed": { label: "Checkpoint passed", description: "The latest checkpoint completed successfully. Review its receipt before continuing." },
  completed: { label: "Completed", description: "The workflow is in a terminal or closed state." },
  ready: { label: "Ready", description: "No active run or blocker is currently reported." },
}

function StateIcon({ state }: { state: WorkspaceState }) {
  if (state === "queued") return <Clock3 aria-hidden="true" />
  if (state === "running") return <Loader2 className="animate-spin" aria-hidden="true" />
  if (state === "failed") return <XCircle aria-hidden="true" />
  if (state === "blocked") return <ShieldAlert aria-hidden="true" />
  if (state === "attention") return <AlertCircle aria-hidden="true" />
  if (state === "checkpoint-passed" || state === "completed") return <CheckCircle2 aria-hidden="true" />
  return <Bot aria-hidden="true" />
}

function TechnicalSection({ summary, count, children }: { summary: string; count: number; children: React.ReactNode }) {
  return (
    <details className="group border-t border-border/60 first:border-t-0">
      <summary className="flex cursor-pointer list-none items-center justify-between gap-3 px-4 py-3 text-sm font-medium focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring">
        <span>{summary}</span>
        <span className="flex items-center gap-2 text-xs text-muted-foreground">
          {count}
          <ChevronDown className="h-4 w-4 transition-transform group-open:rotate-180" aria-hidden="true" />
        </span>
      </summary>
      <div className="border-t border-border/40 bg-background/35 px-4 py-3">{children}</div>
    </details>
  )
}

export function RequestWorkspace({
  request,
  backHref,
}: {
  request: LabRequestListItem
  backHref: string
}) {
  const [review, setReview] = useState<RequestReview | null>(null)
  const [loading, setLoading] = useState(true)
  const [refreshing, setRefreshing] = useState(false)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [mutationError, setMutationError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const [hasNewMessages, setHasNewMessages] = useState(false)
  const [draft, setDraft] = useState("")
  const [mutation, setMutation] = useState<MutationKind>(null)
  const [interruptionDialog, setInterruptionDialog] = useState<InterruptionDialog>(null)
  const [interruptionReason, setInterruptionReason] = useState("")
  const [targetStepKey, setTargetStepKey] = useState("")
  const [runAfterMove, setRunAfterMove] = useState(false)
  const uploadFormRef = useRef<HTMLFormElement>(null)
  const conversationRef = useRef<HTMLDivElement>(null)
  const conversationNearBottomRef = useRef(true)
  const revealLatestConversationRef = useRef(false)
  const conversationTrackerRef = useRef<{ requestId: string | null; lastMessageId: string | null }>({
    requestId: null,
    lastMessageId: null,
  })
  const mountedRef = useRef(true)
  const reviewScopeRef = useRef(createRequestReviewScope(request.id))
  const loadAbortControllerRef = useRef<AbortController | null>(null)

  // Update the scope during render so a response from the prior request is stale
  // before the next request's effect has a chance to run.
  reviewScopeRef.current = selectRequestReviewScope(reviewScopeRef.current, request.id)

  const loadReview = useCallback(async ({ quiet = false }: { quiet?: boolean } = {}) => {
    if (reviewScopeRef.current.requestId !== request.id) return
    const started = beginRequestReviewLoad(reviewScopeRef.current)
    reviewScopeRef.current = started.scope
    loadAbortControllerRef.current?.abort()
    const controller = new AbortController()
    loadAbortControllerRef.current = controller

    const isCurrent = () => (
      mountedRef.current
      && loadAbortControllerRef.current === controller
      && isCurrentRequestReviewLoad(reviewScopeRef.current, started.token)
    )

    if (!quiet) setRefreshing(true)
    try {
      const response = await fetch(`/admin/change-requests/${encodeURIComponent(request.id)}/review`, {
        cache: "no-store",
        headers: { accept: "application/json" },
        signal: controller.signal,
      })
      const payload = await response.json().catch(() => null)
      if (!response.ok) throw new Error(readableError(payload, `Request review failed with HTTP ${response.status}`))
      const parsed = parseReview(payload)
      if (!parsed) throw new Error("Request review returned an invalid response")
      if (isCurrent()) {
        setReview(parsed)
        setLoadError(null)
      }
    } catch (error) {
      if (isCurrent() && !(error instanceof DOMException && error.name === "AbortError")) {
        setLoadError(error instanceof Error ? error.message : "Request review failed")
      }
    } finally {
      if (isCurrent()) {
        setLoading(false)
        setRefreshing(false)
        loadAbortControllerRef.current = null
      }
    }
  }, [request.id])

  useEffect(() => {
    mountedRef.current = true
    setReview(null)
    setLoading(true)
    setRefreshing(false)
    setLoadError(null)
    setMutationError(null)
    setNotice(null)
    setHasNewMessages(false)
    setDraft("")
    setInterruptionDialog(null)
    setInterruptionReason("")
    setTargetStepKey("")
    setRunAfterMove(false)
    uploadFormRef.current?.reset()
    conversationNearBottomRef.current = true
    revealLatestConversationRef.current = false
    setMutation(null)
    void loadReview({ quiet: true })
    const interval = window.setInterval(() => void loadReview({ quiet: true }), 5_000)
    return () => {
      mountedRef.current = false
      window.clearInterval(interval)
      if (reviewScopeRef.current.requestId === request.id) {
        loadAbortControllerRef.current?.abort()
        loadAbortControllerRef.current = null
      }
    }
  }, [loadReview, request.id])

  const lastMessageId = review?.agentMessages.at(-1)?.id ?? null
  useLayoutEffect(() => {
    if (!review) return
    const decision = decideConversationViewportUpdate(conversationTrackerRef.current, {
      requestId: request.id,
      lastMessageId,
      nearBottom: conversationNearBottomRef.current,
      revealLatest: revealLatestConversationRef.current,
    })
    conversationTrackerRef.current = decision.next
    revealLatestConversationRef.current = false
    if (decision.scrollToLatest && conversationRef.current) {
      conversationRef.current.scrollTop = conversationRef.current.scrollHeight
      conversationNearBottomRef.current = true
      setHasNewMessages(false)
    } else if (decision.showNewMessages) {
      setHasNewMessages(true)
    }
  }, [lastMessageId, request.id, review])

  const step = useMemo(() => review ? currentStep(review) : null, [review])
  const timeline = useMemo(() => review ? buildRequestTimeline({
    messages: review.agentMessages,
    runs: review.agentRuns,
    artifacts: review.artifacts,
    events: review.workflowEvents,
    externalRefs: review.externalRefs,
  }) : [], [review])
  const workflowExplorer = useMemo(() => review ? buildWorkflowExplorer({
    definition: review.workflow?.definition as Record<string, unknown> | undefined,
    currentStepKey: review.workflowRun?.currentStepKey || review.changeRequest.currentWorkflowStepKey,
    events: review.workflowEvents,
  }) : [], [review])
  const managementSteps = useMemo<RequestManagementStep[]>(() => {
    const steps = review?.workflow?.definition?.steps
    if (!Array.isArray(steps)) return []
    return steps.flatMap((candidate): RequestManagementStep[] => {
      const key = typeof candidate.key === "string" ? candidate.key.trim() : ""
      if (!key) return []
      return [{
        key,
        label: typeof candidate.label === "string" && candidate.label.trim() ? candidate.label.trim() : key,
        type: typeof candidate.type === "string" ? candidate.type : "unknown",
      }]
    })
  }, [review])
  const state = review ? workspaceState(review) : null
  const activeAgentRun = review?.agentRuns.find((run) => activeRunStatuses.has(run.status.toLowerCase())) ?? null
  const activeRun = Boolean(activeAgentRun)
  const participatingAgents = useMemo(() => {
    const profiles = new Map<string, { key: string | null; name: string }>()
    for (const run of review?.agentRuns ?? []) {
      if (!run.agentProfileId || !run.agentProfileName) continue
      profiles.set(run.agentProfileId, { key: run.agentProfileKey ?? null, name: run.agentProfileName })
    }
    return [...profiles.values()]
  }, [review])
  const currentExecutor = review?.agentRuns.find((run) => activeRunStatuses.has(run.status.toLowerCase()) && run.agentProfileName)
    ?? review?.agentRuns.find((run) => run.agentProfileName)
  const terminal = state === "completed"
  const attention = review?.changeRequest.workflowAttention ?? null
  const canComment = review?.capabilities.canComment === true
  const canViewRequests = review?.capabilities.canViewRequests === true
  const canRun = review?.capabilities.canRunAgent === true
  const canInvoke = canRun && !activeRun && !terminal && !attention && Boolean(step && ["gate", "agent", "checkpoint", "loop"].includes(step.type))
  const canRetry = canRun && !activeRun && !terminal && Boolean(step && ["agent", "checkpoint", "loop"].includes(step.type))
  const canCheckStatus = canRun && !activeRun && !terminal && step?.type === "checkpoint"
  const invokeLabel = step?.type === "gate"
    ? "Continue gate"
    : step?.type === "checkpoint"
      ? "Check status"
      : "Run current step"

  async function mutate(
    kind: Exclude<MutationKind, null>,
    action: () => Promise<Response>,
    successMessage: string,
    options: { revealConversation?: boolean; onSuccess?: (payload: unknown) => void } = {},
  ) {
    const mutationScope = captureRequestReviewScope(reviewScopeRef.current)
    const isCurrent = () => mountedRef.current && isCurrentRequestReviewScope(reviewScopeRef.current, mutationScope)
    setMutation(kind)
    setMutationError(null)
    setNotice(null)
    try {
      const response = await action()
      const payload = await response.json().catch(() => null)
      if (!isCurrent()) return false
      if (!response.ok) throw new Error(readableError(payload, `Operation failed with HTTP ${response.status}`))
      setNotice(successMessage)
      options.onSuccess?.(payload)
      if (options.revealConversation) revealLatestConversationRef.current = true
      await loadReview({ quiet: true })
      return true
    } catch (error) {
      if (isCurrent()) {
        setMutationError(error instanceof Error ? error.message : "Operation failed")
        await loadReview({ quiet: true })
      }
      return false
    } finally {
      if (isCurrent()) setMutation(null)
    }
  }

  async function askPrism() {
    const content = draft.trim()
    if (!content || !review || !canRun) return
    setMutationError(null)
    setNotice(null)
    const managementIntent = resolveRequestManagementIntent(content, managementSteps)
    if (managementIntent?.kind === "cancel-request" && !terminal) {
      setInterruptionReason(content)
      setInterruptionDialog("cancel-request")
      return
    }
    if (managementIntent?.kind === "retry-step" && !terminal) {
      if (!canRetry) {
        setMutationError(
          activeRun
            ? "The current step already has an active run. Stop it before retrying."
            : "The current workflow step cannot be retried.",
        )
        return
      }
      setInterruptionReason(content)
      setInterruptionDialog("retry-step")
      return
    }
    if (managementIntent?.kind === "check-status" && step?.type === "checkpoint" && !terminal) {
      if (!canCheckStatus) {
        setMutationError(activeRun ? "A status check is already running." : "The current checkpoint cannot be checked.")
        return
      }
      setInterruptionReason(content)
      setInterruptionDialog("check-status")
      return
    }
    if (managementIntent?.kind === "move-step" && !terminal) {
      setTargetStepKey(managementIntent.targetStepKey)
      setRunAfterMove(managementIntent.runAfterMove)
      setInterruptionReason(content)
      setInterruptionDialog("move-step")
      return
    }
    const proposalResult: { value: RequestActionProposal | null } = { value: null }
    const succeeded = await mutate(
      "ask",
      () => fetch(`/admin/change-requests/${encodeURIComponent(request.id)}/ask`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ question: content }),
      }),
      "Prism answered in the durable request conversation.",
      {
        revealConversation: true,
        onSuccess: (payload) => {
          proposalResult.value = isRecord(payload) ? requestActionProposal(payload.proposedAction) : null
        },
      },
    )
    if (succeeded) {
      setDraft("")
      const proposedAction = proposalResult.value
      if (!proposedAction) return
      setInterruptionReason(proposedAction.reason)
      if (proposedAction.kind === "cancel-request" && !terminal) {
        setInterruptionDialog("cancel-request")
      } else if (proposedAction.kind === "retry-step" && canRetry) {
        setInterruptionDialog("retry-step")
      } else if (proposedAction.kind === "check-status" && canCheckStatus) {
        setInterruptionDialog("check-status")
      } else if (proposedAction.kind === "move-step" && !terminal && !activeRun) {
        const validTarget = managementSteps.some((candidate) => candidate.key === proposedAction.targetStepKey && candidate.type !== "terminal")
        if (validTarget) {
          setTargetStepKey(proposedAction.targetStepKey)
          setRunAfterMove(proposedAction.runAfterMove)
          setInterruptionDialog("move-step")
        }
      }
    }
  }

  async function addContext() {
    const content = draft.trim()
    if (!content || !canComment) return
    const succeeded = await mutate(
      "comment",
      () => fetch(`/admin/change-requests/${encodeURIComponent(request.id)}/comments`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ content }),
      }),
      "Context added to the durable request history.",
      { revealConversation: true },
    )
    if (succeeded) setDraft("")
  }

  async function invokeCurrentStep() {
    if (!canInvoke) return
    const content = draft.trim()
    const succeeded = await mutate(
      "continue",
      () => fetch(`/admin/change-requests/${encodeURIComponent(request.id)}/workflow/continue`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(content ? { comment: content } : {}),
      }),
      step?.type === "gate" ? "Gate continuation accepted." : "Current-step run accepted.",
    )
    if (succeeded && content) setDraft("")
  }

  async function retryCurrentStep() {
    const reason = interruptionReason.trim()
    if (!reason || !canRetry) return
    const succeeded = await mutate(
      "continue",
      async () => {
        const commentResponse = await fetch(`/admin/change-requests/${encodeURIComponent(request.id)}/comments`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ content: reason }),
        })
        if (!commentResponse.ok) return commentResponse
        return fetch(`/admin/change-requests/${encodeURIComponent(request.id)}/workflow/continue`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ comment: reason, retryCurrentStep: true }),
        })
      },
      interruptionDialog === "check-status" ? "Checkpoint status check accepted." : "Current-step retry accepted.",
      { revealConversation: true },
    )
    if (succeeded) {
      setInterruptionDialog(null)
      setInterruptionReason("")
      setDraft("")
    }
  }

  async function stopCurrentRun() {
    const reason = interruptionReason.trim()
    if (!activeAgentRun || !reason || !canRun) return
    const succeeded = await mutate(
      "stop-run",
      () => fetch(
        `/admin/change-requests/${encodeURIComponent(request.id)}/runs/${encodeURIComponent(activeAgentRun.id)}/cancel`,
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ reason }),
        },
      ),
      "Current agent run stopped. The request remains on the same workflow step.",
    )
    if (succeeded) {
      setInterruptionDialog(null)
      setInterruptionReason("")
    }
  }

  async function cancelRequest() {
    const reason = interruptionReason.trim()
    if (!reason || !canRun || terminal) return
    const succeeded = await mutate(
      "cancel-request",
      () => fetch(`/admin/change-requests/${encodeURIComponent(request.id)}/workflow/cancel`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ comment: reason }),
      }),
      "Request canceled. Active work has been stopped and the workflow is closed.",
    )
    if (succeeded) {
      setInterruptionDialog(null)
      setInterruptionReason("")
      setDraft("")
    }
  }

  async function moveRequest() {
    const reason = interruptionReason.trim()
    if (!reason || !targetStepKey || !canRun || terminal || activeRun) return
    const targetLabel = managementSteps.find((candidate) => candidate.key === targetStepKey)?.label ?? targetStepKey
    const shouldRun = runAfterMove
    const succeeded = await mutate(
      "move-step",
      async () => {
        const moveResponse = await fetch(`/admin/change-requests/${encodeURIComponent(request.id)}/workflow/step`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ targetStepKey, reason }),
        })
        if (!moveResponse.ok || !shouldRun) return moveResponse
        const runResponse = await fetch(`/admin/change-requests/${encodeURIComponent(request.id)}/workflow/continue`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ comment: reason }),
        })
        if (runResponse.ok) return runResponse
        const payload = await runResponse.json().catch(() => null)
        return new Response(JSON.stringify({
          error: `Request moved to ${targetLabel}, but the run could not be started: ${readableError(payload, `HTTP ${runResponse.status}`)}`,
        }), {
          status: runResponse.status,
          headers: { "content-type": "application/json" },
        })
      },
      shouldRun ? `Request moved to ${targetLabel} and its step run was accepted.` : `Request moved to ${targetLabel}.`,
      { revealConversation: true },
    )
    if (succeeded) {
      setInterruptionDialog(null)
      setInterruptionReason("")
      setTargetStepKey("")
      setRunAfterMove(false)
      setDraft("")
    }
  }

  async function uploadArtifact(formData: FormData) {
    if (!canComment) return
    const file = formData.get("file")
    if (!(file instanceof File) || file.size <= 0) {
      setMutationError("Choose a non-empty file to upload")
      return
    }
    const succeeded = await mutate(
      "upload",
      () => fetch(`/admin/change-requests/${encodeURIComponent(request.id)}/artifacts/upload`, {
        method: "POST",
        body: formData,
      }),
      `${file.name} was attached as request context.`,
    )
    if (succeeded) uploadFormRef.current?.reset()
  }

  return (
    <div className="min-w-0 p-4 sm:p-6">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <Link href={backHref} className={buttonVariants({ variant: "ghost", size: "sm" })}>
          <ArrowLeft aria-hidden="true" />
          Back to inbox
        </Link>
        <div className="flex flex-wrap items-center justify-end gap-2">
          {review && canRun && !terminal ? (
            <>
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => {
                  const firstAlternative = managementSteps.find((candidate) => (
                    candidate.type !== "terminal" && candidate.key !== step?.key
                  ))
                  setTargetStepKey(firstAlternative?.key ?? "")
                  setRunAfterMove(false)
                  setInterruptionReason("Move this request to another workflow step for operator review.")
                  setInterruptionDialog("move-step")
                }}
                disabled={mutation !== null || activeRun || !managementSteps.some((candidate) => candidate.type !== "terminal" && candidate.key !== step?.key)}
                title={activeRun ? "Stop the active run before moving the request" : undefined}
              >
                <ArrowRightLeft aria-hidden="true" />
                Move request
              </Button>
              <Button
                type="button"
                variant="destructive"
                size="sm"
                onClick={() => {
                  setInterruptionReason("Cancel this request because it should no longer continue.")
                  setInterruptionDialog("cancel-request")
                }}
                disabled={mutation !== null}
              >
                <XCircle aria-hidden="true" />
                Cancel request
              </Button>
            </>
          ) : null}
          <Button type="button" variant="ghost" size="sm" onClick={() => void loadReview()} disabled={refreshing}>
            <RefreshCw className={cn(refreshing && "animate-spin")} aria-hidden="true" />
            Refresh
          </Button>
        </div>
      </div>

      <header className="mt-4 border-b border-border/60 pb-5">
        <div className="flex flex-wrap items-center gap-2">
          <Badge variant="outline" className="font-mono">#{request.requestNumber}</Badge>
          <Badge variant="muted">{request.source.label}</Badge>
          {request.origin?.targetId ? <Badge variant="outline">{request.origin.targetName || request.origin.targetId}</Badge> : null}
          {request.origin?.interactionProfileKey ? <Badge variant="outline">Profile · {request.origin.interactionProfileKey}</Badge> : null}
          {state ? (
          <Badge variant={state === "failed" || state === "blocked" ? "destructive" : "outline"} className="gap-1">
              <StateIcon state={state} />
              {statePresentation[state].label}
            </Badge>
          ) : null}
        </div>
        <h2 className="mt-3 text-2xl font-semibold tracking-tight">{request.title}</h2>
        <p className="mt-2 text-sm leading-6 text-muted-foreground">{request.description || "No request description was provided."}</p>
        <dl className="mt-4 grid gap-2 text-xs text-muted-foreground sm:grid-cols-2">
          <div><dt className="font-medium text-foreground">Initiator</dt><dd>{request.requestedByDisplayName || "Unknown initiator"}</dd></div>
          <div><dt className="font-medium text-foreground">Origin snapshot</dt><dd>{request.origin ? `${request.origin.platform} · ${request.origin.backfillStatus}` : "Unavailable · historical origin unknown"}</dd></div>
        </dl>
      </header>

      {loading && !review ? (
        <div className="flex min-h-72 items-center justify-center" role="status">
          <Loader2 className="mr-2 h-5 w-5 animate-spin text-primary" aria-hidden="true" />
          Loading live request review…
        </div>
      ) : null}

      {loadError && !review ? (
        <div className="my-6 border border-destructive/40 bg-destructive/5 p-5" role="alert">
          <AlertCircle className="h-5 w-5 text-destructive" aria-hidden="true" />
          <h3 className="mt-3 font-semibold">Live request review unavailable</h3>
          <p className="mt-2 text-sm text-muted-foreground">{loadError}</p>
          <Button type="button" variant="outline" size="sm" className="mt-4" onClick={() => void loadReview()}>Try again</Button>
        </div>
      ) : null}

      {review && state && step ? (
        <>
          <section aria-labelledby="request-now-heading" className="mt-5 border border-border/60 bg-card/40 p-4">
            <div className="flex items-start gap-3">
              <div className={cn(
                "mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-full",
                state === "failed" || state === "blocked" ? "bg-destructive/10 text-destructive" : "bg-primary/10 text-primary",
              )}>
                <StateIcon state={state} />
              </div>
              <div className="min-w-0">
                <h3 id="request-now-heading" className="font-semibold">What is happening now</h3>
                <p className="mt-1 text-sm leading-6 text-muted-foreground">{statePresentation[state].description}</p>
                <dl className="mt-3 grid gap-2 text-sm sm:grid-cols-2">
                  <div className="flex items-center gap-2"><GitBranch aria-hidden="true" /><dt className="sr-only">Current phase</dt><dd>{step.label} · {step.type}</dd></div>
                  <div className="flex items-center gap-2"><TerminalSquare aria-hidden="true" /><dt className="sr-only">Runs</dt><dd>{review.agentRuns.length} recorded run{review.agentRuns.length === 1 ? "" : "s"}</dd></div>
                  <div className="flex items-center gap-2"><Bot aria-hidden="true" /><dt className="sr-only">Current executor</dt><dd>{currentExecutor?.agentProfileName ? <>Executor · {currentExecutor.agentProfileKey ? <Link className="underline" href={`/admin/lab/agents/${encodeURIComponent(currentExecutor.agentProfileKey)}`}>{currentExecutor.agentProfileName}</Link> : currentExecutor.agentProfileName}{currentExecutor.executionMode ? ` · ${currentExecutor.executionMode}` : ""}</> : "Executor · Legacy / unattributed"}</dd></div>
                  <div className="flex items-center gap-2"><UsersRound aria-hidden="true" /><dt className="sr-only">Participating agents</dt><dd>{participatingAgents.length ? <>Participants · {participatingAgents.map((profile, index) => <span key={profile.key || profile.name}>{index ? ", " : ""}{profile.key ? <Link className="underline" href={`/admin/lab/agents/${encodeURIComponent(profile.key)}`}>{profile.name}</Link> : profile.name}</span>)}</> : "Participants · Legacy / unattributed"}</dd></div>
                </dl>
                {activeAgentRun && canRun ? (
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    className="mt-4 border-destructive/50 text-destructive hover:bg-destructive/10 hover:text-destructive"
                    onClick={() => {
                      setInterruptionReason("Stop this run so I can review the request before retrying.")
                      setInterruptionDialog("stop-run")
                    }}
                    disabled={mutation !== null}
                  >
                    <XCircle aria-hidden="true" />
                    Stop current run
                  </Button>
                ) : null}
              </div>
            </div>
            {attention ? (
              <div className="mt-4 border-l-2 border-destructive pl-4">
                <p className="text-sm font-semibold">
                  {activeRun ? "Previous blocker is being retried" : attention.summary || "Workflow needs attention"}
                </p>
                {activeRun && attention.summary ? <p className="mt-1 text-sm text-muted-foreground">Previous blocker: {attention.summary}</p> : null}
                {attention.suggestedFix ? <p className="mt-1 text-sm text-muted-foreground">{activeRun ? "Applied recovery guidance" : "Suggested fix"}: {attention.suggestedFix}</p> : null}
                {attention.blockers.length ? (
                  <ul className="mt-2 list-disc space-y-1 pl-5 text-sm text-muted-foreground">
                    {attention.blockers.map((blocker, index) => <li key={blocker.key || index}>{blocker.summary || blocker.key || "Unspecified blocker"}</li>)}
                  </ul>
                ) : null}
              </div>
            ) : null}
          </section>

          <div className="mt-4 min-h-6" aria-live="polite">
            {mutationError ? <p className="flex items-center gap-2 text-sm text-destructive" role="alert"><AlertCircle aria-hidden="true" />{mutationError}</p> : null}
            {notice ? <p className="flex items-center gap-2 text-sm text-primary"><CheckCircle2 aria-hidden="true" />{notice}</p> : null}
            {loadError && review ? <p className="text-xs text-muted-foreground">Background refresh failed: {loadError}</p> : null}
          </div>

          <Tabs defaultValue="conversation" className="mt-3">
            <TabsList className="h-auto w-full justify-start overflow-x-auto rounded-none border-b border-border/60 bg-transparent p-0">
              <TabsTrigger value="conversation" className="rounded-none border-b-2 border-transparent px-4 py-3 data-[state=active]:border-primary data-[state=active]:bg-transparent">Conversation</TabsTrigger>
              <TabsTrigger value="workflow" className="rounded-none border-b-2 border-transparent px-4 py-3 data-[state=active]:border-primary data-[state=active]:bg-transparent">Workflow</TabsTrigger>
              <TabsTrigger value="activity" className="rounded-none border-b-2 border-transparent px-4 py-3 data-[state=active]:border-primary data-[state=active]:bg-transparent">Activity</TabsTrigger>
              <TabsTrigger value="evidence" className="rounded-none border-b-2 border-transparent px-4 py-3 data-[state=active]:border-primary data-[state=active]:bg-transparent">Evidence</TabsTrigger>
            </TabsList>

            <TabsContent value="conversation" className="mt-0 pt-5">
          <section aria-labelledby="conversation-heading">
            <div className="flex items-end justify-between gap-3">
              <div>
                <h3 id="conversation-heading" className="text-lg font-semibold">Request conversation</h3>
                <p className="text-xs text-muted-foreground">Durable messages linked to this request</p>
              </div>
              <Badge variant="muted">{review.agentMessages.length} messages</Badge>
            </div>

            <div
              ref={conversationRef}
              className="mt-3 max-h-[32rem] min-h-52 overflow-y-auto border border-border/60 bg-background/45 p-3"
              aria-live="polite"
              onScroll={(event) => {
                const element = event.currentTarget
                const nearBottom = element.scrollHeight - element.scrollTop - element.clientHeight <= 64
                conversationNearBottomRef.current = nearBottom
                if (nearBottom) setHasNewMessages(false)
              }}
            >
              {review.agentMessages.length ? (
                <ol className="space-y-3">
                  {review.agentMessages.map((message) => {
                    const fromOperator = message.role === "user"
                    const actorLabel = message.actor?.displayName
                      ?? message.actor?.handle
                      ?? (message.actor?.kind === "site-user"
                        ? "Signed-in user"
                        : message.actor?.kind === "external"
                          ? "External participant"
                          : "Operator")
                    return (
                      <li key={message.id} className={cn("flex", fromOperator ? "justify-end" : "justify-start")}>
                        <article className={cn("max-w-[92%] border px-3 py-2 text-sm sm:max-w-[82%]", fromOperator ? "border-primary/30 bg-primary/8" : "border-border/60 bg-card/70")}>
                          <div className="flex items-center gap-2 text-[0.6875rem] font-medium uppercase tracking-wide text-muted-foreground">
                            {fromOperator ? <UserRound aria-hidden="true" /> : <Bot aria-hidden="true" />}
                            <span title={fromOperator && message.actor?.id ? `Actor ID: ${message.actor.id}` : undefined}>
                              {fromOperator ? actorLabel : "Prism"}
                              {fromOperator && message.actor?.handle && message.actor.handle !== actorLabel
                                ? ` · @${message.actor.handle}`
                                : ""}
                              {fromOperator && message.actor?.basis === "session-owner"
                                ? " · session owner"
                                : ""}
                            </span>
                            <span>·</span>
                            <time dateTime={message.createdAt}>{displayTime(message.createdAt)}</time>
                          </div>
                          <p className="mt-1 whitespace-pre-wrap leading-6">{message.content}</p>
                        </article>
                      </li>
                    )
                  })}
                </ol>
              ) : (
                <div className="flex min-h-44 flex-col items-center justify-center px-5 text-center">
                  <MessageSquareText className="h-6 w-6 text-muted-foreground" aria-hidden="true" />
                  <p className="mt-3 text-sm font-medium">No request conversation yet</p>
                  <p className="mt-1 text-xs text-muted-foreground">Ask Prism a grounded question or add operator context below.</p>
                </div>
              )}
            </div>
            {hasNewMessages ? (
              <div className="mt-2 flex justify-center" aria-live="polite">
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={() => {
                    if (conversationRef.current) {
                      conversationRef.current.scrollTop = conversationRef.current.scrollHeight
                      conversationNearBottomRef.current = true
                    }
                    setHasNewMessages(false)
                  }}
                >
                  New messages · Jump to latest
                </Button>
              </div>
            ) : null}

            <div className="mt-3 border border-border/60 bg-card/45 p-3">
              <label htmlFor="request-message" className="text-xs font-medium text-muted-foreground">Message or operator context</label>
              <Textarea
                id="request-message"
                value={draft}
                onChange={(event) => setDraft(event.target.value)}
                placeholder={step.type === "checkpoint"
                  ? "Ask about this request, or say “check status” to run this checkpoint…"
                  : "Ask what is blocking this request, or say “move back to Work” or “cancel this request”…"}
                rows={4}
                className="mt-2 resize-y bg-background"
                disabled={mutation !== null}
              />
              <div className="mt-3 flex flex-wrap gap-2">
                <Button type="button" size="sm" onClick={() => void askPrism()} disabled={!draft.trim() || !canRun || mutation !== null}>
                  {mutation === "ask" ? <Loader2 className="animate-spin" aria-hidden="true" /> : <Send aria-hidden="true" />}
                  Ask Prism
                </Button>
                <Button type="button" variant="outline" size="sm" onClick={() => void addContext()} disabled={!draft.trim() || !canComment || mutation !== null}>
                  {mutation === "comment" ? <Loader2 className="animate-spin" aria-hidden="true" /> : <MessageSquareText aria-hidden="true" />}
                  Add context only
                </Button>
                <Button type="button" variant="secondary" size="sm" onClick={() => void invokeCurrentStep()} disabled={!canInvoke || mutation !== null} title={!canInvoke ? "Current request state does not permit this action" : undefined}>
                  {mutation === "continue" ? <Loader2 className="animate-spin" aria-hidden="true" /> : <Play aria-hidden="true" />}
                  {invokeLabel}
                </Button>
              </div>
              {!canRun || !canComment ? (
                <p className="mt-3 text-xs text-muted-foreground">
                  Available controls reflect your live request capabilities. Disabled operations are not sent to the server.
                </p>
              ) : null}
              {canRun ? (
                <p className="mt-3 text-xs text-muted-foreground">
                  Move, cancel, retry, and checkpoint commands use confirmed, audited request controls. Other messages ask Prism for analysis.
                </p>
              ) : null}
            </div>
          </section>

          <section aria-labelledby="attachment-heading" className="mt-5 border border-border/60 bg-card/35 p-4">
            <div className="flex items-start gap-3">
              <Paperclip className="mt-0.5 h-5 w-5 text-primary" aria-hidden="true" />
              <div className="min-w-0 flex-1">
                <h3 id="attachment-heading" className="font-semibold">Attach context</h3>
                <p className="mt-1 text-xs text-muted-foreground">Files are saved as request artifacts and remain visible in technical evidence.</p>
                <form ref={uploadFormRef} action={uploadArtifact} className="mt-3 flex flex-col gap-2 sm:flex-row">
                  <input
                    type="file"
                    name="file"
                    required
                    disabled={!canComment || mutation !== null}
                    className="min-w-0 flex-1 text-sm file:mr-3 file:rounded-md file:border file:border-input file:bg-background file:px-3 file:py-1.5 file:text-xs file:font-medium"
                  />
                  <Button type="submit" variant="outline" size="sm" disabled={!canComment || mutation !== null}>
                    {mutation === "upload" ? <Loader2 className="animate-spin" aria-hidden="true" /> : <Upload aria-hidden="true" />}
                    Upload
                  </Button>
                </form>
              </div>
            </div>
          </section>
            </TabsContent>

            <TabsContent value="workflow" className="mt-0 pt-5">
          <WorkflowExplorer
            workflowName={review.workflow?.name || review.workflow?.key || request.workflowKey}
            workflowStatus={review.workflowRun?.status ?? null}
            steps={workflowExplorer}
          />
            </TabsContent>

            <TabsContent value="activity" className="mt-0 pt-5">
          <RequestTimeline
            requestId={request.id}
            items={timeline}
            canViewArtifacts={canViewRequests}
          />
            </TabsContent>

            <TabsContent value="evidence" className="mt-0 pt-5">
          <section aria-labelledby="technical-heading" className="border border-border/60 bg-card/30">
            <div className="flex items-center justify-between gap-3 px-4 py-3">
              <div>
                <h3 id="technical-heading" className="font-semibold">Technical evidence</h3>
                <p className="text-xs text-muted-foreground">Secondary request artifacts, events, references, and run detail</p>
              </div>
              <Badge variant="muted">Live</Badge>
            </div>
            <TechnicalSection summary="Artifacts" count={review.artifacts.length}>
              {review.artifacts.length ? <ul className="space-y-3">{review.artifacts.map((artifact) => (
                <li key={artifact.id} className="flex items-start justify-between gap-3 text-sm">
                  <div className="min-w-0"><p className="truncate font-medium">{artifact.name}</p><p className="text-xs text-muted-foreground">{artifact.kind} · {fileSize(artifact.sizeBytes)} · {displayTime(artifact.createdAt)}</p></div>
                  {canViewRequests ? <a href={`/admin/change-requests/${encodeURIComponent(request.id)}/artifacts/${encodeURIComponent(artifact.id)}/content`} className={buttonVariants({ variant: "ghost", size: "sm" })}><FileText aria-hidden="true" /><span className="sr-only">Open {artifact.name}</span></a> : null}
                </li>
              ))}</ul> : <p className="text-sm text-muted-foreground">No artifacts recorded.</p>}
            </TechnicalSection>
            <TechnicalSection summary="Workflow events" count={review.workflowEvents.length}>
              {review.workflowEvents.length ? <ol className="space-y-3">{review.workflowEvents.slice(0, 50).map((event) => (
                <li key={event.id} className="border-l border-border pl-3 text-sm"><p className="font-medium">{event.eventType}</p><p className="text-xs text-muted-foreground">{event.stepKey || "No step"} · {event.actorType} · {displayTime(event.createdAt)}</p>{event.note ? <p className="mt-1 whitespace-pre-wrap text-xs">{event.note}</p> : null}</li>
              ))}</ol> : <p className="text-sm text-muted-foreground">No workflow events recorded.</p>}
            </TechnicalSection>
            <TechnicalSection summary="External references" count={review.externalRefs.length}>
              {review.externalRefs.length ? <ul className="space-y-2">{review.externalRefs.map((ref) => (
                <li key={ref.id}><a href={ref.url} target="_blank" rel="noreferrer" className="flex items-center justify-between gap-3 text-sm text-primary hover:underline"><span className="truncate">{ref.title || `${ref.provider} ${ref.kind}`}</span><ExternalLink aria-hidden="true" /></a></li>
              ))}</ul> : <p className="text-sm text-muted-foreground">No external references recorded.</p>}
            </TechnicalSection>
            <TechnicalSection summary="Agent runs" count={review.agentRuns.length}>
              {review.agentRuns.length ? <ol className="space-y-3">{review.agentRuns.slice(0, 30).map((run) => (
                <li key={run.id} className="text-sm">
                  <div className="flex flex-wrap items-center gap-2"><Badge variant={failedRunStatuses.has(run.status.toLowerCase()) ? "destructive" : "outline"}>{run.status}</Badge><span className="font-mono text-xs">{run.workflowStepKey || run.kind}</span>{run.agentProfileName ? <span className="text-xs">{run.agentProfileKey ? <Link className="underline" href={`/admin/lab/agents/${encodeURIComponent(run.agentProfileKey)}`}>{run.agentProfileName}</Link> : run.agentProfileName}{run.executionMode ? ` · ${run.executionMode}` : ""}</span> : <span className="text-xs text-muted-foreground">Legacy / unattributed</span>}</div>
                  <p className="mt-1 text-xs text-muted-foreground">Queued {displayTime(run.queuedAt)}{run.finishedAt ? ` · finished ${displayTime(run.finishedAt)}` : ""}</p>
                  {run.errorMessage ? <p className="mt-1 text-xs text-destructive">{run.errorMessage}</p> : null}
                  <details className="mt-2">
                    <summary className="cursor-pointer text-xs font-medium text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">Raw run detail</summary>
                    <pre className="mt-2 max-h-72 overflow-auto whitespace-pre-wrap break-words bg-code-surface p-3 text-[0.6875rem] text-code-surface-foreground">{JSON.stringify({ result: run.result, trace: run.trace }, null, 2)}</pre>
                  </details>
                </li>
              ))}</ol> : <p className="text-sm text-muted-foreground">No agent runs recorded.</p>}
            </TechnicalSection>
          </section>
            </TabsContent>
          </Tabs>
        </>
      ) : null}

      <Dialog
        open={interruptionDialog !== null}
        onOpenChange={(open) => {
          if (!open && mutation === null) {
            setInterruptionDialog(null)
            setInterruptionReason("")
            setTargetStepKey("")
            setRunAfterMove(false)
          }
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>
              {interruptionDialog === "stop-run"
                ? "Stop current run"
                : interruptionDialog === "check-status"
                  ? "Check current status"
                : interruptionDialog === "retry-step"
                  ? "Retry current step"
                  : interruptionDialog === "move-step"
                    ? runAfterMove ? "Move and run request" : "Move request"
                    : "Cancel request"}
            </DialogTitle>
            <DialogDescription>
              {interruptionDialog === "stop-run"
                ? "This stops the active agent run but keeps the request open on its current workflow step. You can add context and retry afterward."
                : interruptionDialog === "check-status"
                  ? "This records your request and runs the current checkpoint through the audited workflow runner without advancing first."
                : interruptionDialog === "retry-step"
                  ? "This records your instruction in the request conversation and queues the current workflow step again through the audited workflow runner."
                  : interruptionDialog === "move-step"
                    ? runAfterMove
                      ? "This moves the request to the selected step, records your reason, and starts that step through the audited workflow runner. Skipped steps are not run."
                      : "This changes the current workflow step without running skipped steps. The change and your reason are recorded in request history."
                    : "This stops active work, closes the workflow, and marks the request canceled. Reopening requires a separate audited action."}
            </DialogDescription>
          </DialogHeader>
          {interruptionDialog === "move-step" ? (
            <div className="space-y-2">
              <Label htmlFor="request-target-step">Target workflow step</Label>
              <Select value={targetStepKey} onValueChange={setTargetStepKey} disabled={mutation !== null}>
                <SelectTrigger id="request-target-step">
                  <SelectValue placeholder="Select a workflow step" />
                </SelectTrigger>
                <SelectContent>
                  {managementSteps.filter((candidate) => candidate.type !== "terminal").map((candidate) => (
                    <SelectItem key={candidate.key} value={candidate.key} disabled={candidate.key === step?.key}>
                      {candidate.label} · {candidate.type}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          ) : null}
          <div className="space-y-2">
            <Label htmlFor="request-interruption-reason">Reason</Label>
            <Textarea
              id="request-interruption-reason"
              value={interruptionReason}
              onChange={(event) => setInterruptionReason(event.target.value)}
              rows={4}
              disabled={mutation !== null}
              placeholder="Explain why this action is needed."
            />
          </div>
          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              onClick={() => {
                setInterruptionDialog(null)
                setInterruptionReason("")
                setTargetStepKey("")
                setRunAfterMove(false)
              }}
              disabled={mutation !== null}
            >
              Keep working
            </Button>
            <Button
              type="button"
              variant={interruptionDialog === "move-step" || interruptionDialog === "retry-step" ? "default" : "destructive"}
              onClick={() => void (
                interruptionDialog === "stop-run"
                  ? stopCurrentRun()
                  : interruptionDialog === "retry-step" || interruptionDialog === "check-status"
                    ? retryCurrentStep()
                    : interruptionDialog === "move-step"
                      ? moveRequest()
                      : cancelRequest()
              )}
              disabled={
                !interruptionReason.trim()
                || mutation !== null
                || (interruptionDialog === "move-step" && (!targetStepKey || targetStepKey === step?.key || activeRun))
                || (interruptionDialog === "retry-step" && !canRetry)
                || (interruptionDialog === "check-status" && !canCheckStatus)
              }
            >
              {mutation === "stop-run" || mutation === "cancel-request" || mutation === "move-step" || mutation === "continue" ? (
                <Loader2 className="animate-spin" aria-hidden="true" />
              ) : interruptionDialog === "move-step" ? (
                <ArrowRightLeft aria-hidden="true" />
              ) : interruptionDialog === "retry-step" || interruptionDialog === "check-status" ? (
                <Play aria-hidden="true" />
              ) : (
                <XCircle aria-hidden="true" />
              )}
              {interruptionDialog === "stop-run"
                ? "Stop current run"
                : interruptionDialog === "check-status"
                  ? "Check status"
                : interruptionDialog === "retry-step"
                  ? "Retry current step"
                : interruptionDialog === "move-step"
                  ? runAfterMove ? "Move and run" : "Move request"
                  : "Cancel request"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
