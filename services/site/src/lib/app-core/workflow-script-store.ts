import { createHash, randomUUID } from 'node:crypto';
import { getDb } from './db';

export type ScriptOutcome = 'completed' | 'no_op' | 'escalate' | 'failed';
export type WorkflowScriptRun = {
  id: string; requestId: string; workflowRunId: string; stepKey: string; iterationKey: string;
  attempt: number; revisionId: string; checksum: string; config: Record<string, unknown>;
  input: Record<string, unknown>; inputChecksum: string; profileId: string | null;
  policy: Record<string, unknown>; status: string; leaseToken: string | null;
  leaseExpiresAt: string | null; output: Record<string, unknown> | null;
  errorCode: string | null; exitCode: number | null; receiptArtifactId: string | null;
  resultArtifactId: string | null; advancementAt: string | null; createdAt: string;
  claimedAt: string | null; finishedAt: string | null; updatedAt: string;
};
export type ScriptRevision = {
  id: string; scriptKey: string; checksum: string; source: string; runtime: 'node-esm';
  contractVersion: 1; inputBinding: string; effectClass: 'pure'; timeoutMs: number;
  outputMaxBytes: number; createdBy: string; createdAt: string;
};

type RunRow = Record<string, unknown>;
const json = (value: unknown, fallback: Record<string, unknown> = {}) => {
  try { const parsed = JSON.parse(String(value)); return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : fallback; }
  catch { return fallback; }
};
const mapRun = (row: RunRow): WorkflowScriptRun => ({
  id: String(row.id), requestId: String(row.request_id), workflowRunId: String(row.workflow_run_id),
  stepKey: String(row.step_key), iterationKey: String(row.iteration_key), attempt: Number(row.attempt),
  revisionId: String(row.revision_id), checksum: String(row.checksum), config: json(row.config_json),
  input: json(row.input_json), inputChecksum: String(row.input_checksum), profileId: row.profile_id == null ? null : String(row.profile_id),
  policy: json(row.policy_json), status: String(row.status), leaseToken: row.lease_token == null ? null : String(row.lease_token),
  leaseExpiresAt: row.lease_expires_at == null ? null : String(row.lease_expires_at),
  output: row.output_json == null ? null : json(row.output_json), errorCode: row.error_code == null ? null : String(row.error_code),
  exitCode: row.exit_code == null ? null : Number(row.exit_code), receiptArtifactId: row.receipt_artifact_id == null ? null : String(row.receipt_artifact_id),
  resultArtifactId: row.result_artifact_id == null ? null : String(row.result_artifact_id),
  advancementAt: row.advancement_at == null ? null : String(row.advancement_at), createdAt: String(row.created_at),
  claimedAt: row.claimed_at == null ? null : String(row.claimed_at), finishedAt: row.finished_at == null ? null : String(row.finished_at),
  updatedAt: String(row.updated_at),
});
const mapRevision = (row: RunRow): ScriptRevision => ({
  id: String(row.id), scriptKey: String(row.script_key), checksum: String(row.checksum), source: String(row.source),
  runtime: 'node-esm', contractVersion: 1, inputBinding: String(row.input_binding), effectClass: 'pure',
  timeoutMs: Number(row.timeout_ms), outputMaxBytes: Number(row.output_max_bytes),
  createdBy: String(row.created_by), createdAt: String(row.created_at),
});

export function checksumScriptSource(source: string) {
  return `sha256:${createHash('sha256').update(source.trimEnd() + '\n').digest('hex')}`;
}
export function checksumScriptInput(input: unknown) {
  return `sha256:${createHash('sha256').update(JSON.stringify(input)).digest('hex')}`;
}

