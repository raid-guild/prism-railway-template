# Assess

## Act and report

Authorized maintenance favors action on reversible configuration drift. When
intent is incomplete, choose the best evidence-backed, least disruptive
interpretation preserving existing approval and access boundaries. Record it
as an assumption to review, not as a request for advance governance approval.
For each assumption record the target, evidence, alternatives, chosen delta,
confidence, validation and rollback. Investigate available source content and
current controls before deciding. Only missing prerequisites, conflicting
concurrent edits, or changes outside existing authority block that item.
Assumptions alone must not prevent advancement to Repair.

Accept either Doctor findings or an authorized scheduled request-recovery sweep.
Read existing maintenance requests and receipts first; do not duplicate repairs
owned by another active run. For sweeps, inspect active/stuck requests and failed
runs within the requested window (default 48 hours), excluding this request.
Save maintenance-scan.json with request/run IDs and evidence. Obtain a fresh
Doctor report through the existing deterministic task when baseline is missing
or stale. The scanner and Doctor supply findings; the shared plan owns repairs.
Limit each batch to ten actionable targets, recording the remainder explicitly.

Read the newest stamped Doctor report and earlier repair receipts. Inspect current definitions and credentials through redacted agent APIs; stale reports are not current truth. Save maintenance-plan.json classifying each finding as already resolved, bounded configuration repair, credential entry, ambiguous policy decision, or genuine repository defect. Include exact targets, evidence and proposed deltas. Do not treat cross-domain execution as an error or replace skills by name similarity alone.

Save maintenance-plan.md explaining scope. Do not create a code request or alter configuration during assessment. Missing secrets must be entered in Gateway Settings, never chat. If no concrete authorized repair exists, record a no-action batch with precise unresolved questions and advance to Repair for a no-op handoff, then Verify for reporting. Item-level questions must not leave this workflow waiting for human input.

## Investigate before escalating

Treat explicit operator dispatch of this maintenance request as authorization to
investigate and perform bounded configuration repairs, not a requirement to ask
for approval again for every factual mapping. For missing skills, inspect the
complete /agent/skills catalog, including GitHub-backed source entries, source
revision/provenance and candidate content. Read the affected step instructions
and required operations. Establish a responsibility-by-responsibility mapping;
do not stop at a name mismatch, invent an alias, or substitute globally without
checking compatibility. If source content is inaccessible, record that precise
access limitation rather than declaring the skill absent.

For Gateway reads inspect the returned schema: /agent/gateway contains
gateway.connections as well as gateway.credentials. An empty credentials list
does not mean there are no connections. Distinguish absent connection, present
connection with missing secret, untested credential, and verified auth failure.
Report only redacted metadata; never infer secret availability from a label or
status alone, expose a value, or request a secret through chat.

For routing drift inspect the current graph, instructions, supported controls,
and active requests. Preserve documented approval/send-back/cancel semantics.
Escalate only the unresolved semantic choice, not the entire workflow inventory.

Partition maintenance-plan.json into actionable repairs, independent blocked
items, already-resolved findings, and optimization candidates. Each item needs
an evidence-backed delta, dependencies, validation and rollback plan. If any
independent authorized repair is actionable, finish assessment successfully so
the normal engine advances to Repair. Item-level blockers stay in the plan;
they must not become a whole-request needs_attention outcome prematurely.

Include optimizations supported by concrete evidence: unnecessarily shared
skills/context, redundant checks, incorrect executor fallbacks, and excessive
model tiers. Do not weaken review, verification, approval, security, ownership,
or domain behavior to reduce warnings or cost. Unproven cost/quality tradeoffs
are recommendations, not automatic changes.
