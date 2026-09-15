# Role-Agent Delegation And Organization Access

## Research Status

- Researched: 2026-07-15
- Status: exploratory product and architecture research
- Decision: no implementation commitment
- Scope: organization identity, role agents, delegated execution, external
  service providers, budgets, and optional onchain authority

This note replaces the earlier narrow `Prism Access` feature direction. The
working idea has expanded beyond role checks inside one Prism instance and may
be better treated as independent organization infrastructure or a separate
product.

## Summary

The central hypothesis is:

> A role can have a durable agent that executes on behalf of all authorized
> members of that role.

Users do not need direct possession of every application credential, wallet, or
downstream permission. They receive the ability to instruct a role agent. The
agent executes through scoped credentials, budgets, workflows, and signing
policies owned by the role.

The model can be entirely offchain. Hats Protocol, smart accounts, or other
onchain systems are optional additions when a role agent needs portable,
externally verifiable authority or control of funds and contracts.

The same model can extend across organizations. A client organization can grant
temporary, revocable access to a service provider's durable role agent without
provisioning every provider employee or sharing permanent credentials.

## Why Explore This

Prism currently has several adjacent access concepts:

- Site users have built-in `admin`, `moderator`, and `member` privileges.
- Discord and Telegram adapters apply target, group, and user policies.
- skills, workflows, tasks, requests, and agent profiles have owners or
  operators.
- Runtime executes work and may spawn temporary subagents.
- Gateway stores credentials and audits their use.
- downstream systems retain their own authorization rules.

These answer individual questions but do not provide one accountable execution
model for:

- a team that shares operational authority,
- a durable agent acting for that team,
- parent roles that manage child roles and their agents,
- role-owned credentials and budgets,
- a service provider operating inside a client environment,
- attribution from the initiating member through the executing agent,
- immediate revocation across applications.

The research question is whether a role-agent control plane is a useful missing
layer between identity systems, runtimes, credential gateways, applications,
and financial accounts.

## Core Terms

### Organization

An isolated administrative and trust domain. Organizations own their users,
roles, role agents, applications, resources, and delegations.

### Role

An organizational unit with members, managers, responsibilities, owned
resources, and one durable execution agent. A role may have one managing parent
and narrower child roles.

### Role agent

A durable execution principal representing a role. It is not one temporary LLM
process. It is a stable profile that may be executed by different compatible
runtimes.

The profile can own or reference:

- skills and workflows,
- connected services and credentials,
- application permissions,
- operational budgets,
- a wallet or smart-account signing policy,
- runtime defaults,
- approval requirements,
- audit and accountability metadata.

### Member

A human authorized to instruct a role agent. Membership is distinct from direct
access to the agent's credentials or funds.

### Manager

A member authorized to manage the role, its membership, agent configuration,
child roles, budgets, or approvals. Management powers should be explicit and
should not be inferred by the model.

### Runtime subagent

A temporary worker spawned during a role-agent run. It inherits an equal or
narrower execution context and is not a durable organization identity.

### Execution grant

A signed, scoped, short-lived authorization binding an initiating principal,
role, role agent, audience, actions, resources, and constraints.

### External delegation

A client organization's grant of bounded authority to a role agent owned by a
different organization.

## Primary Model

```text
Organization
└── Role
    ├── members who may instruct it
    ├── managers accountable for it
    ├── one durable role agent
    ├── owned skills, workflows, and resources
    ├── assigned credentials and connected services
    ├── operational and financial budgets
    └── child roles with narrower authority
```

A user primarily receives one permission:

```text
May this principal invoke this role agent for this operation?
```

The role agent then operates within its own bounded authority.

```text
User request
  -> authenticate user and source
  -> resolve organization and role membership
  -> evaluate role-agent policy
  -> issue short-lived execution grant
  -> Runtime executes role agent
  -> Gateway resolves assigned credentials
  -> application enforces its own business rules
  -> audit member, role, agent, action, and result
```

## Three Control Planes

### 1. Offchain membership plane

An organization access service owns:

- stable users and linked identities,
- role memberships and managers,
- role hierarchy,
- source identities such as Discord and Telegram,
- role-agent bindings,
- application permission assignments,
- authorization decisions and audit.

