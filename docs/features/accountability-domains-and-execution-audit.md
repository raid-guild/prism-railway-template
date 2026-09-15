# Accountability Domains And Execution Audit

## Status

First slice implemented. Instance adoption is in progress.

Priority: ownership and audit.

Explicitly deferred: domain RBAC, hierarchical domains, cascading runtime
configuration, inherited credentials, and inherited authority.

Related documents:

- [Prism Lab Agent-First Operations Addendum](./prism-lab-agent-first-addendum.md)
- [Agent Cards And Owned Workflows](./agent-cards-and-owned-workflows.md)
- [Role-Agent Delegation And Organization Access](../research/role-agent-delegation-and-org-access.md)
- [Durable Agent Run Model](../architecture/durable-agent-run-model.md)
- [Prism Workflows](../architecture/workflows.md)

## Purpose

Prism has durable Agent Profiles, workflows, tasks, hooks, requests, workflow
runs, and agent runs. It can identify the profile and version that executed a
new run, but ownership remains uneven:

- Agent Profiles have owners and stewards;
- workflows and tasks do not have first-class accountable owners;
- a workflow may use several Agent Profiles across its steps;
- missing executors resolve through the Admin Agent compatibility fallback;
- the run does not record whether the Admin Agent was explicitly selected or
  used as an implicit fallback;
- workflow and task definition ownership is not snapshotted with execution.

This feature adds a small, explicit accountability layer without building a
policy engine. It should answer:

> Which operational domain is accountable for this durable definition, who
> stewards that domain, which exact profile executed this run, and how was that
> executor selected?

## Decisions

### Accountability is separate from execution

Every Agent Profile, workflow, and task belongs to exactly one Accountability
Domain. A workflow step does not have an owner or domain of its own; it belongs
to its workflow and resolves one executor for each run.

```text
Accountability Domain
  -> Agent Profiles
  -> Workflows
  -> Tasks

Workflow
  -> step
  -> resolved executor Agent Profile
  -> immutable agent run
```

A workflow may use profiles from several domains:

```text
Change Request / Platform Operations
  triage       -> BizDev Agent / BizDev
  implement    -> Codegen Agent / Software Delivery
  verify       -> Verification Agent / Quality
  review       -> Code Review Agent / Quality
  approve      -> human gate
```

This is normal cross-domain participation, not an ownership conflict. The
workflow's domain remains accountable for its definition and routing. Each
executor's domain remains accountable for that Agent Profile. Executing a step
does not transfer workflow ownership or expand the executor's authority.

### Built-in and custom are origin, not ownership

`built-in` and `custom` describe where a definition came from and how Prism may
protect or upgrade it. They are orthogonal to accountability.

```text
origin: built-in | custom
accountabilityDomain: software-delivery
```

A protected built-in profile can be assigned to an instance-specific domain.
A custom profile can be assigned to the same domain. Protection and migration
rules continue to follow origin/system identity, not domain.

### Domains are flat in the first slice

The first slice supports a flat domain registry. It does not support parent
domains, multiple domain membership, inherited configuration, or policy
merging. Each durable definition has one domain. Additional labels can remain
ordinary tags if needed.

### Domains do not grant authority

Domain assignment and domain stewardship are audit metadata in this slice.
They do not authorize a user, expose credentials, add skills, change a runtime,
or widen an Agent Profile's mutations.

Agent execution continues to use the profile's immutable version, runtime
selection, skill selection, Gateway credential assignment, context policy, and
authority ceiling.

### Admin fallback is visible technical debt

Executor resolution remains deterministic:

```text
workflow step executor
  -> workflow default executor
  -> Admin Agent compatibility fallback

direct task executor
  -> Admin Agent compatibility fallback
```

New workflows and tasks must not intentionally rely on Admin fallback. Existing
definitions continue working, but every new run records the resolution source.
Prism Doctor and Lab treat fallback as an ownership warning.

An explicit Admin Agent step is valid and distinct from fallback:

```text
executorProfile: admin-agent
executorResolution: step-explicit
```

versus:

```text
executorProfile: admin-agent
executorResolution: admin-fallback
```

Completed historical runs remain unknown when durable evidence cannot identify
their executor. Do not rewrite history to manufacture clean attribution.

## Terminology

### Accountability Domain

A stable, instance-owned operational area responsible for a set of Agent
Profiles, workflows, and tasks. Examples may include Platform Operations,
Software Delivery, Quality, Brand, Handbook, or a project-specific operation.

