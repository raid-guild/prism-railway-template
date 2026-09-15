# Prism Lab Agent-First Operations Addendum

## Status

Implemented agent-identity foundation, console-first navigation, and the first
scoped Memory Explorer field-test slice. This addendum supersedes the profile,
ownership, and post-Slice-5
navigation model in `prism-lab-chat-first-operations.md` where the documents
conflict. Slices 0–5 remain implemented and valid foundations.

## Why This Addendum Exists

Field testing clarified that Prism is not only a chat-first request console. It
is being used as a multiplayer agent harness:

- several people interact with agents through Prism Console, Buzz, Discord,
  Telegram, and other interfaces;
- agents run workflows and scheduled tasks on the same shared request state;
- operators need to know who initiated work, which agent performed it, who is
  accountable for that agent, and what changed;
- one required administrative agent needs cross-agent observability,
  orchestration, and bounded repair authority.

The earlier model separated interaction profiles, agent cards, and execution
profiles. Those records remain useful implementation substrate, but they do not
provide one clear operational identity around which sessions, channels,
activity, ownership, and execution can be understood.

The new top-level concept is an **Agent Profile**.

## Product Model

Prism Lab has two first-class global collections:

1. **Requests** are shared collaborative work items. A request may involve
   several agents as its workflow advances and therefore does not belong to a
   single agent.
2. **Agents** are durable operational identities. Agents receive conversations,
   execute workflow steps and tasks, produce artifacts, and retain explicit
   human accountability.

The built-in **Admin Agent** is the required control-plane agent. Other agents
are flat peers rather than members of a required Ops hierarchy. Built-in and
custom describe profile origin, not accountability. An accountability domain
groups the profiles, workflows, and tasks for which one operational area is
answerable; it does not create an agent hierarchy or grant authority.

```text
Workspace administrators
  -> Admin Agent (required, built in)
       -> may observe, direct, verify, and safely repair work
       -> may own explicitly created sub-agents

Other Agent Profiles
  -> always have a Prism Console
  -> may have zero, one, or many external communication bindings
  -> may execute workflows and tasks
  -> are stewarded by a real user even when owned by the Admin Agent
```

## Information Architecture

The Lab shell uses a collapsible Agent Navigator:

```text
Workspace
  Requests
  Activity
  Memory (when Prism Memory is configured)
  Settings

Agents
  Built-ins
  Custom
  Accountability domains
```

The Agents destination separates the protected built-in Admin Agent from other
agents without inventing a Workspace Agent or Ops Agent class:

```text
Admin Agent

Agents
  Veydrift Agent       Console · Buzz · Discord
  Recording Agent      Console · Discord
  Planning Agent       Console only
```

Every Agent Profile has a Prism Console. External communication bindings are
optional. A console-only agent is operational, not "unbound" or private.

Selecting an agent opens an identity-scoped, console-first workspace. The
console occupies the primary canvas, Capture is a peer mode, and an on-demand
right inspector contains profile configuration and observability:

- Console
- Capture
- Activity
- Sessions
- Channels
- Configuration

The left navigator can be collapsed without changing the selected agent. The
right inspector is closed by default so conversation remains the visual focus.

Memory is a workspace context surface rather than another agent identity. Its
Lab route uses the same collapsible navigator and opens a timeline and durable
knowledge explorer. Selecting Memory records may start a scoped conversation
with an eligible Agent Profile; it does not create a separate "Memory Agent."

Agent Console execution resolves its scope from the Site-owned session/profile
assignment, not browser-supplied metadata. The resolved immutable profile
version provides persona instructions, runtime profile, skills, memory scope,
authority context, and continuation policy. A profile edit creates a new
version; existing sessions retain their recorded version and a new session is
required to adopt the edit.

Requests remain a top-level global inbox. Agent pages may show requests in
which the agent participated, but must not create competing agent-owned request
silos.

## Agent Profile

An Agent Profile is a versioned operational identity, not only a prompt or a
runtime configuration. Its resolved non-secret configuration includes:

