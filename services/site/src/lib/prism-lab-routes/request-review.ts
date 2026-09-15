import { resolveRequestMessageActor } from "@/lib/prism-lab/request-message-actor"

export type PrismLabReviewLimits = {
  messageLimit: number
  eventLimit: number
  artifactLimit: number
}

type RemoteReviewPayloads = {
  detail: Record<string, unknown>
  executions: Record<string, unknown>
  events: Record<string, unknown>
  artifacts: Record<string, unknown>
  externalRefs: Record<string, unknown>
  agentThread: Record<string, unknown>
}

function recordArray(value: unknown) {
  return Array.isArray(value)
    ? value.filter((entry): entry is Record<string, unknown> => Boolean(entry) && typeof entry === "object" && !Array.isArray(entry))
    : []
}

function optionalRecord(value: unknown) {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null
}

function boundedLimit(value: string | null, fallback: number) {
  if (!value) return fallback
  const parsed = Number.parseInt(value, 10)
  return Number.isFinite(parsed) ? Math.min(500, Math.max(1, parsed)) : fallback
}

export function readPrismLabReviewLimits(url: URL): PrismLabReviewLimits {
  return {
    messageLimit: boundedLimit(url.searchParams.get("messageLimit"), 150),
    eventLimit: boundedLimit(url.searchParams.get("eventLimit"), 200),
    artifactLimit: boundedLimit(url.searchParams.get("artifactLimit"), 200),
  }
}

export function composeRemotePrismLabReview(
  payloads: RemoteReviewPayloads,
  limits: PrismLabReviewLimits,
  capabilities: { canRunAgent: boolean; canComment: boolean },
) {
  const changeRequest = optionalRecord(payloads.detail.changeRequest)
  if (!changeRequest) {
    return { ok: false as const, error: "Remote request detail did not include changeRequest" }
  }

  const legacyExecutions = recordArray(payloads.executions.legacyExecutions ?? payloads.executions.executions)
  const agentRuns = recordArray(payloads.executions.agentRuns)
  const workflowEvents = recordArray(payloads.events.events ?? payloads.events.workflowEvents)
    .slice(0, limits.eventLimit)
  const artifacts = recordArray(payloads.artifacts.artifacts).slice(0, limits.artifactLimit)
  const externalRefs = recordArray(payloads.externalRefs.externalRefs)
  const remoteSession = optionalRecord(payloads.agentThread.session)
  const requestOrigin = optionalRecord(changeRequest.origin)
  const isPromotedConsoleOrigin = remoteSession?.source === "admin-console"
    && typeof remoteSession.id === "string"
    && remoteSession.id === requestOrigin?.sourceSessionId
  const agentMessages = isPromotedConsoleOrigin
    ? []
    : recordArray(payloads.agentThread.messages).slice(-limits.messageLimit).map((message) => {
        const actor = resolveRequestMessageActor(message, remoteSession)
        return actor ? { ...message, actor } : message
      })

  return {
    ok: true as const,
    capabilities: {
      canViewRequests: true as const,
      canRunAgent: capabilities.canRunAgent,
      canComment: capabilities.canComment,
    },
    changeRequest,
    targetApp: optionalRecord(payloads.detail.targetApp),
    targetEnvironment: optionalRecord(payloads.detail.targetEnvironment),
    deployPlan: optionalRecord(payloads.detail.deployPlan),
    workflow: optionalRecord(payloads.detail.workflow),
    workflowRun: optionalRecord(payloads.detail.workflowRun),
    latestAgentRun: agentRuns[0] ?? null,
    latestExecution: null,
    legacyExecutions,
    executions: legacyExecutions,
    agentRuns,
    workflowEvents,
    artifacts,
    externalRefs,
    agentSession: isPromotedConsoleOrigin ? null : remoteSession,
    agentMessages,
  }
}
