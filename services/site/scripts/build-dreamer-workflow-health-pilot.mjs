#!/usr/bin/env node
// Produces a disabled, reviewable /agent/workflows payload. It makes no API calls.
const args = Object.fromEntries(process.argv.slice(2).map((arg) => {
  const [key, ...rest] = arg.replace(/^--/, '').split('=');
  return [key, rest.join('=')];
}));
const required = ['revision-id', 'checksum', 'workflow-keys', 'scope-key', 'dreamer-profile', 'accountability-domain'];
const missing = required.filter((key) => !args[key]);
if (missing.length) {
  process.stderr.write(`Missing --${missing.join(', --')}; all arguments use --name=value. No changes made.\n`);
  process.exitCode = 2;
} else {
  const key = 'dreamer-workflow-health-pilot';
  const workflowKeys = args['workflow-keys'].split(',').map((value) => value.trim()).filter(Boolean);
  const requiredArtifacts = {};
  for (const workflowKey of workflowKeys) requiredArtifacts[workflowKey] = [];
  const manifest = {
    key, name: 'Dreamer workflow health pilot', version: 1,
    description: 'Read-only, request-owned workflow health inspection. No target repairs or scheduled launch.',
    entrypoint: 'inspect-evidence', defaultAgent: args['dreamer-profile'],
    agentConfig: { contextPolicy: { continuation: 'step', handoff: 'artifacts' } },
    steps: [
      { key: 'inspect-evidence', label: 'Inspect evidence', type: 'script',
        scriptConfig: { scriptKey: 'dreamer-workflow-health-inspector', revisionId: args['revision-id'],
          checksum: args.checksum, contractVersion: 1, inputBinding: 'workflow-health-snapshot-v1',
          effectClass: 'pure', timeoutMs: 30_000, outputMaxBytes: 262_144,
          eligibleWorkflowKeys: workflowKeys, requiredArtifacts, windowHours: 24,
          reportScopeKey: args['scope-key'], fallbackStepKey: 'assess-findings', noOpNextStepKey: 'closed' },
        next: 'report-results' },
      { key: 'assess-findings', label: 'Assess incomplete findings', type: 'agent',
        executorAgent: args['dreamer-profile'], instructionPath: 'steps/assess-findings.md', next: 'report-results' },
      { key: 'report-results', label: 'Report meaningful changes', type: 'agent',
        executorAgent: args['dreamer-profile'], instructionPath: 'steps/report-results.md', next: 'closed' },
      { key: 'closed', label: 'Closed', type: 'terminal' },
    ],
  };
  const files = {
    'workflow.md': `# Dreamer workflow health pilot\n\nThis is a read-only inspection of up to 25 explicit request numbers supplied in request constraints.workflowHealth.requestNumbers. The script has no provider access and no target-write authority. The workflow is disabled until manually validated. A script no-op closes quietly.\n`,
    'steps/assess-findings.md': `# Assess incomplete evidence\n\nRead the current request's workflow-health-snapshot.json and script-execution-receipt.json. Read workflow-health-findings.json if the script produced it; a failed script may have no findings artifact or only an empty result. Report missing evidence explicitly rather than inventing findings. Do not assume missing evidence proves failure, missing credentials, or failed delivery. Keep target requests unchanged. Resolve only from already-authorized, non-secret evidence; retain unknowns as unknowns. Save a concise assessment artifact, then continue to report-results. Do not create a human gate merely for an unresolved question.\n`,
    'steps/report-results.md': `# Report workflow health\n\nRead workflow-health-snapshot.json, workflow-health-findings.json, script-execution-receipt.json, and any Dreamer assessment. Produce a full workflow-health-report.md artifact linked to this request, including selected-request coverage, every finding and unknown with request/run/receipt references, assumptions to review, and any errors. Never claim a partial sweep was complete. Do not change target requests.\n\nBefore notifying Discord, compare the findings fingerprint with the last confirmed delivery for scope ${args['scope-key']}. If unchanged, finish silently. For meaningful change, use the authorized Dreamer channel binding to attach the full report or link its durable artifact; a short recap alone is insufficient. On transport uncertainty, reconcile prior delivery before resending. Only after Discord confirms acceptance with a provider message ID, POST /agent/workflow-health/deliveries with scopeKey, fingerprint, requestId, reportArtifactId and providerMessageId. Save the delivery receipt artifact. If delivery fails, leave this step retryable and do not mark the fingerprint delivered. Never expose service credentials in the report.\n`,
  };
  process.stdout.write(`${JSON.stringify({ key, enabled: false, accountabilityDomainKey: args['accountability-domain'], manifest, files }, null, 2)}\n`);
}
