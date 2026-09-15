export type GatewayCaller = {
  id: "site" | "codex-runtime" | "task-runner";
  kind: "service" | "runtime";
  runtimeKey: string | null;
  token: string;
};

export type GatewayConfig = {
  port: number;
  dbPath: string;
  masterKey: Buffer;
  masterKeyVersion: string;
  previousMasterKeys: Array<{ key: Buffer; keyVersion: string }>;
  callers: GatewayCaller[];
};

export type GatewayConnection = {
  id: string;
  key: string;
  provider: string;
  label: string;
  authType: string;
  configuration: Record<string, string>;
  envBindings: Record<string, string>;
  status: "untested" | "leased" | "revoked";
  secretNames: string[];
  lastTestedAt: string | null;
  lastUsedAt: string | null;
  createdAt: string;
  updatedAt: string;
};

export type GatewayStoredCredential = {
  id: string;
  name: string;
  source: "environment-import" | "admin";
  createdAt: string;
  updatedAt: string;
};

export type GatewayInvocationContext = {
  delegatedActorId?: string;
  requestId?: string;
  workflowRunId?: string;
  workflowStepKey?: string;
  runtimeJobId?: string;
};

export type GatewayAuditEvent = {
  id: string;
  traceId: string;
  credentialKey: string;
  authenticatedCallerId: string;
  delegatedActorId: string | null;
  requestId: string | null;
  workflowRunId: string | null;
  workflowStepKey: string | null;
  status: "denied" | "succeeded" | "failed";
  policyDecision: string;
  latencyMs: number | null;
  errorCode: string | null;
  inputSummary: Record<string, unknown> | null;
  outputSummary: Record<string, unknown> | null;
  createdAt: string;
};
