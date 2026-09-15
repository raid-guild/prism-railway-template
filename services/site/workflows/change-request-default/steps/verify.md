# Verify

Independently verify the current implementation before code review.

Use the `prism-code-verification` skill from fresh step context. Read the request acceptance criteria, `triage-fix-notes.md`, implementation artifacts, applicable repository policy, and any prior `verification.json`. Verify the current immutable base and head SHAs rather than trusting the implementation summary.

Required behavior:

- read request context with `GET /agent/change-board/requests/by-number/<request-number>/review` and artifact bodies with the corresponding `/artifacts` route; use the Site base URL and `x-service-token`, not Gateway or browser-admin routes
- verify the actual repository head and linked PR metadata; public repository/provider reads do not require a GitHub credential, and absence of a token alone is not a blocker
- use assigned authenticated read capabilities only when the target requires them; never obtain broader credentials or send the Site service token to GitHub or Gateway

- inspect the complete relevant diff and select checks proportionate to the changed paths
- run the repository's relevant lint, type, test, build, and runtime checks
- for user-facing changes, execute representative browser journeys and inspect console and network failures
- leave tracked source and external systems unchanged
- clean up local servers and browser processes
- write or replace `verification.md` and validated `verification.json` with the current agent run id

A conclusive `passed` or `failed` verification completes this step. Failed evidence advances to the independent reviewer, which records actionable findings for the deterministic repair loop. Use `needs_attention` only when verification is `inconclusive`, including when the target, repository, environment, or a required runtime capability is unavailable.
