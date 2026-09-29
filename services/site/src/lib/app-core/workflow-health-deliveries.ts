import { getDb } from './db';

export type WorkflowHealthDelivery = { scopeKey: string; fingerprint: string; requestId: string;
  reportArtifactId: string; providerMessageId: string; deliveredAt: string };
export function getWorkflowHealthDelivery(scopeKey: string): WorkflowHealthDelivery | null {
  const row = getDb().prepare('SELECT * FROM workflow_health_deliveries WHERE scope_key=?').get(scopeKey) as
    | { scope_key: string; fingerprint: string; request_id: string; report_artifact_id: string; provider_message_id: string; delivered_at: string } | undefined;
  return row ? { scopeKey: row.scope_key, fingerprint: row.fingerprint, requestId: row.request_id,
    reportArtifactId: row.report_artifact_id, providerMessageId: row.provider_message_id, deliveredAt: row.delivered_at } : null;
}
export function recordWorkflowHealthDelivery(input: Omit<WorkflowHealthDelivery, 'deliveredAt'>): WorkflowHealthDelivery {
  const now = new Date().toISOString();
  getDb().prepare(`INSERT INTO workflow_health_deliveries
    (scope_key,fingerprint,request_id,report_artifact_id,provider_message_id,delivered_at)
    VALUES (?,?,?,?,?,?) ON CONFLICT(scope_key) DO UPDATE SET fingerprint=excluded.fingerprint,
    request_id=excluded.request_id,report_artifact_id=excluded.report_artifact_id,
    provider_message_id=excluded.provider_message_id,delivered_at=excluded.delivered_at`)
    .run(input.scopeKey, input.fingerprint, input.requestId, input.reportArtifactId, input.providerMessageId, now);
  return getWorkflowHealthDelivery(input.scopeKey)!;
}
