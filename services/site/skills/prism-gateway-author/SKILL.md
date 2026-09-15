---
name: prism-gateway-author
description: Use this skill when an admin asks to store, configure, assign, inspect, rotate, or troubleshoot an instance credential managed by Prism Gateway.
---

Use the Site agent API for non-secret Gateway configuration. Never ask the
user to paste API keys, tokens, passwords, private keys, or other credentials
into chat. Secret entry, replacement, and revocation happen in Settings.

Authenticate with `x-service-token: $PRISM_AGENT_SERVICE_TOKEN`.

## Model

A credential is an encrypted set of secret variables plus non-secret instance
configuration. Examples include an API key with `PLAUSIBLE_BASE_URL`, or an
OAuth 1.0a identity with the four environment variables expected by an X
client. Skills and scripts use their normal environment variables and provider
APIs; they do not need a Prism-specific SDK.

The credential `key` is the stable assignment name used by tasks and workflows.
Full-access Admin Console and source-adapter sessions receive active credentials
automatically. Read-only and run-approved source contexts do not. This existing
source trust decision is authoritative; do not add a second permission layer.

## Inspect

Use `GET /agent/gateway` to inspect the redacted credential catalog and recent
audit history. Secret values are never returned.

Environment import is an Advanced migration path. Imported values appear in
the redacted `credentials` migration pool returned by this route. Reuse an
imported value through the existing value-free binding route rather than asking
the admin to enter it again:

```http
PUT /agent/gateway/connections/<connection-id>/credentials/from-store
```

```json
{ "bindings": { "apiKey": "PLAUSIBLE_API_KEY" } }
```

## Create Through Chat

Create a pending credential shell with `POST /agent/gateway/connections`. Give
each secret the exact environment variable expected by the skill or SDK, and
store reusable non-secret values in `configuration`:

```json
{
  "key": "plausible-production",
  "label": "Plausible production",
  "authType": "api-key",
  "secretName": "apiKey",
  "environmentName": "PLAUSIBLE_API_KEY",
  "configuration": {
    "PLAUSIBLE_BASE_URL": "https://analytics.example.org",
    "PLAUSIBLE_SITE_ID": "example.org"
  }
}
```

For multiple secrets, send `envBindings`, where each key is an environment
variable and each value is a connection-local secret name:

```json
{
  "key": "x-production",
  "label": "X production",
  "authType": "oauth-1a",
  "envBindings": {
    "X_API_KEY": "apiKey",
    "X_API_SECRET": "apiSecret",
    "X_ACCESS_TOKEN": "accessToken",
    "X_ACCESS_TOKEN_SECRET": "accessTokenSecret"
  }
}
```

The response includes `credentialUrl`. Direct the admin to that URL to enter
all secret values. Never offer to accept them in chat.

Update only non-secret configuration or environment bindings with:

```http
PATCH /agent/gateway/connections/<connection-id>
```

```json
{
  "configuration": { "SERVICE_BASE_URL": "https://service.example.org" },
  "envBindings": { "SERVICE_API_KEY": "apiKey" }
}
```

## Use From Trusted Jobs

Admin Console and full-access Discord/Telegram contexts discover credentials
automatically. Deterministic tasks and workflow steps should declare only the
credential keys they need in instance-owned configuration:

```json
{
  "gatewayCredentials": ["plausible-production"]
}
```

Externally sourced or reusable skills should document the conventional
environment variables they expect. Do not require those repositories to add
Prism metadata. An instance-owned skill may use `metadata.gateway-credentials`
when inheriting the dependency is useful, but direct task/workflow assignment
is also valid.

Task Runner script jobs receive the same leased environment bundle as runtime
jobs. Configuration variables and decrypted secrets exist only for the job.
Gateway audits the lease, not each downstream provider request.

## Verify

After the admin stores the secret, run a representative non-destructive call
from the intended Console, source channel, task, or workflow. Report the
credential key, consuming job, and result. A stored credential alone is not
proof that the provider accepts it.

Run Prism Doctor after changing deterministic task or workflow assignments.

## Safety

- Never send secret values through `/agent/*`, chat, artifacts, or logs.
- Do not duplicate provider schemas or APIs inside Gateway.
- Do not add egress restrictions, route allowlists, or parallel grants. Source
  policy and operator-owned task/workflow configuration define trust.
