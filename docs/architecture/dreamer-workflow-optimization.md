# Dreamer workflow optimization and bounded Jev routing

Status: **partially implemented locally**. The reviewed-source, read-only script
pilot exists in the working tree but is not installed or enabled on a live
instance. Dreamer-generated scripts, Jev routing, automatic promotion, and
effectful extraction remain future work. This specification does not change
any live workflow, schedule, routing policy, credential grant, or Dreamer authority.

Implementation follow-through: [Workflow script pilot plan](dreamer-workflow-script-pilot-plan.md)
defines the first two implementation PRs: request-owned script execution and a
read-only Dreamer evidence inspector. Jev and effectful extraction remain later.

## Intent

Dreamer should learn from repeated workflow execution and move stable work out
of model-driven steps into tested deterministic scripts. Jev should help select
an allowed workflow or a small tool/skill shortlist when deterministic routing
cannot decide. These are complementary optimizations, not a replacement for
request history, agent judgment, or existing authorization.

Goals:

- Reduce repeated reasoning, prompt size, latency, and measured total cost.
- Learn from successful runs, failures, operator corrections, and recoveries.
- Automatically adopt eligible improvements under explicit standing authority.
- Preserve request-backed execution, evidence, retries, delivery, and closure.
- Report assumptions and questionable changes after acting within that authority.

Non-goals:

- A universal autonomous code deployer or unrestricted self-modifying agent.
- New approval gates for routine optimization already covered by policy.
- Replacing every agent step, or routing all requests through another model.
- Moving provider secrets into scripts, fixtures, prompts, or request artifacts.
- Treating a correct classification as permission to execute a tool or workflow.

## Existing foundation versus proposed work

| Area | Existing behavior | Proposed addition |
| --- | --- | --- |
| Scripts | Site-owned `/agent/task-scripts` metadata/content; Task Runner executes `node-esm` without a shell | Immutable execution revisions and replay/promote records |
| Conditional work | `script-runner` tasks can invoke an agent when `shouldEscalate` is exactly `true` | Request-preserving script-to-agent fallback inside workflows |
| Workflow lifecycle | Site owns steps, events, artifacts, execution/recovery state | First-class deterministic step dispatch with equivalent lifecycle support |
| Optimization | Dreamer can reason about maintenance evidence | Bounded discovery, extraction, evaluation, adoption, and rollback pipeline |
| Jev | Optional Memory annotation pilot | Separate bounded request-routing and shortlist use cases |

The current task handoff returns an agent response; it does not automatically
create a request or a workflow. Do not use it as an untracked substitute for
request-backed agent work. Current workflow autostart and Task Runner continuation
recognize agent/loop execution; a documented `command` label is not proof of a
complete script-step executor. Assess validation and dispatch, then implement
the missing lifecycle support before promoting workflow steps to scripts.

The Memory Jev pilot classifies revision-bound summary candidates into annotations.
It does not route requests, grant tool access, or currently drive Memory search.
Reuse its provider integration and evidence discipline where appropriate, but
keep routing policy, storage identity, evaluations, and rollout independent.

## Proposed architecture

1. **Observe:** a request-backed Dreamer optimization workflow reads execution
   evidence for policy-eligible workflows and proposes bounded candidates.
2. **Extract:** generate a script revision, schemas, fixtures, and fallback contract.
3. **Evaluate:** replay offline, then shadow against live read-only inputs.
4. **Adopt:** promote an eligible revision within standing authority; retain the
   prior revision and original agent path.
5. **Measure:** compare outcomes and total cost; roll back on regression.

Site remains the configuration and lifecycle owner. Task Runner remains a
deterministic execution host; factor or reuse its script execution primitive
rather than building an agent-shaped shell runner in Site. The exact internal
dispatch transport is an implementation decision, not an API introduced here.
Existing `/agent/task-scripts` and `/agent/workflows` remain authoring surfaces;
revision pinning and promotion semantics require implementation and tests.

### First-class workflow script execution

Use a proposed `script` step type, subject to manifest compatibility review.
Its contract references a script key plus immutable revision/checksum, input and
output schema versions, artifact bindings, resource limits, and an explicit
agent fallback. Do not put executable code into workflow manifests.

Each execution must preserve the request ID, workflow run, step, attempt ID,
executor identity, effective authority, timestamps, revision, and artifact links.
Site owns state transitions and cancellation; the execution host returns a
validated result. A restart must not make a dispatched attempt indistinguishable
from one that never ran. Script runs need truthful UI/history representation,
not fictitious model usage or an invisible task-run-only side channel.

Proposed result outcomes are `completed`, `no_op`, `escalate`, `failed`, and
`unknown_effect`; these names are a design contract, not current API fields.
Only validated completion/no-op advances normally. `escalate` enters the
configured agent path in the same request with its evidence and execution receipt.
Invalid output is an error, not an implicit no-op. Preserve existing gates and
terminal semantics; routine uncertainty should use agent fallback, not add HITL.

### Evidence and extraction contract

An optimization candidate records workflow/step revision, source run and artifact
IDs, observation window, failure/correction cases, and the behavior being retained.
Suitable first candidates include normalization, pagination, receipt checking,
deduplication, stable API retrieval, and deterministic eligibility filters.
Keep subjective selection, novel research, and scope negotiation in agent steps.

Every candidate includes:

- Versioned script source, runtime/dependency identity, and content checksum.
- Input/output schemas, preconditions, postconditions, and escalation reasons.
- Sanitized fixtures with source provenance, access scope, and expected results.
- Explicit effects, credential requirements, idempotency strategy, and limits.
- Assumptions, known exclusions, evaluation results, and previous fallback version.