### Domain steward

A named human recorded as accountable for reviewing and maintaining the
domain. Stewardship is informational in this slice and does not itself grant
Prism permissions.

### Definition origin

Whether an Agent Profile, workflow, or task is a protected/template-provided
built-in or an instance-authored custom definition.

### Definition custodian

The existing Agent Profile `owner` relationship currently controls lifecycle
and ownership graph behavior. During this feature it should be labeled as
profile custody where necessary to avoid confusing it with operational
accountability. An Admin-Agent-owned built-in may still be accountable to a
non-Admin domain.

### Executor resolution

The deterministic configuration source that selected a profile for a run.
Controlled values:

- `step-explicit`
- `workflow-default`
- `task-explicit`
- `hook-workflow-default`
- `admin-fallback`
- `historical-unknown`
- `not-applicable`

### Initiator

The trusted user, source message, task, hook, Agent Profile, or system event
that caused work to begin. Initiator, accountable domain, and executor are
separate audit fields.

## Current Baseline And Gaps

| Object | Current durable identity | Gap addressed here |
| --- | --- | --- |
| Agent Profile | Stable key, owner, stewards, version snapshots | No accountability domain |
| Workflow | Stable key, version, built-in flag, definition | No accountable domain or creator |
| Workflow step | Key, type, executor configuration | Resolution source is not snapshotted |
| Workflow run | Workflow key, current step, status | Definition version and domain are not snapshotted |
| Task | Stable key, type, configuration | No version, creator, or accountable domain |
| Task run | Task key, trigger, result | Definition version and domain are not snapshotted |
| Agent run | Profile id/version and execution mode | No resolver source or accountability snapshot |
| Hook | Linked workflow and trigger configuration | Uses linked workflow domain in this slice |
| Request | Initiator and workflow state | Should show workflow domain and participating executor domains |

## Data Model

### `accountability_domains`

Suggested fields:

```text
id
key                    unique stable kebab-case key
name
description
status                 active | archived
version
system_key             nullable; protects template-seeded domains
governance_ref_json    optional non-secret Hats/role/reference metadata
created_by_user_id
updated_by_user_id
created_at
updated_at
```

Domain keys are stable audit identifiers. Rename changes `name`, not `key`.
Archive instead of deleting a domain that has definitions or run history.

### `accountability_domain_stewards`

```text
domain_id
user_id
created_by_user_id
created_at
```

The first slice records human users only. A later governance-role principal can
reference Hats or another role system without changing historical user
snapshots.

### Definition assignments

The first implementation uses one canonical association ledger:

```text
accountability_domain_assignments
  target_type          agent_profile | workflow | task
  target_id
  domain_id
  assigned_by_user_id
  created_at
  updated_at
  unique(target_type, target_id)
```

This preserves the exactly-one assignment invariant without coupling domain
metadata to authorization-bearing definition rows. The target type/id pair is
validated by the Site service before mutation. A later database may materialize
typed foreign-key columns as an optimization without changing the API contract.

The ledger assigns domains to:

- `agent_profiles`
- `workflows`
- `tasks`

Add or normalize creation/version metadata:

- `workflows.created_by_user_id`
- `tasks.created_by_user_id`
- `tasks.version`
- canonical built-in/custom origin in workflow and task read models

The initial slice versions the domain record and snapshots assignments on new
agent runs. Definition-version coupling for domain-only reassignment, plus
workflow-run and task-run snapshots, remains the next provenance increment.

### Workflow-run ownership snapshot

A workflow run should retain:

```json
{
  "workflowKey": "change-request-default",
  "workflowVersion": 9,
  "accountabilityDomain": {
    "id": "domain-platform-operations",
    "key": "platform-operations",
    "name": "Platform Operations",
    "version": 2
  }
}
```

This may use explicit columns for indexed identifiers plus one non-secret JSON
snapshot for display. Gates and terminal transitions then retain workflow
ownership even when they do not create an agent run.

### Task-run ownership snapshot

A task run should retain the task key, task definition version, task domain
snapshot, trigger source, and configurator when known. Script and HTTP tasks use
`executorResolution: not-applicable` unless they explicitly hand off to an
Agent Profile.

### Agent-run execution snapshot

Each new workflow-step or agent-backed task run records:

```json
{
  "initiator": {
    "type": "user",
    "id": "user-123",
    "displayName": "Dekan"
  },
  "definition": {
    "type": "workflow",
    "key": "change-request-default",
    "version": 9,
    "domainKey": "platform-operations"
  },
  "step": {
    "key": "verify"
  },
  "executor": {
    "profileId": "agent-profile-verification",
    "profileKey": "verification-agent",
    "profileVersion": 1,
    "domainKey": "quality",
    "executionMode": "verifier",
    "resolution": "step-explicit"
  }
}
```

Store stable IDs and versions in indexed columns where operators will filter
them. Store names as immutable display snapshots. Do not copy persona bodies,
credential values, secrets, message bodies, or unrestricted configuration into
the accountability snapshot; the immutable Agent Profile version remains the
source for detailed profile configuration.

## Audit Events

Use the existing audit log for configuration changes. Add consistent actions:

```text
accountability.domain.create
accountability.domain.update
accountability.domain.archive
accountability.domain.steward.add
accountability.domain.steward.remove
agent.agent_profile.domain.assign
workflow.domain.assign
task.domain.assign
workflow.executor.update
task.executor.update
```

Each event records actor, target, prior domain/executor where relevant, new
domain/executor, definition version, timestamp, and confirmation source. Never
store credentials or entire prompt bodies in audit metadata.

Executor selection itself belongs on the durable run. A separate audit-log row
for every resolution is unnecessary unless needed for an external audit sink.

## Authoring And Management Skills

Site APIs enforce the data model. Site-hosted skills teach Admin Console and
other trusted runtime interactions to use those APIs deliberately. Skills do
not replace validation and are loaded only for relevant authoring requests.

### New `prism-accountability-author`

Use for creating, inspecting, renaming, archiving, or assigning Accountability
Domains.

Procedure:

1. List existing domains and stewards.
2. Reuse an existing domain when its mandate matches; never create one from a
   name mention alone.
3. Prepare a non-secret preview with key, name, mandate, status, governance
   reference, and named stewards.
4. Require explicit confirmation before creation, archive, steward changes, or
   bulk reassignment.
5. Apply assignments through Site agent routes.
6. Read back affected definitions and report unassigned objects.
7. Recommend Prism Doctor after a bulk migration.

Creating a domain never creates an Agent Profile automatically.

### New `prism-agent-profile-author`

Use for creating or updating custom Agent Profiles and assigning built-in or
custom profiles to an Accountability Domain.

Required creation inputs:

- stable profile key and display name;
- mandate and explicit out-of-scope behavior;
- existing accountability domain;
- at least one named human steward for a custom operational profile;
- persona/instructions;
- runtime choice or deliberate unpinned runtime;
- skills and memory scope;
- authority boundary and mutation expectations;
- context/continuation policy.

Procedure:

1. Inspect existing profiles and domains to avoid duplicates.
2. Distinguish a reusable skill from a durable Agent Profile. Do not create an
   agent merely because a capability has a name.
3. Preview the complete non-secret profile and accountability assignment.
4. Confirm before creation or material authority/domain changes.
5. Create a new immutable profile version for updates.
6. Read back the profile, version, domain, and stewards.
7. Report workflows, tasks, and bindings that use it.

Protected built-in origin, key, and system identity remain immutable. Instance
operators may change supported presentation or domain assignment only through
the protected update path.

### Update `prism-workflow-author`

New workflows require:

- one owning `accountabilityDomainKey`;
- explicit definition origin;
- creator provenance;
- a workflow default executor or an explicit executor on every agent step;
- a preview of effective executor resolution for every runnable agent step;
- an informational list of cross-domain executor references;
- no intentional Admin fallback.

Example authoring summary:

```text
Workflow: change-request-default
Accountable domain: Platform Operations

triage       -> BizDev Agent / BizDev             step-explicit
implement    -> Codegen Agent / Software Delivery step-explicit
verify       -> Verification Agent / Quality      step-explicit
review       -> Code Review Agent / Quality        step-explicit
```

Cross-domain references do not require a separate workflow solely because the
executor differs. Use a child workflow when the work needs its own subject,
lifecycle, accountable outcome, or approval path.

Before enabling, validate that every referenced executor exists and is active,
the domain exists and is active, and the workflow passes existing structural,
skill, credential, loop, and context-handoff checks.

### Update `prism-task-author`

New tasks require:

- one owning `accountabilityDomainKey`;
- creator/configurator provenance;
- task definition version;
- explicit executor for agent-backed tasks;
- an informational cross-domain note when task and executor domains differ;
- no intentional Admin fallback for scheduled work.

Deterministic script and HTTP tasks remain domain-owned even when they have no
Agent Profile executor.