- stable key, display identity, avatar, and constrained visual accent;
- mandate and persona;
- status and profile version;
- accountability domain and definition origin;
- owner principal: user, workspace, or another Agent Profile;
- one or more human stewards;
- runtime/model selection;
- skills and memory scope;
- authority ceiling and allowed operations;
- workflow and task assignments;
- communication bindings;
- default bounded context policy.

Ownership must be acyclic. If the Admin Agent owns another agent, workspace
administrators remain the ultimate human stewards. Agent ownership never grants
the child the parent's authority or credentials automatically.

### Profiles, templates, skills, and modes

Keep these meanings distinct:

| Concept         | Meaning                                                                                         |
| --------------- | ----------------------------------------------------------------------------------------------- |
| Agent Profile   | Durable identity with ownership, sessions, authority, and activity.                             |
| Agent Template  | Reusable starting configuration without operational identity or ownership.                      |
| Skill           | A capability an agent or workflow step may use, such as research.                               |
| Mode            | A bounded execution posture such as worker, orchestrator, verifier, reviewer, judge, or repair. |
| Runtime Profile | Adapter and runtime transport configuration; not an agent identity.                             |
| Binding         | Associates an Agent Profile with a communication surface.                                       |

Do not create an agent merely because a capability has a name. Research is
normally a skill. It becomes a distinct agent only when it needs a durable
mandate, owner, memory scope, authority boundary, and independent sessions.

Templates and cloning may be added later. A clone becomes a new Agent Profile
with its own ownership, version history, authority, and activity.

## Required Admin Agent

The Admin Agent is seeded for every workspace and is protected from deletion.
It is stewarded by authorized workspace administrators and has cross-agent
control-plane visibility.

Its responsibilities include:

- inspect agents, sessions, requests, workflows, tasks, runs, blockers, and
  system health;
- explain what is happening and who is responsible;
- direct or delegate work to another agent;
- diagnose and repair allowlisted request or workflow state;
- propose higher-risk repairs for human approval;
- create Agent Profiles through a reviewable Admin Console operation;
- run bounded automated doctor, maintenance, or orchestration loops.

"Can work with everything" does not mean permanently holding every provider
credential. Gateway credentials remain job-scoped leases. The Admin Agent's
effective authority is the intersection of workspace policy, the selected
mode, the requested operation, and any required human approval.

Verifier and reviewer have become protected built-in Agent Profiles because
fresh context, independent evidence, and distinct mutation boundaries justify
operational separation. Codegen is also a protected built-in profile. Judge and
repair may remain bounded modes until a durable mandate requires another
profile.

```text
Admin Agent
  diagnose/repair mode
  orchestrator mode
  judge mode

Codegen Agent
Verification Agent
Code Review Agent
```

Automated Admin Agent operation must use bounded iterations rather than one
indefinitely growing conversation:

```text
wake
  -> inspect current durable state
  -> select one repair, delegation, or proposal
  -> execute or request approval
  -> verify and record the outcome
  -> sleep
```

## Ownership And Attribution

Do not overload one "owner" label. Every relevant UI and API read model should
distinguish:

- **initiated by**: the user, source message, task, hook, or system event that
  caused the work;
- **created/configured by**: the user or agent that created an automation,
  binding, workflow, or task;
- **accountable domain**: the operational area answerable for an Agent Profile,
  workflow, or task definition;
- **owned by**: the principal accountable for an Agent Profile;
- **stewarded by**: the real user or users ultimately accountable for an agent;
- **executed by**: the exact Agent Profile version and mode that performed a
  run or action;
- **participating agents**: agents whose runs or conversations contributed to
  a request.

Sessions already contain useful provenance. Authenticated Site sessions have a
`createdByUserId`; source messages may contain trusted platform author metadata;
sessions retain channel and interaction-policy metadata. Future request
creation must resolve this trusted state automatically rather than depending on
a model to repeat source IDs correctly.

Prospective provenance rules:

