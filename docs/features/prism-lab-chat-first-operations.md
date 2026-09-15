# Prism Lab: Chat-First Operations And Bounded Execution Profiles

## Status

Future feature specification. Slices 0–5 are implemented on the Lab feature
branch; later slices remain proposed.

The agent identity, ownership, navigation, and execution direction for the next
slices has been refined by field testing. See
[`prism-lab-agent-first-addendum.md`](./prism-lab-agent-first-addendum.md). The
addendum supersedes this document's profile split and Slices 6–8 where they
conflict; the implemented Slices 0–5 remain valid foundations.

This document proposes an additive, field-testable replacement for the current
Prism admin workspace. The new experience lives at `/admin/lab` inside the
existing Site service, operates on the live Prism instance through existing
authorization checks, and can later be promoted to `/admin` without a service
or data migration.

The work is deliberately divided into ordered slices. Early slices validate the
chat-first request experience. Later slices add trustworthy request provenance,
bounded execution profiles, independent verification and judgment, and
checkpoint-controlled orchestration.

## Product Thesis

Prism should feel like a chat-first operations console with a request inbox,
not a collection of equally prominent configuration dashboards.

The primary operator surfaces should be:

1. **Requests**: find work, understand its state, intervene, and review results.
2. **Console**: ask Prism to investigate, configure, create, or operate work.
3. **Settings**: manage the small set of security-sensitive connections and
   runtime controls that must remain explicit.

Tasks, skills, workflows, hooks, captures, target apps, and detailed settings
remain important system capabilities. They should become contextual tools,
secondary views, or chat-assisted configuration rather than competing top-level
destinations.

## Decisions

### Lab is a route, not another workspace tab

Build an independent UI shell under `/admin/lab` rather than adding another tab
to the existing `ChangeBoard` component.

Suggested route shape:

```text
/admin                         current UI during validation
/admin/lab                     Lab request inbox
/admin/lab/requests/:number    Lab request workspace
/admin/lab/console             Lab console
/admin/lab/activity            cross-request activity and attention
/admin/lab/settings            simplified settings entrypoint
```

The Lab may reuse low-level components and domain helpers, but it should not use
the current tab container as its application shell.

### Lab uses live instance state

Lab is not a sandbox and is not read-only by definition. Actions use the same
Site-owned state, workflows, Gateway, Runtime, roles, and capability checks as
the current UI.

Riskier actions may be introduced later than read and conversational actions,
but there must not be a separate Lab database or shadow workflow state.

### Lab remains inside the current Site service

Do not deploy a second state-owning Site service and do not mount the Site
SQLite volume into multiple services. The existing Site remains the only owner
of migrations and instance state.

This keeps rollout and rollback at the routing/UI layer:

```text
validate /admin/lab
  -> allow selected users to default to Lab
  -> move current UI to /admin/legacy
  -> promote Lab to /admin
  -> retire legacy components after parity is proven
```

### Profiles have distinct meanings

> **Superseded for future slices:** Field testing showed that these concerns
> need one first-class Agent Profile identity with supporting templates, skills,
> modes, bindings, ownership, and immutable run snapshots. See the
> [Agent-First Operations Addendum](./prism-lab-agent-first-addendum.md). The
> Interaction Profile records implemented for source policy remain valid
> migration substrate.

Do not use one overloaded "agent profile" object for every concern.

| Concept | Purpose |
| --- | --- |
| Interaction profile | Governs an incoming interface, channel, group, or user context. |
| Agent card | Names the accountable owner and operating mandate of a recurring workflow. |
| Execution profile | Governs how one workflow step runs, such as worker, verifier, judge, or orchestrator. |

An orchestration workflow may have an Orchestration Agent card as its primary
owner. Verifier and judge behavior inside that workflow should still be
step-level execution profiles, not additional competing workflow owners.

## Goals

- Make open requests and items needing attention immediately visible.
- Let an operator understand and operate a request through one conversational
  workspace.
- Preserve technical detail while moving it behind a clearer hierarchy.
- Show who or what initiated a request, which channel or interface it came
  from, and which interaction profile governed it.
- Make workflow steps, context boundaries, skills, artifacts, and run identity
  inspectable.
- Give worker, verifier, judge, and orchestrator runs explicit, versioned,
  bounded execution profiles.
- Make verification independent from implementation.
- Make orchestration state durable, resumable, and understandable without one
  indefinitely growing model conversation.
- Reuse the current workflow engine, Runtime, durable runs, artifacts, Gateway,
  and authorization model.
- Allow gradual field testing and a reversible promotion to the default UI.

## Non-Goals

