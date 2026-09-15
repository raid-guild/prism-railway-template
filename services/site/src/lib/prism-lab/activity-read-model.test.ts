import assert from "node:assert/strict"
import test from "node:test"

import type { LabRequestListItem } from "./contracts"
import { buildCrossRequestActivity, buildUnifiedActivityPage, labActivitySearchParams, parseLabActivityFilters } from "./activity-read-model"

function request(overrides: Partial<LabRequestListItem>): LabRequestListItem {
  return {
    id: "request-1", requestNumber: 1, title: "Request", description: "", requestType: "change-request",
    priority: "normal", workflowKey: "default", lifecycle: "open",
    phase: { key: "work", label: "Work", type: "agent", known: true },
    source: { key: "site", label: "Site", raw: "site", known: true },
    run: { status: null, active: false, activeCount: 0, failed: false, workflowStatus: null, workflowActive: false },
    attention: { required: false, blocked: false, status: null, summary: null, suggestedFix: null, blockerCount: 0 },
    hasHumanGate: false, estimatedHumanHours: null, estimatedHumanHoursLabel: null, requestedByDisplayName: null,
    createdAt: "2026-01-01T00:00:00.000Z", updatedAt: "2026-01-01T00:00:00.000Z",
    allowedActions: {} as LabRequestListItem["allowedActions"], searchText: "request", ...overrides,
  }
}

test("cross-request activity is newest first and attention takes precedence", () => {
  const items = buildCrossRequestActivity([
    request({ id: "older", requestNumber: 1 }),
    request({
      id: "attention", requestNumber: 2, updatedAt: "2026-01-02T00:00:00.000Z",
      run: { status: "running", active: true, activeCount: 1, failed: false, workflowStatus: "active", workflowActive: true },
      attention: { required: true, blocked: true, status: "blocked", summary: "Approval missing", suggestedFix: null, blockerCount: 1 },
    }),
  ])
  assert.equal(items[0]?.request.id, "attention")
  assert.equal(items[0]?.state, "attention")
  assert.equal(items[0]?.summary, "Approval missing")
})

test("unified activity interleaves conversations and requests newest first", () => {
  const requests = buildCrossRequestActivity([
    request({ id: "request", requestNumber: 7, title: "Older request", updatedAt: "2026-01-02T00:00:00.000Z" }),
  ])
  const page = buildUnifiedActivityPage({
    requests,
    conversations: [{
      id: "thread", source: "discord", title: "A worm that consumes all knowledge", messageCount: 2,
      lastMessageAt: "2026-01-03T00:00:00.000Z", updatedAt: "2026-01-03T00:00:00.000Z",
      createdByDisplayName: "Dekan", agentKey: "admin-agent", agentName: "Queen Raida",
    }],
    filters: parseLabActivityFilters({}),
  })
  assert.equal(page.items[0]?.kind, "conversation")
  assert.equal(page.items[1]?.kind, "request")
  assert.equal(page.totalItems, 2)
})

test("activity filters and pagination remain URL-native and deterministic", () => {
  const conversations = Array.from({ length: 23 }, (_, index) => ({
    id: `thread-${index}`, source: index % 2 ? "discord" : "buzz", title: `Conversation ${index}`,
    messageCount: 2, lastMessageAt: `2026-01-${String(index + 1).padStart(2, "0")}T00:00:00.000Z`,
    updatedAt: `2026-01-${String(index + 1).padStart(2, "0")}T00:00:00.000Z`, createdByDisplayName: null,
    agentKey: index % 2 ? "admin-agent" : "buzz-agent", agentName: index % 2 ? "Queen Raida" : "Buzz Agent",
  }))
  const filters = parseLabActivityFilters({ kind: "conversation", agent: "admin-agent", page: "2" })
  const page = buildUnifiedActivityPage({ requests: [], conversations, filters, pageSize: 10 })
  assert.equal(page.totalItems, 11)
  assert.equal(page.page, 2)
  assert.equal(page.items.length, 1)
  assert.equal(labActivitySearchParams(filters).toString(), "kind=conversation&agent=admin-agent&page=2")
})

test("legacy attention links normalize to request attention filters", () => {
  assert.deepEqual(parseLabActivityFilters({ view: "attention", page: "bad" }), {
    query: "", kind: "request", state: "attention", agent: null, page: 1,
  })
})