### Update `prism-doctor`

Prism Doctor remains report-only by default. Add ownership and execution audit
checks:

#### Blocking

- enabled workflow/task references a missing or inactive domain;
- enabled workflow/task references a missing or inactive explicit executor;
- a protected built-in definition has invalid system identity or origin drift;
- an execution snapshot names a profile/version that cannot be resolved.

#### Warning

- custom Agent Profile, workflow, or task has no domain;
- active domain has no human steward;
- enabled agent-backed task has no explicit executor;
- workflow agent step resolves through `admin-fallback`;
- profile remains Admin-Agent-custodied without an accountable domain;
- workflow/task version is absent from a new run snapshot;
- a domain references only archived definitions or has no active work.

#### Informational

- cross-domain workflow executor edges;
- explicit Admin Agent steps;
- built-in versus custom counts by domain;
- profiles with no workflow, task, binding, or recent run;
- domain dependency counts and recent failure rates.

Doctor output should group findings by accountable domain, then list unassigned
definitions and Admin fallbacks separately. It recommends exact repairs but
does not create domains, reassign definitions, or modify executors without a
subsequent explicit operator request and confirmation.

## Agent API

Suggested service-token routes:

```text
GET    /agent/accountability-domains
POST   /agent/accountability-domains
GET    /agent/accountability-domains/:key
PATCH  /agent/accountability-domains/:key
POST   /agent/accountability-domains/:key/assignments
GET    /agent/accountability/audit
```

Domain POST/PATCH accepts non-secret configuration only. Creation and material
changes use preview/confirm semantics consistent with Agent Profile creation.
Archive replaces destructive deletion for referenced domains.

Extend existing authoring routes:

```text
POST /agent/agent-profiles
POST /agent/workflows
POST /agent/tasks
```

They accept `accountabilityDomainKey` and return the canonical assignment when
provided. During compatibility rollout, legacy callers may omit it; the audit
then reports the definition as unassigned. Once all first-party callers supply
the field, creation can make it mandatory without obscuring legacy debt.

The audit endpoint is read-only and returns:

- domains and stewards;
- unassigned profiles/workflows/tasks;
- executor-resolution matrix for workflows and tasks;
- Admin fallback inventory;
- cross-domain execution edges;
- invalid/inactive references;
- recent run attribution completeness;
- counts only for credential leases and mutations, with links to their existing
  audit records and no secret values.

## Lab Information Architecture

Keep built-in/custom and domain as independent facets.

```text
Agents
  Built-ins
  Custom
  Domains

Workspace
  Activity
  Ownership Audit
```

### Domain list

Show:

- name and mandate;
- human stewards;
- active profile/workflow/task counts;
- built-in/custom mix;
- recent runs and failures;
- Admin fallback count;
- unassigned or inactive-reference warnings.

### Domain detail

Show:

- domain identity and governance reference;
- named stewards;
- Agent Profiles;
- workflows and per-step executor matrix;
- tasks and executor/delivery summary;
- cross-domain inbound and outbound dependencies;
- recent runs, mutations, Gateway lease names, artifacts, and failures;
- configuration audit history.

Do not show credential values. Domain detail is an observability surface in the
first slice, not a permissions-management surface.

### Ownership Audit

Prioritize actionable gaps:

1. implicit Admin fallbacks;
2. missing domains or stewards;
3. missing/inactive executors;
4. new runs with incomplete definition/executor snapshots;
5. profiles still appearing owned by Admin without an accountable domain;
6. cross-domain dependency inventory;
7. dormant or orphaned definitions.

Cross-domain execution is not itself an error. Present it as a dependency map
and make warnings depend on missing or invalid accountability, not on domain
boundaries being crossed.

## Authoring Flow

Interactive Admin Agent configuration follows one composable flow:

```text
create or reuse domain
  -> create or reuse Agent Profile
  -> create workflow with explicit executors
  -> optionally create task
  -> run ownership audit
  -> review
  -> enable
```

Skill loading is request-scoped:

- existing domain + new workflow: `prism-workflow-author`;
- new domain: add `prism-accountability-author`;
- new profile: add `prism-agent-profile-author`;
- scheduled execution: add `prism-task-author`;
- final audit: `prism-doctor`.

Do not load domain instructions into ordinary Agent Profile runtime turns.
Domains are accountability metadata, not personas, memory scope, skills, or
execution prompts.

## Migration And Compatibility

### Schema migration