- Do not create a second workflow engine or execution queue.
- Do not create a second Site database or state-owning service.
- Do not make every configuration screen conversational in the first slice.
- Do not allow generic, unaudited "agent calls agent" behavior.
- Do not allow an orchestrator to silently invent authority, credentials,
  owners, or enabled workflows.
- Do not make a judge both approve work and perform the corrective work.
- Do not treat model instructions as a substitute for server-side permissions.
- Do not expose service tokens, Gateway credentials, or interface credentials
  to browser code.
- Do not require a full organization or role-agent access system for the first
  implementation.

## Existing Foundation

The proposal is additive because Prism already has most execution primitives:

- Site-owned workflows and workflow runs.
- Durable `agent_runs` linked to requests, workflow runs, steps, tasks, hooks,
  and sessions.
- Request artifacts linked to producing agent runs.
- Workflow events, blockers, external refs, and request-linked agent sessions.
- A request review API that aggregates workflow, runs, events, artifacts,
  external refs, and messages.
- Interaction profiles with persona, runtime, memory scope, allowed workflows,
  access mode, and rate limits.
- Platform source policy that can select skills and interaction profiles for
  targets, groups, and users.
- Per-step workflow context policy:

```json
{
  "contextPolicy": {
    "continuation": "step",
    "handoff": "artifacts"
  }
}
```

- Workflow loop nodes with bounded iteration counts and artifact-backed state.
- Prism Doctor checks for adjacent agent steps that change skill scope without
  an explicit context boundary.

The main gaps are presentation, request-origin attribution, consistent profile
application across adapters, execution-profile persistence, and structured
orchestration/review contracts.

## Target Lab Experience

### Request inbox

The default Lab screen should show open requests and support:

- free-text search;
- open, attention, running, completed, and all lifecycle filters;
- interaction-profile segmentation;
- source-platform and source-channel segmentation;
- workflow and current-phase segmentation;
- owner or initiator filtering when known;
- updated, created, priority, and attention sorting;
- compact indicators for active runs, blockers, human gates, and estimates.

The list should remain a list. A kanban view may be added only if field testing
shows a real need for backlog planning rather than operational triage.

### Request workspace

The request workspace should establish this hierarchy:

1. What is this request and where did it come from?
2. What is happening now?
3. Does it need attention?
4. What can the operator ask or do next?
5. What evidence, artifacts, and technical history support that answer?

The primary panel is a request-scoped conversation. Operators should be able to
ask questions or provide intervention context such as:

- What is blocking this request?
- Summarize what has happened so far.
- Continue after this gate.
- Use this file as additional context.
- Explain the latest verification failure.
- Retry the failed step if it is safe.
- Show the technical timeline.

Every user-authored conversation entry must preserve its actor provenance. New
entries snapshot the authenticated user ID, display name, and handle at write
time, and the conversation renders that identity rather than a generic
"Operator" label. Older Site-authored entries may recover identity from the
owning authenticated session when no per-message snapshot exists; unknown or
legacy password-only actors remain explicitly unidentified instead of being
attributed to a different user.

Artifacts, events, raw logs, external refs, and run traces remain accessible in
a secondary drawer or expandable technical view.

### Activity and attention

A cross-request activity view should emphasize meaningful state changes rather
than reproduce raw logs. It should include:

- new requests;
- workflow step changes;
- active, completed, failed, or canceled runs;
- blockers and needs-attention outcomes;
- human and agent review gates;
- proposed child work;
- retry decisions;
- artifact creation and external side effects.

### Console and capture

The Lab console remains a full workspace-level conversation. Capture should
become a console input mode or contextual action rather than a permanently
equal top-level destination. Existing capture pages may remain available while
that integration is tested.

### Settings

Lab Settings should initially emphasize:

- Gateway connections and credential status;
- external interfaces;
- runtime profiles and default runtime health;
- source/channel access policies;
- a link to the complete legacy settings workspace.

Credentials remain explicit UI operations. Chat may explain configuration or
prepare non-secret changes, but it must not request or return secrets.

### Operator interruption controls

Lab distinguishes stopping current work from canceling the request. `Stop
current run` interrupts a queued or running agent run while preserving the
request on its current workflow step for corrected context and retry. `Cancel
request` is available from every nonterminal workflow state, cancels active
runs, records an operator reason, and closes the workflow.

`Move request` changes an inactive, open request to another declared
nonterminal workflow step. It is intended for explicit operator recovery such
as sending review findings back to work or advancing a completed checkpoint to
review. It must not skip active work silently, target an undeclared or terminal
step, or bypass the normal cancel and reopen operations.