Do not transcribe secrets or untrusted run output into executable instructions.
Historical success is evidence, not a specification: compare observed behavior
with current workflow intent and incorporate later human corrections.

### Replay and effect safety

Offline replay substitutes recorded provider responses and intercepts **all**
external effects, including POST-based reads, message delivery, and CRM writes.
A `dryRun` flag alone is insufficient. Use isolated execution, no live write
credentials, controlled network access, bounded output, and time/process limits.
Shadow mode may read authorized live state but must not duplicate real effects.

Production scripts use stable operation identities and persist attempt receipts
before effects. Read back provider identifiers before reporting success. Retry
only when absence of the prior effect is established or provider idempotency
guarantees it. A timeout after submission is an unknown result, not proof of
failure: reconcile first, and never blindly replay through either script or agent.
Rollbacks restore future execution behavior; they do not undo external effects.

## Bounded automatic adoption

An instance policy defines eligible workflows/steps, effect classes, maximum
blast radius, evaluation thresholds, execution budgets, canary limits, and rollback
triggers. Within that standing authority, Dreamer may test and promote without
asking for approval each time. Record the policy version and decision evidence.

Start with pure transforms and read-only retrieval. Permit idempotent existing
writes only when their effect and reconciliation contracts pass evaluation.
Promotion must not expand credentials, target scope, recipients, permitted writes,
publication/spend limits, or reserved operator decisions. Unclear cases retain the
existing agent path; report the uncertainty rather than stall unrelated work.

Use compare-and-swap against the evaluated workflow revision to avoid overwriting
concurrent edits. Pin executions to their starting revision; promotion affects
new attempts only. After adoption, publish a report through the instance's normal
Dreamer destination containing the diff, evidence, assumptions to review,
measured results, exclusions, and rollback reference. No-change sweeps stay quiet.

## Bounded Jev request routing

Routing precedence is explicit:

1. Enforce access policy, disabled state, and allowed workflow/tool/skill catalog.
2. Honor an authorized explicit workflow choice, continuation, or existing request.
3. Apply deterministic surface bindings and unambiguous configured routing rules.
4. Ask Jev only about remaining ambiguity among the eligible candidates.
5. Validate its selection; otherwise use the normal agent router with the same
   restricted catalog and recorded evidence. Do not default to a change request.

Jev returns a bounded classification or ranked shortlist, never executable code,
new capabilities, arbitrary endpoints, or a workflow definition. Tool/skill
shortlisting reduces discovery context; it does not remove mandatory workflow
skills or prevent authorized fallback discovery. Revalidate current availability
and access immediately before execution. Prefer abstention to a forced match.

Calibrate acceptance thresholds on representative held-out cases, including
operator-corrected misroutes. Provider probability is not automatically calibrated
confidence; combine it with schema validity, ambiguity/margin checks, policy
constraints, and measured error cost. Provider errors, budget exhaustion, or
unsupported cases fall back to the agent, not a new human approval gate.

Cache identity includes exact normalized input and relevant conversation state,
provider/model identity, routing policy version, candidate catalog revisions,
and organization/profile/binding/access scope. Do not share cache entries across
authority boundaries. Moving model aliases need explicit cache invalidation or
a recorded provider version; cache only under a documented freshness policy.
Cached output is advisory and cannot bypass live authorization checks.

## Evaluation, metrics, and rollout

Separate extraction examples from held-out evaluation by request lineage/time;
near-duplicate reruns must not leak across the split. Include failures, recoveries,
missing inputs, rate limits, duplicates, partial effects, stale catalogs, malicious
source text, and human corrections. Compare against desired corrected outcomes,
not merely the prior agent answer. Report coverage gaps and sample counts.

Measure end-to-end success, wrong-route rate, unsafe/effect mismatches, duplicate
effects, escalation/abstention rate, recovery time, and p50/p95 latency. Report
tokens and actual total cost per successful request, including extraction,
development/evaluation, Jev calls, fallback agents, retries, maintenance, and
hosting. Do not claim savings from lower inference cost alone; record amortization
assumptions and observe net benefit over an agreed window.

### Delivery phases and acceptance

1. **Baseline and contracts:** audit existing script dispatch and request state;
   define policy, fixtures, budgets, and baseline metrics. No live substitution.
2. **Workflow execution primitive:** implement revision pinning and lifecycle
   integration. Tests cover validation, artifacts, cancellation, concurrency,
   restart recovery, agent fallback, unknown effects, and terminal closure.
3. **Dreamer pilot:** extract one pure/read-only step; pass held-out and shadow
   checks, then automatically canary under policy. Prove rollback before widening.
4. **Jev shadow pilot:** compare ambiguous routing/shortlists with corrected labels;
   test deterministic precedence, cache isolation, and provider-failure fallback.
5. **Bounded adoption:** enable eligible routing and script promotions only after
   agreed quality/cost thresholds pass. Writes require proven effect reconciliation.

Regression triggers include authority violations, duplicate effects, elevated
error/escalation rates, worse net cost, or contract drift. Stop new candidate
dispatch, restore the last known-good revision/agent path, reconcile in-flight
effects, and save incident evidence. Jev can be disabled independently while
deterministic bindings and agent routing continue. No schedule is enabled by this
document; any future optimization schedule follows request-backed task ownership.

## References

- [Script runner tasks](../features/script-runner-tasks.md)
- [Site-owned task scripts](site-owned-task-scripts.md) — original design plus handoff constraints.
- [Memory Jev pilot](../../services/prism-memory/examples/jev-task/README.md)
- [Workflow author guidance](../../services/site/skills/prism-workflow-author/SKILL.md)
- Execution touchpoints: `services/task-runner/src/index.ts`,
  `services/task-runner/src/script-agent-handoff.ts`, and
  `services/site/src/lib/workflow-autostart.ts`.
