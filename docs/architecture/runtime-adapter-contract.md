# Prism Runtime Adapter Contract

Status: v1 implemented by Codex Runtime and local Grok Runtime

Related decision: [Prism Credential Gateway](../features/prism-credential-gateway.md)

Related feature: [Local Prism Stack And Runtime Bridge](../features/local-prism-stack-and-runtime-bridge.md)

## Purpose

Make Codex Runtime one replaceable execution adapter instead of a hard-coded
Prism dependency. Prism should submit and observe runtime jobs through one
contract while each adapter translates those jobs into its own CLI, API, or
agent harness.

The contract is intentionally close to the existing Codex Runtime job API. The
first implementation should normalize existing behavior, not build a plugin
framework for runtimes that do not yet exist.

## Service Boundary

```text
site / task-runner / source-adapter
        |
        v
Prism runtime job contract
        |
        +-- codex-runtime -> Codex CLI
        +-- future runtime -> another CLI, API, or harness
```

Each long-running runtime adapter is normally its own Railway service. There is
no additional proxy service in front of `codex-runtime`. The existing service
becomes the Codex implementation of this contract.

Site owns runtime profile configuration and chooses the runtime for a workflow,
task, or console session. The credential gateway does not own runtime job
scheduling.

Communication adapters do not select or call Codex/Grok services directly.
They submit chat and utility invocations to Site through
`POST /agent/runtime/invoke`; Site resolves the requested or default runtime
profile and uses this contract for the selected adapter.

## Version

The initial contract version is:

```text
2026-07-10
```

Shared TypeScript types live in `packages/contracts/src/index.ts`.

### Current Adapter Discovery

Codex Runtime and the local Grok Build adapter expose an additive discovery manifest:

```text
GET /v1/runtime/manifest
```

The manifest reports runtime identity, contract version, endpoint paths, and
features that are actually implemented. Codex Runtime retains
`/v1/responses/jobs` for callers that have not migrated yet. Grok Runtime uses
only the normalized routes and wraps the host CLI's headless JSON mode.

## Required Routes

```text
GET  /health
GET  /v1/runtime/manifest
GET  /v1/runtime/capabilities
POST /v1/runtime/jobs
GET  /v1/runtime/jobs/:jobId
POST /v1/runtime/jobs/:jobId/cancel
```

The first Codex implementation may keep these compatibility routes while
callers migrate:

```text
POST /v1/responses
POST /v1/responses/jobs
GET  /v1/responses/jobs/:jobId
```

## Submit Job

```json
{
  "contractVersion": "2026-07-10",
  "prompt": "Prepare the weekly analytics brief.",
  "sessionId": "request:344:step:synthesize",
  "continuationId": null,
  "recentHistory": [],
  "skills": [
    {
      "name": "weekly-analytics-brief",
      "contentUrl": "http://site.railway.internal:3100/agent/skills/weekly-analytics-brief"
    }
  ],
  "credentials": [
    {
      "key": "portal"
    }
  ],
  "context": {
    "delegatedActorId": "content-agent",
    "initiatedBy": "user:123",
    "orgId": "raidguild",
    "requestId": "344",
    "workflowRunId": "wf_run_abc",
    "workflowStepKey": "synthesize"
  },
  "modelTier": "economy",
  "metadata": {}
}
```

`contractVersion` is required and must equal the adapter's advertised version.
`prompt` and `sessionId` are required non-empty strings. Unknown optional fields
may be ignored for forward compatibility, but an adapter must reject malformed
known fields instead of guessing their meaning.

Submission returns HTTP `202` with `PrismRuntimeJobAcceptedResponse`. Poll and
cancel return the normalized job envelope. A terminal job is immutable except
for redacted diagnostic trace additions; late harness output must not change a
`canceled` job to `succeeded`.

### Provider-neutral model selection

`modelTier` is optional and accepts `economy`, `standard`, or `deep`. Site
resolves it with this precedence:

1. explicit workflow step or task override;
2. assigned Agent Profile default;
3. Site/runtime default when no tier is set.

Profiles and execution definitions carry only the tier. Each runtime adapter
owns the mapping from tiers to provider-specific model identifiers and
reasoning controls. Adapters must advertise `model-tier-routing` before Site
sends a tiered job. An adapter should reject an unmapped requested tier instead
of silently substituting another tier.

Successful results should include the effective tier, selected provider model,
and reasoning effort in `providerMetadata` for auditability.

Adapters that advertise `idempotent-job-creation` accept an `idempotency-key`
header on `POST /v1/runtime/jobs`. Repeating the same request with the same key
returns the original job instead of starting another runtime process. Callers
may retry a transport failure only when this capability is advertised or the
adapter is a bundled implementation known to support it. Polling GET requests
may be retried independently because they do not create work.

The adapter must not treat `delegatedActorId` or `initiatedBy` as authenticated
runtime identity. Service authentication establishes the adapter caller. The
delegation context explains on whose behalf the job is running.

## Job Response

```json
{
  "id": "runtime_job_01",
  "runtimeKey": "codex-default",
  "adapter": "codex",
  "status": "succeeded",
  "createdAt": "2026-07-10T16:00:00.000Z",
  "startedAt": "2026-07-10T16:00:01.000Z",
  "finishedAt": "2026-07-10T16:02:10.000Z",
  "result": {
    "responseText": "The weekly brief is ready.",
    "continuationId": "codex_thread_abc",
    "artifacts": [],
    "usage": {
      "inputTokens": 1200,
      "outputTokens": 400,
      "estimatedCost": 0.08,
      "currency": "USD"
    }
  },
  "error": null,
  "trace": []
}
```

Controlled statuses:

```text
queued
running
succeeded
failed
canceled
```

Errors must include a stable code, a safe message, and whether retry is
appropriate. Provider-specific failures may be retained in redacted metadata,
but callers should not need to parse Codex-specific strings.

Adapter process crashes, CLI exit codes, malformed provider output, and timeout
failures must become a terminal `failed` job when the adapter can persist that
state. Transport-level `5xx` responses are reserved for requests that could not
be accepted or read; callers should poll an accepted job rather than resubmit it
blindly.

## Runtime Features And Organization Credentials

`GET /v1/runtime/capabilities` describes execution features, not organizational
tool permissions.

Examples:

```text
repository
shell
site-hosted-skills
continuations
image-input
browser-automation
workspace-assignment
gateway-credentials
idempotent-job-creation
```

Workflow agent steps may declare `agentConfig.requiredRuntimeFeatures`. When a
runtime profile is not explicitly pinned, Site selects the first enabled
profile, preferring the configured default, that advertises every required
feature. An explicit profile pin fails closed when it lacks a requirement.
Capabilities describe the contract, not the implementation: for example,
`browser-automation` may be backed by Playwright, Chrome DevTools Protocol, or
another harness, and `workspace-assignment` does not imply Git worktrees.

The runtime request lists the Gateway credential keys assigned to that job.
Site resolves those assignments from Console context, source-adapter policy,
workflow, task, and optionally instance-owned skills.

The downstream service remains authoritative for the credential's RBAC and
request validation. Gateway leases selected values and non-secret configuration
into the assigned trusted child job under conventional environment names. The
long-lived Gateway caller token is never passed to that child. The child uses
normal provider SDKs, CLIs, HTTP/OpenAPI clients, or MCP clients.

In v1, Codex Runtime authenticates to Gateway with its caller-specific service
token and requests the connected services assigned in the job envelope. Site
and source policy are the assignment authority. Site-signed short-lived
assignment assertions are a future hardening step, not a v1 guarantee. Grok
Runtime advertises no Gateway support and must not claim to have used assigned
connected services.

Deterministic jobs use `gatewayCredentials` in instance configuration.

