# Long-running agent steps

Agent execution and external-job waiting are different concerns. Keep ordinary
verification as an agent step. Today's checkpoint is an operator-triggered
external-state check and stays at that checkpoint after checking; adding one to
verification would introduce a manual pause, not solve execution timeouts.

## Runtime budget

The Codex adapter reports `progress-aware-timeouts` and
`durable-terminal-results` in its capabilities. Other adapters must implement
these guarantees independently; Site does not infer support from their names.

- `PRISM_RUNTIME_IDLE_TIMEOUT_MS`: no meaningful execution events for this long.
  Defaults to legacy `CODEX_RUNTIME_TIMEOUT_MS`, or 20 minutes when unset.
- `PRISM_RUNTIME_MAX_DURATION_MS`: absolute execution ceiling, default 60 minutes.
  Configure this consistently on Site and the runtime. Site's workflow polling
  deadline includes a further 60 seconds for finalization/transport.
- A workflow's effective `agentConfig.executionBudget` can narrow either limit
  with `idleTimeoutMs` and `maxDurationMs`. It cannot widen runtime limits.
  This is currently an adapter capability, not a profile settings UI feature.

Tool starts/completions/updates and assistant messages count as progress;
polling, stderr, and heartbeat noise do not. A silent long-running shell command
can still hit the idle deadline. Choose the idle budget accordingly, or use a
separate external-job submission/status workflow with a durable job identifier.
Activity never extends the absolute maximum. Timeout terminates the child and
escalates to SIGKILL after five seconds. Normal cancellation remains available.

## Durable results and recovery

Terminal normalized results are atomically written to
`PRISM_RUNTIME_RECEIPTS_DIR`, defaulting to `.runtime-receipts` under the target
workspace root. Use a persistent Railway volume. Job inputs and credential
leases are not stored; result text and traces remain sensitive server-side data.
The receipt directory currently retains results until operator cleanup.

After restart or in-memory eviction, GET of the same normalized job ID can
recover its terminal response. Site's bounded last poll accepts a verified
runtime success before canceling on a transport deadline. Persistence errors
fail closed. This does not resume processes interrupted by deployment, make job
creation idempotency survive restart, or atomically commit across Site and
runtime databases. Further Site run reconciliation is needed for a Site process
that itself restarts before applying a result.

A `verification.json` artifact is evidence, not a terminal runtime receipt.
Never automatically advance based on its filename or `passed` field. For
request #2325, validate run provenance and the exact current PR head in a
bounded recovery verification before using the normal review transition.
No implementation or deployment should be repeated merely to recover a lost
verification handoff.
