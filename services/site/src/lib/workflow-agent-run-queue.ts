import type { ChangeRequestRecord } from "@/lib/app-core"
import {
  claimNextQueuedAgentRun,
  countRunningAgentRuns,
  createAgentRun,
  createAgentSession,
  createWorkflowEvent,
  ensureWorkflowRunForRequest,
  expireStaleRunningAgentRuns,
  findActiveAgentRunByIdempotencyKey,
  getChangeRequest,
  getAgentRun,
  getWorkflowByKey,
  updateAgentRun,
  updateChangeRequest,
  updateWorkflowRun,
  assignAgentProfileToSession,
  workflowAgentExecutor,
  buildAccountabilitySnapshot,
  type AgentRunRecord,
} from "@/lib/app-core"
import { handleResponsePost } from "@/lib/response-route-handler"
import { loopIterationKeyForRequest, resolveControlFlowSteps } from "@/lib/workflow-control-flow"
import { findStepByKey, gateEventAction, nextStepForAction, stepKey, stepType, workflowSteps } from "@/lib/workflow-steps"
import { buildWorkflowAgentRunPrompt } from "@/lib/workflow-agent-run-prompt"

type EnqueueWorkflowAgentRunInput = {
  request: ChangeRequestRecord
  prompt: string
  workflowAction?: string | null
  advanceAttentionStep?: boolean
  requestedSkills?: string[]
  baseUrl?: string | null
}

type EnqueueWorkflowAgentRunResult = {
  queued: boolean
  duplicate?: boolean
  reason?: string
  status?: number
  agentRun?: ReturnType<typeof getAgentRun>
  advanced?: boolean
  advancedToStepKey?: string | null
  error?: string
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value)
}

function isTerminalStep(step: Record<string, unknown> | null | undefined) {
  return stepType(step) === "terminal"
}

function workflowStepRunIdempotencyKey(input: {
  requestId: string
  workflowRunId: string
  stepKey: string
  action?: string | null
  loopIterationKey?: string | null
}) {
  const actionKey = input.action && input.action.trim() ? input.action.trim() : "run"
  const loopKey = input.loopIterationKey && input.loopIterationKey.trim() ? `:${input.loopIterationKey.trim()}` : ""
  return `workflow:${input.requestId}:${input.workflowRunId}:${input.stepKey}:${actionKey}${loopKey}`
}

function defaultBaseUrl() {
  return "http://127.0.0.1"
}

function readPositiveInteger(value: unknown, fallback: number) {
  const numberValue = Number(value)
  return Number.isFinite(numberValue) && numberValue > 0 ? Math.trunc(numberValue) : fallback
}

function workflowConcurrency() {
  return readPositiveInteger(process.env.PRISM_AGENT_RUN_WORKFLOW_CONCURRENCY, 2)
}

function globalConcurrency() {
  return readPositiveInteger(process.env.PRISM_AGENT_RUN_GLOBAL_CONCURRENCY, 3)
}

function leaseSeconds() {
  return readPositiveInteger(process.env.PRISM_AGENT_RUN_LEASE_SECONDS, 1800)
}

function staleUnleasedSeconds() {
  return readPositiveInteger(process.env.PRISM_AGENT_RUN_STALE_UNLEASED_SECONDS, leaseSeconds() * 2)
}

function dispatcherIntervalMs() {
  return readPositiveInteger(process.env.PRISM_AGENT_RUN_DISPATCHER_INTERVAL_MS, 10_000)
}

function workflowRunPriority(request: ChangeRequestRecord) {
  const priority = request.priority.trim().toLowerCase()
  if (priority === "urgent") return 90
  if (priority === "high") return 70
  if (priority === "low") return 30
  return 50
}

function workflowAgentRunInput(run: AgentRunRecord) {
  return isRecord(run.input) ? run.input : {}
}

function workflowAgentRunPrompt(run: AgentRunRecord) {
  const input = workflowAgentRunInput(run)
  return typeof input.prompt === "string" && input.prompt.trim() ? input.prompt : null
}

function workflowAgentRunString(input: Record<string, unknown>, key: string) {
  const value = input[key]
  return typeof value === "string" ? value : null
}

function workflowAgentRunStringArray(input: Record<string, unknown>, key: string) {
  const value = input[key]
  return Array.isArray(value)
    ? value.filter((entry): entry is string => typeof entry === "string" && entry.trim().length > 0)
    : []
}

