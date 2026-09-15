# Conditional Review Lenses

Read only the sections relevant to the changed paths and behavior. These lenses add focus; they do not require findings when the evidence is clean.

## Authorization and security

- Trace authentication separately from authorization and confirm the exact capability at every new mutation boundary.
- Check tenant, workspace, request, repository, and resource ownership boundaries.
- Look for credential exposure in prompts, logs, artifacts, browser payloads, subprocess arguments, and error messages.
- Inspect untrusted input crossing into shells, paths, URLs, templates, SQL, or external APIs.
- Confirm sensitive actions fail closed when identity, policy, or provider state is missing.

## Data and migrations

- Verify forward migration on populated databases, not only fresh schema creation.
- Check uniqueness, nullability, foreign keys, backfill behavior, and compatibility with older rows.
- Confirm retries and partial failures do not duplicate or corrupt durable state.
- Identify destructive or irreversible behavior and whether recovery or reconciliation exists.
- Check that immutable provenance and historical snapshots remain immutable.

## Concurrency and asynchronous work

- Look for duplicate starts, overlapping polls, stale responses, lease expiry, and lost-update races.
- Verify idempotency keys cover the actual side effect and survive retries.
- Confirm cancellation or supersession prevents late results from mutating current state.
- Check cursor advancement happens only after successful downstream delivery.

## API and compatibility

- Compare request and response contracts, aliases, status codes, and authorization across callers.
- Check older clients, stored payloads, environment fallbacks, and disabled or missing integrations.
- Verify error bodies remain bounded and do not leak secrets or internal provider data.
- Confirm UI affordances correspond to real backend authority and state.

## Tests and verification

- Prefer tests that exercise observable behavior and failure paths over assertions on wording or implementation details.
- Check that the test would fail before the change and that mocks preserve the production contract.
- Look for absent regression coverage around authorization, migration, retry, cancellation, and stale-state behavior.
- Treat a green check as evidence only for the code and configuration it actually ran.

## Frontend and accessibility

- Check loading, empty, error, stale, disabled, and narrow-screen states.
- Verify keyboard access, focus behavior, semantic labels, and announcements for asynchronous state.
- Look for optimistic UI that contradicts durable backend state.
- Check that identity, provenance, destructive controls, and confirmation state remain visible and unambiguous.
