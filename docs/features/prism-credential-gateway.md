# Prism Credential Gateway

Gateway is intentionally credential-only; it has no provider operation catalog
or parallel grant system.

## Decision

Prism Gateway is a credential vault and lease auditor for trusted agent runs.

It exists so operators can add and rotate organization credentials without
Railway access while preserving the flexibility agents had when credentials
were stored as Railway environment variables.

The product flow is:

1. An operator adds a credential in Gateway Settings.
2. The operator asks an agent to perform work.
3. Site applies its existing trust policy.
4. Gateway leases the credential into that job under configured environment and
   configuration variable names.
5. The agent uses the provider's normal SDK, CLI, HTTP API, OpenAPI client, or
   MCP client.
6. Gateway records the lease without recording secret values.

There is no separate access-profile creation, enablement, operation catalog, or
runtime assignment lifecycle.

## What We Optimize For

In order:

1. Preserve trusted-agent flexibility.
2. Let operators manage credentials without Railway access.
3. Keep credentials out of prompts, chat, task inputs, artifacts, and logs.
4. Limit credential exposure to the child job that needs it.
5. Audit who leased each credential, for which run, and when.
6. Support immediate revocation and safe rotation.

Per-provider operation allowlists and proxying every downstream request are not
v1 goals. Those controls make the agent less flexible and duplicate trust
decisions already made by Site and source-adapter policy.

## Trust

Site is the authorization authority.

- Admin Console runs are trusted.
- Discord and Telegram targets configured as `full` are trusted.
- `readonly`, `run-approved`, and `off` source contexts do not receive
  credentials.
- Operator-authored workflows are trusted and inherit active credentials.
- Deterministic tasks declare required credential keys with
  `agentConfig.gatewayCredentials`.

Gateway does not create a parallel permission model.

A trusted run can still process hostile external content. That is an inherent
consequence of the operator's trust decision. Preview, review gates, and
provider-specific safeguards may control side effects independently; they are
not credential-vault concepts.

## Data Model

A credential bundle contains:

- stable `key`;
- operator-facing label and provider;
- encrypted secret values;
- environment bindings mapping environment names to secret names;
- non-secret configuration variables;
- lifecycle status and timestamps.

A lease audit event contains:

- credential key;
- authenticated runtime or service caller;
- delegated actor and run/workflow/task context;
- leased environment-variable names, never values;
- timestamp and result.

## Runtime Contract

Runtime job requests carry a `credentials` array:

```json
{
  "credentials": [{ "key": "sendgrid" }],
  "context": {
    "delegatedActorId": "admin-console",
    "runtimeJobId": "job-123"
  }
}
```

Codex Runtime requests those bundles from:

```http
POST /credential-bundles/lease
```

The long-lived Gateway caller token remains in the runtime parent process.
Decrypted values are added only to the spawned child job environment. Protected
Prism, Railway, Node bootstrap, and linker variables are rejected.

Gateway can audit lease issuance. Once a raw provider credential is leased to a
trusted process, Gateway cannot observe every downstream provider request.
That tradeoff is intentional.

## Operator Experience

Adding a credential requires:

- name;
- secret type and value;
- the conventional environment variable expected by the integration;
- optional non-secret base URLs, account IDs, sender profiles, and similar
  configuration.

After secret entry, the credential is immediately active for trusted runs.
There is no additional enable action.

For transactional email:

- “Send an email to …” may preview or create a review gate according to the
  agent/workflow policy.
- “Send it now without a preview” is explicit operator authorization to send.
- The email skill uses `SENDGRID_API_KEY` or another configured provider
  credential; Gateway does not encode email-provider operations.

## Non-goals

Gateway does not:

- reproduce provider OpenAPI or MCP schemas;
- define provider route allowlists;
- require skills to use a Prism-specific API;
- decide whether an email or other side effect needs approval;
- grant untrusted source contexts access to credentials;
- claim to audit downstream calls after a credential is leased.

## Acceptance Criteria

- Adding a credential and starting a trusted run makes its configured variables
  available without another setup step.
- Limited source contexts receive no credentials.
- Workflow and task leases contain run context in the audit record.
- Secret values never appear in list APIs or audit records.
- Rotation affects subsequent leases.
- Revocation prevents subsequent leases.
- Skills without Prism metadata can use conventional provider environment
  variables.