Both controls require `canRunAgent`, explicit confirmation, durable audit
events, idempotent server behavior, and protection against late Runtime results.
When Runtime exposes a cancellable job, Site persists its non-secret job
reference and requests process cancellation in addition to making the Site run
state authoritative.

The request conversation may recognize clear retry, move, and cancel commands, but the
model remains a read-only utility. Site resolves only unambiguous commands
against the current workflow, shows the same confirmation used by direct UI
controls, and performs the structured capability-checked mutation itself.

## Provenance Model

Prism needs three related but separate provenance layers.

### 1. Ingress provenance

Ingress provenance answers who or what initiated the request and from where.

Suggested request-origin snapshot:

```ts
type RequestOriginSnapshot = {
  sourceSessionId: string | null
  platform: "site" | "discord" | "telegram" | "buzz" | "external" | "task" | "hook" | "system"
  targetId: string | null
  targetName: string | null
  threadId: string | null
  interfaceKey: string | null
  interactionProfileKey: string | null
  interactionProfileVersion: number | null
  actorType: "user" | "external-subject" | "task" | "hook" | "system" | null
  actorId: string | null
  actorDisplayName: string | null
  sourceMessageId: string | null
  capturedAt: string
}
```

The request stores a historical snapshot. It must not rely only on a live join
because channel names, profiles, policies, users, and external identities may
change or be deleted.

External subject identifiers may need hashing or redaction depending on the
interface policy. The admin UI should display only identifiers appropriate for
that operator context.

### 2. Execution provenance

Execution provenance answers which bounded identity performed a run.

Each workflow-step `agent_run` should record:

```text
execution_profile_key
execution_profile_version
execution_profile_snapshot_json
parent_agent_run_id
initiating_request_origin_json or reference
input_artifact_ids
output_artifact_ids
```

The snapshot should include resolved instructions, role, boundaries, skills,
context policy, runtime selection, and output contract without including
credentials or secret values.

### 3. Artifact and handoff provenance

Artifact and handoff provenance answers what evidence moved between bounded
runs and why new work was created.

Child work should record:

```text
parent_request_id
created_by_agent_run_id
created_by_workflow_run_id
created_by_workflow_step_key
created_by_agent_card_id
handoff_reason
handoff_payload_json
source_artifact_ids
approval_status
```

These fields turn a child request into an auditable handoff rather than an
isolated request with a similar title.

## Profile Model

### Interaction profiles

Interaction profiles remain the source-context policy used by Discord,
Telegram, Buzz, and named external HTTP interfaces. They may select:

- access mode;
- runtime profile;
- persona instructions;
- memory sources and buckets;
- allowed workflows;
- source-specific skills;
- rate limits.

All communication adapters should resolve and snapshot interaction profiles in
a consistent shape. A profile key present in source policy should not be merely
stored as opaque metadata on one platform and fully applied on another.

### Agent cards

An agent card is the accountable operating mandate for a workflow. It answers:

- Who owns this recurring process?
- What is its job?
- Which sources should it trust?
- What is it allowed to do?
- What failure modes should reviewers watch?
- What makes its work successful?

The first rule remains one primary agent card per workflow run. Child workflows
may have different cards because they are distinct, auditable handoffs.

### Execution profiles

An execution profile is a reusable, versioned policy for one run posture.

Suggested shape:

```ts
type ExecutionProfile = {
  key: string
  version: number
  name: string
  role: "worker" | "verifier" | "judge" | "orchestrator" | "specialist"
  description: string | null
  instructions: string
  runtimeProfileKey: string | null
  model: string | null
  reasoningEffort: string | null
  skills: string[]
  contextPolicy: {
    continuation: "session" | "step"
    handoff: "artifacts" | null
  }
  authority: {
    mode: "read_only" | "propose" | "approved_write"
    allowedActions: string[]
    allowedCredentialKeys: string[]
    delegationAllowed: boolean
    maxChildren: number
  }
  inputContract: {
    requiredArtifactKinds: string[]
    optionalArtifactKinds: string[]
  }
  outputContract: {
    artifactName: string | null
    schemaKey: string | null
  }
  enabled: boolean
}
```

Effective authority must be an intersection:

```text
agent-card boundaries
  intersect workflow boundaries
  intersect execution-profile boundaries
  intersect step-specific restrictions
```

A workflow or step may narrow authority. It may not widen its owning card or
selected execution profile.

## Built-In Execution Profiles

### Worker

The worker performs bounded domain work.

It receives:

- request goal and acceptance criteria;
- current step instructions;
- explicitly selected prior artifacts;
- required skills and scoped credentials;
- target repository or external-system context when authorized.

