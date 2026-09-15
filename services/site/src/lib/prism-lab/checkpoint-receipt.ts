type RequestSummary = {
  id: string
  requestNumber: number
  title: string
  targetEnvironmentId: string | null
}

type SessionSummary = {
  id: string
  meta: Record<string, unknown>
}

type MessageSummary = {
  source: string
  sourceMessageId?: string | null
}

export type PublishCheckpointReceiptDependencies = {
  findSession: (input: { source: string; contextKey: string }) => SessionSummary | null
  createSession: (input: {
    source: string
    status: string
    title: string
    linkedChangeRequestId: string
    linkedTargetEnvironmentId: string | null
    createdByUserId: null
    meta: Record<string, unknown>
    lastMessageAt: string
  }) => SessionSummary | null
  listMessages: (sessionId: string, limit: number) => MessageSummary[]
  createMessage: (input: {
    sessionId: string
    role: string
    source: string
    sourceMessageId: string
    content: string
    meta: Record<string, unknown>
  }) => unknown
  updateSession: (sessionId: string, input: {
    linkedChangeRequestId: string
    linkedTargetEnvironmentId: string | null
    lastMessageAt: string
    meta: Record<string, unknown>
  }) => unknown
  now?: () => string
}

export function publishCheckpointReceipt(input: {
  request: RequestSummary
  stepKey: string
  stepLabel: string
  agentRunId: string
  responseText: string
  status: "succeeded" | "blocked" | "needs_attention"
}, dependencies: PublishCheckpointReceiptDependencies) {
  const contextKey = `prism-lab-request:${input.request.id}`
  const now = (dependencies.now ?? (() => new Date().toISOString()))()
  let session = dependencies.findSession({ source: "admin-console", contextKey })
  if (!session) {
    session = dependencies.createSession({
      source: "admin-console",
      status: "active",
      title: `Request #${input.request.requestNumber}: ${input.request.title}`,
      linkedChangeRequestId: input.request.id,
      linkedTargetEnvironmentId: input.request.targetEnvironmentId,
      createdByUserId: null,
      meta: { transport: "site", contextKey, kind: "prism-lab-request-ask" },
      lastMessageAt: now,
    })
  }
  if (!session) return null

  const sourceMessageId = `checkpoint:${input.agentRunId}`
  const duplicate = dependencies.listMessages(session.id, 500).some((message) => (
    message.source === "workflow-checkpoint" && message.sourceMessageId === sourceMessageId
  ))
  if (duplicate) return null

  const heading = input.status === "succeeded"
    ? `Checkpoint passed · ${input.stepLabel}`
    : input.status === "blocked"
      ? `Checkpoint blocked · ${input.stepLabel}`
      : `Checkpoint needs attention · ${input.stepLabel}`
  const message = dependencies.createMessage({
    sessionId: session.id,
    role: "assistant",
    source: "workflow-checkpoint",
    sourceMessageId,
    content: `${heading}\n\n${input.responseText.trim().slice(0, 8000)}`,
    meta: {
      transport: "site",
      kind: "checkpoint-receipt",
      requestId: input.request.id,
      workflowStepKey: input.stepKey,
      agentRunId: input.agentRunId,
      status: input.status,
    },
  })
  dependencies.updateSession(session.id, {
    linkedChangeRequestId: input.request.id,
    linkedTargetEnvironmentId: input.request.targetEnvironmentId,
    lastMessageAt: now,
    meta: { ...session.meta, transport: "site", contextKey, kind: "prism-lab-request-ask" },
  })
  return message
}