- Console request creation resolves the authenticated session user.
- Buzz, Discord, and Telegram resolve the specific source-message author;
  shared channel sessions are not assigned to the first participant.
- Scheduled requests identify `task:<task-key>` as the immediate initiator and
  separately preserve who configured the task.
- Hook-created requests identify the hook and preserve its configuration
  provenance.
- An agent-created request snapshots the initiating Agent Profile and version.
- Caller-supplied display names never override trusted Site-owned identity.

## Communication Bindings And Sessions

Each external communication surface has one primary Agent Profile. One Agent
Profile may serve zero, one, or many external surfaces.

```text
Buzz #veydrift -----+
Discord #veydrift --+--> Veydrift Agent
Telegram group -----+
```

The Prism Console is implicit for every agent and does not require an external
binding record. A new Console session explicitly selects an agent; Admin Console
always selects the Admin Agent.

Installing one transport bot in a workspace does not authorize an agent in
every channel. External routing resolves in this order: thread binding, channel
binding, any future explicitly configured category/workspace fallback, then
unconfigured. An unconfigured Discord mention receives a deterministic setup
message naming the destination and Agents configuration surface. It must not
invoke a runtime, read Memory or requests, or create a durable agent session.
An explicitly disabled binding remains silent.

A surface can have only one active primary Agent Profile. Assigning a second
agent to an occupied destination fails with a visible conflict naming the
current agent. An authorized operator must disable the existing binding before
assigning the destination elsewhere; assignment must never silently move a
channel between personas.

Session terminology describes the communication shape, not privacy:

- Console session: one active authenticated participant;
- channel session: shared channel conversation;
- thread session: shared thread conversation;
- direct-message session: one external participant;
- automated session: task, hook, or workflow initiated.

Do not label Console sessions "private." They are observable operational
records. The UI must state that authorized workspace administrators and agent
stewards can inspect them. Transcript access is capability-controlled and
audited.

In shared channel and thread sessions, the session belongs to the agent and
surface while each message retains its actual author.

## Requests And Cross-Agent Execution

Requests remain global because one workflow may involve multiple agents. They
show provenance, workflow state, current executor, participants, human steward
when assigned, and attention—not a forced single agent owner.

```text
Request #1468
  initiated by: Daniel via Buzz
  workflow: Recording Post-Publish
  accountable domain: Recording Operations
  current executor: Verification Agent · verifier mode · Quality
  participating agents: Recording Agent, Verification Agent
  steward: Daniel
```

Workflows are the primary durable cross-agent coordination mechanism. A
workflow may define a default executor, and a step may select another Agent
Profile and bounded mode. A missing step executor inherits the workflow
default.

```yaml
defaultAgent: recording-agent
steps:
  - key: prepare
  - key: verify
    executorAgent: admin-agent
    executionMode: verifier
  - key: publish
```

Executing one step does not transfer request ownership. Each run snapshots the
executor Agent Profile, version, mode, effective authority, and declared input
and output artifacts.

### Executor attribution iteration

Automated activity must never become operationally ownerless merely because it
has no chat session. Executor selection is canonical and ordered:

1. `steps[].executorAgent` (or the equivalent step `agentConfig` field);
2. workflow `defaultAgent`;
3. the required Admin Agent for legacy definitions with no explicit executor.

Every new run also records whether resolution was `step-explicit`,
`workflow-default`, `task-explicit`, `hook-workflow-default`, or
`admin-fallback`. An explicit Admin Agent assignment is not the same as an
implicit fallback and must remain distinguishable in audit.

Direct tasks use `agentConfig.executorAgent`; hook activity inherits its
workflow default. Every new run snapshots the resolved profile id, version, and
bounded execution mode when it is created. Workflow execution also creates an
automated, profile-scoped session so persona, runtime scope, skills, and memory
are applied rather than merely displayed as attribution.

The rollout repair assigns only already-active unassigned runs to the Admin
Agent. Completed historical runs remain unknown unless durable evidence proves
their executor; the UI must not manufacture historical provenance.