It produces durable work artifacts and a concise completion result. It may
write only within the workflow's authority.

### Verifier

The verifier independently gathers evidence about whether claimed work meets
the requirements.

It receives:

- original requirements and acceptance criteria;
- the claimed output artifacts or diff;
- tests, checks, references, and external evidence;
- a verification rubric.

It must not receive the worker's conversational continuation or private
reasoning. It should normally have read-only authority and must not silently fix
the work it is reviewing.

Suggested output:

```json
{
  "status": "pass",
  "checks": [
    {
      "criterion": "Unauthorized callers receive 401",
      "status": "pass",
      "evidence": ["artifact:test-results", "ref:pull-request#checks"]
    }
  ],
  "findings": [],
  "confidence": "high",
  "limitations": []
}
```

Verification produces evidence. It does not own final routing unless the
workflow deliberately combines verifier and judge for a low-risk process.

### Judge

The judge applies an explicit rubric to requirements and verification evidence.
It does not perform implementation or repair.

It receives:

- acceptance criteria and decision rubric;
- the verifier report;
- necessary primary artifacts or evidence references;
- risk and approval policy.

Suggested output:

```json
{
  "verdict": "accept",
  "blockingFindingIds": [],
  "recommendedRoute": "publish",
  "reason": "Every required criterion has passing evidence.",
  "requiresHumanReview": false
}
```

The workflow engine should validate this structured artifact and apply only an
allowed route. The judge must not directly invent a step key or start arbitrary
work.

Verifier and judge may begin as one execution profile when the workflow is
low-risk and the evidence collection is simple. Separate them when the result
controls publication, credentials, funds, consequential writes, or a
subjective decision that benefits from independent adjudication.

### Orchestrator

The orchestrator coordinates an explicit plan and bounded child workflows.

It receives:

- request goal and constraints;
- a durable structured plan;
- child-request and child-run statuses;
- result, verification, and handoff artifacts;
- blocker and retry state;
- the allowlist of child workflows it may propose or start.

It should not receive complete worker conversations, broad credential access,
or authority to enable workflows and assign owners silently.

Suggested output:

```json
{
  "decision": "start_next",
  "targetItemId": "task-3",
  "suggestedWorkflowKey": "code-change",
  "reason": "Task 2 passed verification and task 3 is now unblocked.",
  "sourceArtifactIds": ["artifact-1", "artifact-2"],
  "requiresApproval": false
}
```

Every orchestration decision cycle should normally start with a fresh runtime
continuation and reconstruct state from durable artifacts. Long-term memory of
the plan belongs in the plan, request, events, and child links rather than an
indefinitely growing model conversation.

## Context Boundary Rules

The following rules should be enforced for built-in execution profiles:

| Profile | Continuation | Handoff | Default authority |
| --- | --- | --- | --- |
| Worker | `step` for artifact-driven workflows | artifacts | workflow-scoped writes |
| Verifier | always `step` | explicit evidence artifacts | read-only |
| Judge | always `step` | verifier report plus rubric | propose route only |
| Orchestrator | `step` per decision cycle | plan and child-result artifacts | propose/start allowlisted child work |

Additional rules:

- Do not pass recent chat history when starting a verifier or judge.
- Do not pass a worker's self-assessment as verification evidence unless it is
  clearly labeled as an unverified claim.
- Step instructions name the artifacts they require and the artifact they must
  produce.
- Runtime prompts may summarize artifact indexes, but primary artifact bodies
  remain inspectable and retrievable.
- A context boundary should appear explicitly in Lab run history.
- Changing execution profile, skill scope, authority, or evaluation posture
  between adjacent steps requires a fresh continuation.
- Existing workflows without a policy retain compatibility behavior until
  migrated; new verifier, judge, and orchestrator steps fail validation without
  an artifact boundary.

## Example Workflow

```text
intake
  -> plan                 [orchestrator, fresh context]
  -> implement-item       [worker, fresh context]
  -> verify-item          [verifier, fresh context, read-only]
  -> judge-item           [judge, fresh context]
  -> iteration-loop       [deterministic]
       revise -> implement-item
       next   -> plan
       done   -> final-review
       risk   -> human-gate
  -> final-review         [verifier or human gate]
  -> closed
```

The loop and workflow engine own routing and iteration caps. The orchestrator
and judge produce structured recommendations within an allowlist.

## Ordered Implementation Slices

### Slice 0: Contracts, baseline, and rollout controls

**Purpose:** establish the safe boundary for incremental field testing.

Deliver:

- Reserve `/admin/lab` and `/admin/legacy` routing conventions.
- Add a Lab feature flag or Site-owned preference without changing the default
  UI.
