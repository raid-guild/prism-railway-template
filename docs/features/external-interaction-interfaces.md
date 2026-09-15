# External Interaction Interfaces

Status: first additive server-to-server slice in progress

## Implementation Status

Implemented on the feature branch:

- additive Site tables for profiles, interfaces, credential hashes, and ingress
  authorization events;
- console/agent configuration routes and a built-in
  `prism-interaction-author` skill;
- admin-only one-time API-key generation, rotation, and revocation;
- a compact **Settings > Interfaces** observability and credential surface;
- source-adapter session and message routes backed by generic Site sessions;
- persona/version metadata, continuation reset, rate limiting, and public-output
  sanitization;
- operator-owned advisory Memory source, bucket, and behavior instructions,
  injected into the trusted Runtime policy and labeled instructions-only;
- Gateway credentials only for deliberately configured `full` interfaces, and
  no enabled interfaces by default.

Next interaction work, in order:

- upgrade advisory Prism Memory selectors to enforceable source and bucket
  scoping, including the required Prism Memory service authorization changes;
- deterministic `run-approved` execution that rejects workflows outside the
  configured allowlist before starting a run.

Later, separate authorization work:

- a restricted tool-free Runtime;
- reuse of interaction profiles by Discord and Telegram;
- the future organization authorization service.

Browser-direct authentication, CORS flows, and signed browser sessions are not
on this roadmap. The interface is server-to-server; browser clients should call
their own application backend.

Rate limits are aggregate per interface credential boundary and count session
creation as well as messages. Session IDs and caller-asserted external subjects
must not create independent capacity or allow a caller to bypass the configured
interface limit.

## Decision

Add named HTTP interaction interfaces to the existing source/communication
adapter. Each interface is an operator-configured conversational entrypoint,
similar to a Discord channel or Telegram chat, with a stable path and a
Site-owned interaction profile.

The first slice is additive:

- existing Discord and Telegram behavior does not change;
- no external interface exists or is enabled by default;
- `/agent/*` and Runtime routes remain internal service APIs;
- Gateway remains credential custody and lease audit, not interaction RBAC;
- hooks remain the event and approved-workflow entrypoint;
- configuration is authored through Prism Console and observed in Settings.

The intended path is:

```text
external application
  -> source/communication adapter HTTP interface
  -> Site resolves interface and interaction policy
  -> Site-owned agent session
  -> Site-mediated Runtime invocation
  -> adapter returns the sanitized response
```

This follows the Discord and Telegram pattern instead of adding a second public
agent API directly to Site.

## Why

External applications need bounded ways to interact with Prism. Examples
include:

- a chat assistant embedded in a documentation site;
- a Portal project module that uses Prism Memory context;
- a project assistant that may start selected Prism workflows;
- a member-support interface with an instance-specific persona;
- a trusted internal application that needs broader Prism assistance.

Existing routes are adjacent but do not provide this boundary:

- `/agent/runtime/invoke` trusts an internal service token and must not be
  exposed to external clients;
- hooks accept events and create workflow-backed requests, but are not
  conversational sessions;
- Prism Memory exposes read, write, and operations keys, but current read keys
  are not scoped to individual knowledge sources or buckets;
- Discord and Telegram already have source identity, session, policy, rate
  limit, sanitizer, and Runtime handoff patterns that should be reused.

## Goals

- Support several named external interaction paths per Prism instance.
- Give each path operator-owned authentication and interaction configuration.
- Reuse Site agent sessions, Runtime profiles, hooks, and source access modes.
- Support trusted persona instructions that callers cannot override.
- Allow an interface to run only explicitly configured workflows.
- Preserve source, external subject, session, run, request, and workflow audit
  attribution.
- Keep the implementation compatible with a future organization authorization
  service without requiring that service now.
- Require explicit operator activation on each instance.

## Non-goals For The First Slice

- Do not expose `/agent/*` or a Runtime adapter directly to external clients.
- Do not build the future organization RBAC authority service.
- Do not add Gateway permissions, grants, toolsets, or provider operation
  catalogs.
- Do not add a generic plugin framework for communication transports.
- Do not migrate Discord or Telegram to a new policy model in the same change.
- Do not accept a persona, Runtime profile, Memory scope, workflow list, or
  credential list from an individual external request.
