import {
  buildRequestArtifactStoragePath, createRequestArtifact, createWorkflowEvent, enqueueWorkflowScriptAttempt,
  attachFailedWorkflowScriptArtifacts,
  getChangeRequest, getRequestArtifact, getWorkflowByKey, getWorkflowRunForRequest, getWorkflowScriptRun,
  getDb,
  getScriptRevision, getTaskScriptByKey,
  listUnadvancedWorkflowScriptRuns, markWorkflowScriptAdvanced, supersedeWorkflowScriptAttempt,
  updateChangeRequest, updateWorkflowRun,
  writeRequestArtifactFile, type WorkflowScriptRun,
} from '@/lib/app-core';
import { enqueueWorkflowAgentRun } from '@/lib/workflow-agent-run-queue';
import { findStepByKey, stepKey, stepType, workflowSteps } from '@/lib/workflow-steps';

async function saveArtifact(run: WorkflowScriptRun, suffix: string, name: string, content: unknown) {
  const id = `workflow-script-${run.id}-${suffix}`;
  if (getRequestArtifact(id)) return id;
  const body = Buffer.from(JSON.stringify(content, null, 2) + '\n', 'utf8');
  const storagePath = buildRequestArtifactStoragePath({ requestId: run.requestId, artifactId: id, name });
  await writeRequestArtifactFile(storagePath, body);
  createRequestArtifact({ id, requestId: run.requestId, workflowRunId: run.workflowRunId,
    kind: 'json', name, mimeType: 'application/json', storagePath, sizeBytes: body.byteLength,
    metadata: { scriptRunId: run.id, revisionId: run.revisionId, attempt: run.attempt }, createdBy: 'workflow-script' });
  return id;
}

function savedOutcome(run: WorkflowScriptRun) {
  const output = run.output;
  return output && typeof output.outcome === 'string' ? output.outcome : 'failed';
}

export async function finalizeWorkflowScriptAttempt(id: string) {
  const current = getWorkflowScriptRun(id);
  if (!current) return { ok: false, reason: 'SCRIPT_RUN_NOT_FOUND' };
  if (current.status === 'completing' || (current.status === 'failed' && !current.receiptArtifactId)) {
    const receiptId = await saveArtifact(current, 'receipt', 'script-execution-receipt.json', {
      version: 1, scriptRunId: current.id, requestId: current.requestId, workflowRunId: current.workflowRunId,
      stepKey: current.stepKey, attempt: current.attempt, revisionId: current.revisionId,
      checksum: current.checksum, inputChecksum: current.inputChecksum, outcome: savedOutcome(current),
      exitCode: current.exitCode, errorCode: current.errorCode,
    });
    const resultName = current.config.inputBinding === 'workflow-health-snapshot-v1'
      ? 'workflow-health-findings.json' : 'script-result.json';
    await saveArtifact(current, 'input', current.config.inputBinding === 'workflow-health-snapshot-v1'
      ? 'workflow-health-snapshot.json' : 'script-input.json', current.input);
    const resultId = await saveArtifact(current, 'result', resultName, current.output?.result ?? {});
    const { finishWorkflowScriptAttempt } = await import('@/lib/app-core');
    if (current.status === 'completing') {
      finishWorkflowScriptAttempt({ id, status: savedOutcome(current) as 'completed' | 'no_op' | 'escalate' | 'failed',
        receiptArtifactId: receiptId, resultArtifactId: resultId });
    } else {
      attachFailedWorkflowScriptArtifacts({ id, receiptArtifactId: receiptId, resultArtifactId: resultId });
    }
  }
  return advanceWorkflowScriptAttempt(id);
}