- Define shared request-list, request-review, activity, provenance, and
  execution-profile TypeScript contracts.
- Inventory current admin mutations and their required capabilities.
- Record baseline measures for request discovery time, workflow-attention
  count, active runs, failed runs, and request-detail API latency.
- Add a persistent visual "Lab" marker and a reliable link back to the current
  UI.

Acceptance criteria:

- Lab can be enabled or disabled without a database rollback.
- No Lab browser bundle contains a service token or Gateway credential.
- Current `/admin` behavior is unchanged.
- Every planned mutation maps to an existing or explicitly proposed
  capability-checked Site route.

### Slice 1: Lab shell and operational request inbox

**Depends on:** Slice 0.

Deliver:

- Independent Lab layout and navigation.
- Searchable request list defaulting to open requests.
- Lifecycle, workflow phase, priority, source, and attention filters supported
  by current data.
- Request selection and deep links by request number.
- Compact current-step, active-run, blocker, source, and human-estimate
  indicators.
- Responsive desktop and narrow-screen layouts.

This slice may use best-effort source labels from existing request and linked
session data. It must label unknown attribution as unknown rather than infer a
person or channel.

Acceptance criteria:

- An operator can find an open or blocked request without using the legacy UI.
- Reloading or sharing a Lab request URL preserves selection.
- Polling or refresh does not reset filters or conversation position.
- Lab reads the same canonical request and workflow state as the current UI.

### Slice 2: Chat-first request workspace

**Depends on:** Slice 1.

Deliver:

- Request-scoped conversation as the primary intervention surface.
- Reuse of request-linked agent sessions and durable agent runs.
- Natural-language status explanation grounded in request review data.
- Comment/context submission.
- Normal workflow continue from human gates.
- Agent-run invocation for the current runnable step.
- Stop-current-run control that preserves the current workflow step.
- Cancel-request control from every nonterminal workflow state, including while
  an agent run is queued or running.
- Move-request control for explicit movement between declared nonterminal steps
  when no run is active.
- Deterministic conversational routing of unambiguous move and cancel commands
  into the same confirmed Site-owned controls; ordinary questions remain
  read-only.
- File upload or existing artifact attachment as additional context.
- Clear running, queued, failed, blocked, and completed states.
- Secondary technical drawer for artifacts, events, refs, and raw run detail.

Higher-risk controls such as reopen or blocker override
should remain in the legacy UI until their Lab affordances and capability
checks are reviewed. Stop-current-run, cancel-request, and validated
move-request are required pilot controls.

Acceptance criteria:

- An operator can ask what is blocking a request and receive an answer tied to
  current workflow/run data.
- Continuing a gate uses the normal workflow continuation route and creates the
  expected event and agent run exactly once.
- Adding conversational context is visible in both Lab and legacy request
  history.
- Stopping an active run leaves the request on the same workflow step and a
  late completion cannot advance it.
- Canceling from any nonterminal step closes the request and cancels every
  active run.
- Moving a request records previous and next steps plus an operator reason,
  rejects active runs and terminal targets, and appears in durable history.
- Typing a clear command such as `cancel this request` or `move back to work`
  opens confirmation rather than returning a read-only-model refusal.
- A failed mutation is explicit and does not leave optimistic UI state behind.

### Slice 3: Request-origin provenance and profile segmentation

**Depends on:** Slice 0. May ship alongside or immediately after Slice 2.

Deliver:

- Add nullable request-origin snapshot storage.
- Accept a trusted source-session reference during request creation.
- Resolve source, target, thread, actor, interface, and interaction profile from
  Site-owned session metadata rather than arbitrary display labels.
- Link the source session to the created request.
- Add request list filters for platform, target/channel, interaction profile,
  and initiator.
- Normalize Discord, Telegram, Buzz, external HTTP, Site, task, and hook origin
  snapshots.
- Apply referenced interaction profiles consistently across supported
  communication adapters.
- Backfill recoverable provenance from linked sessions, hooks, tasks, and
  existing request source strings.

Backfill rules:

- Never guess an actor from a title or message body.
- Mark partial backfills explicitly.
- Preserve raw historical source strings.
- Do not rewrite old request numbers, timestamps, or workflow history.

Acceptance criteria:

- A newly created external request shows platform, target, interaction profile,
  and initiator when available.
- Changing or deleting a live channel/profile does not erase the request's
  historical origin snapshot.
- Filters are server-backed and do not require loading every request into the
  browser.
- External subject privacy rules are tested.

