import type { Capability } from "@/lib/role-access";

export const labRequestLifecycles = [
  "open",
  "running",
  "attention",
  "completed",
  "all",
] as const;

export type LabRequestLifecycleFilter = (typeof labRequestLifecycles)[number];

export const labRequestAttentionFilters = [
  "all",
  "attention",
  "blocked",
  "clear",
] as const;

export type LabRequestAttentionFilter = (typeof labRequestAttentionFilters)[number];

export const labRequestSorts = [
  "attention",
  "updated-desc",
  "created-desc",
  "priority-desc",
] as const;

export type LabRequestSort = (typeof labRequestSorts)[number];

export type LabRequestFilterState = {
  query: string;
  lifecycle: LabRequestLifecycleFilter;
  phase: string | null;
  priority: string | null;
  source: string | null;
  target: string | null;
  profile: string | null;
  initiator: string | null;
  attention: LabRequestAttentionFilter;
  sort: LabRequestSort;
};

export type LabRequestSource = {
  /** Stable grouping key used by the source filter. */
  key: string;
  label: string;
  raw: string | null;
  known: boolean;
};

export type LabWorkflowPhase = {
  key: string | null;
  label: string;
  type: string;
  known: boolean;
};

export type LabRequestRunIndicator = {
  /** Highest-priority actual active agent-run status (running, claimed, then queued). */
  status: string | null;
  active: boolean;
  activeCount: number;
  failed: boolean;
  workflowStatus: string | null;
  workflowActive: boolean;
};

export type LabRequestAttentionIndicator = {
  required: boolean;
  blocked: boolean;
  status: "blocked" | "needs_attention" | "failed" | null;
  summary: string | null;
  suggestedFix: string | null;
  blockerCount: number;
};

export type LabActionDecision = {
  allowed: boolean;
  reason: string | null;
  requiredCapability: Capability;
};

export type LabRequestAllowedActions = {
  view: LabActionDecision;
  comment: LabActionDecision;
  uploadArtifact: LabActionDecision;
  continueHumanGate: LabActionDecision;
  invokeCurrentStep: LabActionDecision;
};

export type LabRequestListItem = {
  id: string;
  requestNumber: number;
  title: string;
  description: string;
  requestType: string;
  priority: string;
  workflowKey: string;
  lifecycle: Exclude<LabRequestLifecycleFilter, "all">;
  phase: LabWorkflowPhase;
  source: LabRequestSource;
  run: LabRequestRunIndicator;
  attention: LabRequestAttentionIndicator;
  hasHumanGate: boolean;
  estimatedHumanHours: number | null;
  estimatedHumanHoursLabel: string | null;
  requestedByDisplayName: string | null;
  origin?: LabRequestOriginSnapshot | null;
  createdAt: string;
  updatedAt: string;
  allowedActions: LabRequestAllowedActions;
  /** Pre-normalized, internal-only search haystack. */
  searchText: string;
};

export type LabRequestListData = {
  requests: LabRequestListItem[];
  totalCount: number;
  filteredCount: number;
  filters: LabRequestFilterState;
};

export type LabRequestOriginSnapshot = {
  sourceSessionId: string | null;
  platform:
    | "site"
    | "discord"
    | "telegram"
    | "buzz"
    | "external"
    | "task"
    | "hook"
    | "system"
    | "unknown";
  targetId: string | null;
  targetName: string | null;
  threadId: string | null;
  interfaceKey: string | null;
  interactionProfileKey: string | null;
  interactionProfileVersion: number | null;
  actorType: "user" | "external-subject" | "task" | "hook" | "system" | null;
  actorId: string | null;
  actorDisplayName: string | null;
  sourceMessageId: string | null;
  rawSource: string | null;
  backfillStatus: "complete" | "partial" | "unknown";
  capturedAt: string;
};

export type LabActivityItem = {
  id: string;
  requestId: string;
  requestNumber: number;
  kind: string;
  summary: string;
  occurredAt: string;
  needsAttention: boolean;
  runId: string | null;
  artifactId: string | null;
};

export type LabExecutionProfileSummary = {
  key: string;
  version: number;
  name: string;
  role: "worker" | "verifier" | "judge" | "orchestrator" | "specialist";
  contextContinuation: "session" | "step";
  handoff: "artifacts" | null;
  authorityMode: "read_only" | "propose" | "approved_write";
  enabled: boolean;
};

export type LabRequestReviewData = {
  request: LabRequestListItem;
  origin: LabRequestOriginSnapshot | null;
  activity: LabActivityItem[];
  executionProfiles: LabExecutionProfileSummary[];
};