async function executeClaimedWorkflowAgentRun(agentRun: AgentRunRecord) {
  const input = workflowAgentRunInput(agentRun)
  const requestId = agentRun.requestId
  const request = requestId ? getChangeRequest(requestId) : null
  const prompt = workflowAgentRunPrompt(agentRun)
  if (!request || !prompt) {
    updateAgentRun(agentRun.id, {
      status: "failed",
      errorMessage: request ? "WORKFLOW_AGENT_RUN_PROMPT_MISSING" : "WORKFLOW_AGENT_RUN_REQUEST_MISSING",
      leaseExpiresAt: null,
      queueReason: null,
      finishedAt: new Date().toISOString(),
    })
    return
  }

  try {
    let sessionId = agentRun.sessionId
    if (!sessionId && agentRun.agentProfileId) {
      const session = createAgentSession({
        source: "workflow",
        status: "active",
        title: `${request.title} · ${agentRun.workflowStepKey ?? "workflow step"}`,
        linkedChangeRequestId: request.id,
        meta: {
          transport: "site",
          workflowRunId: agentRun.workflowRunId,
          workflowStepKey: agentRun.workflowStepKey,
        },
        lastMessageAt: new Date().toISOString(),
      })
      if (!session) throw new Error("WORKFLOW_AGENT_SESSION_CREATE_FAILED")
      assignAgentProfileToSession({
        sessionId: session.id,
        profileId: agentRun.agentProfileId,
        conversationScope: "automated",
      })
      sessionId = session.id
      updateAgentRun(agentRun.id, { sessionId })
    }
    const response = await handleResponsePost(
      new Request(new URL("/agent/responses", workflowAgentRunString(input, "baseUrl")?.trim() || defaultBaseUrl()), {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          input: [{ role: "user", content: prompt }],
          session_id: sessionId,
          linked_change_request_id: request.id,
          workflow_action: workflowAgentRunString(input, "workflowAction"),
          requested_skills: workflowAgentRunStringArray(input, "requestedSkills"),
          agent_run_id: agentRun.id,
          execution_mode: agentRun.executionMode ?? "worker",
        }),
      }),
      async () => ({ ok: true as const }),
    )
    if (!response.ok) {
      const text = await response.text().catch(() => "")
      updateAgentRun(agentRun.id, {
        status: "failed",
        errorMessage: text || `HTTP ${response.status}`,
        leaseExpiresAt: null,
        queueReason: null,
        finishedAt: new Date().toISOString(),
      })
    }
  } catch (error) {
    updateAgentRun(agentRun.id, {
      status: "failed",
      errorMessage: error instanceof Error ? error.message : "WORKFLOW_AGENT_RUN_FAILED",
      leaseExpiresAt: null,
      queueReason: null,
      finishedAt: new Date().toISOString(),
    })
  }
}

let dispatcherScheduled = false
let dispatcherRunning = false
let dispatcherHeartbeat: ReturnType<typeof setInterval> | null = null

export function wakeWorkflowAgentRunDispatcher() {
  if (dispatcherScheduled) {
    return
  }
  dispatcherScheduled = true
  setTimeout(() => {
    dispatcherScheduled = false
    void dispatchWorkflowAgentRuns()
  }, 0)
}

export function startWorkflowAgentRunDispatcher() {
  wakeWorkflowAgentRunDispatcher()
  if (dispatcherHeartbeat) {
    return
  }
  dispatcherHeartbeat = setInterval(() => {
    wakeWorkflowAgentRunDispatcher()
  }, dispatcherIntervalMs())
  dispatcherHeartbeat.unref?.()
}

async function dispatchWorkflowAgentRuns() {
  if (dispatcherRunning) {
    wakeWorkflowAgentRunDispatcher()
    return
  }
  dispatcherRunning = true
  try {
    expireStaleRunningAgentRuns({
      staleUnleasedSeconds: staleUnleasedSeconds(),
    })

    while (
      countRunningAgentRuns() < globalConcurrency() &&
      countRunningAgentRuns({ lane: "workflow" }) < workflowConcurrency()
    ) {
      const agentRun = claimNextQueuedAgentRun({
        lane: "workflow",
        leaseSeconds: leaseSeconds(),
      })
      if (!agentRun) {
        break
      }

      void executeClaimedWorkflowAgentRun(agentRun).finally(() => {
        wakeWorkflowAgentRunDispatcher()
      })
    }
  } finally {
    dispatcherRunning = false
  }
}

