# Dreamer workflow script pilot: implementation plan

Status: local implementation of the first two slices, September 29, 2026;
review and rollout pending. No live workflow, schedule, credentials, or routing
changed. The rollout minimum and canary acceptance criteria below remain open.

Related specification: [Dreamer workflow optimization and bounded Jev routing](dreamer-workflow-optimization.md).

## Scope and defaults

Deliver request-owned deterministic script steps, then use one for a read-only
workflow-health evidence report. Dreamer handles ambiguous findings through an
agent fallback in the same request. Routine ambiguity does not create a human gate.

- Introduce explicit `type: "script"`; do not reinterpret legacy `command` steps.
- Reuse Task Runner's Node execution host, not Codex or a shell.
- Site owns attempts, artifacts, routing, cancellation, and terminal closure.
- Pin exact script bytes, inputs, and configuration for every attempt.
- Give the pilot bounded JSON evidence, not Site tokens or provider credentials.
- Configure adoption through persisted instance policy, not a new environment flag.
- Validate the pilot manually before enabling a schedule or changing existing ones.

Jev routing, gameplay decisions, publishing decisions, external-effect scripts,
and generalized autonomous code deployment are outside this slice. The inspector
does not repair the target requests it examines. Existing Dreamer recovery
authority is neither expanded nor removed.

## Verified baseline and implementation starting point

Inspected checkout: `docs/memory-upgrade-repair`, commit `1c7e5f2`. The parent
optimization draft was an untracked file. This is not a production deployment audit.

- Site's task-script migration and repository store one current record per key.
- `task-script-storage.ts` writes checksum-derived files, but does not provide an
  immutable revision registry or retention contract; filenames use a checksum prefix.
- Task Runner fetches current script content and runs `node-esm` without a shell,
  with timeout and bounded output.
- Workflow autostart handles agent and loop steps, not request-owned script steps.
- The existing agent queue provides queue/lease concepts to reuse.
- PR #98's task-to-agent handoff work is in the separate
  `codex/threat-handoff-recovery` worktree at `099e6b3`. It does not implement
  request-owned script execution.

Start implementation from refreshed canonical main, preserving this checkout's
work. Recheck these contracts and incorporate merged handoff/concurrency fixes.
Do not revive older behavior merely because this planning checkout contains it.

## PR 1 — Reliable workflow script execution

### Immutable revisions

Add a numbered migration and storage/repository support for script revisions:
revision ID, script key, full checksum, canonical source, runtime/contract version,
input/output schema identity, effect class, limits, and creation provenance.

Keep `task_scripts` as the current authoring pointer; existing script-runner tasks
remain compatible. Workflow scripts pin revision and full checksum. Recompute the
checksum before execution. Preserve referenced revisions; disablement prevents
new claims without deleting history. Old orphaned files are not reliable history.

### Manifest and execution contract

Proposed manifest fields, not existing API fields:

```json
{
  "key": "inspect-evidence",
  "type": "script",
  "scriptConfig": {
    "scriptKey": "dreamer-workflow-health-inspector",
    "revisionId": "<immutable-revision>",
    "checksum": "sha256:<full-digest>",
    "contractVersion": 1,
    "inputBinding": "workflow-health-snapshot-v1",
    "effectClass": "pure",
    "timeoutMs": 30000,
    "outputMaxBytes": 262144,
    "fallbackStepKey": "assess-findings"
  },
  "next": "report-results"
}
```

Validate revision/checksum, runtime, bounds, schema compatibility, and fallback
target. Require an explicit executor for the fallback agent. Keep source and
schemas outside the manifest. Unsupported steps fail validation, not silently run
as agents. Ship only pure execution in this slice.

Add `workflow_script_runs`, not fictitious agent runs or a universal execution
framework. Record request/workflow/step/iteration, attempt, pinned revision and
configuration, input artifact/checksum, accountable profile/policy, status,
lease/fencing token, timestamps, exit code, validated outcome, and artifact IDs.
Retries create new attempts.