- Do not place a long-lived API key in browser JavaScript.
- Do not claim that prompt instructions alone enforce a public read-only
  security boundary.
- Do not automatically ingest external conversations into Prism Memory.
- Do not add a new primary navigation surface.

## Terms

### External interface

A named HTTP transport entrypoint such as `docs-assistant` or
`portal-project-assistant`. It owns transport configuration: enabled state,
authentication mode, allowed origins, and its interaction profile reference.

### Interaction profile

The complete operator-owned behavior resolved for a conversation. It contains
an access mode, persona, Runtime selection, allowed workflows, rate limit, and
eventually enforced Memory scope.

Profiles are intended to become reusable by Discord and Telegram later. They
are introduced through the external HTTP transport first so existing adapters
do not need a flag-day migration.

### Source identity

The verified transport and caller context supplied by the adapter. For an
external interface this includes the interface key, authenticated client, and
an optional external subject asserted by a trusted application backend.

### Resolved interaction context

The Site-owned result passed to Runtime and audit records. External callers do
not construct it.

## Responsibility Boundary

### Source/communication adapter

The adapter owns:

- public HTTP interaction routes;
- extraction of the interface key;
- forwarding credentials to Site for verification over the internal service
  boundary;
- request-size enforcement and optional Origin metadata checks for configured
  application backends; this is not a browser CORS/authentication flow;
- transport-level rate limiting and timeouts;
- public-output sanitization;
- returning the response to the external application;
- source identity and correlation metadata.

The adapter does not own personas, organization roles, Memory authorization,
workflow definitions, Gateway credentials, or the canonical session record.

### Site

Site owns:

- external interface records and credential hashes;
- interaction profiles;
- policy resolution;
- personas and trusted instructions;
- allowed workflow resolution;
- agent sessions and messages;
- Runtime profile selection and invocation;
- request, workflow, and interaction audit linkage;
- Gateway credential assignment based on resolved trust.

### Runtime

Runtime executes only the Site-resolved request. It must not treat caller input
as authority or let caller metadata replace the resolved interaction context.

### Gateway

Gateway continues to lease active credentials to trusted jobs under the
credential-only model described in
[Prism Credential Gateway](./prism-credential-gateway.md).

- `off`, `readonly`, and `run-approved` external contexts receive no
  organization credentials.
- An explicitly configured `full` interface is a trusted source
  context and follows normal trusted-run credential leasing.
- Approved workflows receive credentials according to their workflow or task
  configuration, not from the external request.

### Prism Memory

Prism Memory remains the source of durable context. Until Memory supports
resource-scoped authorization, a limited external run must receive a
Site-prepared context bundle or use a restricted broker. Giving a limited run a
global Memory read key does not enforce a knowledge-source or bucket scope.

The current profile may store `knowledgeSourceIds`, `buckets`, and additional
Memory instructions. Site passes them as trusted model instructions and records
`enforcement: instructions-only`. This improves relevance and model behavior,
but it is not access control: the model can make mistakes and the Memory service
does not reject out-of-scope reads yet.

## First-Slice Configuration

The initial model should remain small.

An external interface needs:

```json
{
  "key": "docs-assistant",
  "name": "Documentation Assistant",
  "enabled": false,
  "authMode": "api-key",
  "interactionProfileKey": "public-docs",
  "allowedOrigins": ["https://docs.example.org"]
}
```

An interaction profile needs:

```json
{
  "key": "public-docs",
  "name": "Public Documentation Guide",
  "mode": "readonly",
  "runtimeProfileKey": "public-context-chat",
  "persona": {
    "name": "Prism Docs Guide",
    "instructions": "Answer from the supplied public documentation context. Be concise and do not speculate about private workspace state."
  },
  "memoryScope": {
    "knowledgeSourceIds": ["public-handbook"],
    "buckets": [],
    "instructions": "Use only the configured public handbook source; say when the answer is outside it."
  },
  "allowedWorkflows": [],
  "rateLimit": {
    "windowSeconds": 60,
    "maxRequests": 10
  }
}
```

Persona instructions are trusted Site configuration. The external request may
contain user content and an opaque subject identifier, but it cannot provide or
override the persona.

