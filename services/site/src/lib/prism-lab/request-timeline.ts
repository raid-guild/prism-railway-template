export type TimelineMessage = {
  id: string
  role: string
  source: string
  content: string
  createdAt: string
}
export type TimelineRun = {
  id: string
  status: string
  kind: string
  workflowStepKey: string | null
  errorMessage: string | null
  queuedAt: string
  startedAt: string | null
  finishedAt: string | null
}

export type TimelineArtifact = {
  id: string
  name: string
  kind: string
  description: string | null
  createdAt: string
  agentRunId: string | null
}

export type TimelineEvent = {
  id: string
  eventType: string
  stepKey: string | null
  actorType: string
  note: string | null
  createdAt: string
}

export type TimelineExternalRef = {
  id: string
  provider: string
  kind: string
  title: string | null
  url: string
  state: string | null
  createdAt: string
}

export type RequestTimelineItem = {
  id: string
  kind: "message" | "workflow_event" | "agent_run" | "artifact" | "external_ref"
  occurredAt: string
  summary: string
  detail: string | null
  status: string | null
  stepKey: string | null
  actor: string | null
  needsAttention: boolean
  runId: string | null
  artifactId: string | null
  externalUrl: string | null
}

const kindOrder: Record<RequestTimelineItem["kind"], number> = {
  message: 0,
  workflow_event: 1,
  agent_run: 2,
  artifact: 3,
  external_ref: 4,
}

function timestamp(value: string) {
  const parsed = new Date(value).getTime()
  return Number.isFinite(parsed) ? parsed : 0
}

function humanize(value: string) {
  return value
    .split(/[._:-]+/)
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ")
}

function runOccurredAt(run: TimelineRun) {
  return run.finishedAt || run.startedAt || run.queuedAt
}

function runNeedsAttention(status: string) {
  return ["failed", "canceled", "blocked", "needs_attention"].includes(status.toLowerCase())
}

function eventNeedsAttention(eventType: string) {
  const normalized = eventType.toLowerCase()
  return normalized.includes("failed") || normalized.includes("blocked") || normalized.includes("attention")
}

export function buildRequestTimeline(input: {
  messages: TimelineMessage[]
  runs: TimelineRun[]
  artifacts: TimelineArtifact[]
  events: TimelineEvent[]
  externalRefs: TimelineExternalRef[]
}): RequestTimelineItem[] {
  const items: RequestTimelineItem[] = [
    ...input.messages.map((message): RequestTimelineItem => ({
      id: `message:${message.id}`,
      kind: "message",
      occurredAt: message.createdAt,
      summary: message.role === "user" ? "Operator message" : "Prism message",
      detail: message.content,
      status: null,
      stepKey: null,
      actor: message.role === "user" ? "Operator" : message.source || "Prism",
      needsAttention: false,
      runId: null,
      artifactId: null,
      externalUrl: null,
    })),
    ...input.events.map((event): RequestTimelineItem => ({
      id: `event:${event.id}`,
      kind: "workflow_event",
      occurredAt: event.createdAt,
      summary: humanize(event.eventType),
      detail: event.note,
      status: event.eventType,
      stepKey: event.stepKey,
      actor: event.actorType,
      needsAttention: eventNeedsAttention(event.eventType),
      runId: null,
      artifactId: null,
      externalUrl: null,
    })),
    ...input.runs.map((run): RequestTimelineItem => ({
      id: `run:${run.id}`,
      kind: "agent_run",
      occurredAt: runOccurredAt(run),
      summary: `${humanize(run.kind || "Agent run")} · ${humanize(run.status)}`,
      detail: run.errorMessage,
      status: run.status,
      stepKey: run.workflowStepKey,
      actor: "Agent run",
      needsAttention: runNeedsAttention(run.status),
      runId: run.id,
      artifactId: null,
      externalUrl: null,
    })),
    ...input.artifacts.map((artifact): RequestTimelineItem => ({
      id: `artifact:${artifact.id}`,
      kind: "artifact",
      occurredAt: artifact.createdAt,
      summary: `Artifact · ${artifact.name}`,
      detail: artifact.description || humanize(artifact.kind),
      status: null,
      stepKey: null,
      actor: null,
      needsAttention: false,
      runId: artifact.agentRunId,
      artifactId: artifact.id,
      externalUrl: null,
    })),
    ...input.externalRefs.map((reference): RequestTimelineItem => ({
      id: `external-ref:${reference.id}`,
      kind: "external_ref",
      occurredAt: reference.createdAt,
      summary: reference.title || `${humanize(reference.provider)} ${humanize(reference.kind)}`,
      detail: reference.state ? `State: ${reference.state}` : null,
      status: reference.state,
      stepKey: null,
      actor: reference.provider,
      needsAttention: reference.state?.toLowerCase() === "failed",
      runId: null,
      artifactId: null,
      externalUrl: reference.url,
    })),
  ]

  return items.sort((left, right) => {
    const timeDifference = timestamp(left.occurredAt) - timestamp(right.occurredAt)
    if (timeDifference !== 0) return timeDifference
    const kindDifference = kindOrder[left.kind] - kindOrder[right.kind]
    if (kindDifference !== 0) return kindDifference
    return left.id.localeCompare(right.id)
  })
}
