---
name: prism-accountability-author
description: Use this skill when Codex is asked to create, update, archive, assign, or audit Prism accountability domains and their stewards. Do not use it to grant runtime authority or credentials.
---

Use this skill to manage the ownership layer for Prism Agent Profiles, workflows,
and tasks.

An accountability domain is a flat audit category. It answers who is expected to
maintain a definition; it does not grant permission to execute, view, approve, or
receive credentials. Do not model hierarchy, inherited policy, or cascading
configuration through a domain.

Rules:

1. Give each Agent Profile, workflow, and task exactly one domain.
2. Assign stewards to the domain as accountable contacts. Stewardship is
   informational until a separate authorization feature explicitly consumes it.
3. Keep definition ownership separate from execution. A workflow may deliberately
   use built-in or cross-domain profiles at individual steps.
4. Treat `admin-fallback` as visible technical debt. Do not relabel fallback runs
   as explicit Admin Agent assignments.
5. Archive obsolete custom domains; do not delete or archive the protected
   `prism-builtins` domain.
6. Never place secrets or credential references in domain metadata.

Use service auth with `x-service-token` and the `/agent/*` routes:

- `GET /agent/accountability-domains?includeArchived=true`
- `POST /agent/accountability-domains`
- `GET /agent/accountability-domains/:key`
- `PATCH /agent/accountability-domains/:key`
- `POST /agent/accountability-domains/:key/assignments`
- `GET /agent/accountability/audit`

Create and update operations use preview/confirm. Send the proposed payload once
without `confirm:true`, inspect the preview, then repeat it with `confirm:true`
after the operator has authorized the mutation.

Domain payload:

```json
{
  "key": "community-operations",
  "name": "Community Operations",
  "description": "Owns community operations automation and its maintenance.",
  "stewardUserIds": ["<user-id>"],
  "governanceRef": { "url": "https://example.org/roles" },
  "confirm": true
}
```

Assignment payload:

```json
{
  "targetType": "workflow",
  "targetKey": "community-intake",
  "confirm": true
}
```

Valid target types are `agent_profile`, `workflow`, and `task`.

Before finishing a change, read the audit report and disclose:

- unassigned profiles, workflows, and tasks;
- unresolved executor profiles;
- Admin fallback inventory;
- intentional cross-domain step execution;
- recent runs missing resolution or accountability snapshots.

Do not automatically reassign custom definitions based on names, channels,
skills, or current executor profiles. Present ambiguous assignments for an
operator decision.
