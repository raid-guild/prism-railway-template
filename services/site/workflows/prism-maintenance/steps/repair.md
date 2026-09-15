# Repair

For request recovery, re-read current step, active runs, artifacts and external
receipts immediately before mutation. Never interrupt an active job or replay
an ambiguous external side effect. Use terminal reconciliation dry-run/apply
only for a verified terminal workflow projection. Retry a failed step at most
once per batch only when evidence establishes no side effect occurred, or the
operation is demonstrably idempotent and retains its original authorization.
Do not override human gates, close active work by assumption, or manually patch
request workflow state. Persist before/after run IDs and readback. If recovery
is still queued/running, report pending, not successful; verification must check.

Read maintenance-plan.json and source evidence. Apply bounded reversible configuration fixes within the operator's dispatched scope, including best-supported assumptions identified for follow-up review, using the relevant authoring skills and /agent APIs. Uncertainty alone is not a governance gate. Re-read before writing, preserve unrelated fields, snapshot non-secret before/after definitions and save maintenance-receipts.json. Record every assumption with evidence, alternatives, chosen change, validation and rollback, explicitly marked "assumption to review". Do not edit active workflow semantics without checking affected runs. Never bypass approval policy, invent skill equivalents, remove credentials, alter gameplay/business policy, or conceal unresolved failures to make Doctor green.

For missing secrets save a Gateway Settings handoff, never request or copy secrets. For a true code defect save repository-repair-proposal.md identifying the target, evidence, acceptance tests and scope; create a linked change-request-default only with explicit operator authorization and a verified repository target. Missing authorization defers that item to the follow-up report, not the entire run and not permission to create arbitrary CRs. Save unresolved items durably and let verification assess the actual results. A batch with no actionable items is a successful no-op handoff to Verify, not a human gate.

Process independent actionable items even when another item needs credentials
or a policy decision. Skip only dependent items, with precise reasons. Do not
stop the entire batch at the first blocker. Revalidate candidate skill content
and each affected step before migrating a reference; preserve source-backed
skills instead of creating shadow custom copies. Check installed definition
versions immediately before each write and stop that item on concurrent drift.

Apply behavior-preserving optimizations only when the plan supplies evidence,
validation, and rollback. Do not lower model tiers without representative
quality evidence. Record optimization proposals separately from applied repairs.
After all safe work, return a successful repair-step handoff to Verify with
partial results and blockers in the receipts. Only an unsafe condition affecting
the entire execution should stop this step before verification.