1. Add domain registry and steward tables.
2. Add nullable domain assignments and creator/version fields.
3. Add workflow/task ownership snapshots.
4. Add executor-resolution and accountability snapshot fields to new runs.
5. Update profile version snapshots to include domain assignment.

### Built-in backfill

Seed one protected `prism-builtins` domain stewarded informationally by workspace
administrators. Assign only exact known built-in profiles and workflows to it
during the first migration. Legacy `tasks.task_type = builtin` is also the API
default for some user-authored tasks, so it is not safe evidence for automatic
task assignment. Tasks remain unassigned until confirmed or until a canonical
origin marker is added. An instance can later reassign built-ins to more useful
domains without changing their built-in origin.

Do not infer domains for custom definitions from names, skills, channels,
creators, existing Admin-Agent custody, or currently referenced executors.
Leave them unassigned and surface them in the audit.

### Run history

- Do not rewrite completed historical executor or domain attribution.
- Existing profile/version snapshots remain authoritative where present.
- Already-active unassigned runs retain the conservative repair rules already
  implemented.
- New runs always record executor resolution.
- Legacy definitions continue through explicit `admin-fallback` until repaired.

### Hooks and requests

Hooks inherit the accountability domain of their linked workflow in the first
slice and preserve hook creator/trigger provenance separately. Requests remain
global shared subjects and display the workflow domain plus participating
executor domains; they do not receive a single Agent Profile owner.

## Delivery Slices

### Slice 1: ownership schema and read model

- domain registry and stewards;
- assignments for profiles/workflows/tasks;
- exact built-in backfill;
- origin and creator normalization;
- read-only ownership audit API.

### Slice 2: prospective execution provenance

- controlled executor-resolution values;
- workflow/task definition snapshots;
- domain snapshots on workflow, task, and agent runs;
- explicit Admin fallback reporting;
- request participant-domain projection.

### Slice 3: authoring procedures

- `prism-accountability-author`;
- `prism-agent-profile-author`;
- ownership updates to workflow/task authoring skills and APIs;
- Prism Doctor ownership checks;
- preview/confirm/readback procedures.

### Slice 4: Lab audit surfaces

- domain list and detail;
- Ownership Audit workspace;
- built-in/custom/domain facets;
- executor-resolution matrix;
- cross-domain dependency view;
- links to runs, artifacts, audit events, and Gateway lease records.

## Acceptance Criteria

- Every newly created Agent Profile, workflow, and task has one active
  Accountability Domain.
- Every active domain has at least one named human steward or an explicit
  built-in compatibility warning.
- Built-in/custom origin remains independent from domain assignment.
- A workflow can use explicit profiles from several domains without changing
  its owning domain.
- Every new workflow-step run records workflow key/version/domain, step key,
  executor profile/version/domain/mode, and executor-resolution source.
- Explicit Admin execution and Admin fallback are distinguishable.
- New workflows and agent-backed tasks cannot be enabled while intentionally
  relying on Admin fallback.
- Historical unknown attribution remains unknown.
- New workflow/task/profile creation uses preview, confirmation, mutation, and
  readback through Site APIs.
- Prism Doctor reports ownership gaps without mutating configuration.
- Lab shows unassigned definitions, fallbacks, cross-domain edges, stewards,
  and run attribution without exposing secrets.
- Domain assignment does not grant user access, runtime authority, credentials,
  skills, or memory access.

## Deferred Work

- domain RBAC and permission management;
- governance-role and Hats-synchronized principals;
- hierarchical or multiple-parent domains;
- multiple domains per definition;
- cascading runtime, persona, skill, memory, or context configuration;
- inherited credentials or authority;
- domain budgets and approval thresholds;
- external organization delegation;
- policy evaluation on cross-domain execution edges.

If these are introduced later, authority must remain monotonic: a domain or
workflow may narrow an executor profile's authority but must never widen it.

## Open Questions

- Should profile custody eventually become a first-class Domain owner principal
  or remain separate from operational accountability?
- Should reassignment of a protected built-in require only confirmation or a
  recorded reason as well?
- Which built-in definitions should remain in `prism-system` versus move to
  template-provided domains such as Software Delivery?
- Should domain stewards be snapshotted on runs, or should runs snapshot only
  the domain version and resolve the historical steward list from versioned
  domain records?
- When hooks gain behavior beyond invoking a workflow, should they receive an
  explicit domain instead of inheriting the workflow domain?
- Which audit findings should prevent enabling a definition versus remain
  warnings during migration?
