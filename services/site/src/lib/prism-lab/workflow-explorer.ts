export type WorkflowExplorerStep = {
  key: string
  label: string
  type: string
  next: string | null
  routes: Array<{ action: string; target: string; loop: boolean }>
  current: boolean
  observed: boolean
  completed: boolean
  terminal: boolean
}
type ExplorerEvent = {
  stepKey: string | null
  eventType: string
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value)
}

function labelForKey(value: string) {
  return value
    .split(/[-_:]+/)
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ")
}

function eventCompletesStep(eventType: string) {
  const value = eventType.toLowerCase()
  return value.includes("completed") || value.includes("continued") || value.includes("approved")
}

export function buildWorkflowExplorer(input: {
  definition: Record<string, unknown> | null | undefined
  currentStepKey: string | null
  events: ExplorerEvent[]
}): WorkflowExplorerStep[] {
  const rawSteps = Array.isArray(input.definition?.steps) ? input.definition.steps : []
  const parsed = rawSteps.flatMap((value) => {
    if (!isRecord(value)) return []
    const key = typeof value.key === "string" ? value.key.trim() : ""
    if (!key) return []
    const label = typeof value.label === "string" && value.label.trim()
      ? value.label.trim()
      : typeof value.name === "string" && value.name.trim()
        ? value.name.trim()
        : labelForKey(key)
    const type = typeof value.type === "string" && value.type.trim() ? value.type.trim() : "agent"
    const next = typeof value.next === "string" && value.next.trim() ? value.next.trim() : null
    const routes = isRecord(value.routes)
      ? Object.entries(value.routes).flatMap(([action, target]) => typeof target === "string" && target.trim()
        ? [{ action, target: target.trim() }]
        : [])
      : []
    const loop = isRecord(value.loop) ? value.loop : null
    const loopRoutes = loop
      ? [
          ["changes requested", loop.target],
          ["max iterations", loop.onMaxIterations],
          ["evaluation error", loop.onError],
        ].flatMap(([action, target]) => typeof action === "string" && typeof target === "string" && target.trim()
          ? [{ action, target: target.trim() }]
          : [])
      : []
    return [{ key, label, type, next, routes: [...routes, ...loopRoutes] }]
  })
  const indexByKey = new Map(parsed.map((step, index) => [step.key, index]))
  const observed = new Set(input.events.flatMap((event) => event.stepKey ? [event.stepKey] : []))
  const completed = new Set(input.events.flatMap((event) => (
    event.stepKey && eventCompletesStep(event.eventType) ? [event.stepKey] : []
  )))

  return parsed.map((step, index) => {
    const links = [
      ...(step.next ? [{ action: "next", target: step.next }] : []),
      ...step.routes,
    ].map((route) => ({
      ...route,
      loop: (indexByKey.get(route.target) ?? Number.POSITIVE_INFINITY) <= index,
    }))
    return {
      key: step.key,
      label: step.label,
      type: step.type,
      next: step.next,
      routes: links,
      current: step.key === input.currentStepKey,
      observed: observed.has(step.key),
      completed: completed.has(step.key),
      terminal: step.type === "terminal" || links.length === 0,
    }
  })
}
