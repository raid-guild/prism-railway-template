import { getScriptRevision, workflowAgentExecutor } from '@/lib/app-core';
import { findStepByKey, stepType, workflowSteps } from '@/lib/workflow-steps';

const supportedBindings = new Set(['request-snapshot-v1', 'workflow-health-snapshot-v1']);
const record = (value: unknown): value is Record<string, unknown> => Boolean(value) && typeof value === 'object' && !Array.isArray(value);

export function validateWorkflowScriptSteps(definition: Record<string, unknown>): string | null {
  const steps = workflowSteps(definition);
  const keys = new Set(steps.map((step) => step.key));
  if (keys.size !== steps.length) return 'WORKFLOW_STEP_KEYS_DUPLICATED';
  for (const step of steps) {
    const type = stepType(step);
    // Preserve pre-existing workflow authoring rules for non-script steps.
    if (type !== 'script') continue;
    const config = step.scriptConfig;
    if (!record(config)) return `WORKFLOW_SCRIPT_CONFIG_REQUIRED:${String(step.key)}`;
    const allowedFields = new Set(['scriptKey','revisionId','checksum','contractVersion','inputBinding','effectClass',
      'timeoutMs','outputMaxBytes','fallbackStepKey','noOpNextStepKey','eligibleWorkflowKeys','requiredArtifacts','windowHours','reportScopeKey']);
    if (Object.keys(config).some((field) => !allowedFields.has(field))) return `WORKFLOW_SCRIPT_CONFIG_FIELD_UNSUPPORTED:${String(step.key)}`;
    const key = typeof config.scriptKey === 'string' ? config.scriptKey.trim() : '';
    const revisionId = typeof config.revisionId === 'string' ? config.revisionId.trim() : '';
    const checksum = typeof config.checksum === 'string' ? config.checksum.trim() : '';
    const binding = typeof config.inputBinding === 'string' ? config.inputBinding.trim() : '';
    const fallback = typeof config.fallbackStepKey === 'string' ? config.fallbackStepKey.trim() : '';
    const timeout = config.timeoutMs;
    const outputMax = config.outputMaxBytes;
    const revision = getScriptRevision(revisionId);
    if (!key || !revision || revision.scriptKey !== key || revision.checksum !== checksum || revision.runtime !== 'node-esm' || revision.effectClass !== 'pure') {
      return `WORKFLOW_SCRIPT_REVISION_INVALID:${String(step.key)}`;
    }
    if (config.contractVersion !== 1 || revision.contractVersion !== 1 || !supportedBindings.has(binding) || revision.inputBinding !== binding) {
      return `WORKFLOW_SCRIPT_CONTRACT_INVALID:${String(step.key)}`;
    }
    if (config.effectClass !== 'pure') return `WORKFLOW_SCRIPT_EFFECT_UNSUPPORTED:${String(step.key)}`;
    if (!Number.isInteger(timeout) || Number(timeout) < 1_000 || Number(timeout) > Math.min(30_000, revision.timeoutMs) ||
        !Number.isInteger(outputMax) || Number(outputMax) < 1_024 || Number(outputMax) > Math.min(262_144, revision.outputMaxBytes)) {
      return `WORKFLOW_SCRIPT_LIMITS_INVALID:${String(step.key)}`;
    }
    const fallbackStep = findStepByKey(steps, fallback);
    if (!fallbackStep || stepType(fallbackStep) !== 'agent' || fallback === step.key) {
      return `WORKFLOW_SCRIPT_FALLBACK_INVALID:${String(step.key)}`;
    }
    try { workflowAgentExecutor(definition, fallbackStep); }
    catch { return `WORKFLOW_SCRIPT_FALLBACK_EXECUTOR_UNRESOLVED:${String(step.key)}`; }
    if (typeof step.next !== 'string' || !keys.has(step.next)) return `WORKFLOW_SCRIPT_NEXT_INVALID:${String(step.key)}`;
    if (config.noOpNextStepKey !== undefined) {
      const noOp = typeof config.noOpNextStepKey === 'string' ? findStepByKey(steps, config.noOpNextStepKey) : null;
      if (!noOp || stepType(noOp) !== 'terminal') return `WORKFLOW_SCRIPT_NO_OP_ROUTE_INVALID:${String(step.key)}`;
    }
    if (binding === 'workflow-health-snapshot-v1') {
      if (typeof config.reportScopeKey !== 'string' || !/^[a-z0-9][a-z0-9-]{2,80}$/.test(config.reportScopeKey)) {
        return `WORKFLOW_SCRIPT_REPORT_SCOPE_INVALID:${String(step.key)}`;
      }
      if (!Array.isArray(config.eligibleWorkflowKeys) || config.eligibleWorkflowKeys.length === 0 ||
          config.eligibleWorkflowKeys.length > 50 || config.eligibleWorkflowKeys.some((key) => typeof key !== 'string' || !/^[a-z0-9-]+$/.test(key)) ||
          !record(config.requiredArtifacts) || Object.values(config.requiredArtifacts).some((names) =>
            !Array.isArray(names) || names.length > 20 || names.some((name) => typeof name !== 'string' || name.length > 100))) {
        return `WORKFLOW_SCRIPT_SNAPSHOT_CONFIG_INVALID:${String(step.key)}`;
      }
    }
  }
  return null;
}

export function validateWorkflowScriptResult(binding: string, result: Record<string, unknown>): string | null {
  if (binding !== 'workflow-health-snapshot-v1') return null;
  if (result.version !== 1 || typeof result.scopeKey !== 'string' ||
      typeof result.fingerprint !== 'string' || !/^sha256:[a-f0-9]{64}$/.test(result.fingerprint) ||
      !Array.isArray(result.checks) || !Array.isArray(result.findings) ||
      !Array.isArray(result.unknowns) || !record(result.coverage)) return 'SCRIPT_HEALTH_RESULT_INVALID';
  for (const check of result.checks) {
    if (!record(check) || !Number.isSafeInteger(check.requestNumber) ||
        typeof check.key !== 'string' || !['pass', 'finding', 'unknown', 'not_applicable'].includes(String(check.status)) ||
        typeof check.summary !== 'string' || typeof check.observedAt !== 'string' || !Array.isArray(check.evidence)) {
      return 'SCRIPT_HEALTH_CHECK_INVALID';
    }
  }
  return null;
}
