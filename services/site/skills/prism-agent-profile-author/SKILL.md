---
name: prism-agent-profile-author
description: Use this skill when Codex is asked to design, create, or update a Prism Agent Profile, including its accountable domain, runtime behavior, skills, bindings, and ownership metadata.
---

Use this skill to author an Agent Profile as a bounded execution identity.

Keep these concepts separate:

- `owner` describes profile-level control and legacy ownership relationships;
- `accountabilityDomainKey` identifies the flat maintenance/audit domain;
- stewards are accountable contacts, not an authorization grant;
- bindings decide where the profile is selected;
- authority, source policy, and Gateway policy decide what it may do.

For new profiles:

1. Choose a stable kebab-case key and a distinct purpose.
2. Assign exactly one active accountability domain. Create the domain first with
   `prism-accountability-author` when it does not exist.
3. Prefer a domain-specific owner over Admin Agent ownership. Use the Admin Agent
   only for intentional control-plane profiles or a disclosed temporary fallback.
4. Request only the skills, memory scope, source bindings, and runtime features the
   profile needs.
5. Set an optional provider-neutral `modelTier` (`economy`, `standard`, or
   `deep`) when the profile has a stable cost/quality baseline. Omit it to use
   the Site default. Do not put provider model names in an Agent Profile.
6. Do not embed provider credentials. Gateway leases remain policy-controlled and
   job-scoped.
7. Preview the profile before confirmation and run the accountability audit after
   creation.

Create through `POST /agent/agent-profiles` with service auth. Include
`accountabilityDomainKey` in the payload:

```json
{
  "key": "community-operations-agent",
  "name": "Community Operations Agent",
  "description": "Operates the community intake and follow-through workflows.",
  "owner": "workspace",
  "accountabilityDomainKey": "community-operations",
  "modelTier": "standard",
  "skills": ["community-intake"],
  "stewardUserIds": ["<user-id>"],
  "confirm": true
}
```

The first request should omit `confirm:true` so the returned preview can be
reviewed. Creating the profile and assigning its domain are one service operation;
if assignment fails, report the partial result and repair the assignment through
the accountability endpoint before enabling new bindings or workflow use.

When reviewing an existing profile, distinguish built-in origin (`systemKey`) from
its accountability domain. A built-in profile may be used by a domain workflow;
that does not transfer ownership of the built-in profile to that domain.