Cross-agent handoffs use explicit bounded artifacts rather than shared runtime
continuations. A handoff includes objective, relevant facts, declared inputs,
constraints, delegated authority, outputs, evidence, unresolved blockers, and
the next handoff. Agent-to-agent work must remain visible in the request
timeline.

Ad hoc Admin Agent delegation should create the same durable child-run or
workflow-step records. Do not add an unaudited agent-to-agent message bus.

## Agent Activity And Session Observability

An Agent page is primarily an identity-scoped activity and interaction surface.
Its activity read model joins existing canonical records rather than creating a
second activity source of truth.

Activity includes:

- workflow-step runs with request, workflow, step, status, mode, and artifacts;
- Console and external-channel conversations with surface and participants;
- task and workflow invocations;
- handoffs to and from other agents;
- Admin Agent interventions;
- profile, authority, skill, steward, and binding changes.

Activity cards show operational metadata, not full message bodies. They link to
a drillable session view.

The session view includes:

- chronological user and agent transcript;
- message-level authors and communication surface;
- Agent Profile and version;
- response jobs, runs, API actions, and outcomes;
- linked requests, workflows, tasks, artifacts, and handoffs;
- skills used and Gateway connection names, never credential values;
- errors, blockers, and collapsible technical traces.

The view should make causality inspectable:

```text
user message
  -> agent response job
  -> Site action
  -> request or workflow run
  -> artifact and outcome
```

## Revised Next Slice: Agent Identity And Observability Foundation

This slice replaces the previous Slice 6 execution-profile-first plan.

### Deliver

1. Add a Site-owned, versioned Agent Profile registry.
2. Seed the required protected Admin Agent.
3. Support user-, workspace-, and Admin-Agent-owned profiles with explicit
   human stewards and cycle-safe ownership.
4. Associate Agent Profiles and resolved versions with Console and source
   sessions.
5. Correct prospective request provenance for authenticated Console users,
   source-message authors, scheduled tasks, hooks, and agent-created work.
6. Add Agent Profile and mode snapshots to new response jobs and workflow-step
   runs without rewriting historical runs.
7. Add `/admin/lab/agents` and agent detail routes with Overview, Console,
   Activity, and Sessions as the first working views.
8. Add a capability-controlled, audited session transcript view.
9. Add deterministic agent creation through an Admin Console review/confirm
   flow. Default the initiating operator to human steward; allow explicit Admin
   Agent ownership.
10. Add zero-to-many external bindings with one primary agent per external
    surface. Preserve existing source-policy restrictions as authority inputs.
11. Display current executor and participating agents on global request detail
    and activity views.

Workflow authoring, task assignment, cross-agent step execution, and automated
Admin Agent repair loops may be implemented incrementally after the identity,
session, and activity foundations are proven. The schema must allow them without
requiring them all in the first deployment.

### Compatibility

- Existing interaction profiles remain valid source access-policy records until
  bindings are migrated; they are not displayed as agent owners.
- Existing `agentConfig.identity` remains a legacy execution label.
- New runs from existing workflows and tasks without Agent Profile assignments
  use the deterministic Admin Agent compatibility fallback and record
  `admin-fallback` as the executor-resolution source. Completed historical runs
  remain unknown unless durable evidence proves their executor; history is
  never rewritten merely to make attribution look complete.
- Existing request-origin snapshots remain immutable. Correct only prospective
  capture unless a conservative deterministic backfill is possible.
- Existing request numbers, histories, sessions, and run records are unchanged.
- Runtime Profiles remain independent transport configuration.

### Acceptance Criteria

- Admin Agent is present, separately displayed, protected from deletion, and
  resolves to real workspace administrators as ultimate stewards.
- An authorized operator can create an agent from Admin Console, review its
  non-secret policy, choose operator or Admin Agent ownership, and confirm it.
- Every new Console session identifies the selected Agent Profile, version, and
  authenticated participant.
- A source-channel session deterministically resolves its primary agent and
  retains message-level authors.
- New scheduled requests show the task as initiator and preserve the task's
  configurator when known.