function advanceWorkflowScriptAttemptInTransaction(id: string) {
  const run = getWorkflowScriptRun(id);
  if (!run || run.advancementAt) return { ok: Boolean(run), duplicate: true };
  if (!['completed', 'no_op', 'escalate', 'failed'].includes(run.status)) return { ok: false, reason: 'SCRIPT_ATTEMPT_NOT_TERMINAL' };
  const request = getChangeRequest(run.requestId);
  const workflowRun = getWorkflowRunForRequest(run.requestId);
  const workflow = request ? getWorkflowByKey(request.workflowKey) : null;
  const steps = workflowSteps(workflow?.definition);
  const current = findStepByKey(steps, run.stepKey);
  if (!request || !workflowRun || workflowRun.id !== run.workflowRunId ||
      workflowRun.currentStepKey !== run.stepKey || workflowRun.status !== 'active') {
    supersedeWorkflowScriptAttempt(id, 'WORKFLOW_MOVED');
    createWorkflowEvent({ workflowRunId: run.workflowRunId, requestId: run.requestId, stepKey: run.stepKey,
      eventType: 'script.completion_ignored', actorType: 'system', payload: { scriptRunId: id, reason: 'workflow_moved' } });
    return { ok: true, ignored: true };
  }
  const currentConfig = current?.scriptConfig;
  const manifestChanged = !workflow || !current || stepType(current) !== 'script' ||
    (run.policy.workflowVersion !== undefined && workflow.version !== run.policy.workflowVersion) ||
    JSON.stringify(currentConfig) !== JSON.stringify(run.config) ||
    (run.policy.nextStepKey !== undefined && current.next !== run.policy.nextStepKey);
  if (manifestChanged) {
    supersedeWorkflowScriptAttempt(id, 'WORKFLOW_MANIFEST_CHANGED');
    createWorkflowEvent({ workflowRunId: run.workflowRunId, requestId: run.requestId, stepKey: run.stepKey,
      eventType: 'script.completion_ignored', actorType: 'system',
      payload: { scriptRunId: id, reason: 'workflow_manifest_changed', recovery: 'retry_current_step' } });
    return { ok: true, ignored: true, reason: 'WORKFLOW_MANIFEST_CHANGED' };
  }
  const revision = getScriptRevision(run.revisionId);
  const authored = revision ? getTaskScriptByKey(revision.scriptKey) : null;
  if (run.status === 'failed' && run.attempt < 2 && run.errorCode !== 'SCRIPT_DISABLED' && authored?.enabled) {
    const retry = enqueueWorkflowScriptAttempt({ requestId: run.requestId, workflowRunId: run.workflowRunId,
      stepKey: run.stepKey, iterationKey: run.iterationKey, revisionId: run.revisionId, checksum: run.checksum,
      config: run.config, snapshot: run.input, profileId: run.profileId, policy: run.policy });
    markWorkflowScriptAdvanced(id);
    createWorkflowEvent({ workflowRunId: run.workflowRunId, requestId: run.requestId, stepKey: run.stepKey,
      eventType: 'script.retried', actorType: 'system', payload: { previousScriptRunId: id, scriptRunId: retry.id } });
    return { ok: true, retryId: retry.id };
  }

  const targetKey = run.status === 'completed' ? current.next :
    run.status === 'no_op' ? run.config.noOpNextStepKey ?? current.next : run.config.fallbackStepKey;
  const next = typeof targetKey === 'string' ? findStepByKey(steps, targetKey) : null;
  if (!next) {
    supersedeWorkflowScriptAttempt(id, 'SCRIPT_ROUTE_INVALID');
    createWorkflowEvent({ workflowRunId: run.workflowRunId, requestId: run.requestId, stepKey: run.stepKey,
      eventType: 'script.completion_ignored', actorType: 'system',
      payload: { scriptRunId: id, reason: 'script_route_invalid', recovery: 'retry_current_step' } });
    return { ok: true, ignored: true, reason: 'SCRIPT_ROUTE_INVALID' };
  }
  const nextKey = stepKey(next)!;
  if (workflowRun.currentStepKey === run.stepKey) {
    updateChangeRequest(run.requestId, { workflowStepKey: nextKey });
    updateWorkflowRun({ requestId: run.requestId, currentStepKey: nextKey,
      status: stepType(next) === 'terminal' ? 'completed' : 'active',
      completedAt: stepType(next) === 'terminal' ? new Date().toISOString() : null });
    createWorkflowEvent({ workflowRunId: run.workflowRunId, requestId: run.requestId, stepKey: nextKey,
      eventType: 'workflow.step_changed', actorType: 'system', payload: { previousStepKey: run.stepKey,
        nextStepKey: nextKey, scriptRunId: id, outcome: run.status } });
  }
  if (stepType(next) === 'agent') {
    const result = enqueueWorkflowAgentRun({ request: getChangeRequest(run.requestId) ?? request,
      prompt: `Continue request #${request.requestNumber} after script attempt ${id}. Read the saved script receipt and findings artifacts.`,
      workflowAction: null });
    if (!result.queued) throw new Error(result.reason ?? 'SCRIPT_FALLBACK_QUEUE_FAILED');
  } else if (stepType(next) === 'script') {
    const result = enqueueWorkflowAgentRun({ request: getChangeRequest(run.requestId) ?? request,
      prompt: `Continue request #${request.requestNumber} after script attempt ${id}.`, workflowAction: null });
    if (!result.queued) throw new Error(result.reason ?? 'NEXT_SCRIPT_QUEUE_FAILED');
  }
  markWorkflowScriptAdvanced(id);
  createWorkflowEvent({ workflowRunId: run.workflowRunId, requestId: run.requestId, stepKey: run.stepKey,
    eventType: `script.${run.status}`, actorType: 'system', payload: { scriptRunId: id, nextStepKey: nextKey } });
  return { ok: true, nextStepKey: nextKey };
}

export function advanceWorkflowScriptAttempt(id: string) {
  try { return getDb().transaction(() => advanceWorkflowScriptAttemptInTransaction(id))(); }
  catch (error) { return { ok: false, reason: error instanceof Error ? error.message : 'SCRIPT_ADVANCEMENT_FAILED' }; }
}

export async function recoverWorkflowScriptCompletions() {
  const pending = listUnadvancedWorkflowScriptRuns();
  for (const run of pending) {
    try { await finalizeWorkflowScriptAttempt(run.id); }
    catch (error) { console.error(JSON.stringify({ event: 'workflow_script.recovery_failed', runId: run.id,
      error: error instanceof Error ? error.message : 'UNKNOWN' })); }
  }
  return pending.length;
}