Implementation note (2026-08-20): Slice 3 uses an immutable, nullable
`request_origins` record rather than mutable live channel/profile joins. New
agent-created requests may provide only a Site-owned source session/message
reference; platform, target, profile, and actor fields are resolved from that
trusted state. Historical rows are conservatively backfilled and labeled
`partial` or `unknown`, and external subject values are deliberately omitted.
Lab filtering remains server-rendered, so unrendered request records are not
hydrated into the browser.

### Slice 4: Unified timeline, workflow exploration, and attention view

**Depends on:** Slices 1-3.

Deliver:

- One ordered request timeline joining messages, workflow events, runs,
  artifacts, external refs, and meaningful side effects.
- Stable ordering and cursor/pagination rules.
- Collapsed summaries for verbose traces and logs.
- Expandable technical evidence for debugging.
- Workflow map with current step, loops, gates, checkpoints, and terminal
  states.
- Cross-request Activity and Needs Attention views.
- Links from a timeline event to its run, artifact, external ref, or decision.

Acceptance criteria:

- An operator can distinguish "still running" from "stuck" or "failed."
- Every displayed artifact identifies its producing run when known.
- Timeline ordering remains stable while new events arrive.
- Raw traces are available without becoming the default reading experience.

Implementation note (2026-08-20): request review now deterministically merges
messages, workflow events, agent runs, artifacts, and external references by
timestamp, event kind, and durable identifier. The newest review window is
shown first with incremental older-event disclosure; message bodies and raw
run traces remain collapsed by default. Artifacts link to their producing run
when that relationship is known. The workflow explorer marks current,
observed, completed, terminal, branch, and backward-loop states from the live
definition and recorded events. `/admin/lab/activity` provides auto-refreshed
cross-request Activity and Needs Attention views from the capability-filtered
canonical request snapshot without adding privileged run payloads to the
board response.

### Slice 5: Console, capture, and simplified settings integration

**Depends on:** Slices 1-2.

Deliver:

- Lab Console with existing durable job behavior.
- Ability to promote a useful console interaction into a request.
- Capture as a console input/context mode or contextual action.
- Simplified settings landing page emphasizing Gateway, interfaces, runtimes,
  and source policies.
- Links to legacy configuration screens for capabilities not yet represented in
  Lab.
- Chat assistance that may prepare non-secret configuration changes for review.

Acceptance criteria:

- Console and request conversations remain distinct and clearly labeled.
- Promoting a conversation preserves source-session provenance.
- Credential entry and rotation remain explicit settings operations.
- No credential value enters model prompts, request artifacts, or chat.

Implementation note (2026-08-20): `/admin/lab/console` reuses the existing
durable admin-console job/session contract and exposes browser Capture as a
clearly labeled console context mode. An operator may promote an unlinked
console session exactly once into a canonical request. Site validates the
workflow, target, type, and priority, snapshots the console session as request
origin provenance, creates a distinct empty request conversation, records an
audit event, and invokes normal workflow auto-start. `/admin/lab/settings`
links Gateway, Interfaces, Runtimes, and Source Policies to their existing
credential-safe settings flows. Its Console assistance links prefill only
allowlisted non-secret planning prompts. Lab navigation is capability-filtered
so request viewers, run operators, and settings managers see only their
available surfaces.

### Slice 6: Execution-profile registry and run snapshots

> **Replaced:** Use the revised "Agent Identity And Observability Foundation"
> slice in the
> [Agent-First Operations Addendum](./prism-lab-agent-first-addendum.md).

**Depends on:** Slice 4 for useful observability.

Deliver:

- Site-owned execution-profile registry and agent routes.
- Initial built-in `worker`, `verifier`, and `orchestrator` profiles.
- Workflow authoring support for `agentConfig.executionProfileKey`.
- Versioned resolved-profile snapshot on every workflow-step agent run.
- Parent-run and explicit input/output artifact links.
- Validation of effective authority intersections.
- Mandatory fresh artifact boundaries for verifier and orchestrator profiles.
- Lab role badges, profile version, context-boundary markers, skills, and
  authority summaries in run history.

Compatibility:

- Existing workflows without an execution profile continue using current
  `agentConfig` behavior.
- Existing `mode` and `identity` values may be displayed as legacy descriptors
  but are not silently converted into trusted profiles.
- Profile deletion must not destroy historical snapshots.

Acceptance criteria:

- A run can be reconstructed with the exact non-secret profile configuration
  used at execution time.
- A disabled or missing profile prevents new runs but does not corrupt history.
- A verifier run cannot inherit a worker continuation.
- A step cannot widen profile or agent-card authority.

### Slice 7: Independent verification and structured judgment

**Depends on:** Slice 6.

Deliver:

- Verification report artifact schema and validator.
- Reusable verifier workflow step pattern.
- Explicit evidence references to artifacts, tests, diffs, or external refs.
- Optional `judge` execution profile and judgment artifact schema.
- Deterministic decision/routing step that validates allowed judge routes.
- Human-gate fallback for inconclusive evidence, policy conflicts, or high-risk
  outcomes.
- Lab comparison of worker claim, verifier evidence, and judge decision.

Acceptance criteria:

- Verification starts with a fresh continuation and read-only default
  authority.
- A verifier cannot mark its own repair as independently verified in the same
  run.
- A judge cannot perform implementation or select a route outside the workflow
  allowlist.
- Missing or malformed evidence routes to review rather than implicit success.
- Lower-risk workflows may combine verification and judgment explicitly, while
  consequential workflows require separation or a human gate.

### Slice 8: Bounded orchestration, child work, and pending actions

**Depends on:** Slices 3, 4, 6, and 7.

Deliver:

- Structured orchestration-plan and orchestration-decision artifacts.
- Parent/child request and run provenance.
- Proposed child work with workflow, owner/card, input artifacts, reason, risk,
  and approval status.
- Allowlists, child-count limits, retry budgets, and loop iteration caps.
- Checkpoint-controlled child-result evaluation.
- Pending Actions records or an equivalent Needs Review projection for proposed
  work, assignment, retry, publish, and human-review decisions.
- Prism Doctor checks for unbounded loops, missing handoff artifacts, missing
  profile snapshots, or authority expansion.
- Lab orchestration view showing plan items, active child work, verification,
  decisions, and blockers.

Acceptance criteria:

- Every child request identifies the run and artifacts that caused it.
- Dynamic planning is allowed, but starting child work requires explicit
  allowlist policy and any required approval.
- Orchestration resumes correctly after Site or Runtime restart using durable
  plan and child state.
- Repeated callbacks or retries do not create duplicate child work.
- Reaching a retry or iteration cap creates an attention item rather than an
  infinite loop.

### Slice 9: Lab promotion and legacy retirement

**Depends on:** field validation of the earlier slices. Full orchestration is
not required for initial promotion if the core request and console flows have
parity.

Deliver:

- User preference or cohort rollout for defaulting to Lab.
- Move the current UI to `/admin/legacy`.
- Promote the Lab shell to `/admin`.
- Preserve deep links and redirect old tab URLs where practical.
- Keep legacy settings links until each replacement is proven.
- Remove legacy components only after usage and parity checks.

Promotion criteria:

- Core request discovery, review, chat, continue, artifact, console, and
  settings-entry flows are reliable.
- Capability checks match or strengthen the current UI.
- No unresolved provenance or event-ordering corruption exists.
- Operators can return to legacy during the observation window.
- Support documentation and screenshots reflect the promoted UI.
- Rollback requires only routing/config changes, not data restoration.

## API Direction

Prefer focused Site-owned endpoints over a Lab-specific duplicate backend.

Likely additions include:

```text
GET  /agent/change-board/requests
      ?openOnly=true
      &interactionProfileKey=...
      &platform=...
      &targetId=...
      &attention=true

GET  /agent/change-board/requests/by-number/:number/review
GET  /agent/change-board/requests/by-number/:number/timeline
POST /agent/change-board/requests/by-number/:number/workflow/continue
POST /agent/change-board/requests/by-number/:number/runs/:runId/cancel
POST /agent/change-board/requests/by-number/:number/workflow/cancel
POST /agent/change-board/requests/by-number/:number/workflow/step
POST /agent/responses

GET  /agent/execution-profiles
POST /agent/execution-profiles
GET  /agent/execution-profiles/:key
PATCH /agent/execution-profiles/:key
DELETE /agent/execution-profiles/:key

GET  /agent/pending-actions
POST /agent/pending-actions/:id/resolve
```

Browser Lab routes should use admin-session endpoints or server-side handlers
that preserve current capability checks. The existence of an `/agent/*` route
does not authorize forwarding a service token to the browser.

## Data Migration Strategy

- Add new provenance and profile fields as nullable.
- Snapshot new data at creation time before attempting broad backfills.
- Backfill in bounded batches with dry-run counts and explicit partial status.
- Keep historical request `source` values for compatibility.
- Do not rewrite completed workflow state while adding provenance.
- Add indexes only for filters demonstrated by the Lab query patterns.
- Treat execution-profile snapshots as immutable historical data.
- Keep profile registry records archivable so old snapshots remain meaningful.

## Authorization And Safety

- Every Lab mutation uses the existing role/capability model.
- Request origin is resolved from trusted session and adapter data.
- Browser input cannot claim an arbitrary interaction or execution profile as
  trusted provenance.
