import {
  getChangeRequestByNumber, getWorkflowRunForRequest, listAgentRuns,
  listWorkflowEventsForRequest, listWorkflowScriptRuns, type ChangeRequestRecord,
  getWorkflowHealthDelivery, getDb,
} from '@/lib/app-core';

type Config = Record<string, unknown>;
const strings = (value: unknown) => Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string' && item.length > 0) : [];
const numbers = (value: unknown) => Array.isArray(value) ? value.filter((item): item is number => Number.isSafeInteger(item) && item > 0) : [];
const object = (value: unknown): Record<string, unknown> => value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {};

export function workflowScriptSnapshot(input: { request: ChangeRequestRecord; binding: string; config: Config }) {
  const observedAt = new Date().toISOString();
  if (input.binding === 'request-snapshot-v1') {
    return { version: 1, binding: input.binding, observedAt, request: {
      id: input.request.id, number: input.request.requestNumber, workflowKey: input.request.workflowKey,
      stepKey: input.request.currentWorkflowStepKey, runStatus: input.request.workflowRunStatus,
      closedAt: input.request.closedAt,
    } };
  }
  if (input.binding !== 'workflow-health-snapshot-v1') throw new Error('WORKFLOW_SCRIPT_INPUT_BINDING_UNSUPPORTED');
  const selection = object(input.request.constraints.workflowHealth);
  const selected = numbers(selection.requestNumbers).slice(0, 25);
  const requestedCount = numbers(selection.requestNumbers).length;
  const eligible = new Set(strings(input.config.eligibleWorkflowKeys));
  const required = object(input.config.requiredArtifacts);
  const reportScopeKey = String(input.config.reportScopeKey);
  const priorDelivery = getWorkflowHealthDelivery(reportScopeKey);
  const windowHours = typeof input.config.windowHours === 'number' && Number.isInteger(input.config.windowHours)
    ? Math.min(168, Math.max(1, input.config.windowHours)) : 24;
  const since = new Date(Date.now() - windowHours * 3_600_000).toISOString();
  let remainingBytes = 120_000;
  const targets = selected.map((number) => {
    const request = getChangeRequestByNumber(number);
    if (!request) return { number, coverage: 'missing_request' };
    if (!eligible.has(request.workflowKey)) return { number, coverage: 'ineligible_workflow', workflowKey: request.workflowKey };
    const workflowRun = getWorkflowRunForRequest(request.id);
    const requiredNames = strings(required[request.workflowKey]);
    // Required artifacts are lifetime-scoped to this workflow run, not the observation window.
    const artifacts = requiredNames.flatMap((name) => {
      if (!workflowRun) return [];
      const row = getDb().prepare(`SELECT id,name,created_at FROM request_artifacts
        WHERE request_id=? AND workflow_run_id=? AND name=? ORDER BY created_at DESC LIMIT 1`)
        .get(request.id, workflowRun.id, name) as { id: string; name: string; created_at: string } | undefined;
      return row ? [{ id: row.id, name: row.name, createdAt: row.created_at }] : [];
    });
    const receiptRows = workflowRun ? getDb().prepare(`SELECT id,
      json_extract(metadata_json,'$.agentRunId') AS run_id,
      json_extract(metadata_json,'$.status') AS status,
      json_extract(metadata_json,'$.exitCode') AS exit_code,
      json_extract(metadata_json,'$.truncated') AS truncated,
      created_at FROM request_artifacts
      WHERE request_id=? AND workflow_run_id=? AND name='command-completion-receipt.json' AND created_at>=?
      ORDER BY created_at DESC LIMIT 50`).all(request.id, workflowRun.id, since) as Array<{
        id: string; run_id: unknown; status: unknown; exit_code: unknown; truncated: unknown; created_at: string }> : [];
    const agentHistory = listAgentRuns({ requestId: request.id, limit: 100 }).filter((run) => run.createdAt >= since);
    const scriptHistory = listWorkflowScriptRuns(request.id, 100).filter((run) => run.createdAt >= since);
    const eventHistory = listWorkflowEventsForRequest(request.id, 100).filter((event) => event.createdAt >= since);
    const agentRuns = agentHistory.slice(0, 30);
    const scriptRuns = scriptHistory.slice(0, 30);
    const events = eventHistory.slice(0, 30);
    const target = {
      number, coverage: 'observed', workflowKey: request.workflowKey, requestId: request.id,
      requestStep: request.currentWorkflowStepKey, requestRunStatus: request.workflowRunStatus,
      closedAt: request.closedAt, updatedAt: request.updatedAt,
      workflowRun: workflowRun ? { id: workflowRun.id, status: workflowRun.status, stepKey: workflowRun.currentStepKey,
        completedAt: workflowRun.completedAt, updatedAt: workflowRun.updatedAt } : null,
      requiredArtifacts: requiredNames,
      artifacts,
      historyTruncated: agentHistory.length > agentRuns.length || scriptHistory.length > scriptRuns.length ||
        eventHistory.length > events.length || receiptRows.length === 50,
      agentRuns: agentRuns.map((run) => ({ id: run.id, stepKey: run.workflowStepKey, status: run.status,
        startedAt: run.startedAt, finishedAt: run.finishedAt, leaseExpiresAt: run.leaseExpiresAt,
        errorCode: typeof run.result?.errorCode === 'string' ? run.result.errorCode : null })),
      scriptRuns: scriptRuns.map((run) => ({ id: run.id, stepKey: run.stepKey, status: run.status,
        attempt: run.attempt, claimedAt: run.claimedAt, finishedAt: run.finishedAt, leaseExpiresAt: run.leaseExpiresAt,
        receiptArtifactId: run.receiptArtifactId, errorCode: run.errorCode })),
      events: events.map((event) => ({ id: event.id, type: event.eventType, stepKey: event.stepKey, createdAt: event.createdAt })),
      credentialLeaseAudit: { status: 'not_available', references: [] },
      commandReceipts: receiptRows.map((row) => ({
        id: row.id, runId: typeof row.run_id === 'string' ? row.run_id : null,
        status: typeof row.status === 'string' ? row.status : 'unknown',
        exitCode: typeof row.exit_code === 'number' ? row.exit_code : null,
        truncated: row.truncated === 1 || row.truncated === true,
        createdAt: row.created_at,
      })),
    };
    const bytes = Buffer.byteLength(JSON.stringify(target));
    if (bytes > 8_000 || bytes > remainingBytes) return { number, coverage: 'snapshot_budget_exceeded' };
    remainingBytes -= bytes;
    return target;
  });
  return { version: 1, binding: input.binding, observedAt, windowStart: since,
    reportScopeKey, previousDeliveredFingerprint: priorDelivery?.fingerprint ?? null,
    coverage: { requested: requestedCount, selected: selected.length, cap: 25,
      partial: requestedCount > 25 || targets.some((target) => target.coverage !== 'observed' ||
        ('historyTruncated' in target && target.historyTruncated === true)) },
    targets };
}
