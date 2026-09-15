import assert from "node:assert/strict";
import test from "node:test";

import type { AdminBoardData, ChangeRequestRecord, WorkflowRecord } from "@/lib/admin";
import type { ActiveRequestAgentRunSummary } from "./active-run-projection";

import { buildLabRequestListItems, labRequestSource } from "./request-read-model";

const workflow: WorkflowRecord = {
  id: "workflow-1",
  key: "change",
  name: "Change",
  description: null,
  version: 1,
  definition: {
    steps: [
      { key: "work", label: "Work", type: "agent" },
      { key: "approve", label: "Approve", type: "gate" },
      { key: "closed", label: "Closed", type: "terminal" },
    ],
  },
  systemDefault: false,
  enabled: true,
  createdAt: "2026-01-01T00:00:00.000Z",
  updatedAt: "2026-01-01T00:00:00.000Z",
};

function request(overrides: Partial<ChangeRequestRecord> = {}): ChangeRequestRecord {
  return {
    id: "request-1",
    requestNumber: 7,
    workflowKey: "change",
    title: "Ship Lab",
    description: "Build the request inbox",
    requestType: "feature",
    priority: "high",
    source: "discord-source-adapter",
    requestedByUserId: null,
    requestedByDisplayName: "Operator",
    targetAppId: null,
    targetAppSlug: null,
    targetAppName: null,
    targetEnvironmentId: null,
    targetEnvironmentSlug: null,
    targetEnvironmentName: null,
    currentWorkflowStepKey: "work",
    workflowRunStatus: "running",
    workflowAttention: null,
    triageSummary: null,
    estimatedHumanHours: 1.5,
    acceptanceCriteria: [],
    constraints: {},
    attachments: [],
    agentRecommendation: null,
    reviewNotes: null,
    resolutionSummary: null,
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-02T00:00:00.000Z",
    triagedAt: null,
    approvedForWorkAt: null,
    completedAt: null,
    closedAt: null,
    ...overrides,
  };
}

function board(changeRequests: ChangeRequestRecord[]): AdminBoardData {
  return {
    targetApps: [],
    targetEnvironments: [],
    changeRequests,
    workflows: [workflow],
    activeRequestAgentRuns: [],
  };
}

function activeRun(
  overrides: Partial<ActiveRequestAgentRunSummary> = {},
): ActiveRequestAgentRunSummary {
  return {
    id: "run-1",
    status: "queued",
    requestId: "request-1",
    ...overrides,
  };
}

test("source labels group supported sources and explicitly mark unknown attribution", () => {
  assert.deepEqual(labRequestSource("hook:publish"), {
    key: "hook",
    label: "Hook",
    raw: "hook:publish",
    known: true,
  });
  assert.equal(labRequestSource("").label, "Unknown source");
  assert.equal(labRequestSource("carrier-pigeon").known, false);
  assert.match(labRequestSource("carrier-pigeon").label, /^Unknown source/);
});

test("read model derives active runs, phase, estimates, and capability actions", () => {
  const data = board([request()]);
  data.activeRequestAgentRuns = [activeRun({ status: "running" })];
  const [item] = buildLabRequestListItems(
    data,
    ["canViewRequests", "canComment", "canRunAgent"],
  );
  assert.equal(item.lifecycle, "running");
  assert.equal(item.run.active, true);
  assert.equal(item.run.status, "running");
  assert.equal(item.run.workflowStatus, "running");
  assert.deepEqual(item.phase, { key: "work", label: "Work", type: "agent", known: true });
  assert.equal(item.source.key, "discord");
  assert.equal(item.estimatedHumanHoursLabel, "1.5h human");
  assert.equal(item.allowedActions.invokeCurrentStep.allowed, false);
  assert.match(item.allowedActions.invokeCurrentStep.reason ?? "", /active/);
});