- Profile instructions never grant authority by themselves.
- Gateway leases are computed from effective server-side policy.
- Verifier and judge profiles receive no write credentials by default.
- Orchestrator credentials are limited to allowlisted coordination actions.
- Structured model outputs are validated before workflow mutation.
- High-risk or ambiguous decisions route to a human gate.
- Logs and snapshots exclude prompt bodies, secrets, credential values, and
  hidden model reasoning.

## Observability

Lab should make these relationships inspectable:

```text
request origin
  -> workflow run and primary agent card
  -> workflow step and execution profile
  -> agent run and parent run
  -> input artifacts
  -> result and output artifacts
  -> verification evidence
  -> judgment or human decision
  -> next step or child request
```

Recommended non-sensitive measures:

- time from opening Lab to selecting the intended request;
- time from request selection to first useful operator action;
- requests by source platform, target, and interaction profile;
- requests and runs needing attention;
- queue and run duration by workflow step and execution profile;
- verification pass, fail, and inconclusive counts;
- judge-human disagreement rate where both decisions exist;
- orchestration retries, child counts, and cap escalations;
- use of legacy UI after Lab promotion;
- prompt bytes and selected-skill counts without prompt contents.

## Testing Strategy

### Unit and contract tests

- Request-origin normalization for every supported source.
- Historical snapshot behavior after live profile/channel changes.
- Execution-profile validation and versioning.
- Authority intersection cannot widen permissions.
- Verifier, judge, and orchestrator context policies reject session
  continuation.
- Structured verification, judgment, and orchestration artifacts reject unknown
  fields or invalid routes where appropriate.
- Timeline ordering and cursor behavior.

### Integration tests

- Site request creation and Lab request operation.
- Discord, Telegram, Buzz, external interface, task, and hook request origins.
- Gate continuation creates exactly one next-step run across retries.
- Run cancellation preserves the current workflow step and makes a late Runtime
  completion non-authoritative.
- Request cancellation works from agent, checkpoint, loop, and gate steps,
  including with queued or running agent runs.
- Worker-to-verifier handoff contains only declared artifacts and no runtime
  continuation.
- Judge output routes only through allowed workflow edges.
- Parent/child orchestration is idempotent.
- Cancel, restart, and late completion behavior preserves durable state.
- Capability checks for member, moderator, and admin Lab operations.

### Field tests

- Can an operator find a blocked request in under one minute?
- Can an operator explain where the request came from?
- Can an operator distinguish worker claims from independent evidence?
- Can an operator understand why a judge or orchestrator selected a route?
- Can an operator repair or escalate a routine blocker without opening raw
  logs?
- Can an expert still reach the underlying artifacts and traces when needed?

## Documentation Follow-Ups

When implementation begins, reconcile this spec with:

- `docs/features/agent-cards-and-owned-workflows.md`;
- `docs/features/codex-runtime-prompt-transport-and-workflow-context.md`;
- `docs/features/workflow-loop-nodes.md`;
- `docs/agent-pr-review-workflows.md`;
- `docs/architecture/durable-agent-run-model.md`;
- `docs/runbooks/durable-agent-run-followups.md`;
- `docs/features/external-interaction-interfaces.md`.

Avoid duplicating normative contracts across all of these documents. Promote
implemented profile, provenance, and routing contracts into the relevant
architecture documents and leave this file as the product rollout plan.

## Open Questions

- Should request-origin snapshots use first-class columns plus JSON, or a
  separate immutable provenance table?
- Which external actor identifiers may be displayed, hashed, or omitted?
- Should execution profiles be instance-owned only or optionally source-backed?
- Should workflows snapshot the primary agent card at run start?
- Which low-risk workflows may combine verifier and judge?
- Which decisions always require a human gate regardless of judge confidence?
- Should the deterministic router consume a judgment artifact directly or a
  separate signed/validated decision record?
- When should proposed child work become a request versus remain a pending
  action?
- Which existing workflows should migrate from session continuation to step
  continuation first?
- What minimum request and settings parity is required before Lab becomes the
  default UI?

## Recommended First Field-Test Milestone

The first meaningful milestone is complete after Slices 0-3:

> An operator can open `/admin/lab`, segment live requests by source or
> interaction profile, select an active request, understand its current state,
> ask what is blocking it, add context, and safely continue a normal workflow
> gate without returning to the legacy request view.

That milestone tests the product thesis before committing to the execution
profile and orchestration layers. Slices 4-8 then make the same experience more
observable, independently verifiable, and capable of safe bounded
orchestration.
