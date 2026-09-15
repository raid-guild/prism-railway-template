import type { ChangeRequestRecord } from "@/lib/app-core"
import {
  getChangeRequest,
  getWorkflowByKey,
  getWorkflowRunForRequest,
} from "@/lib/app-core"
import { enqueueWorkflowAgentRun } from "@/lib/workflow-agent-run-queue"

type WorkflowAutoStartResult = {
  started: boolean
  reason?: string
  status?: number
  response?: unknown
  error?: string
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value)
}

function workflowSteps(definition: unknown) {
  return isRecord(definition) && Array.isArray(definition.steps)
    ? definition.steps.filter(isRecord)
    : []
}

function stepKey(step: Record<string, unknown> | null | undefined) {
  return typeof step?.key === "string" && step.key.trim() ? step.key.trim() : null
}

function stepLabel(step: Record<string, unknown> | null | undefined) {
  return typeof step?.label === "string" && step.label.trim()
    ? step.label.trim()
    : stepKey(step) ?? "workflow step"
}

function stepType(step: Record<string, unknown> | null | undefined) {
  return typeof step?.type === "string" && step.type.trim() ? step.type.trim() : "agent"
}

function currentWorkflowStep(request: ChangeRequestRecord) {
  const workflow = getWorkflowByKey(request.workflowKey)
  const steps = workflowSteps(workflow?.definition)
  const run = getWorkflowRunForRequest(request.id)
  const currentStepKey = run?.currentStepKey ?? request.currentWorkflowStepKey
  if (currentStepKey) {
    const match = steps.find((step) => stepKey(step) === currentStepKey)
    if (match) return match
  }

  const entrypoint = isRecord(workflow?.definition) && typeof workflow.definition.entrypoint === "string"
    ? workflow.definition.entrypoint.trim()
    : ""
  if (entrypoint) {
    const match = steps.find((step) => stepKey(step) === entrypoint)
    if (match) return match
  }

  return steps[0] ?? null
}

export async function autoStartWorkflowRequest(
  request: ChangeRequestRecord,
  options: { baseUrl?: string | null; requestedSkills?: string[] } = {},
): Promise<WorkflowAutoStartResult> {
  const freshRequest = getChangeRequest(request.id) ?? request
  const step = currentWorkflowStep(freshRequest)
  const key = stepKey(step)
  if (!step || !key) {
    return { started: false, reason: "workflow_step_not_found" }
  }
  const type = stepType(step)
  if (type !== "agent" && type !== "loop") {
    return { started: false, reason: "current_step_is_not_agent" }
  }

  const prompt = [
    type === "loop"
      ? `Run the next runnable workflow step for request #${freshRequest.requestNumber}: ${freshRequest.title}. The site may resolve a control-flow step before this agent run starts.`
      : `Run workflow step ${key} for request #${freshRequest.requestNumber}: ${freshRequest.title}.`,
    `Step label: ${stepLabel(step)}.`,
    type === "loop"
      ? "Use the current workflow step instructions from runtime metadata after control-flow resolution."
      : typeof step.instructionPath === "string" && step.instructionPath.trim()
      ? `Use the workflow step instructions at ${step.instructionPath.trim()}.`
      : "Use the current workflow step instructions from runtime metadata.",
    "Use the request context and thread history. Return a concise summary of what changed or what should happen next.",
  ].join("\n")

  try {
    const result = enqueueWorkflowAgentRun({
      request: freshRequest,
      prompt,
      workflowAction: null,
      requestedSkills: options.requestedSkills ?? [],
      baseUrl: options.baseUrl,
    })
    if (!result.queued) {
      return {
        started: false,
        reason: result.reason ?? "workflow_start_failed",
        status: result.status,
        response: result,
      }
    }
    return { started: true, status: result.status, response: result }
  } catch (error) {
    return {
      started: false,
      reason: "workflow_start_error",
      error: error instanceof Error ? error.message : "Unknown workflow start error",
    }
  }
}