test("human gate actions require canRunAgent and a clear, inactive gate", () => {
  const gated = request({ currentWorkflowStepKey: "approve", workflowRunStatus: "active" });
  const [active] = buildLabRequestListItems(board([gated]), ["canViewRequests", "canRunAgent"]);
  assert.equal(active.hasHumanGate, true);
  assert.equal(active.run.active, false);
  assert.equal(active.lifecycle, "open");
  assert.equal(active.allowedActions.continueHumanGate.allowed, true);

  const queuedData = board([gated]);
  queuedData.activeRequestAgentRuns = [activeRun()];
  const [queued] = buildLabRequestListItems(
    queuedData,
    ["canViewRequests", "canRunAgent"],
  );
  assert.equal(queued.run.active, true);
  assert.equal(queued.run.status, "queued");
  assert.equal(queued.lifecycle, "running");
  assert.equal(queued.allowedActions.continueHumanGate.allowed, false);

  const [member] = buildLabRequestListItems(board([gated]), ["canViewRequests"]);
  assert.equal(member.allowedActions.continueHumanGate.allowed, false);
  assert.match(member.allowedActions.continueHumanGate.reason ?? "", /canRunAgent/);
});

test("active recovery runs take precedence over prior attention while terminal remains final", () => {
  const blocked = request({
    workflowRunStatus: "running",
    workflowAttention: {
      status: "blocked",
      summary: "Missing approval",
      suggestedFix: "Ask an operator",
      blockers: [{ key: "approval" }],
      agentRunId: "run-1",
      workflowRunId: "workflow-run-1",
      workflowStepKey: "work",
      createdAt: "2026-01-02T00:00:00.000Z",
    },
  });
  const closed = request({
    id: "request-2",
    requestNumber: 8,
    currentWorkflowStepKey: "closed",
    workflowRunStatus: "completed",
  });
  const data = board([blocked, closed]);
  data.activeRequestAgentRuns = [activeRun({ status: "running" })];
  const [blockedItem, closedItem] = buildLabRequestListItems(data, ["canViewRequests"]);
  assert.equal(blockedItem.lifecycle, "running");
  assert.equal(blockedItem.attention.blockerCount, 1);
  assert.equal(closedItem.lifecycle, "completed");
});

test("unknown workflow phases remain explicit rather than inventing a phase", () => {
  const [item] = buildLabRequestListItems(
    board([request({ currentWorkflowStepKey: "migrated-step" })]),
    ["canViewRequests"],
  );
  assert.deepEqual(item.phase, {
    key: "migrated-step",
    label: "Migrated Step",
    type: "unknown",
    known: false,
  });
});

test("null request phase resolves the configured workflow entrypoint before the first step", () => {
  const workflowWithNonFirstEntrypoint: WorkflowRecord = {
    ...workflow,
    definition: {
      entrypoint: "approve",
      steps: workflow.definition.steps,
    },
  };
  const data = board([request({ currentWorkflowStepKey: null, workflowRunStatus: null })]);
  data.workflows = [workflowWithNonFirstEntrypoint];

  const [item] = buildLabRequestListItems(data, ["canViewRequests", "canRunAgent"]);

  assert.deepEqual(item.phase, {
    key: "approve",
    label: "Approve",
    type: "gate",
    known: true,
  });
  assert.equal(item.hasHumanGate, true);
  assert.equal(item.allowedActions.continueHumanGate.allowed, true);
  assert.equal(item.allowedActions.invokeCurrentStep.allowed, false);
});

test("immutable origin snapshot overrides loose source labels without exposing external subjects", () => {
  const data = board([request({
      source: "caller-controlled-label",
      requestedByDisplayName: null,
      origin: {
        sourceSessionId: "external-session", platform: "external", targetId: "partner-api", targetName: "Partner API",
        threadId: null, interfaceKey: "partner-api", interactionProfileKey: "partner-readonly", interactionProfileVersion: 4,
        actorType: "external-subject", actorId: null, actorDisplayName: null, sourceMessageId: "event-1",
        rawSource: "external", backfillStatus: "complete", capturedAt: "2026-01-01T00:00:00.000Z",
      },
    })]);
  const [item] = buildLabRequestListItems(data, ["canViewRequests"]);
  assert.equal(item.source.key, "external");
  assert.equal(item.requestedByDisplayName, "External subject");
  assert.equal(item.origin?.interactionProfileKey, "partner-readonly");
  assert.equal(item.searchText.includes("partner-api"), true);
  assert.equal(item.searchText.includes("caller-controlled-label"), false);
});