Memory selectors are trusted Site configuration and cannot be overridden by an
external request. They currently compose model instructions only and must not
be presented as enforced until Prism Memory rejects out-of-scope access.
Knowledge-source IDs are the primary selector for docs, handbook, policy, and
support assistants. Operators should resolve them from `GET /knowledge/sources`
rather than guessing from a display name. Buckets are optional and intended for
activity or digest context when explicitly requested.

## Public HTTP Shape

The initial source-adapter surface may be:

```text
POST /interactions/:key/sessions
POST /interactions/:key/sessions/:sessionId/messages
```

The exact response envelope is not frozen by this spec. It must include stable
request and session identifiers and a sanitized assistant response. Streaming
can be added later without changing the policy model.

The adapter maps the interface to source context similar to:

```json
{
  "platform": "external",
  "targetId": "docs-assistant",
  "userId": "client:docs-site",
  "groupIds": []
}
```

An authenticated backend may additionally assert an external subject for audit.
That subject is not an independently verified Prism user and must not receive
user-specific authority unless a later signed identity mechanism verifies it.

Workflow execution should use an explicit endpoint or structured action that
Site checks against `allowedWorkflows`. Site then uses the existing hook or
workflow request path. The Runtime must not receive a broad Site service token
and rely on prompt instructions to honor the list.

## Authentication

The first slice supports server-to-server API keys:

1. Site generates a random credential.
2. Site stores only a strong hash and a display prefix.
3. The authenticated Settings UI shows the plaintext value once.
4. `/agent/*` may create the pending interface configuration but never returns
   the plaintext credential.
5. The adapter asks Site to authorize the presented credential over the private
   service boundary.
6. Rotation and revocation take effect without a Railway variable change.

An API key identifies the external application, not necessarily the human using
it.

Browser-direct chat is outside the current design. Long-lived interface keys
must not be shipped in browser bundles. A browser application should call its
own backend, which holds the interface credential and calls Prism
server-to-server. CORS is not being used as an authentication boundary.

## Access Modes

Keep the existing operator-facing modes:

- `off`: reject the interaction;
- `readonly`: answer from permitted context with no organization credentials;
- `run-approved`: readonly behavior plus explicitly listed workflows; the
  profile is stored now, but deterministic allowlist enforcement is not wired
  until the workflow execution slice;
- `full`: trusted agent behavior with normal trusted-run credential access,
  enabled only through deliberate operator configuration.

Modes are convenient presets, not a future universal RBAC vocabulary. The
resolved context should also record concrete actions and resources so a future
authority service can return the same decision shape.

## Persona And Session Behavior

Trusted instruction order should be:

```text
Runtime safety and Prism operating instructions
  -> resolved persona instructions
  -> resolved access and context boundaries
  -> prepared Memory context
  -> conversation history
  -> current user message
```

Each session records the interaction profile key and a profile version or
snapshot. If persona or Runtime configuration changes, Prism must either keep an
existing session pinned or reset its Runtime continuation. It must not silently
reuse a continuation created under different trusted instructions.

Site's generic source session lookup and upsert behavior should be reused rather
than introducing a second conversation database.

## Console And UI

Configuration remains console-first. An operator should be able to say:

> Create a disabled read-only external docs assistant using the Docs Guide
> persona and no workflows or credentials.

Agent routes should accept non-secret configuration. Secret generation, copy,
rotation, and revocation remain authenticated UI actions.

Add one compact operational surface under Settings, such as **External
Interfaces**. It should show:

- endpoint key and enabled state;
- authentication mode and credential status;
- resolved interaction profile and access mode;
- persona and Runtime profile;
- allowed workflow count;
- last use and recent success/failure counts;
- links to related sessions, runs, requests, and Gateway lease audit.

The UI is for observability and credential lifecycle, not a large persona or
policy form builder. Substantive changes should continue through Prism Console.

## Audit

Reuse existing records for accepted work:

- conversations in `agent_sessions` and `agent_messages`;
- execution in `agent_runs`;
- workflow and request state in existing workflow/request records;
- credential issuance in Gateway lease audit.

Add a small ingress audit stream only for events that may occur before those
records exist:

- authentication accepted or rejected;
- unknown, disabled, or rate-limited interface;
- invalid request shape;
- disallowed workflow attempt;
- resolved interface and profile version;
- stable request ID and safe external identity hash.

Never record plaintext interface credentials, authorization headers, Gateway
credential values, or raw private prompt bodies in the ingress audit stream.