export function createScriptRevision(input: {
  scriptKey: string; source: string; runtime: 'node-esm'; inputBinding: string;
  timeoutMs: number; outputMaxBytes: number; createdBy: string;
}): ScriptRevision {
  const db = getDb();
  const canonical = input.source.trimEnd() + '\n';
  const checksum = checksumScriptSource(canonical);
  const existing = db.prepare('SELECT * FROM script_revisions WHERE script_key = ? AND checksum = ? AND input_binding = ? AND contract_version = 1')
    .get(input.scriptKey, checksum, input.inputBinding) as RunRow | undefined;
  if (existing) {
    return mapRevision(existing);
  }
  const id = randomUUID();
  const now = new Date().toISOString();
  db.prepare(`INSERT INTO script_revisions
    (id,script_key,checksum,source,runtime,contract_version,input_binding,effect_class,timeout_ms,output_max_bytes,created_by,created_at)
    VALUES (?,?,?,?,?,1,?,'pure',?,?,?,?)`).run(id, input.scriptKey, checksum, canonical, input.runtime,
    input.inputBinding, input.timeoutMs, input.outputMaxBytes, input.createdBy, now);
  return getScriptRevision(id)!;
}
export function getScriptRevision(id: string): ScriptRevision | null {
  const row = getDb().prepare('SELECT * FROM script_revisions WHERE id = ?').get(id) as RunRow | undefined;
  return row ? mapRevision(row) : null;
}
export function listScriptRevisions(scriptKey: string): ScriptRevision[] {
  return (getDb().prepare('SELECT * FROM script_revisions WHERE script_key = ? ORDER BY created_at DESC').all(scriptKey) as RunRow[])
    .map(mapRevision);
}
export function getWorkflowScriptRun(id: string): WorkflowScriptRun | null {
  const row = getDb().prepare('SELECT * FROM workflow_script_runs WHERE id = ?').get(id) as RunRow | undefined;
  return row ? mapRun(row) : null;
}
export function listWorkflowScriptRuns(requestId: string, limit = 100): WorkflowScriptRun[] {
  return (getDb().prepare('SELECT * FROM workflow_script_runs WHERE request_id = ? ORDER BY created_at DESC LIMIT ?')
    .all(requestId, Math.max(1, Math.min(limit, 500))) as RunRow[]).map(mapRun);
}
export function listActiveWorkflowScriptRuns(limit = 200): WorkflowScriptRun[] {
  return (getDb().prepare("SELECT * FROM workflow_script_runs WHERE status IN ('queued','running','canceling','completing') ORDER BY created_at DESC LIMIT ?")
    .all(Math.max(1, Math.min(limit, 500))) as RunRow[]).map(mapRun);
}
export function activeWorkflowScriptRun(workflowRunId: string): WorkflowScriptRun | null {
  const row = getDb().prepare("SELECT * FROM workflow_script_runs WHERE workflow_run_id = ? AND status IN ('queued','running','canceling','completing')")
    .get(workflowRunId) as RunRow | undefined;
  return row ? mapRun(row) : null;
}
export function enqueueWorkflowScriptAttempt(input: {
  requestId: string; workflowRunId: string; stepKey: string; iterationKey: string; revisionId: string;
  checksum: string; config: Record<string, unknown>; snapshot: Record<string, unknown>;
  profileId: string | null; policy: Record<string, unknown>;
}): WorkflowScriptRun {
  const db = getDb();
  const create = db.transaction(() => {
    const active = activeWorkflowScriptRun(input.workflowRunId);
    if (active) return active;
    const agent = db.prepare("SELECT id FROM agent_runs WHERE workflow_run_id = ? AND status IN ('queued','running') LIMIT 1")
      .get(input.workflowRunId);
    if (agent) throw new Error('WORKFLOW_EXECUTOR_ACTIVE');
    const current = db.prepare('SELECT current_step_key,status FROM workflow_runs WHERE id = ?').get(input.workflowRunId) as
      | { current_step_key: string; status: string } | undefined;
    if (!current || current.status !== 'active' || current.current_step_key !== input.stepKey) {
      throw new Error('WORKFLOW_SCRIPT_STEP_MOVED');
    }
    const next = db.prepare('SELECT COALESCE(MAX(attempt),0)+1 AS attempt FROM workflow_script_runs WHERE workflow_run_id = ? AND step_key = ? AND iteration_key = ?')
      .get(input.workflowRunId, input.stepKey, input.iterationKey) as { attempt: number };
    const now = new Date().toISOString();
    const id = randomUUID();
    db.prepare(`INSERT INTO workflow_script_runs
      (id,request_id,workflow_run_id,step_key,iteration_key,attempt,revision_id,checksum,config_json,input_json,input_checksum,
       profile_id,policy_json,status,created_at,updated_at)
      VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,'queued',?,?)`)
      .run(id, input.requestId, input.workflowRunId, input.stepKey, input.iterationKey, next.attempt, input.revisionId,
        input.checksum, JSON.stringify(input.config), JSON.stringify(input.snapshot), checksumScriptInput(input.snapshot),
        input.profileId, JSON.stringify(input.policy), now, now);
    return getWorkflowScriptRun(id)!;
  });
  return create();
}

