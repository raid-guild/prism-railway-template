# Prism Maintenance

## Completion contract

This workflow completes a bounded maintenance batch, not a guarantee of zero
Doctor findings. Investigate and attempt authorized repairs, verify what changed,
save unresolved findings and questions, and deliver the configured report.
Unresolved item-level findings are operator-authorized deferrals to the report,
not human-in-the-loop gates. Close with an explicit partial outcome after report
delivery; never call deferred findings fixed. Follow-up answers and later sweeps
use linked requests and the durable backlog rather than holding this run open.
Actual execution or report-delivery failures remain retryable technical failures.

Default to act, verify, and report for authorized reversible internal repairs.
Resolve incomplete intent using the best-supported assumption and flag it for
follow-up review with before/after evidence and rollback. Governance uncertainty
alone is not a blocker. This does not authorize changing access, bypassing human
approval boundaries, destructive actions, spending, or unrelated publishing.

Repair workflow/configuration drift and apply evidence-backed, behavior-preserving
optimizations. Assessment is a discovery phase, not a blanket approval gate.
Independent safe repairs proceed even when other findings require operator input;
verification owns the final unresolved-items decision. Doctor remains report-only
until an operator dispatches maintenance. Approved scheduled sweeps and Doctor
findings enter this same workflow. Legacy workflow-repair-loop requests retain
their history but new sweeps use prism-maintenance.

Own instance configuration diagnosis, bounded repair and verification without requiring a repository, PR or code-review gate. Doctor creates an unstarted request; detecting findings is not authorization to mutate the instance. Explicit operator dispatch authorizes the scoped maintenance work, not blanket permission to eliminate every warning.

Dreamer is the explicit executor, not an Admin fallback. Keep source reports,
decisions and receipts as request artifacts. Preserve historical runs and custom
configuration. Code, credentials, access policy, business decisions, destructive
operations and external publishing need separate authority. Never create a CR
merely because a credential, skill or configuration route is missing.

Memory work is recommendation-only: inspect relevant evidence and propose
improvements with provenance. Do not rewrite, delete, rebuild, reclassify or
promote memory. Do not change Dreamer's own authority, bindings or schedules.
