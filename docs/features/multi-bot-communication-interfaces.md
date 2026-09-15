# Multi-Bot Communication Interfaces

Status: deferred future feature

## Context

Prism currently configures one Telegram bot identity in the communication
adapter through `TELEGRAM_BOT_TOKEN`. That is sufficient for the initial Sync
Steward field test. A single bot may participate in several chats, and Site may
bind each configured destination to an Agent Profile.

The single-token model stops being sufficient when an instance needs several
visible bot identities with different names, avatars, ownership, operational
isolation, or rotation lifecycles. Adding numbered environment variables or a
`TELEGRAM_BOTS_JSON` secret would make identity and credential management
deployment-coupled and should not become the durable design.

This feature is intentionally deferred. The Sync Steward pilot should use the
existing single token rather than expanding adapter and Gateway scope before
field testing establishes the need.

## Product Model

Keep four concepts distinct:

| Concept | Responsibility |
| --- | --- |
| Agent Profile | Site-owned persona, mandate, skills, workflows, authority, memory scope, and activity identity. |
| Communication interface | A visible provider account, such as a particular Telegram bot. |
| Destination | A chat, group, channel, thread, room, or other address reached through an interface. |
| Binding | The Site-owned assignment of an interface destination to one Agent Profile. |

The intended relationship is:

```text
Gateway credential
  -> communication interface identity
       -> destination binding
            -> Agent Profile
```

An Agent Profile may have zero, one, or many communication bindings. A
communication interface may serve several Agent Profiles in different
destinations. Distinct agents do not require distinct bot accounts unless the
operator wants a distinct provider-visible identity or stronger isolation.

## Proposed Decision

Site owns non-secret interface records and destination bindings. Gateway owns
provider credentials. The communication adapter is a trusted service consumer
that resolves enabled interfaces, obtains narrowly scoped renewable credential
leases, and runs one provider client or polling loop per interface.

This extends Gateway beyond its current runtime-job lease boundary. It must be
implemented as an explicit **service lease** capability rather than by
pretending an always-on adapter is a runtime job.

The communication adapter remains responsible for transport behavior. It does
not own agent personas, workflow authorization, memory scope, or canonical
session identity.

## Non-Goals

- Do not store provider tokens in Agent Profiles, bindings, prompts, task
  inputs, artifacts, or logs.
- Do not place encrypted provider secrets directly in Site merely to avoid a
  Gateway change.
- Do not add one Railway service deployment per bot as the durable routing
  architecture.
- Do not infer an Agent Profile from the bot's display name or username.
- Do not allow callers to select an Agent Profile in an inbound message.
- Do not allow several enabled Agent Profiles to ambiguously own the same
  provider destination.
- Do not require a unique bot identity for every Agent Profile.

## Site Data Model

### Communication interface

Suggested non-secret fields:

- stable `key`;
- platform, initially `telegram` with later reuse by Discord or other
  transports;
- operator-facing name and provider-visible identity metadata;
- enabled state;
- Gateway connection or credential key reference;
- adapter routing metadata;
- health and last-observed timestamps;
- created, updated, and audited-by metadata.

The interface record may cache safe provider metadata such as bot username and
numeric bot ID after adapter verification. It must never return a token.

### Destination binding

A binding resolves:

```text
platform + interface key + external destination ID -> Agent Profile version
```

It also records access mode, enabled state, display metadata, and provenance.
Inbound requests resolve this binding server-side. Browser or provider message
content cannot override it.

Site should warn or reject when another enabled Agent Profile is already bound
to the same effective provider destination. Even when two bot identities are
members of the same Telegram group, the operator should make the overlap
explicit rather than accidentally creating two responding agents.

## Gateway Service Leases

The current Gateway contract is optimized for short-lived trusted runtime
jobs. Multi-bot adapters need a separate service-lease contract with:

- an authenticated adapter service principal;
- an allowlist of credential keys or interface records it may resolve;
- renewable, revocable leases with bounded lifetime;
- no secret values in Site responses, logs, prompts, or audit payloads;
- lease issuance, renewal, failure, rotation, and revocation audit events;
- immediate failure of subsequent renewals after disable or revocation;
- a defined adapter response to lease expiry and Gateway unavailability.

The adapter must hold decrypted values only in process memory and provider
client state. It must not persist them in its destination cache or return them
from diagnostics.

## Adapter Behavior

For every enabled interface, the adapter should:

1. resolve the non-secret Site configuration;
2. acquire the matching Gateway service lease;
3. verify provider identity without exposing the credential;
4. start an isolated polling, webhook, or event-consumer lifecycle;
5. normalize inbound provenance with `interfaceKey`, platform, destination,
   thread, and verified provider user identity;
6. resolve the Site-owned Agent Profile binding;
7. create or continue the correctly scoped canonical session;
8. select the originating interface for replies and outbound delivery;
9. expose health without exposing tokens or raw provider responses.

One interface failure must not stop polling or delivery for other interfaces.
Backoff, offsets, webhook state, and rate-limit state must be isolated by
interface key.

## Unconfigured and Conflicting Destinations

For a direct mention or recognized command in an unconfigured destination, the
adapter should return a deterministic setup response identifying the platform
destination and directing an administrator to Prism Lab. It must not create a
session or invoke Runtime.

An explicitly disabled binding should remain disabled and must not silently
fall back to a default powerful agent. Provider outages and Site resolution
failures must be reported differently from an unconfigured destination.

If more than one enabled binding resolves for the same effective destination,
the adapter must fail closed and surface an operator-visible configuration
error. It must not choose one by ordering.

## Outbound Delivery

Outbound requests need an `interfaceKey` in addition to the destination so the
adapter can select the intended provider identity. Workflow configuration may
name an allowed destination and interface, but may not carry the credential.

Replies to an inbound interaction inherit its verified interface identity.
Cross-channel workflow delivery uses an operator-authored destination
allowlist. Missing or disabled interface identity is a delivery failure rather
than a fallback to another bot.

## Observability

Prism Lab should show:

- interface name, platform identity, enabled state, and health;
- destinations observed through each interface;
- the Agent Profile bound to each destination;
- polling or webhook freshness and last successful inbound/outbound event;
- credential lease status without secret material;
- duplicate-binding and unresolved-destination warnings;
- sessions, requests, runs, and messages attributed to both Agent Profile and
  interface identity.

## Migration From The Single Telegram Token

The migration should be additive:

1. Continue accepting `TELEGRAM_BOT_TOKEN` as a legacy default interface.
2. Materialize a stable non-secret interface key such as `telegram-default`.
3. Preserve existing destination bindings and session provenance.
4. Add Gateway service leasing and multi-interface polling behind a feature
   flag.
5. Move the legacy token into Gateway through an operator-only credential
   flow; never transmit it through chat or `/agent/*`.
6. Verify inbound polling and outbound replies through the new interface.
7. Remove the Railway token only after the new path passes field tests and
   operational recovery checks.

Existing activities with no interface key remain valid legacy provenance and
must not be relabeled speculatively.

## Ordered Future Slices

### Slice 1: Interface identity and routing contracts

- Add Site-owned non-secret interface records.
- Include interface identity in destination discovery, bindings, sessions,
  activity, and outbound requests.
- Preserve the current single-token adapter as `telegram-default`.
- Enforce unambiguous destination ownership.

### Slice 2: Gateway service leases

- Add adapter service principals and renewable credential leases.
- Implement rotation, revocation, audit, and failure semantics.
- Keep current runtime-job leasing behavior unchanged.

### Slice 3: Multi-interface adapter runtime

- Run isolated Telegram clients concurrently.
- Isolate offsets, health, retry, and rate limits per interface.
- Route replies through the originating interface.

### Slice 4: Operator experience and migration

- Add interface creation, credential setup handoff, health, binding, conflict,
  and rotation UI.
- Migrate the default Telegram token without interrupting existing sessions.
- Add deployment and recovery documentation.

## Acceptance Criteria

- Two Telegram bots can operate concurrently in different destinations without
  sharing credentials, offsets, sessions, or reply identity.
- One bot can serve different Agent Profiles in different explicitly bound
  destinations.
- An inbound message resolves interface and Agent Profile entirely from trusted
  adapter and Site state.
- A destination conflict fails closed and is visible to operators.
- Disabling or revoking one interface does not interrupt another.
- Provider tokens never appear in Site data, prompts, logs, artifacts,
  diagnostics, or browser responses.
- Existing single-token deployments continue working throughout migration.

## Revisit Trigger

Revisit this feature when an instance needs a second provider-visible Telegram
bot identity, independent credential rotation, or per-bot operational
isolation. Multiple Agent Profiles alone are not sufficient reason: one bot can
continue serving several agents through destination bindings.
