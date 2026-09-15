import assert from "node:assert/strict";
import test from "node:test";

import type { LabRequestListItem } from "./contracts";
import {
  defaultLabRequestFilters,
  filterAndSortLabRequests,
  labRequestFilterOptions,
  labRequestFiltersToSearchParams,
  parseLabRequestFilters,
} from "./request-filters";

function item(overrides: Partial<LabRequestListItem> = {}): LabRequestListItem {
  return {
    id: "request-1",
    requestNumber: 1,
    title: "Request",
    description: "Description",
    requestType: "feature",
    priority: "normal",
    workflowKey: "change",
    lifecycle: "open",
    phase: { key: "work", label: "Work", type: "agent", known: true },
    source: { key: "site", label: "Site", raw: "manual", known: true },
    run: {
      status: null,
      active: false,
      activeCount: 0,
      failed: false,
      workflowStatus: null,
      workflowActive: false,
    },
    attention: {
      required: false,
      blocked: false,
      status: null,
      summary: null,
      suggestedFix: null,
      blockerCount: 0,
    },
    hasHumanGate: false,
    estimatedHumanHours: null,
    estimatedHumanHoursLabel: null,
    requestedByDisplayName: null,
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
    allowedActions: {} as LabRequestListItem["allowedActions"],
    searchText: "1 request description feature normal change work site",
    ...overrides,
  };
}

test("filters default to open and serialize canonically without default noise", () => {
  assert.deepEqual(parseLabRequestFilters(new URLSearchParams()), defaultLabRequestFilters);
  const parsed = parseLabRequestFilters(
    new URLSearchParams("sort=created-desc&source=discord&q=%20blocked%20request%20&lifecycle=all"),
  );
  assert.equal(
    labRequestFiltersToSearchParams(parsed).toString(),
    "q=blocked+request&lifecycle=all&platform=discord&sort=created-desc",
  );
  assert.deepEqual(parseLabRequestFilters(labRequestFiltersToSearchParams(parsed)), parsed);
});

test("invalid enum values fail to stable defaults", () => {
  const parsed = parseLabRequestFilters(new URLSearchParams("lifecycle=deleted&attention=nope&sort=random"));
  assert.equal(parsed.lifecycle, "open");
  assert.equal(parsed.attention, "all");
  assert.equal(parsed.sort, "attention");
});

test("open includes running and attention while completed is excluded", () => {
  const requests = [
    item(),
    item({ id: "running", requestNumber: 2, lifecycle: "running" }),
    item({ id: "attention", requestNumber: 3, lifecycle: "attention" }),
    item({ id: "completed", requestNumber: 4, lifecycle: "completed" }),
  ];
  assert.deepEqual(
    filterAndSortLabRequests(requests, defaultLabRequestFilters).map((request) => request.id).sort(),
    ["attention", "request-1", "running"],
  );
});

test("attention sorting triages blocked before attention before recently updated clear work", () => {
  const clear = item({ id: "clear", requestNumber: 2, updatedAt: "2026-01-04T00:00:00.000Z" });
  const needsAttention = item({
    id: "attention",
    requestNumber: 3,
    lifecycle: "attention",
    attention: { ...clear.attention, required: true, status: "needs_attention" },
  });
  const blocked = item({
    id: "blocked",
    requestNumber: 4,
    lifecycle: "attention",
    attention: { ...clear.attention, required: true, blocked: true, status: "blocked" },
  });
  assert.deepEqual(
    filterAndSortLabRequests([clear, needsAttention, blocked], defaultLabRequestFilters).map(({ id }) => id),
    ["blocked", "attention", "clear"],
  );
});

test("query and supported current-data facets combine", () => {
  const discord = item({
    id: "discord",
    title: "Fix gateway",
    priority: "urgent",
    source: { key: "discord", label: "Discord", raw: "discord", known: true },
    searchText: "1 fix gateway urgent discord work",
  });
  const site = item({ id: "site", requestNumber: 2 });
  const filters = {
    ...defaultLabRequestFilters,
    query: "gateway",
    priority: "urgent",
    source: "discord",
    phase: "work",
  };
  assert.deepEqual(filterAndSortLabRequests([site, discord], filters).map(({ id }) => id), ["discord"]);
});

test("filter options are unique and deterministically ordered", () => {
  const requests = [
    item(),
    item({
      id: "discord",
      phase: { key: "approve", label: "Approve", type: "gate", known: true },
      source: { key: "discord", label: "Discord", raw: "discord", known: true },
      priority: "urgent",
    }),
  ];
  assert.deepEqual(labRequestFilterOptions(requests), {
    phases: [
      { value: "approve", label: "Approve" },
      { value: "work", label: "Work" },
    ],
    priorities: ["urgent", "normal"],
    sources: [
      { value: "discord", label: "Discord" },
      { value: "site", label: "Site" },
    ],
    targets: [{ value: "unknown", label: "Unknown target" }],
    profiles: [{ value: "unknown", label: "No profile snapshot" }],
    initiators: [{ value: "unknown", label: "Unknown initiator" }],
  });
});

test("origin platform, target, profile, and initiator filters compose", () => {
  const discord = item({
    id: "discord-origin",
    source: { key: "discord", label: "Discord", raw: "discord", known: true },
    requestedByDisplayName: "Ada",
    origin: {
      sourceSessionId: "session-1", platform: "discord", targetId: "channel-1", targetName: "Product",
      threadId: null, interfaceKey: null, interactionProfileKey: "dev-agent", interactionProfileVersion: 2,
      actorType: "user", actorId: "user-1", actorDisplayName: "Ada", sourceMessageId: "message-1",
      rawSource: "discord-source-adapter", backfillStatus: "complete", capturedAt: "2026-01-01T00:00:00.000Z",
    },
  });
  const filters = { ...defaultLabRequestFilters, source: "discord", target: "channel-1", profile: "dev-agent", initiator: "user-1" };
  assert.deepEqual(filterAndSortLabRequests([item(), discord], filters).map(({ id }) => id), ["discord-origin"]);
  assert.equal(labRequestFiltersToSearchParams(filters).toString(), "platform=discord&target=channel-1&profile=dev-agent&initiator=user-1");
});