## Skills And Tools

Site is the source of truth for Prism-managed skills. Runtime adapters fetch
requested skills from authenticated Site agent routes or receive stable skill
references. Skills should not be copied into runtime-specific persistent
storage as the canonical version.

Gateway is the source of truth for organization credential bundles and reusable
non-secret configuration. Trusted runtime adapters receive assigned bundles as
job-scoped environment variables. Skills, SDKs, CLIs, and downstream APIs retain
their existing behavior and permissions.

Generic skills remain runtime- and credential-provider agnostic. Site assigns
active credentials to Admin Console and full-access source contexts through its
existing policy. Deterministic jobs may declare `gatewayCredentials`, and
instance-owned skills may declare `metadata.gateway-credentials`.

Runtime-specific system instructions and bootstrap authentication may remain
inside the runtime service. For example, Codex CLI device authentication can
remain on the Codex Runtime volume.

## Cancellation

`POST /v1/runtime/jobs/:jobId/cancel` is idempotent. It should request
cancellation from the underlying runtime and return the latest normalized job.
Late runtime completion must not overwrite a canceled Site agent run.

Canceling an unknown job returns `404`. Canceling a terminal job returns that
job unchanged. Adapters should terminate the underlying process promptly, but
the normalized canceled state is authoritative even when a harness cannot be
interrupted immediately.

## Continuations

`continuationId` is opaque to Site and belongs to the selected runtime profile.
Site must clear it when a session changes runtime profiles. An adapter that does
not advertise `continuations` ignores a null continuation and must reject a
non-null continuation rather than silently starting an unrelated session.

`recentHistory` is fallback conversational context, not a substitute for the
runtime's continuation state. Adapters must not assume both contain identical
history.

## Authentication And Secret Boundary

The contract does not standardize one deployment transport credential. Railway
services use private networking and their configured service authentication;
the local bridge binds to loopback and uses generated instance configuration.
Regardless of transport:

- runtime profile responses must never expose service tokens
- job prompts and metadata must not contain provider credentials
- Site-hosted skill URLs must use the authenticated agent surface
- traces and normalized errors must redact tokens, authorization headers, and
  leased environment values
- each adapter must advertise only features it actually implements

## Runtime Profiles

Site stores profiles shaped like:

```json
{
  "key": "codex-default",
  "adapter": "codex",
  "baseUrl": "http://codex-runtime.railway.internal:3030",
  "enabled": true,
  "features": ["repository", "shell", "site-hosted-skills", "gateway-credentials"]
}
```

The profile stores routing and feature metadata in Site SQLite. On migration,
Site bootstraps `codex-default` from `CODEX_RUNTIME_BASE_URL` only when no
profiles exist; subsequent profile configuration is database-owned. Service
tokens remain bootstrap variables and are never returned to the browser.

## Migration Rules

1. Add shared client and response normalization without changing existing Codex
   behavior.
2. Add the new routes to `codex-runtime` while retaining compatibility routes.
3. Move one caller at a time to runtime profiles.
4. Do not add a second runtime until the Codex path is stable through the common
   contract.
5. A fallback may handle an unavailable compatibility route during migration.
   It must not retry around authentication, policy, or cancellation decisions.

## First Proof

The first proof passed locally on 2026-07-13: the same Site-owned job envelope
was routed to Codex Runtime and Grok Runtime, and Site resumed the returned Grok
session ID on a second turn. Grok Runtime currently supports Site-hosted skills,
host repository/shell access, cancellation, and continuations. It does not yet
claim Gateway credential leasing or isolated workspace assignment.

## V1 Completion Boundary

The v1 operation contract is complete for job submission, polling,
cancellation, continuations, feature discovery, Site-owned runtime selection,
and normalized results across Codex and Grok. Deferred changes that require a
new contract version or additive manifest feature include streaming events,
runtime pairing, signed job assignments, isolated workspace grants, and a
generic hosted-model harness.