Ordinary users do not need wallets.

### 2. Agent mandate plane

The role agent has a durable execution identity. Initially this can be an
offchain service identity plus an optional Ethereum address.

An optional onchain binding can add:

- an Execution Hat,
- a Safe or smart-account signer role,
- externally verifiable activation and revocation,
- contract permissions,
- onchain budgets and signing authority.

### 3. Execution plane

Prism or another implementing application combines membership and mandate into
a bounded run:

```text
member may invoke role
  + role agent is active
  + action is in scope
  + required approval exists
  + budget is available
  = execution grant
```

Runtime and Gateway consume the grant. They should not reconstruct the full
organization hierarchy independently.

## Role Hierarchy

The first model should remain a tree rather than a general policy graph.

1. A role has at most one managing parent.
2. A parent may create and manage child roles only when explicitly authorized.
3. A child may not receive authority the parent cannot delegate.
4. A child cannot act upward or modify its parent.
5. Cycles are invalid.
6. Organization administrators retain recovery authority over the full tree.
7. Suspending a role prevents new execution by its role agent and descendants
   unless they are deliberately reparented.

This supports ownership and accountability without assuming voting, councils,
quorum rules, or other governance mechanisms.

## Acting Through A Role Agent

Role members do not become the role agent and do not receive its raw secrets.
The audit record must preserve both identities:

```json
{
  "initiatedBy": {
    "type": "user",
    "id": "alice"
  },
  "executedBy": {
    "type": "role-agent",
    "id": "content-team-agent"
  },
  "actingRole": {
    "id": "content-team"
  },
  "source": {
    "type": "discord",
    "id": "content-channel"
  },
  "action": "portal.posts.create"
}
```

Tasks, hooks, and unattended workflows use the same model but identify the
automation source instead of inventing a human initiator.

```text
initiatedBy: weekly-analytics-task
executedBy: analytics-role-agent
actingRole: analytics-team
```

## Runtime Subagents

A durable role agent may spawn research, validation, image, audit, or
orchestration subagents. Those subagents:

- inherit the parent run's organization, role, and initiating principal,
- receive no more authority than the parent grant,
- may receive a narrower action or resource scope,
- expire with the parent run or delegated lease,
- cannot modify their own role or permissions,
- record their identity and parent run in audit.

Temporary subagents should not each receive organization membership, a wallet,
or an onchain Hat.

## Guarded Actions

An implementing system adds execution-grant checks at consequential action
boundaries.

Examples:

```text
Prism
  prism.console.invoke
  prism.workflows.run
  prism.skills.manage
  prism.requests.approve

Portal
  portal.content.create
  portal.content.publish
  portal.members.manage

CRM
  crm.contacts.read
  crm.contacts.update
  crm.campaigns.send

Gateway
  gateway.credential.use
  gateway.connected_service.invoke

Onchain
  funds.send
  proposal.create
  multisig.sign
```

The access service does not need to understand each application's payload
schema. Applications define and enforce their own operations and business
rules. The access service binds opaque action names to roles, agents, resources,
and constraints.

## Execution Grant Shape

```ts
type ExecutionGrant = {
  id: string
  issuerOrganizationId: string
  initiatedBy: PrincipalRef
  actingRoleId: string
  roleAgentId: string
  audience: string
  actions: string[]
  resources: ResourceRef[]
  source: SourceRef | null
  parentRunId: string | null
  externalDelegationId: string | null
  constraints: {
    expiresAt: string
    budgetId?: string
    maximumValue?: string
    approvalIds?: string[]
  }
}
```

Protected services verify the signature, audience, expiry, action, resource,
and revocation status. Grants should attenuate as work is delegated; a child
grant must never expand its parent.

## Credential Custody

Client and organization credentials remain in Gateway or the relevant client
credential system.

```text
Role Agent
  -> presents execution grant
  -> Gateway verifies grant and role-agent assignment
  -> Gateway invokes or leases the assigned credential
  -> downstream service enforces native authorization
```

The role agent should not receive standing access to all role credentials. A
service provider should not receive a client's permanent credentials merely
because its agent has delegated access.

## Budgets And Financial Authority

A role agent can operate several kinds of role-owned budget.

### Operational budgets

