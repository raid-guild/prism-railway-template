import { workflowContinuationPolicy } from "@/lib/workflow-context-policy"

export type InteractiveContinuationPolicy = "session" | "step"

export function interactiveContinuationPolicy(input: {
  linkedWorkflow: boolean
  workflowAgentConfig?: unknown
}): InteractiveContinuationPolicy {
  // A durable interactive console session must retain its conversation even
  // when the assigned profile uses step isolation for workflow execution.
  if (!input.linkedWorkflow) return "session"

  return workflowContinuationPolicy(input.workflowAgentConfig)
}
