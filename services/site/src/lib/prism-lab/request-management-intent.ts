export type RequestManagementStep = {
  key: string
  label: string
  type: string
}

export type RequestManagementIntent =
  | { kind: "cancel-request" }
  | { kind: "retry-step" }
  | { kind: "check-status" }
  | { kind: "move-step"; targetStepKey: string; runAfterMove: boolean }
  | null

function normalized(value: string) {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim()
}

function cancelIntent(value: string) {
  return /^(?:(?:please|kindly)\s+)?(?:(?:can|could|would|will)\s+you\s+)?(?:cancel|close)(?:\s+(?:(?:this|the|current)\s+)?request)?(?:\s+(?:now|please))?[?.!]*$/i.test(value.trim())
}

function retryIntent(value: string) {
  return /^(?:(?:please|kindly)\s+)?(?:(?:can|could|would|will)\s+you\s+)?(?:(?:try|run)\s+(?:(?:this|current|the(?:\s+current)?)\s+)?(?:step\s+)?again|re-?try(?:\s+(?:(?:this|current|the(?:\s+current)?)\s+)?(?:step|run|request))?|re-?run(?:\s+(?:(?:this|current|the(?:\s+current)?)\s+)?(?:step|run))?)(?:\s+(?:now|please))?[?.!]*$/i.test(value.trim())
}

function checkStatusIntent(value: string) {
  return /^(?:(?:please|kindly)\s+)?(?:(?:can|could|would|will)\s+you\s+)?(?:(?:check|poll|refresh)(?:\s+(?:the|current|job|render))*\s+(?:status|state|progress)|(?:check|poll)\s+(?:it\s+)?(?:now|again)|run\s+(?:(?:the\s+)?current\s+|the\s+)?(?:status\s+check|checkpoint))(?:\s+(?:now|again|please))?[?.!]*$/i.test(value.trim())
}

function moveTarget(value: string) {
  const compoundFromMatch = value.trim().match(
    /^(?:(?:please|kindly)\s+)?(?:(?:can|could|would|will)\s+you\s+)?(?:move|send|change|set|go)\b[\s\S]*?\bback\s+and\s+(?:run|re-?run|retry)\s+from\s+(.+?)[?.!]*$/i,
  )
  const compoundAfterMatch = value.trim().match(
    /^(?:(?:please|kindly)\s+)?(?:(?:can|could|would|will)\s+you\s+)?(?:move|send|change|set|go)\b[\s\S]*?\b(?:back\s+to|forward\s+to|to)\s+(.+?)\s+and\s+(?:run|re-?run|retry)(?:\s+(?:it|that|the\s+step))?[?.!]*$/i,
  )
  const match = compoundFromMatch ?? compoundAfterMatch ?? value.trim().match(
    /^(?:(?:please|kindly)\s+)?(?:(?:can|could|would|will)\s+you\s+)?(?:move|send|change|set)\b[\s\S]*?\b(?:back\s+to|forward\s+to|to)\s+(.+?)[?.!]*$/i,
  )
  if (!match?.[1]) return null
  const target = normalized(match[1])
    .replace(/^the\s+/, "")
    .replace(/\s+(?:step|phase)(?:\s+(?:now|please))?$/, "")
    .replace(/\s+(?:now|please)$/, "")
    .trim()
  return { target, runAfterMove: Boolean(compoundFromMatch || compoundAfterMatch) }
}

export function resolveRequestManagementIntent(
  value: string,
  steps: RequestManagementStep[],
): RequestManagementIntent {
  if (cancelIntent(value)) return { kind: "cancel-request" }
  if (retryIntent(value)) return { kind: "retry-step" }
  if (checkStatusIntent(value)) return { kind: "check-status" }
  const move = moveTarget(value)
  if (!move) return null

  const candidates = steps
    .filter((step) => step.type !== "terminal")
    .map((step) => ({
      step,
      names: Array.from(new Set([normalized(step.key), normalized(step.label)])),
    }))
    .filter(({ names }) => names.some((name) => name === move.target))

  return candidates.length === 1
    ? {
        kind: "move-step",
        targetStepKey: candidates[0]!.step.key,
        runAfterMove: move.runAfterMove,
      }
    : null
}
