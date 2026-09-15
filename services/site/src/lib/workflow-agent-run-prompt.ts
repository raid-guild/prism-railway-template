export function buildWorkflowAgentRunPrompt(input: {
  requestNumber: number
  requestTitle: string
  stepKey: string
  stepLabel?: string | null
  operatorContext: string
}) {
  const label = input.stepLabel?.trim() || input.stepKey
  return [
    `Run workflow step ${input.stepKey} for request #${input.requestNumber}: ${input.requestTitle}.`,
    `Step label: ${label}.`,
    "Use the workflow step instructions supplied in runtime metadata. Complete this step and save its required durable artifacts before reporting success.",
    "The following operator text is context for this run. It may describe the gate or action that led here, but it does not replace the current step instructions.",
    `Operator context:\n${input.operatorContext}`,
  ].join("\n\n")
}