- Agent Activity shows workflow-step execution and conversations with links to
  canonical requests, runs, and sessions.
- Authorized operators can drill into a Console or channel session and inspect
  the transcript and resulting actions.
- No UI calls an operational Console session private.
- A request involving several agents remains one global request and lists its
  participants without assigning false ownership.
- Profile ownership cannot cycle or silently widen child authority.
- Secrets and credential values never appear in profile snapshots, transcripts,
  activity payloads, or model prompts.

## Deferred Decisions

- Whether agent templates are instance-owned, source-backed, or both.
- Accountability Domains are adopted for ownership and audit metadata as
  specified in
  [Accountability Domains And Execution Audit](./accountability-domains-and-execution-audit.md).
  Domain RBAC, configuration inheritance, and cascading authority remain
  deferred.
- When verifier, reviewer, or judge warrants an independent Agent Profile
  instead of an Admin Agent mode.
- Which low-risk Admin Agent repairs may run without human confirmation.
- Whether non-admin users may create agents or only request creation through the
  Admin Agent.

## Configuration Consolidation Addendum

Agent Profiles are the single authored identity and communication-policy
aggregate. Interaction Profiles and the file-backed source-adapter policy are
legacy import sources only and must not remain parallel authoring systems.

The Prism Console is an implicit authenticated binding and defaults to full
access. Discord, Buzz, Telegram, external HTTP, and future communication
bindings each carry an explicit access mode, rate limit, allowed workflows, and
optional narrower thread/group/user overrides. Neither a binding nor one of its
overrides may exceed the parent Agent Profile or binding maximum.

Communication adapters own transport, channel discovery, delivery, and trusted
author identifiers. For every inbound interaction they resolve one effective
Agent Profile version and binding policy from Site. They do not own personas,
skills, memory policy, or channel authority.

An installed adapter with no Site-owned Agent Profile binding is explicitly
unconfigured, even if historical source-policy defaults would otherwise allow
readonly interaction. This fail-closed state exposes migration and setup gaps
rather than hiding them behind an anonymous fallback persona.

Existing channel rules are migrated through the Agents review surface. The
migration creates or reuses an Agent Profile, copies non-secret persona/runtime/
memory configuration, and creates its bindings. Historical policy records stay
readable for rollback and attribution, but their public write routes return a
retired-authoring response. Once all deployed instances have migrated, those
compatibility reads and the adapter fallback can be removed.

## Next Slice: Scoped Memory Explorer And Agent Conversations

Implementation status: the first field-test slice is implemented on the Lab
branch. It includes configuration-aware navigation, Timeline and Knowledge
browsing, server-side facets and authorization, versioned profile Memory scope,
eligible-agent selection, durable observable Memory sessions, and a
runtime-enforced read-only conversation handoff. Relationship graphs, reusable
reference collections, and explicit promotion into operational work remain
deferred as described below.

### Product boundary

Prism Memory is durable, inspectable context. An Agent Profile provides the
identity, persona, runtime, authority, and conversation. The Lab must not model
Memory as its own chatbot or introduce a second unowned console.

The Memory destination appears under Workspace when
`PRISM_MEMORY_BASE_URL` is configured:

```text
Workspace
  Requests
  Activity
  Memory
  Settings
```

Configuration and availability are different states. If Memory is configured
but unreachable, keep the destination visible and render an honest unavailable
state with the last known space and health information. Do not make navigation
disappear during an outage.

The first Lab Memory surface has two primary modes:

```text
Memory
  Timeline
    Latest daily snapshot
    Daily rollups grouped by week
    Meeting and source-bucket indicators
    Decisions, action items, open threads, facts, and upcoming items
    Evidence quotes and source references

  Knowledge
    Text search
    Kind, tag, entity, source, audience, and stability facets
    Document content, metadata, and provenance
    Related-document links
    Knowledge sources and synchronization status
```

