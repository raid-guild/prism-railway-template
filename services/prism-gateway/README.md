# Prism Gateway

Prism Gateway stores organization credentials and leases them to trusted Prism
runtime and task jobs.

## Responsibilities

- encrypt secret values at rest;
- keep credential entry and rotation in Admin Settings;
- store conventional environment bindings and non-secret configuration;
- lease selected credential bundles to authenticated runtime/task parents;
- audit lease identity, context, variable names, result, and time;
- reject protected Prism, Railway, Node bootstrap, and linker variables;
- revoke future access without Railway changes;
- back up and rotate the Gateway encryption key.

Gateway deliberately does not model provider operations or proxy arbitrary API
calls. Trusted jobs use normal SDKs, CLIs, HTTP APIs, OpenAPI clients, and MCP
clients with leased environment variables.

## Core Routes

Site-only management:

- `GET /connections`
- `POST /connections`
- `PATCH /credential-bundles/:id`
- `PUT /connections/:id/credentials`
- `DELETE /connections/:id`
- `GET /credential-bundles`
- `GET /audit-events`
- `POST /ops/backup`
- `POST /ops/rotate-master-key`

Trusted runtime and Task Runner lease:

- `POST /credential-bundles/lease`

## Lease Example

```json
{
  "credentials": ["sendgrid"],
  "context": {
    "delegatedActorId": "admin-console",
    "runtimeJobId": "job-123"
  }
}
```

Response:

```json
{
  "ok": true,
  "env": {
    "SENDGRID_API_KEY": "[leased value]",
    "SENDGRID_BASE_URL": "https://api.sendgrid.com"
  },
  "leasedCredentials": ["sendgrid"]
}
```

Secret values are returned only to the authenticated lease caller and must be
injected only into the relevant child process. They are never returned by list
or audit routes.