Task Runner claims pending attempts through authenticated Site service routes
under `/agent/*`; final route names are an implementation detail. Site resolves
inputs and authority. A factored runner executes and returns bounded results.
The child receives neither the parent environment nor Site's service token.
Do not create scheduler tasks for individual steps or use a direct Codex handoff
as workflow fallback.

### Race conditions, cancellation, and restarts

Enforce execution ownership transactionally across agent and script attempts for
the same workflow run. A separate active-check followed by insertion is insufficient.

Persist validated artifacts, mark the attempt terminal, and then advance or queue
fallback exactly once. Use a recoverable completion record so a crash between
these stages cannot lose advancement. Never advance while the prior attempt
still owns execution. Duplicate callbacks return the recorded result; stale
leases cannot alter workflow state.

Pin configuration at dispatch. If the request moved, canceled, or was edited
incompatibly, retain returned evidence without advancing the newer state.
Cancellation terminates child processes and descendants. Old workers must not
claim unsupported versions. For pure steps, one fenced retry is allowed after
interruption; never run fallback concurrently with a live child. An exhausted
script retry enters the configured agent fallback with evidence. An agent failure
remains a truthful retryable failure, not an infinite fallback loop.

### Validated outcomes and UI

Require exit code zero plus one size-bounded, schema-valid JSON result. Empty,
truncated, malformed, timed-out, or nonzero output is not a no-op.

- `completed`: valid inspection result; normal next step.
- `no_op`: valid unchanged result; normal closure/report suppression path.
- `escalate`: incomplete/ambiguous evidence; configured agent fallback.
- `failed`: contract/execution failure; bounded retry then fallback.
- `unknown_effect`: reserved for later effectful execution; never blind replay.

Site chooses routing, not arbitrary script-returned destinations. Save a
`script-execution-receipt.json` and validated result as request artifacts, with
attempt identifiers. Never store credentials or unbounded raw diagnostics.

Show script attempts honestly in request history, counts, status, and stop/retry
controls; do not invent model usage. Integrate autostart, continuation, loops, and
closure while preserving gate/checkpoint behavior. Deploy compatible services
and migration before installing manifests. Restore agent-path manifests before
downgrading to services without script support.

## PR 2 — Read-only Dreamer inspector and reporting

Use a fixed reviewed script revision first. Site prepares a bounded snapshot for
up to 25 explicitly selected requests from an eligible workflow allowlist and a
fixed observation window. Partial coverage is visible, never called a complete sweep.

Snapshot contents:

- Run/step identities, observation times, execution state and terminal metadata.
- Explicit required-artifact definitions and matching artifact metadata.
- Structured command-completion receipts, when present.
- Accessible non-secret credential-lease audit references.
- Previous successfully reported findings fingerprint.
- Missing inputs, fetch failures, and coverage boundaries.

Required-artifact rules must be explicit configuration; the script must not infer
requirements from arbitrary prose. Do not ingest arbitrary artifact text as
instructions. The child does not fetch provider data, lease credentials, inspect
other processes, or change target requests.

Classify each check as `pass`, `finding`, `unknown`, or `not_applicable`, with
evidence references and observation time. Initial checks cover terminal projection
disagreement, expired/inconsistent ownership, required artifacts, command receipt
completeness, and whether credential diagnoses have supporting evidence.

A successful lease does not prove runtime presence. Historical presence does not
prove current availability. A pending command, empty output, missing receipt, or
receipt from another attempt does not prove absence. Changing active state during
inspection is not automatically a failure. Missing evidence is reported as unknown.

Normal flow: `inspect-evidence → report-results → closed`.
Ambiguous/error flow: `inspect-evidence → assess-findings → report-results → closed`.
Dreamer owns the fallback and reporting; resolve the instance's accountable domain
explicitly rather than adding an Admin fallback. Fallback stays read-only toward
target requests and reports unresolved questions without imposing HITL.

Save these attempt-linked artifacts:

- `workflow-health-snapshot.json`
- `workflow-health-findings.json`
- `workflow-health-report.md`
- `script-execution-receipt.json`

Attach or link the full report through the existing authorized Dreamer destination,
including assumptions to review and evidence links—not only a recap. Save the
delivery receipt. Compute meaningful-change fingerprints without incidental
timestamps; advance the delivered fingerprint only after confirmed delivery.
Unchanged/no-op sweeps close quietly. Delivery errors remain retryable and reconcile
prior delivery before resending. Missing evidence may close as an honestly reported
unresolved finding; it does not prevent other work from finishing.

Do not enable another notification stream by default. Prefer adding the validated
inspector to the existing Dreamer request lifecycle without altering its cadence.

## Later — Dreamer-generated scripts and automatic promotion

The existing subprocess runner is not a security sandbox. No shell and an empty
environment do not prevent Node filesystem or network access. The initial pilot
uses reviewed source only; do not describe it as isolated arbitrary-code execution.

Before executing Dreamer-generated candidates, enforce restricted filesystem,
no external network, no inherited credentials, and process/memory/output/time
limits in an isolated execution boundary. Static checks or `dryRun` alone do not
provide this boundary.

Within standing authority, promotion can then be automatic after held-out replay,
shadow comparison, workflow-revision compare-and-swap, and exercised rollback.
Retain the previous revision and agent path. Report the diff, measurements,
assumptions, and rollback reference afterward; add no routine approval gate.
Promotion affects new attempts, never in-flight execution. Jev and external-write
extraction remain separate follow-up phases.

## Implementation touchpoints

Confirm locations against main before editing:

- Site `src/lib/app-core/{repository.ts,task-script-storage.ts,migrations/}`.
- Site `src/app/agent/task-scripts/` and new script-attempt service routes.
- Site `src/lib/{workflow-autostart.ts,workflow-steps.ts,workflow-agent-run-queue.ts}`.
- Site `src/lib/prism-lab-routes/workflow-continue.ts`.
- Site `src/components/prism-lab/workflow-explorer.tsx` and request review/history.
- Task Runner `src/index.ts`; factor its script executor into a testable module.
- Workflow-author guidance and Doctor manifest validation.

Add focused modules for script queue/completion handling, snapshot schemas, and
the pure inspector. Reuse existing execution guards where adequate; strengthen
them once rather than layering independent locks.

## Tests and acceptance

Foundation tests cover revision pinning, checksum mismatch, disablement/deletion,
invalid manifests, duplicate claims/results, concurrent retry, stale completion,
cancellation, child cleanup, bounded output, invalid JSON, and empty output.
Inject crashes before dispatch, during execution, after artifact persistence,
and before advancement. Verify no stuck ownership or duplicate advancement, and
that fallback starts only after script ownership ends. Artifact persistence failure
cannot falsely advance. Existing tasks and agent/loop/gate workflows still pass.

Pilot fixtures cover clean completion, missing artifact, projection drift,
legitimate active/queued work, expired attempt, pending/empty command output,
successful lease without presence proof, wrong-attempt receipt, API denial/rate
limit, concurrent state change, partial coverage, and unchanged-report suppression.
Use corrected outcomes, not prior agent assertions, as expected labels.

Acceptance before broader rollout:

- No false credential-absence claims, secret disclosure, or target mutation.
- All defined fixture cases pass with traceable evidence.
- Ten representative shadow runs without lifecycle regression (a rollout minimum,
  not statistical proof); document coverage gaps.
- One canary proves normal closure, fallback, interruption recovery, and rollback.
- Discord receives the full report only on meaningful change.
- Record latency, fallback rate, tokens, and total cost including development,
  retries, and reporting; demonstrate net benefit before expansion.

First implement PR 1, then PR 2. Do not combine Jev or external-write optimization
with either PR. Remaining implementation decisions are transport route names,
schema library reuse, migration numbering, and the instance's pilot allowlist;
none require an extra governance gate for routine authorized work.
