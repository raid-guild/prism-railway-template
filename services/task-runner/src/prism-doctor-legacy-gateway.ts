type RecordValue = Record<string, unknown>;

export type LegacyGatewayFinding = {
  check: string;
  status: "failed";
  subjectType: "workflow";
  subjectKey: string;
  stepKey?: string | null;
  expected: string;
  observed: string;
  recommendation: string;
  evidence: Record<string, unknown>;
};

const legacyAgentConfigKeys = [
  "gatewayToolsets",
  "gateway_toolsets",
  "gatewayCapabilities",
  "gateway_capabilities",
] as const;

const legacyInstructionPatterns = [
  { marker: "PRISM_RUNTIME_TOOLSET_URL", pattern: /\bPRISM_RUNTIME_TOOLSET_URL\b/i },
  { marker: "PRISM_RUNTIME_TOOLSET_TOKEN", pattern: /\bPRISM_RUNTIME_TOOLSET_TOKEN\b/i },
  { marker: "legacy admin toolset key", pattern: /\b[a-z][a-z0-9-]*\.admin\b/i },
  { marker: "Gateway HTTP toolset", pattern: /\b(?:gateway\s+)?http\s+toolset\b/i },
  { marker: "Gateway toolset", pattern: /\bgateway\s+toolset\b/i },
] as const;

function isRecord(value: unknown): value is RecordValue {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function workflowKey(workflow: RecordValue) {
  return typeof workflow.key === "string" && workflow.key.trim()
    ? workflow.key.trim()
    : "unknown-workflow";
}

function agentConfig(value: unknown) {
  return isRecord(value) ? value : {};
}

function configuredLegacyKeys(value: unknown) {
  const config = agentConfig(value);
  return legacyAgentConfigKeys.filter((key) => {
    const candidate = config[key];
    return Array.isArray(candidate) ? candidate.length > 0 : candidate !== undefined && candidate !== null;
  });
}

function legacyInstructionMarkers(content: unknown) {
  if (typeof content !== "string" || !content.trim()) return [];
  return legacyInstructionPatterns
    .filter(({ pattern }) => pattern.test(content))
    .map(({ marker }) => marker);
}

function findingBase(subjectKey: string) {
  return {
    status: "failed" as const,
    subjectType: "workflow" as const,
    subjectKey,
    expected: "Workflow uses Gateway credential leases and normal provider API access without legacy toolset configuration.",
    recommendation: "Remove legacy toolset fields and instructions, assign gatewayCredentials when deterministic access is needed, and use the provider's normal SDK, CLI, HTTP API, OpenAPI client, or MCP client.",
  };
}

export function legacyGatewayWorkflowFindings(input: {
  workflow: RecordValue;
  detail?: RecordValue | null;
}): LegacyGatewayFinding[] {
  const subjectKey = workflowKey(input.workflow);
  const definition = isRecord(input.workflow.definition) ? input.workflow.definition : {};
  const steps = Array.isArray(definition.steps) ? definition.steps.filter(isRecord) : [];
  const findings: LegacyGatewayFinding[] = [];

  const rootKeys = configuredLegacyKeys(definition.agentConfig ?? definition.agent_config);
  if (rootKeys.length) {
    findings.push({
      ...findingBase(subjectKey),
      check: "workflow-does-not-use-legacy-gateway-toolsets",
      observed: `Workflow agent config still declares legacy fields: ${rootKeys.join(", ")}.`,
      evidence: { location: "agentConfig", fields: rootKeys },
    });
  }

  for (const step of steps) {
    const stepKey = typeof step.key === "string" && step.key.trim() ? step.key.trim() : "unknown-step";
    const stepKeys = configuredLegacyKeys(step.agentConfig ?? step.agent_config);
    if (stepKeys.length) {
      findings.push({
        ...findingBase(subjectKey),
        check: "workflow-step-does-not-use-legacy-gateway-toolsets",
        stepKey,
        observed: `Step agent config still declares legacy fields: ${stepKeys.join(", ")}.`,
        evidence: { location: "step.agentConfig", fields: stepKeys },
      });
    }

    const inlineMarkers = legacyInstructionMarkers(step.instructions);
    if (inlineMarkers.length) {
      findings.push({
        ...findingBase(subjectKey),
        check: "workflow-step-instructions-do-not-require-legacy-toolsets",
        stepKey,
        observed: `Inline step instructions still reference legacy Gateway toolset behavior: ${inlineMarkers.join(", ")}.`,
        evidence: { location: "step.instructions", markers: inlineMarkers },
      });
    }
  }

  const detail = isRecord(input.detail) ? input.detail : {};
  const detailSteps = Array.isArray(detail.steps) ? detail.steps.filter(isRecord) : [];
  for (const step of detailSteps) {
    const markers = legacyInstructionMarkers(step.instructionContent ?? step.instruction_content);
    if (!markers.length) continue;
    const stepKey = typeof step.key === "string" && step.key.trim() ? step.key.trim() : "unknown-step";
    findings.push({
      ...findingBase(subjectKey),
      check: "workflow-step-instructions-do-not-require-legacy-toolsets",
      stepKey,
      observed: `Step instruction file still references legacy Gateway toolset behavior: ${markers.join(", ")}.`,
      evidence: { location: "step.instructionContent", markers },
    });
  }

  return findings;
}