`memory/rolling/latest` is an alias for the newest daily rolling snapshot, not
a separate type of daily. Weeks organize navigation over daily records. The
currently implemented weekly outputs are content-suggestion rollups; the UI
must not label them as weekly rolling memory. A true weekly memory product may
be introduced later under an explicit contract.

Meeting indicators are derived from canonical source digest paths and bucket
metadata. A selected highlight preserves its section, source digest, author,
timestamp, external jump URL, and evidence quote. The UI must not convert
deterministic evidence into unattributed prose.

### Memory and knowledge contracts

The existing Prism Memory service already exposes daily rolling memory,
per-date and per-bucket digests, recent activity, daily and weekly content
suggestions, knowledge document search, tag and entity indexes, knowledge
sources, and derived objectives/signals/throughlines. The current Site Memory
Explorer proxies artifacts, sources, objectives, signals, and throughlines but
does not provide the proposed timeline or first-class knowledge search.

Add the smallest read contracts needed by Lab rather than probing filesystem
paths from the browser:

1. A bounded index of available rolling dates with section and bucket counts.
2. A daily rolling-memory read returning canonical evidence references.
3. Knowledge search with server-side text and metadata filters.
4. Knowledge document detail and metadata reads.
5. Tag, entity, kind, and source facet values.
6. Related-document edges when the existing related index can be exposed with
   stable provenance.

The browser calls only authenticated Site `/admin/*` proxies. The Site calls
Prism Memory server-side with its read credential. Prism Memory keys, internal
base URLs, and raw filesystem paths never enter browser state.

Search and a document detail pane are the default Knowledge experience. A node
graph is deferred until the relationship contract has explicit, stable edges.
Shared tags and entities may support a small Connections panel first; the UI
must not imply that co-tagging is a stronger relationship than the source data
establishes.

### Capability model

Conversation and operational execution must not share one capability. Add
`canChatAgents` alongside the existing Memory capabilities:

| Capability               | Grants                                                              |
| ------------------------ | ------------------------------------------------------------------- |
| `canViewMemory`          | Browse Memory records the user is permitted to see.                 |
| `canChatAgents`          | Start and continue non-mutating conversations with eligible agents. |
| `canRunAgent`            | Invoke authorized workflow, task, tool, or mutation operations.     |
| `canManageMemorySources` | Configure, synchronize, or retire knowledge sources.                |

Members receive `canViewMemory` and `canChatAgents` by default. This does not
grant Admin Agent access, source management, workflow continuation, Memory
writes, or unrestricted tool execution. Moderator and administrator grants
remain explicit through the existing role/capability system.

Record-level access is enforced by the Site as the intersection of:

```text
authenticated user access
  AND selected Agent Profile memory scope
  AND selected surface/session authority
```

Agent scope never replaces user authorization. An all-memory Admin Agent cannot
reveal operator-only documents to a member. Conversely, a user who can inspect
a document cannot force an agent to retrieve it when the profile excludes that
source or bucket.

The initial normalized Agent Profile memory scope supports:

- rolling-memory buckets;
- knowledge source IDs;
- optional knowledge kinds, tags, entities, audiences, and stability classes;
- profile-specific retrieval instructions;
- an explicit workspace-wide scope reserved for suitably governed agents.

An empty or malformed scope fails closed. Profile edits create a new immutable
version; existing sessions retain the scope snapshot with which they began.
The required Admin Agent may have workspace-wide operational Memory scope, but
its availability to a user remains capability- and policy-controlled.

### Ask an agent

The Memory Explorer replaces the legacy standalone Memory Chat with an
agent-selection handoff:

```text
select day, evidence, documents, or sources
  -> Ask an agent
  -> choose among eligible Agent Profiles
  -> create a normal profile-scoped session
  -> open the selected agent Console with visible Memory references
```

The chooser lists only agents the user may chat with whose immutable profile
scope covers every selected record. If no one agent covers the selection, the
UI explains which references are excluded and allows the user to narrow the
selection. It never silently widens an agent's scope or defaults a member to
the Admin Agent.

