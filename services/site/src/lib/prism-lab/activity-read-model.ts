import type { LabRequestListItem } from "./contracts"

export type LabCrossRequestActivity = {
  request: LabRequestListItem
  occurredAt: string
  state: "attention" | "running" | "completed" | "updated"
  summary: string
}

export type LabAgentConversationActivity = {
  id: string
  source: string
  title: string | null
  messageCount: number
  lastMessageAt: string | null
  updatedAt: string
  createdByDisplayName: string | null
  agentKey: string
  agentName: string
}

export type LabActivityKindFilter = "all" | "request" | "conversation"
export type LabActivityStateFilter = "all" | LabCrossRequestActivity["state"]

export type LabActivityFilters = {
  query: string
  kind: LabActivityKindFilter
  state: LabActivityStateFilter
  agent: string | null
  page: number
}

export type LabUnifiedActivity =
  | { key: string; kind: "request"; occurredAt: string; request: LabCrossRequestActivity }
  | { key: string; kind: "conversation"; occurredAt: string; conversation: LabAgentConversationActivity }

export type LabActivityPage = {
  items: LabUnifiedActivity[]
  page: number
  pageSize: number
  totalItems: number
  totalPages: number
}

const activityKinds = new Set<LabActivityKindFilter>(["all", "request", "conversation"])
const activityStates = new Set<LabActivityStateFilter>(["all", "attention", "running", "completed", "updated"])

function first(value: string | string[] | undefined) {
  return Array.isArray(value) ? value[0] : value
}

export function parseLabActivityFilters(params: Record<string, string | string[] | undefined>): LabActivityFilters {
  const requestedKind = first(params.kind)
  const legacyAttention = first(params.view) === "attention"
  const requestedState = legacyAttention ? "attention" : first(params.state)
  const requestedPage = Number(first(params.page))
  return {
    query: (first(params.q) ?? "").trim().slice(0, 200),
    kind: legacyAttention
      ? "request"
      : activityKinds.has(requestedKind as LabActivityKindFilter)
        ? requestedKind as LabActivityKindFilter
        : "all",
    state: activityStates.has(requestedState as LabActivityStateFilter)
      ? requestedState as LabActivityStateFilter
      : "all",
    agent: (first(params.agent) ?? "").trim().slice(0, 120) || null,
    page: Number.isFinite(requestedPage) && requestedPage > 0 ? Math.trunc(requestedPage) : 1,
  }
}

export function labActivitySearchParams(filters: LabActivityFilters, page = filters.page) {
  const params = new URLSearchParams()
  if (filters.query) params.set("q", filters.query)
  if (filters.kind !== "all") params.set("kind", filters.kind)
  if (filters.state !== "all") params.set("state", filters.state)
  if (filters.agent) params.set("agent", filters.agent)
  if (page > 1) params.set("page", String(page))
  return params
}

export function buildUnifiedActivityPage(input: {
  requests: LabCrossRequestActivity[]
  conversations: LabAgentConversationActivity[]
  filters: LabActivityFilters
  pageSize?: number
}): LabActivityPage {
  const query = input.filters.query.toLocaleLowerCase()
  const requestItems: LabUnifiedActivity[] = input.requests
    .filter((item) => input.filters.kind !== "conversation")
    .filter((item) => input.filters.state === "all" || item.state === input.filters.state)
    .filter(() => !input.filters.agent)
    .filter((item) => !query || [
      item.request.requestNumber,
      item.request.title,
      item.request.workflowKey,
      item.request.source.label,
      item.summary,
    ].join(" ").toLocaleLowerCase().includes(query))
    .map((request) => ({ key: `request:${request.request.id}`, kind: "request", occurredAt: request.occurredAt, request }))
  const conversationItems: LabUnifiedActivity[] = input.conversations
    .filter(() => input.filters.kind !== "request" && input.filters.state === "all")
    .filter((item) => !input.filters.agent || item.agentKey === input.filters.agent)
    .filter((item) => !query || [
      item.title,
      item.agentName,
      item.agentKey,
      item.source,
      item.createdByDisplayName,
    ].join(" ").toLocaleLowerCase().includes(query))
    .map((conversation) => ({
      key: `conversation:${conversation.id}`,
      kind: "conversation",
      occurredAt: conversation.lastMessageAt ?? conversation.updatedAt,
      conversation,
    }))
  const allItems = [...requestItems, ...conversationItems].sort((left, right) =>
    right.occurredAt.localeCompare(left.occurredAt) || left.key.localeCompare(right.key),
  )
  const pageSize = Math.max(10, Math.min(Math.trunc(input.pageSize ?? 40), 100))
  const totalPages = Math.max(1, Math.ceil(allItems.length / pageSize))
  const page = Math.min(input.filters.page, totalPages)
  return {
    items: allItems.slice((page - 1) * pageSize, page * pageSize),
    page,
    pageSize,
    totalItems: allItems.length,
    totalPages,
  }
}

export function buildCrossRequestActivity(requests: LabRequestListItem[]): LabCrossRequestActivity[] {
  return requests
    .map((request): LabCrossRequestActivity => {
      if (request.attention.required) {
        return {
          request,
          occurredAt: request.updatedAt,
          state: "attention",
          summary: request.attention.summary || (request.attention.blocked ? "Workflow is blocked" : "Workflow needs attention"),
        }
      }
      if (request.run.active) {
        return {
          request,
          occurredAt: request.updatedAt,
          state: "running",
          summary: `${request.run.activeCount} active agent run${request.run.activeCount === 1 ? "" : "s"}`,
        }
      }
      if (request.lifecycle === "completed") {
        return { request, occurredAt: request.updatedAt, state: "completed", summary: "Request reached a terminal state" }
      }
      return { request, occurredAt: request.updatedAt, state: "updated", summary: `Current phase: ${request.phase.label}` }
    })
    .sort((left, right) => {
      const time = new Date(right.occurredAt).getTime() - new Date(left.occurredAt).getTime()
      return time || right.request.requestNumber - left.request.requestNumber
    })
}