## Additive Data And Migration

Prefer additive Site tables for interface records, credential hashes,
interaction profiles, and ingress events. Do not replace or rewrite the current
`source-adapter-policy.json` in the first slice.

Existing source policy continues to resolve Discord and Telegram exactly as it
does now. Later, its target, group, and user rules may gain an optional
`interactionProfileKey`. Legacy rules without one keep their current mode,
rate-limit, and access behavior.

Instance rollout requires configuration rather than a content migration:

1. deploy compatible Site, source adapter, and Runtime versions;
2. verify existing Discord and Telegram policy behavior;
3. create a suitable Runtime profile;
4. create the interaction profile and disabled interface;
5. generate the instance-specific credential;
6. verify auth, rate limiting, sanitization, session audit, and workflow denial;
7. enable the interface explicitly.

Knowledge source IDs, workflow keys, personas, origins, and API credentials are
instance-owned and must not be copied from template examples.

## Future Authorization Service Alignment

This feature does not implement the organization authority service explored in
[Role-Agent Delegation And Organization Access](../research/role-agent-delegation-and-org-access.md).

It should, however, keep a compatible boundary:

```text
adapter verifies source identity
  -> Site requests an authorization decision
  -> local interaction policy resolves it today
  -> future authority service may resolve it later
  -> Runtime receives the same bounded execution context
```

A future decision may include:

```json
{
  "initiatedBy": "external:portal:user:123",
  "source": "external:portal-project-assistant",
  "agentProfileKey": "project-coach",
  "actions": ["chat.respond", "memory.read", "workflow.run"],
  "resources": [
    "knowledge-source:project-handbook",
    "workflow:project-status-review"
  ],
  "expiresAt": "2026-07-16T20:00:00Z"
}
```

The adapter must not become an organization membership or role store. Gateway
must not become the authorization service. Site remains the local authority
until there is a demonstrated need to extract it.

## Later Work

- First upgrade the advisory Memory selectors to enforceable source, bucket,
  artifact, and visibility scopes through changes to Prism Memory.
- Then add deterministic `run-approved` execution through existing Site
  workflow or hook behavior, rejecting non-allowlisted workflow keys before
  execution.
- Let Discord and Telegram targets, groups, and users reference reusable
  interaction profiles.
- Add a restricted, tool-free Runtime profile suitable for public chat.
- Add streaming responses and cancellation.
- Add per-interface usage budgets and durable distributed rate limits.
- Add inbound email as another communication transport where appropriate.
- Add reusable agent cards when the agent-card feature is implemented.
- Replace local authorization decisions with signed execution grants only if a
  separate authority service is proven useful.

## Implementation Sequence

1. Add additive Site records and agent/admin APIs for interaction profiles and
   disabled external interfaces.
2. Add hashed API-key generation, rotation, revocation, and authorization.
3. Add the source-adapter session and message routes.
4. Reuse generic Site source sessions and Site-mediated Runtime invocation.
5. Apply persona instructions, access mode, rate limit, and output sanitization.
6. Add ingress audit and the compact Settings observability surface.
7. Validate one disabled-by-default server-to-server interface.
8. Add advisory Memory selectors and trusted model instructions to the Site
   profile contract.
9. Enforce those selectors through Prism Memory authorization.
10. Add deterministic allowlisted workflow execution through existing Site
   workflow or hook behavior.

Browser-direct authentication and CORS flows are explicitly excluded from this
sequence. Revisit them only if the product later adopts browser-to-Prism calls.

## Acceptance Criteria

- An operator can create several disabled named external interfaces through
  Prism Console without Railway access.
- Each interface has a stable adapter path and one resolved interaction profile.
- Site stores only hashes of inbound API credentials and never exposes them
  through agent routes.
- A request cannot override persona, Runtime, access mode, workflow list,
  Memory scope, or credential assignment.
- Existing Discord and Telegram behavior and configuration remain unchanged.
- Limited external contexts receive no Gateway credentials.
- Once the `run-approved` slice is implemented, a disallowed workflow is
  rejected before Runtime or workflow execution. This is not yet a current
  guarantee.
- Accepted conversations reuse Site sessions and record source attribution.
- Public responses pass through the existing sanitizer.
- No interface becomes externally usable until an operator enables it.