export function enqueueWorkflowAgentRun(input: EnqueueWorkflowAgentRunInput): EnqueueWorkflowAgentRunResult {
  const workflow = getWorkflowByKey(input.request.workflowKey)
  const steps = workflowSteps(workflow?.definition)
  const workflowRun = ensureWorkflowRunForRequest({
    requestId: input.request.id,
    workflowKey: input.request.workflowKey,
  })
  let currentStep =
    findStepByKey(steps, workflowRun.currentStepKey) ??
    findStepByKey(steps, typeof workflow?.definition?.entrypoint === "string" ? workflow.definition.entrypoint : null)
  if (!currentStep) {
    return { queued: false, reason: "workflow_step_not_found", status: 409 }
  }
  if (stepType(currentStep) === "loop") {
    const resolved = resolveControlFlowSteps({
      requestId: input.request.id,
      workflowRunId: workflowRun.id,
      steps,
      step: currentStep,
    })
    currentStep = resolved.step
    if (!currentStep || resolved.stopped) {
      const loopError = "error" in resolved && typeof resolved.error === "string"
        ? resolved.error
        : "WORKFLOW_LOOP_STOPPED"
      return { queued: false, reason: loopError, status: 409 }
    }
  }
  if (input.workflowAction && stepType(currentStep) !== "gate") {
    return { queued: false, reason: "WORKFLOW_ACTION_REQUIRES_GATE", status: 409 }
  }
  if (
    input.advanceAttentionStep === true &&
    !input.workflowAction &&
    input.request.workflowAttention &&
    input.request.workflowAttention.workflowStepKey === stepKey(currentStep) &&
    stepType(currentStep) !== "gate"
  ) {
    const nextStep = nextStepForAction(steps, currentStep, null)
    const nextStepKey = stepKey(nextStep)
    if (!nextStep || !nextStepKey) {
      return { queued: false, reason: "workflow_next_step_not_found", status: 409 }
    }
    createWorkflowEvent({
      workflowRunId: workflowRun.id,
      requestId: input.request.id,
      stepKey: stepKey(currentStep),
      eventType: "operator.attention_resolved",
      actorType: "agent",
      note: input.prompt,
      payload: {
        agentRunId: input.request.workflowAttention.agentRunId,
        blockerKeys: input.request.workflowAttention.blockers
          .map((blocker) => typeof blocker.key === "string" ? blocker.key.trim() : "")
          .filter((key) => key.length > 0),
        fromStepKey: stepKey(currentStep),
        toStepKey: nextStepKey,
        workflowOutcomeStatus: input.request.workflowAttention.status,
        workflowAction: "continue",
      },
    })
    updateChangeRequest(input.request.id, {
      workflowStepKey: nextStepKey,
    })
    updateWorkflowRun({
      requestId: input.request.id,
      currentStepKey: nextStepKey,
      status: isTerminalStep(nextStep) ? "completed" : "active",
      completedAt: isTerminalStep(nextStep) ? new Date().toISOString() : null,
    })
    createWorkflowEvent({
      workflowRunId: workflowRun.id,
      requestId: input.request.id,
      stepKey: nextStepKey,
      eventType: "workflow.step_changed",
      actorType: "system",
      payload: {
        previousStepKey: stepKey(currentStep),
        nextStepKey,
        continuedFromAttention: true,
      },
    })
    currentStep = nextStep
    if (stepType(currentStep) === "loop") {
      const resolved = resolveControlFlowSteps({
        requestId: input.request.id,
        workflowRunId: workflowRun.id,
        steps,
        step: currentStep,
      })
      currentStep = resolved.step
      if (!currentStep || resolved.stopped) {
        const loopError = "error" in resolved && typeof resolved.error === "string"
          ? resolved.error
          : "WORKFLOW_LOOP_STOPPED"
        return { queued: false, reason: loopError, status: 409 }
      }
    }
    if (stepType(currentStep) === "gate" || stepType(currentStep) === "checkpoint" || isTerminalStep(currentStep)) {
      return { queued: true, status: 202, advanced: true, advancedToStepKey: stepKey(currentStep), agentRun: undefined }
    }
  }
  const runnableStep = stepType(currentStep) === "gate"
    ? nextStepForAction(steps, currentStep, input.workflowAction ?? null)
    : currentStep
  const runnableStepKey = stepKey(runnableStep)
  if (!runnableStep || !runnableStepKey) {
    return { queued: false, reason: "workflow_runnable_step_not_found", status: 409 }
  }
  const runnableStepType = stepType(runnableStep)
  if (stepType(currentStep) === "gate" && runnableStepType === "terminal") {
    const currentStepKey = stepKey(currentStep)
    const action = gateEventAction(input.workflowAction)
    createWorkflowEvent({
      workflowRunId: workflowRun.id,
      requestId: input.request.id,
      stepKey: currentStepKey,
      eventType: `gate.${action}`,
      actorType: "agent",
      note: input.prompt,
      payload: {
        fromStepKey: currentStepKey,
        toStepKey: runnableStepKey,
      },
    })
    updateChangeRequest(input.request.id, {
      workflowStepKey: runnableStepKey,
    })
    updateWorkflowRun({
      requestId: input.request.id,
      currentStepKey: runnableStepKey,
      status: "completed",
      completedAt: new Date().toISOString(),
    })
    createWorkflowEvent({
      workflowRunId: workflowRun.id,
      requestId: input.request.id,
      stepKey: runnableStepKey,
      eventType: "workflow.step_changed",
      actorType: "system",
      payload: {
        previousStepKey: currentStepKey,
        nextStepKey: runnableStepKey,
      },
    })
    return { queued: true, status: 202, advanced: true, advancedToStepKey: runnableStepKey, agentRun: undefined }
  }
  if (runnableStepType === "terminal") {
    return { queued: false, reason: "WORKFLOW_ALREADY_TERMINAL", status: 409 }
  }
  if (runnableStepType !== "agent" && runnableStepType !== "checkpoint") {
    return { queued: false, reason: "WORKFLOW_STEP_NOT_RUNNABLE", status: 409 }
  }

  const idempotencyKey = workflowStepRunIdempotencyKey({
    requestId: input.request.id,
    workflowRunId: workflowRun.id,
    stepKey: runnableStepKey,
    action: input.workflowAction ?? null,
    loopIterationKey: loopIterationKeyForRequest({
      requestId: input.request.id,
    }),
  })
  const existing = findActiveAgentRunByIdempotencyKey(idempotencyKey)
  if (existing) {
    return { queued: true, duplicate: true, status: 202, agentRun: existing }
  }

  let executor
  try {
    executor = workflowAgentExecutor(workflow?.definition, runnableStep)
  } catch (error) {
    return {
      queued: false,
      reason: error instanceof Error ? error.message : "AGENT_EXECUTOR_RESOLUTION_FAILED",
      status: 409,
    }
  }

  const agentRun = createAgentRun({
    kind: "workflow_step",
    status: "queued",
    lane: "workflow",
    priority: workflowRunPriority(input.request),
    idempotencyKey,
    requestId: input.request.id,
    workflowRunId: workflowRun.id,
    workflowStepKey: runnableStepKey,
    agentProfileId: executor.profileId,
    agentProfileVersion: executor.profileVersion,
    executionMode: executor.executionMode,
    executorResolution: executor.resolution,
    accountabilitySnapshot: buildAccountabilitySnapshot({
      definitionType: workflow ? "workflow" : null,
      definitionId: workflow?.id ?? null,
      definitionKey: workflow?.key ?? workflowRun.workflowKey,
      definitionVersion: workflow?.version ?? null,
      executorProfileId: executor.profileId,
      executorProfileKey: executor.profileKey,
      executorProfileVersion: executor.profileVersion,
      resolution: executor.resolution,
    }),
    source: "site",
    input: {
      prompt: buildWorkflowAgentRunPrompt({
        requestNumber: input.request.requestNumber,
        requestTitle: input.request.title,
        stepKey: runnableStepKey,
        stepLabel: typeof runnableStep.label === "string" ? runnableStep.label : null,
        operatorContext: input.prompt,
      }),
      workflowAction: input.workflowAction ?? null,
      requestedSkills: input.requestedSkills ?? [],
      baseUrl: input.baseUrl ?? null,
    },
    queueReason: "Waiting for workflow lane capacity.",
  })
  if (!agentRun) {
    return { queued: false, reason: "AGENT_RUN_CREATE_FAILED", status: 500 }
  }

  wakeWorkflowAgentRunDispatcher()
  return { queued: true, status: 202, agentRun }
}