export function claimWorkflowScriptAttempt(leaseSeconds = 60): WorkflowScriptRun | null {
  const db = getDb();
  return db.transaction(() => {
    const row = db.prepare(`SELECT wsr.id FROM workflow_script_runs wsr
      JOIN script_revisions sr ON sr.id=wsr.revision_id
      JOIN task_scripts ts ON ts.key=sr.script_key AND ts.enabled=1
      WHERE wsr.status='queued' ORDER BY wsr.created_at LIMIT 1`).get() as { id: string } | undefined;
    if (!row) return null;
    const token = randomUUID();
    const now = new Date();
    db.prepare(`UPDATE workflow_script_runs SET status='running', lease_token=?, claimed_at=?, lease_expires_at=?,updated_at=? WHERE id=? AND status='queued'`)
      .run(token, now.toISOString(), new Date(now.getTime() + leaseSeconds * 1000).toISOString(), now.toISOString(), row.id);
    return getWorkflowScriptRun(row.id);
  })();
}
export function renewWorkflowScriptLease(id: string, token: string, leaseSeconds = 60): boolean {
  const now = new Date();
  return getDb().prepare("UPDATE workflow_script_runs SET lease_expires_at=?,updated_at=? WHERE id=? AND lease_token=? AND status='running' AND lease_expires_at>?")
    .run(new Date(now.getTime() + leaseSeconds * 1000).toISOString(), now.toISOString(), id, token, now.toISOString()).changes === 1;
}
export function beginWorkflowScriptCompletion(input: {
  id: string; token: string; outcome: ScriptOutcome; result: Record<string, unknown>;
  exitCode: number; errorCode?: string | null;
}): WorkflowScriptRun | null {
  const db = getDb();
  return db.transaction(() => {
    const run = getWorkflowScriptRun(input.id);
    if (!run || run.status !== 'running' || run.leaseToken !== input.token || !run.leaseExpiresAt || run.leaseExpiresAt <= new Date().toISOString()) return null;
    const now = new Date().toISOString();
    db.prepare(`UPDATE workflow_script_runs SET status='completing', output_json=?, exit_code=?, error_code=?,lease_expires_at=NULL,updated_at=? WHERE id=?`)
      .run(JSON.stringify({ outcome: input.outcome, result: input.result }), input.exitCode, input.errorCode ?? null, now, input.id);
    return getWorkflowScriptRun(input.id);
  })();
}
export function finishWorkflowScriptAttempt(input: { id: string; status: ScriptOutcome | 'canceled' | 'superseded'; receiptArtifactId: string; resultArtifactId: string }): WorkflowScriptRun | null {
  const db = getDb();
  return db.transaction(() => {
    const run = getWorkflowScriptRun(input.id);
    if (!run || run.status !== 'completing') return null;
    const now = new Date().toISOString();
    db.prepare('UPDATE workflow_script_runs SET status=?,receipt_artifact_id=?,result_artifact_id=?,finished_at=?,updated_at=? WHERE id=?')
      .run(input.status, input.receiptArtifactId, input.resultArtifactId, now, now, input.id);
    return getWorkflowScriptRun(input.id);
  })();
}
export function attachFailedWorkflowScriptArtifacts(input: { id: string; receiptArtifactId: string; resultArtifactId: string }): WorkflowScriptRun | null {
  const db = getDb();
  db.prepare(`UPDATE workflow_script_runs SET receipt_artifact_id=?,result_artifact_id=?,updated_at=?
    WHERE id=? AND status='failed' AND advancement_at IS NULL AND receipt_artifact_id IS NULL`)
    .run(input.receiptArtifactId, input.resultArtifactId, new Date().toISOString(), input.id);
  return getWorkflowScriptRun(input.id);
}
export function markWorkflowScriptAdvanced(id: string): boolean {
  const now = new Date().toISOString();
  return getDb().prepare('UPDATE workflow_script_runs SET advancement_at=?,updated_at=? WHERE id=? AND advancement_at IS NULL')
    .run(now, now, id).changes === 1;
}
export function supersedeWorkflowScriptAttempt(id: string, reason: string): boolean {
  const now = new Date().toISOString();
  return getDb().prepare(`UPDATE workflow_script_runs SET status='superseded',error_code=?,advancement_at=?,updated_at=?
    WHERE id=? AND advancement_at IS NULL AND status IN ('completed','no_op','escalate','failed')`)
    .run(reason, now, now, id).changes === 1;
}
export function listUnadvancedWorkflowScriptRuns(): WorkflowScriptRun[] {
  return (getDb().prepare("SELECT * FROM workflow_script_runs WHERE (status IN ('completed','no_op','escalate','failed') OR status='completing') AND advancement_at IS NULL ORDER BY created_at LIMIT 100")
    .all() as RunRow[]).map(mapRun);
}
export function expireWorkflowScriptLeases(): number {
  const now = new Date().toISOString();
  const db = getDb();
  return db.transaction(() => {
    const expired = db.prepare("UPDATE workflow_script_runs SET status='failed',error_code='SCRIPT_LEASE_EXPIRED',lease_token=NULL,lease_expires_at=NULL,finished_at=?,updated_at=? WHERE status='running' AND lease_expires_at<?")
      .run(now, now, now).changes;
    const disabled = db.prepare(`UPDATE workflow_script_runs SET status='failed',error_code='SCRIPT_DISABLED',finished_at=?,updated_at=?
      WHERE status='queued' AND NOT EXISTS (
        SELECT 1 FROM script_revisions sr JOIN task_scripts ts ON ts.key=sr.script_key
        WHERE sr.id=workflow_script_runs.revision_id AND ts.enabled=1)`).run(now, now).changes;
    const canceled = db.prepare("UPDATE workflow_script_runs SET status='canceled',lease_token=NULL,lease_expires_at=NULL,finished_at=?,updated_at=? WHERE status='canceling' AND lease_expires_at<?")
      .run(now, now, now).changes;
    return expired + disabled + canceled;
  })();
}
export function cancelWorkflowScriptRuns(workflowRunId: string): number {
  const now = new Date().toISOString();
  const db = getDb();
  return db.transaction(() => {
    const running = db.prepare("UPDATE workflow_script_runs SET status='canceling',updated_at=? WHERE workflow_run_id=? AND status='running'")
      .run(now, workflowRunId).changes;
    const other = db.prepare("UPDATE workflow_script_runs SET status='canceled',lease_token=NULL,lease_expires_at=NULL,finished_at=?,updated_at=? WHERE workflow_run_id=? AND status IN ('queued','completing')")
      .run(now, now, workflowRunId).changes;
    return running + other;
  })();
}
export function requestWorkflowScriptCancellation(id: string): WorkflowScriptRun | null {
  const db = getDb();
  const now = new Date().toISOString();
  db.prepare("UPDATE workflow_script_runs SET status=CASE WHEN status='running' THEN 'canceling' ELSE 'canceled' END,updated_at=?,finished_at=CASE WHEN status='queued' THEN ? ELSE finished_at END WHERE id=? AND status IN ('queued','running')")
    .run(now, now, id);
  return getWorkflowScriptRun(id);
}
export function acknowledgeWorkflowScriptCancellation(id: string, token: string): boolean {
  const now = new Date().toISOString();
  return getDb().prepare("UPDATE workflow_script_runs SET status='canceled',lease_token=NULL,lease_expires_at=NULL,finished_at=?,updated_at=? WHERE id=? AND status='canceling' AND lease_token=?")
    .run(now, now, id, token).changes === 1;
}
