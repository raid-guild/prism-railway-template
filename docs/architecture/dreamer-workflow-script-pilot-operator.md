# Dreamer workflow-health pilot: provisioning and rollout

This implementation is code-only. It does not install a live workflow, create a
schedule, send Discord messages, or alter any existing Dreamer request. Run the
Site migration and deploy compatible Site and Task Runner versions before
registering the pilot. Rolling back to older services requires restoring an
agent-path manifest first; old workers cannot claim these script attempts.

## Prepare a reviewed revision

The reviewed source is
`services/site/scripts/dreamer-workflow-health-inspector.mjs`. Register its
exact bytes as a disabled `node-esm` task script named
`dreamer-workflow-health-inspector` through `POST /agent/task-scripts`, review
the returned full checksum, and enable only that fixed source. Then create an
immutable revision with `POST /agent/task-scripts/dreamer-workflow-health-inspector/revisions`
using `inputBinding: "workflow-health-snapshot-v1"`, `effectClass: "pure"`,
`timeoutMs: 30000`, and `outputMaxBytes: 262144`. Record the returned revision
ID and full checksum. Revisions retain source when the mutable task-script
authoring record changes. A disabled current script blocks new claims.

## Prepare, but do not enable, the workflow

Run `node services/site/scripts/build-dreamer-workflow-health-pilot.mjs` with
`--revision-id=… --checksum=sha256:… --workflow-keys=key1,key2
--scope-key=… --dreamer-profile=… --accountability-domain=…` to print a
reviewable `/agent/workflows` POST payload. Supply the instance's real Dreamer
profile and accountability domain; do not use the Admin fallback. Edit the
`requiredArtifacts` mapping to explicit names for each eligible workflow.
Empty lists mean “no artifact rule configured,” not “all artifacts optional.”
The generated payload has `enabled:false` and creates no task.

For a manual run, enable the reviewed workflow after deployment and create a
request whose `constraints.workflowHealth.requestNumbers` contains up to 25
explicit positive request numbers. The script does not discover or sweep all
requests. The snapshot reports truncated selection and missing/ineligible
targets as partial coverage. It reads metadata only, never provider bodies or
secrets, and does not repair target requests. The command-receipt check is
conservative: absent same-attempt receipts are unknown, not proof a command
failed. Lease audit currently reports `not_available` unless non-secret audit
references are added later; credential diagnoses stay unknown.

The normal route is inspection → full report → close. Incomplete evidence or
contract failure routes through Dreamer's read-only assessment before reporting.
An unchanged/clean result closes without Discord. The report step must attach
or link the full `workflow-health-report.md`, reconcile uncertain delivery,
and record a delivery receipt only after the provider accepts it. The Site
delivery fingerprint is updated through `/agent/workflow-health/deliveries`
after provider acceptance, never before. No second notification stream or
recurring task is created by this implementation.

Validate a clean/no-op request, a changed finding, incomplete evidence,
interruption and retry, fallback, stop, and restored agent-path manifest in a
canary before scheduling. Shadow-run at least ten representative requests and
record coverage gaps, latency, fallback rate, tokens, and end-to-end cost.
Only then consider attaching this step to an existing Dreamer lifecycle.