- model and runtime usage,
- paid API and x402/MPP tool usage,
- rendering and storage,
- workflow execution quotas,
- provider-specific rate or spend limits.

### Financial budgets

- a Safe or smart-account balance,
- a bounded agent session key,
- DAO proposal or voting authority,
- token streams or role compensation,
- contract-specific spending limits.

Members access these budgets through the role agent rather than receiving
personal custody.

```text
member requests purchase
  -> role-agent grant permits purchase
  -> policy checks vendor, amount, and remaining budget
  -> required approvals are collected
  -> isolated signer executes
  -> expense is attributed to member, role, and agent
```

### Custody warning

Meaningful role funds should not be held directly in an agent EOA. Revoking an
application role or Hat does not remove an EOA private key's control over its
own funds.

Prefer:

- a Safe with revocable role-agent signing authority,
- a smart account with bounded session keys,
- a spending contract that validates current authority,
- an EOA used only as a constrained signer or gas payer.

The private key must remain in an isolated signer. The LLM and general runtime
should submit typed transaction intents, not read the key.

## Approval Policy

Membership permits a user to request execution; it does not necessarily approve
every action.

```text
Routine read                 automatic
Create a private draft       automatic
Publish publicly             editor approval
Spend below role threshold   automatic within budget
Spend above threshold        role manager approval
Treasury transfer            multisig or DAO approval
```

Deterministic software evaluates these rules. A model may propose an operation
or explain it, but it must not infer that approval exists.

## Optional Hats Protocol Binding

Hats Protocol is not required for the role-agent hierarchy. The entire
membership, management, execution-grant, budget, and audit model can be
implemented offchain.

Hats is useful when the role agent needs a portable and independently
verifiable organizational mandate.

```ts
type HatsBinding = {
  provider: "hats"
  chainId: number
  hatId: string
  wearerAddress: string
}
```

In the hybrid model:

- users and membership remain offchain,
- a durable role-agent wallet wears an Execution Hat,
- parent governance controls the relevant Hat administration, eligibility, and
  activation arrangements,
- the access service verifies Hat state before issuing selected grants,
- onchain accounts and contracts may independently check Hat authority.

```text
Is Alice an offchain member of Content Team?
  + Is Content Agent's Execution Hat valid?
  = May Org Access issue this Content Agent grant?
```

For ordinary offchain actions, Hat validation should normally be a cached read,
not a new transaction. High-risk onchain actions are validated again by the
account, signer, or receiving contract.

Hats adds:

- public and portable role identity,
- onchain parent administration and revocation,
- integration with token gates, Safes, Hats Accounts, and governance,
- authority that is not silently rewritten by the offchain database.

Hats also adds RPC, indexing, signing, gas, caching, privacy, and recovery
complexity. It should remain an optional role binding rather than a requirement
for ordinary users.

Primary references:

- [Hats Protocol developer overview](https://docs.hatsprotocol.xyz/for-developers/hats-protocol-for-developers)
- [Hats trees](https://docs.hatsprotocol.xyz/for-developers/hats-protocol-for-developers/hats-trees)
- [Hat administration and hatter contracts](https://docs.hatsprotocol.xyz/for-developers/hats-protocol-for-developers/hat-admins-and-hatter-contracts)
- [Hats Account](https://docs.hatsprotocol.xyz/hats-integrations/permissions-and-authorities/hats-account)

## Cross-Organization Delegation

The role-agent model becomes more distinctive when a service provider operates
inside a client organization.

```text
PayrollCo
└── Payroll Operations
    ├── provider members
    └── Payroll Agent

Acme
└── delegates bounded payroll authority
    to PayrollCo's Payroll Agent
```

Acme does not provision every PayrollCo employee. PayrollCo controls who may
instruct its own agent. Acme controls what that agent may do inside Acme.

```ts
type ExternalDelegation = {
  id: string
  issuerOrganizationId: string
  subjectOrganizationId: string
  subjectRoleAgentId: string
  audience: string
  actions: string[]
  resources: ResourceRef[]
  constraints: {
    expiresAt: string
    maximumValue?: string
    requiresClientApprovalFor: string[]
    mayRedelegate: boolean
  }
  status: "active" | "suspended" | "revoked" | "expired"
}
```

Delegation must not be transitive by default. A provider cannot pass client
access to a subcontractor unless the client explicitly permits it.

### Provider execution flow

```text
Provider member authenticates
  -> provider confirms role membership
  -> provider role agent receives an execution attestation
  -> client verifies external delegation
  -> client issues client-scoped execution grant
  -> provider role agent performs guarded action
  -> both organizations retain linked audit records
```

### Dual approval

Provider and client can maintain separate accountability:

| Action | Provider control | Client control |
| --- | --- | --- |
| Read permitted records | Role membership | Pre-authorized delegation |
| Prepare payroll draft | Provider agent policy | Pre-authorized delegation |
| Change bank details | Provider manager | Client approval |
| Execute payroll | Provider manager | Client finance approval |
| Transfer treasury funds | Provider policy | Client multisig |

The provider may change staff without changing the client's delegation. The
client may suspend the provider agent without changing provider membership.

## Independent Service Boundary

This capability is probably better as independent organization infrastructure
than as a large subsystem inside Prism Site.

Tentative service responsibility:

- organizations and workspaces,
- stable principals and linked identities,
- roles, membership, management, and hierarchy,
- durable role-agent profiles,
- application action and resource assignments,
- optional onchain bindings,
- external trust relationships and delegations,
- signed execution grants and revocation,
- authorization and delegation audit.

It should not own:

- application passwords and MFA initially,
- client credentials,
- application records and request schemas,
- workflow definitions,
- runtime execution,
- funds,
- downstream application authorization logic.

It should begin as an identity directory and authorization service, not a new
identity provider. Applications can authenticate users through existing
sessions or OIDC and submit a verified issuer and subject.

## Deployment Models

### Single organization

One self-hosted service shared by Prism, Portal, CRM, adapters, Gateway, and
other organization applications.

### Hosted multi-tenant

One service hosts strictly isolated organization namespaces. Organizations
establish explicit trust relationships and delegations.

### Federated

Each organization runs its own service and exchanges signed organization,
role-agent, and delegation attestations.

Federation best preserves organization autonomy but introduces key discovery,
trust establishment, revocation propagation, protocol compatibility, and
cross-domain audit complexity. It should not be the first implementation.

## Illustrative APIs

### Authorization

```http
POST /v1/authorize
```

```json
{
  "organizationId": "raidguild",
  "principal": {
    "issuer": "discord-adapter",
    "subject": "discord-user-456"
  },
  "actingRoleId": "content-team",
  "action": "prism.workflows.run",
  "resource": {
    "type": "workflow",
    "id": "weekly-blog"
  }
}
```

### Grant issuance

```http
POST /v1/execution-grants
```

```json
{
  "roleId": "content-team",
  "roleAgentId": "content-agent",
  "initiatedBy": "person-alice",
  "action": "prism.workflows.run",
  "resource": {
    "type": "workflow",
    "id": "weekly-blog"
  }
}
```

### Decision response

```json
{
  "allowed": true,
  "decisionId": "decision-789",
  "roleId": "content-team",
  "roleAgentId": "content-agent",
  "executionGrant": "signed-short-lived-token",
  "expiresAt": "2026-07-15T19:00:00Z"
}
```

Use established token and identity standards where possible. The product value
is the role-agent and cross-organization delegation model, not custom JWT
cryptography.

## Audit Model

Every guarded action should answer:

- which person, task, hook, or external principal initiated it,
- which organization and role authorized it,
- which durable role agent executed it,
- which temporary subagent performed a tool call, if any,
- which external delegation and client organization were involved,
- which action and resource were requested,
- which approvals, budget, and policy version applied,
- whether optional onchain authority was checked,
- which credential or signer class was used without exposing secret values,
- what result occurred.

Different services may retain detailed events for their own boundaries while
sharing `decisionId`, `grantId`, `runId`, and `traceId` correlation fields.

## Security And Failure Considerations

### Shared-agent compromise

Compromise of a role agent can expose the authority of the whole role. Mitigate
with short-lived grants, credential isolation, bounded signers, approval policy,
budgets, immediate suspension, and source attribution.

### Confused deputy

The role agent must not accept a user's statement that they have authority.
Membership, source identity, action scope, and approvals are verified outside
the model.

### Cross-organization escalation

External grants require explicit audience, action, resource, expiry, and
redelegation constraints. Client credentials remain client-side.

### Availability

A shared authorization service becomes critical infrastructure. Protected
services need short-lived cached decisions, locally verifiable signatures,
clear write failure behavior, and narrowly scoped emergency administration.

### Revocation

New grants must stop immediately. Existing grants must be short lived or checked
against a revocation service for high-risk actions. Gateway leases and signer
sessions must expire with or before their parent grant.

### Audit privacy

Cross-organization operation may require the provider to identify the actual
operator to the client, or provide a stable accountable pseudonym. This must be
part of the delegation agreement rather than inferred later.

## Current Product Landscape

The market contains adjacent products but no obvious mature product combining
the complete role-agent and provider-to-client model.

### Microsoft Entra Agent ID

Microsoft Entra Agent ID provides durable agent identities, blueprints, owners,
sponsors, managers, delegated permissions, and lifecycle controls. It is close
to the durable agent identity and accountability layer, but it is currently
documented as preview and is centered on Microsoft tenant boundaries.

- [Agent identities](https://learn.microsoft.com/en-us/entra/agent-id/agent-identities)
- [Owners, sponsors, and managers](https://learn.microsoft.com/en-us/entra/agent-id/agent-owners-sponsors-managers)

### Grantex

Grantex is an emerging open delegated-authorization protocol for agent identity,
scoped and expiring grants, revocation, subagent attenuation, service-side JWT
verification, and audit. It is the closest public reference for execution-grant
mechanics, but its public packages remain early releases and its primary model
is principal-to-agent delegation rather than collective role-agent ownership.

- [Grantex introduction](https://docs.grantex.dev/introduction)
- [Subagent delegation](https://docs.grantex.dev/api-reference/grants/delegate-a-grant-to-a-sub-agent)

### WorkOS RBAC and FGA

WorkOS provides multi-organization membership, custom roles, IdP group mapping,
hierarchical resources, and resource-scoped permissions. It can supply much of
the conventional B2B authorization layer, but role agents, execution grants,
provider ownership, and financial execution remain a separate domain layer.

- [WorkOS RBAC](https://workos.com/docs/rbac)
- [WorkOS FGA](https://workos.com/docs/fga/schema-management)

### Auth0 Token Vault

Auth0 Token Vault stores OAuth credentials connected to a user and enables an
agent to access an external API on that user's behalf. This is adjacent to
credential custody but remains primarily user-to-agent delegation rather than
collective role execution.

- [Auth0 Token Vault](https://auth0.com/ai/docs/intro/token-vault)

### AgentRail

AgentRail focuses on programmable agent wallets, payment rails, spend policy,
and financial observability. It validates the role-agent budget use case but is
not a general organization membership and application authorization system.

- [AgentRail documentation](https://www.agentrail.com/docs)

### Splight Delegated Identities

Splight documents cross-organization identities for consulting partners and
service providers with scoped roles in another organization. It validates the
external-provider use case but is an application-specific feature rather than a
general role-agent execution control plane.

- [Splight delegated identities](https://docs.splight.com/settings/delegatedidentities)

### Enterprise agent IAM

SecureAuth, Ping Identity, PlainID, and other enterprise IAM vendors now market
agent identity, delegated authority, action authorization, and audit. These
products reinforce the category but generally focus on enterprise policy and
workload identity rather than collective role agents and portable
provider-to-client execution.

- [SecureAuth Agentic AI Authority](https://secureauth.com/products/agent)
- [Ping Identity Agent IAM Core](https://www.pingidentity.com/en/product/agent-iam-core.html)
- [PlainID agentic AI authorization](https://www.plainid.com/solutions/ai/)

## Apparent Differentiation

Existing systems commonly use one of two models:

```text
agent acts on behalf of one user
```

or:

```text
agent is an enterprise service principal
```

The explored model is:

```text
agent is the operational delegate of an organizational role
```

Potentially distinctive properties are:

1. Multiple members instruct one stable role agent.
2. The role, rather than an individual, owns workflows, credentials, and
   budgets.
3. The provider controls internal membership while clients control delegated
   access.
4. Client credentials remain in the client environment.
5. Every action preserves both human and agent attribution.
6. The same agent can operate across compatible runtimes and client systems.
7. Financial and application authority use the same delegation model.
8. Optional onchain bindings make selected authority portable and externally
   verifiable.

## Relationship To Prism

Prism can serve as an early proving environment without making this service a
required part of the Railway template.

### Site

- authenticates users,
- submits verified source identity,
- asks for authorization,
- starts requests and workflows with a signed grant,
- retains emergency instance administration.

### Source adapter

- continues enforcing Discord and Telegram target and user policy,
- passes platform identity and source context,
- does not become the organization role store.

### Runtime

- executes the durable role-agent profile,
- propagates and attenuates execution context for subagents,
- remains compatible with Codex, Grok, and future runtime adapters.

### Gateway

- retains encrypted credential custody,
- resolves credentials assigned to the authorized role agent,
- validates execution grant audience and scope,
- does not become organization RBAC.

### Task Runner

- identifies the initiating task and owning role agent,
- receives the same bounded grants as interactive execution.

### Downstream applications

- guard selected actions,
- validate their own payloads and business rules,
- retain native authorization and audit.

## Options

### Option A: keep Prism-only RBAC

Extend Site users and roles directly. This is simplest for one instance but
does not produce reusable organization infrastructure or cross-organization
delegation.

### Option B: shared single-organization access service

Extract identities, roles, role agents, grants, and audit into one service used
across an organization's applications. This is the most practical next step.

### Option C: hosted multi-organization service

Add strict tenant isolation and external delegations. This tests the service
provider product thesis but materially increases security and operational
requirements.

### Option D: federated protocol

Allow independently hosted organization services to exchange signed agent and
delegation attestations. This offers the strongest autonomy and broadest reach,
but should follow proven single-service semantics.

## Deferred RaidGuild Steward Adoption Note

Recorded: 2026-09-01

Status: direction refined into
[Accountability Domains And Execution Audit](../features/accountability-domains-and-execution-audit.md).
Implementation remains deferred until the current built-in profiles and their
workflow/task execution boundaries are stable.

RaidGuild already has delegated operational roles in its Hats tree. Prism should
prefer those existing mandates over inventing a parallel ownership hierarchy in
which the admin agent owns every specialized profile.

The intended accountability chain is:

```text
RaidGuild / workspace
  -> delegated steward role
  -> Prism accountability domain
  -> bounded Agent Profiles, workflows, and tasks
```

The steward role is the accountable principal. Its Prism accountability domain
collects the durable definitions for which that role is answerable. Agent
Profiles are bounded executors and a workflow may use profiles from several
domains without transferring ownership. Queen Raida remains the cross-agent
control-plane, compatibility fallback, and emergency-repair profile—not the
ordinary accountable owner of specialized work.

Initial domain mapping to revisit:

| RaidGuild role | Candidate accountability domain and responsibility |
| --- | --- |
| Infrastructure Maestro | Platform Operations, System Automation, deployments, Prism Doctor, and workflow repair |
| Ganggang / quality assurance delegates | Code Review Agent, RIP quality/release checks, and high-risk approval gates |
| Brand Steward | Brand Agent, editorial workflows, public content, and social voice |
| Handbook Steward | Handbook Assistant, handbook issue intake, wiki generation, and handbook knowledge maintenance |
| Sync Steward | Sync Steward Agent, meetings, agendas, recordings, transcripts, recaps, and follow-ups |
| Participation Steward | Participation snapshots, activity accounting, and share-distribution preparation |
| Angry Dwarf | Accounting Agent, treasury reporting, and accounting synchronization |

Reference: [RaidGuild DAO Roles empowered with Hats](https://handbook.raidguild.org/docs/dao-operations/dao-roles).

Profiles without a durable delegated role, including BizDev, Veydrift, and
seasonal project agents, can remain workspace-owned with named human stewards
until RaidGuild deliberately creates or assigns an appropriate mandate.

Near-term Prism representation:

- add a flat accountability domain registry without RBAC or inherited policy
- assign each profile, workflow, and task to exactly one domain
- assign current role wearers as named domain stewards
- record the Hats role reference as domain governance metadata
- preserve built-in/custom as profile origin rather than ownership
- record explicit cross-domain step execution and Admin fallback in run audit
- keep credentials and mutations bounded by the profile authority policy
- require steward approval for consequential actions
- preserve the initiating user, steward role, executing profile, task/workflow,
  credential lease, and result in audit history

Later product work may add a first-class `governance-role` owner principal and a
Hats synchronization path. Hat membership should establish accountability and
approval eligibility; it must not automatically expose credentials or grant
unbounded runtime authority. The Hats administrative tree should not be copied
directly into an agent-parent hierarchy.

Revisit when:

1. Built-in Codegen, Code Review, and Verification profiles have stable
   workflow ownership and provenance.
2. Prism can update profile ownership and stewards without direct database
   changes.
3. Prism Doctor can detect implicit admin-agent fallbacks in workflows and
   tasks.
4. At least one delegated role is ready for an end-to-end pilot with bounded
   authority and an auditable approval path.

## Recommended Experiments

### Experiment 1: internal role agent

Use one organization and one role:

- two members,
- one durable role agent,
- one Prism workflow,
- one Gateway credential,
- one operational budget,
- complete member-to-agent audit.

Validate that members can perform useful work without direct credential access
and that removing membership or suspending the agent takes effect immediately.

### Experiment 2: role-agent signer

Give the agent a constrained testnet signer or Safe session policy. Test a small
transaction, budget enforcement, approval, key isolation, and revocation. Do
not put meaningful funds in a direct agent EOA.

### Experiment 3: optional Hats binding

Bind the same durable agent to an Execution Hat. Compare the value of portable
onchain mandate and parent revocation against RPC and administration overhead.

### Experiment 4: simulated service provider

Create provider and client organizations:

- provider owns the role agent and manages two provider members,
- client grants one action on one resource for a limited period,
- provider replaces a member without changing the client delegation,
- client revokes access without receiving or rotating provider credentials,
- both sides correlate audit records.

## Suggested Progression

1. Define role-agent semantics and audit before choosing a general policy
   engine.
2. Implement a single-organization offchain prototype.
3. Use standard signed tokens and local verification for execution grants.
4. Integrate one Prism path and one Gateway credential.
5. Add constrained signing as a separate boundary.
6. Test Hats as an optional binding rather than a foundation.
7. Prototype one provider-to-client delegation.
8. Decide whether this remains Prism infrastructure, becomes a reusable
   self-hosted service, or supports a hosted multi-organization product.

## Non-Goals For A First Prototype

- replacing an organization's identity provider,
- generalized policy-language design,
- arbitrary multi-parent role graphs,
- voting, councils, or proposal governance,
- transitive cross-organization delegation,
- direct custody of client credentials or funds,
- wallets for every user,
- onchain writes for ordinary offchain actions,
- runtime-specific coupling,
- a universal API schema for downstream applications.

## Open Questions

- Is one role agent per role always useful, or should some roles remain
  non-executing membership groups?
- Which member and manager distinctions are necessary before the model becomes
  usable?
- How should an application register its action vocabulary without centralizing
  application schemas?
- Should role-agent resource ownership live in the access service or remain in
  each application with shared role IDs?
- What revocation latency is acceptable for low-risk and high-risk actions?
- How should a client verify the actual provider member while respecting
  provider privacy?
- What is the minimum viable dual-approval contract?
- Which signer or smart-account system best supports bounded agent authority?
- Does Hats add enough interoperability to justify its operational overhead?
- Can an existing FGA and delegated-token product supply most of the foundation?
- Should a hosted product hold authorization data only, or also operate a
  signer service?
- What emergency controls remain local when the shared service is unavailable?

## Working Conclusion

The role-agent model does not require onchain infrastructure and should be
tested offchain first. Its strongest potential value is not ordinary RBAC; it
is making a durable agent the accountable execution delegate of a role.

The cross-organization extension appears particularly promising. It gives a
client a revocable way to authorize a provider team's stable agent while the
provider independently manages its members and the client retains credentials,
resources, approvals, and final control.

The market is moving quickly toward agent identity and delegated authorization,
but the collective role-agent and provider-to-client combination does not yet
have an obvious mature incumbent. The next useful work is a narrow prototype and
protocol comparison, not a full Prism RBAC implementation.
