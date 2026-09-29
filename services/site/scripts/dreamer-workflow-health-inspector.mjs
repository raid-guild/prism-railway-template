import { createHash } from 'node:crypto';
import { pathToFileURL } from 'node:url';

export function inspectWorkflowHealth(snapshot) {
const observedAt = snapshot.observedAt;
const checks = [];
const add = (target, key, status, summary, evidence = []) => checks.push({
  requestNumber: target.number, workflowKey: target.workflowKey ?? null,
  key, status, summary, evidence, observedAt,
});

for (const target of snapshot.targets ?? []) {
  if (target.coverage === 'ineligible_workflow') {
    add(target, 'coverage', 'not_applicable', 'Workflow is outside the configured allowlist');
    continue;
  }
  if (target.coverage !== 'observed') {
    add(target, 'coverage', 'unknown', `Could not inspect target: ${target.coverage}`);
    continue;
  }
  if (target.historyTruncated) {
    add(target, 'history-coverage', 'unknown', 'Recent run, event, or command-receipt history was truncated by the snapshot limit');
  }
  const run = target.workflowRun;
  if (!run) {
    add(target, 'terminal-projection', 'unknown', 'Workflow run record was unavailable');
  } else {
    const mismatch = (run.status === 'completed' && !target.closedAt) ||
      (target.closedAt && run.status !== 'completed' && run.status !== 'canceled') ||
      (target.requestStep && target.requestStep !== run.stepKey);
    add(target, 'terminal-projection', mismatch ? 'finding' : 'pass',
      mismatch ? 'Request and workflow run projections disagree' : 'Request and workflow projections agree',
      [{ kind: 'workflow-run', id: run.id }]);
  }

  const attempts = [...(target.agentRuns ?? []), ...(target.scriptRuns ?? [])];
  for (const attempt of attempts) {
    if (attempt.status !== 'running') continue;
    const expired = attempt.leaseExpiresAt && attempt.leaseExpiresAt < observedAt;
    add(target, `ownership:${attempt.id}`, expired ? 'finding' : 'pass',
      expired ? 'Running attempt has an expired lease' : 'Running attempt has an active lease',
      [{ kind: 'attempt', id: attempt.id }]);
  }
  if (attempts.length === 0) add(target, 'ownership', 'not_applicable', 'No recent attempts in the observation window');

  const names = new Set((target.artifacts ?? []).map((artifact) => artifact.name));
  for (const name of target.requiredArtifacts ?? []) {
    const found = names.has(name);
    const terminal = run?.status === 'completed';
    add(target, `required-artifact:${name}`, found ? 'pass' : terminal ? 'finding' : 'unknown',
      found ? `Required artifact ${name} is present` : terminal ? `Completed run lacks required artifact ${name}` :
        `Artifact ${name} is not present while the run may still be active`,
      found ? (target.artifacts ?? []).filter((artifact) => artifact.name === name).map((artifact) => ({ kind: 'artifact', id: artifact.id })) : []);
  }
  if ((target.requiredArtifacts ?? []).length === 0) add(target, 'required-artifacts', 'not_applicable', 'No artifact rules configured');

  const receipts = target.commandReceipts ?? [];
  for (const attempt of target.agentRuns ?? []) {
    const receipt = receipts.find((entry) => entry.runId === attempt.id);
    if (!receipt) {
      add(target, `command-receipt:${attempt.id}`, 'unknown', 'No same-attempt command completion receipt was available',
        [{ kind: 'attempt', id: attempt.id }]);
    } else if (receipt.status === 'completed' && receipt.exitCode === 0 && !receipt.truncated) {
      add(target, `command-receipt:${attempt.id}`, 'pass', 'Command completion receipt is complete',
        [{ kind: 'artifact', id: receipt.id }]);
    } else {
      add(target, `command-receipt:${attempt.id}`, 'unknown', 'Command receipt does not prove a completed command',
        [{ kind: 'artifact', id: receipt.id }]);
    }
    const credentialDiagnosis = typeof attempt.errorCode === 'string' && /CREDENTIAL|WALLET|SECRET|KEY/i.test(attempt.errorCode);
    if (credentialDiagnosis) {
      const audit = target.credentialLeaseAudit;
      add(target, `credential-diagnosis:${attempt.id}`, 'unknown',
        audit?.status === 'not_available' ? 'Credential diagnosis has no accessible lease audit reference' :
          'Lease audit alone cannot prove runtime presence or absence', [{ kind: 'attempt', id: attempt.id }]);
    }
  }
}

const reportable = checks.filter((item) => item.status === 'finding' || item.status === 'unknown');
const fingerprintInput = reportable.map((item) => [item.requestNumber, item.key, item.status, item.summary]).sort((a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b)));
const fingerprint = `sha256:${createHash('sha256').update(JSON.stringify(fingerprintInput)).digest('hex')}`;
const previous = snapshot.previousDeliveredFingerprint;
const coverage = snapshot.coverage ?? {};
const unchanged = previous === fingerprint;
const incomplete = coverage.partial === true || reportable.some((item) => item.status === 'unknown');
const result = { version: 1, scopeKey: snapshot.reportScopeKey ?? null, fingerprint,
  previousDeliveredFingerprint: previous ?? null, unchanged, coverage,
  checks, findings: checks.filter((item) => item.status === 'finding'),
  unknowns: checks.filter((item) => item.status === 'unknown'),
  assumptionsToReview: incomplete ? ['Some evidence was unavailable; unknown checks are not a proof of failure or credential absence.'] : [] };
const outcome = unchanged || (reportable.length === 0 && !coverage.partial)
  ? 'no_op' : incomplete ? 'escalate' : 'completed';
return { outcome, result };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  let text = '';
  for await (const chunk of process.stdin) text += chunk;
  process.stdout.write(JSON.stringify(inspectWorkflowHealth(JSON.parse(text))));
}
