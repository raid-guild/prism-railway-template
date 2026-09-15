function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value)
}

const normalGateContinueActions = new Set(["approve", "approved", "continue", "continued"])

export function gateEventAction(action: string | null | undefined) {
  const normalized = action?.trim() || null
  if (!normalized || normalGateContinueActions.has(normalized.toLowerCase())) {
    return "continued"
  }
  return normalized
}

export function workflowSteps(definition: unknown) {
  return isRecord(definition) && Array.isArray(definition.steps)
    ? definition.steps.filter(isRecord).filter((step) => typeof step.key === "string" && step.key.trim())
    : []
}

export function stepKey(step: Record<string, unknown> | null | undefined) {
  return typeof step?.key === "string" && step.key.trim() ? step.key.trim() : null
}

export function stepType(step: Record<string, unknown> | null | undefined) {
  return typeof step?.type === "string" && step.type.trim() ? step.type.trim() : "agent"
}

export function findStepByKey(steps: Record<string, unknown>[], key: string | null | undefined) {
  return steps.find((step) => stepKey(step) === key) ?? null
}

export function nextStepForAction(
  steps: Record<string, unknown>[],
  step: Record<string, unknown>,
  action: string | null,
) {
  const routes = isRecord(step.routes) ? step.routes : null
  const normalizedAction = action?.trim() || null
  const next = typeof step.next === "string" ? step.next : null
  if (normalizedAction) {
    if (routes) {
      const routeValue = routes[normalizedAction]
      if (typeof routeValue === "string") {
        return findStepByKey(steps, routeValue)
      }
    }
    if (!normalGateContinueActions.has(normalizedAction.toLowerCase())) {
      return null
    }
  }

  if (next) {
    return findStepByKey(steps, next)
  }

  const legacyApprovedRoute = routes?.approved
  return typeof legacyApprovedRoute === "string" ? findStepByKey(steps, legacyApprovedRoute) : null
}