The most recently used eligible agent may be suggested, but agent selection is
explicit. Console-only agents are valid choices; an external communication
binding is not required.

A Memory-originated session defaults to a server-enforced read-only retrieval
posture. It may answer, compare, summarize, and cite the selected records, but
cannot continue a workflow, publish or modify knowledge, create requests, or
invoke mutating tools merely because the underlying profile can do so. An
authorized user may later choose an explicit operational action in the agent
Console; that transition requires `canRunAgent`, fresh policy evaluation, and
the normal confirmation or workflow boundary.

Selected records are stored as typed references, not trusted browser-supplied
content. The server resolves and authorizes each reference before assembling
bounded runtime context. Responses cite stable artifact IDs, document slugs,
source URLs, digest paths, or external jump URLs. Context limits and omitted
records are visible rather than silently truncating evidence.

### Ownership and observability

A Memory-originated conversation is a normal observable Agent Profile session,
not a private chat. It records:

- initiating user;
- selected Agent Profile and immutable version;
- read-only Memory posture and effective capability decision;
- typed Memory and knowledge references;
- source surface (`prism-memory-explorer`);
- chronological messages, retrievals, citations, and errors;
- any later explicit operational transition and resulting canonical actions.

The session appears in the selected agent's Activity and Sessions views and in
workspace Activity. Authorized operators and stewards can drill into the
transcript and causal records under the existing audit model.

### Ordered delivery

1. Add configuration-aware Memory navigation and `/admin/lab/memory`, including
   configured-offline and unauthorized states.
2. Add the rolling-date index and build Timeline with weekly grouping, daily
   selection, deterministic sections, meeting/source indicators, and evidence
   drill-down.
3. Add Knowledge search, metadata facets, document detail, provenance, related
   links, and knowledge-source status.
4. Add `canChatAgents`, default role grants, and distinct read-only versus
   operational authority checks.
5. Normalize and enforce versioned Agent Profile memory scopes at every Site
   retrieval boundary.
6. Add the eligible-agent chooser and create observable, profile-scoped,
   read-only Memory sessions with typed references and citations.
7. Add "Open in agent Console" and an explicit, separately authorized path
   from read-only investigation to operational work.
8. Field-test search and Connections before defining or rendering a graph API.

### Acceptance criteria

- Memory appears under Workspace only when configured and remains visible with
  an honest offline state when the configured service is unavailable.
- A user with `canViewMemory` can browse only records allowed by Site policy.
- Daily navigation never presents `latest` as a second daily record or labels
  weekly content suggestions as weekly rolling memory.
- Timeline highlights retain section, bucket, source, author, timestamp, and
  evidence provenance when available.
- Knowledge search supports server-side text and metadata filters and returns
  stable document identifiers and provenance.
- A member with `canChatAgents` but without `canRunAgent` can ask an eligible
  ordinary agent about selected Memory without gaining mutation authority.
- The Admin Agent is not offered to a member unless an explicit policy grant
  makes it eligible.
- The server rejects a selected record when either user access or the immutable
  Agent Profile scope excludes it.
- Browser-supplied content cannot masquerade as an authorized Memory record.
- A read-only Memory session cannot continue workflows, create requests,
  publish knowledge, or call mutating tools.
- Every Memory conversation identifies the initiating user, agent profile and
  version, selected references, retrieval decisions, and citations.
- Memory sessions are visible in agent and workspace Activity and are never
  described as private.
- Source-management controls require `canManageMemorySources`; conversational
  access never implies configuration access.
- No Prism Memory credential or internal service URL is exposed to the browser,
  transcript, activity payload, or model prompt.

### Deferred decisions

- Whether a dedicated weekly rolling-memory product is useful beyond grouping
  daily snapshots and the existing weekly content suggestions.
- Whether source-level audiences need more granularity than the initial
  workspace/operator policy classes.
- Whether a mature relationship contract justifies a full node graph.
- Whether users may save reusable Memory reference collections.
- Whether agents may propose knowledge inbox entries directly from read-only
  conversations or only after an explicit operational transition.
