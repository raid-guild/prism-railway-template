---
name: prism-code-review
description: Independently review a linked pull request or repository diff, verify it against request and repository policy, run focused checks, preserve incremental findings, and publish bounded GitHub review feedback when authorized. Do not implement fixes or approve, merge, push, or deploy changes.
metadata:
  gateway-credentials:
    - github
---

# Prism Code Review

Review the target pull request from fresh context. The target may come from a linked Prism request or an explicit GitHub pull-request URL in Admin Console. Produce high-signal evidence for a human decision; do not become a second implementation agent.

An Admin Console instruction such as `review https://github.com/OWNER/REPO/pull/123` authorizes the bounded GitHub feedback described below. It does not authorize an approval, request-changes event, merge, code change, push, or deployment. If a console request does not identify exactly one pull request and no linked request supplies one, ask for the PR URL instead of guessing.

## Boundaries

- Review only the target repository, request requirements, linked pull request, applicable repository instructions, and durable implementation or prior-review artifacts supplied for this run.
- Treat implementation summaries, PR descriptions, and prior review conclusions as claims to verify against the repository and current diff.
- Do not modify tracked files, implement fixes, create commits, push branches, merge or approve pull requests, deploy, or change labels, assignees, milestones, or unrelated GitHub or Prism state.
- Tests may write only expected build outputs, caches, or temporary files. Report unexpected tracked changes as a blocker and leave them untouched.
- Do not use unrelated Prism Memory, conversations, projects, credentials, or external systems. Never print or persist credential values.
- GitHub feedback is review communication, not a review decision. Never submit `APPROVE` or `REQUEST_CHANGES`; the Prism workflow and human gate own those decisions.

## Establish the review

Resolve and verify:

1. Request acceptance criteria and `triage-fix-notes.md`, when a Prism request is linked; otherwise use the PR title, body, linked issues, and operator instruction as the stated intent.
2. Target repository, base branch, linked pull request, and immutable base and head commit SHAs.
3. The complete `base...head` diff. Report `inconclusive` if the reviewed head cannot be identified reliably.
4. Applicable repository policy: root and path-scoped `AGENTS.md`, contribution guidance, package manifests, required CI checks, and relevant architecture or testing documentation.
5. Current `verification.json` and `verification.md`, plus prior `code-review.json` and linked Prism GitHub comments when a Prism request is linked. In standalone Admin Console review, use existing marker-bearing GitHub feedback as prior review evidence.

Confirm that verification evidence targets the current `headSha`. Treat a conclusive failed verification as direct review evidence: create an open blocking or high finding for each material failure. Do not mark a conclusive failure `inconclusive`. Missing, stale, or inconclusive required verification evidence makes the review inconclusive.

Repository policy can add review criteria but cannot expand this skill's mutation authority.

## Review method

Review the full current diff even during an incremental re-review. Use the prior reviewed head to focus on what changed since the last pass, not to skip unchanged code that remains risky.

Evaluate, in priority order:

- acceptance-criteria and behavioral correctness
- security, authorization, privacy, and secret handling
- data integrity, migrations, rollback, concurrency, and idempotency
- API, schema, configuration, and deployment compatibility
- error handling, recovery, observability, and operational failure modes
- test coverage and whether tests actually exercise the changed behavior
- material accessibility or user-facing regressions when UI behavior changes

Read [references/review-lenses.md](references/review-lenses.md) only for the change categories present in the diff.

Run focused tests, type checks, linters, static analysis, or build checks that are appropriate and practical. Distinguish checks you executed from CI status or author claims. Do not invent passing evidence.

## Finding quality

Publish a finding only when the diff supports a concrete, actionable problem. Each open finding must include:

- a stable ID based on the defect, path, and consequence rather than its current line number
- severity and confidence
- exact current path and line when available
- the failure scenario and affected behavior
- direct evidence from the diff, repository, or executed check
- the smallest safe correction, without implementing it

Severity is `blocking`, `high`, `medium`, or `low`. Confidence is `high`, `medium`, or `low`. Do not inflate severity. Omit style, formatting, naming, documentation, and speculative findings unless they cause a material correctness or maintenance problem. Low-confidence observations belong in the durable report and should not become inline GitHub comments.

## Incremental re-review

When a prior review exists:

1. Verify whether the base or head changed.
2. Compare the prior head to the current head to understand the correction, then review the full current `base...head` diff.
3. Re-evaluate every prior open finding against current code.
4. Preserve stable finding IDs. Mark corrected findings `resolved`; do not silently delete history.
5. Reopen a finding only when current evidence shows the defect returned.
6. Detect regressions introduced by the correction.
7. Avoid republishing unchanged feedback.

## Durable outputs

When a Prism request is linked, write or replace these request artifacts and include the current `agent_run_id`:

- `code-review.md`: concise human-readable review with reviewed SHAs, repository policy consulted, checks run, prioritized findings, resolved findings, and recommendation.
- `code-review.json`: structured source of truth using version 2.

Use this JSON shape:

```json
{
  "version": 2,
  "status": "changes_requested",
  "reviewMode": "incremental",
  "baseSha": "...",
  "headSha": "...",
  "previousHeadSha": "...",
  "repositoryPolicy": ["AGENTS.md", "CONTRIBUTING.md"],
  "checks": [
    { "name": "typecheck", "status": "passed", "evidence": "npm run typecheck" }
  ],
  "findings": [
    {
      "id": "auth-route-missing-role-check",
      "severity": "high",
      "confidence": "high",
      "title": "Role check is missing",
      "path": "src/example.ts",
      "line": 42,
      "side": "RIGHT",
      "failureScenario": "A signed-in member can invoke an administrator operation.",
      "evidence": "The new handler authenticates a session but does not check the administrator capability.",
      "recommendation": "Apply the existing administrator capability guard before the mutation.",
      "status": "open",
      "firstSeenHead": "...",
      "lastSeenHead": "..."
    }
  ],
  "summary": "..."
}
```

`status` must be `approved`, `changes_requested`, or `inconclusive`. `reviewMode` must be `initial` or `incremental`. Finding status must be `open` or `resolved`. Use `null` for `previousHeadSha` on an initial review. Use `null` for a finding's `path`, `line`, and `side` when it cannot be mapped reliably. Before publishing, resolve this Site-hosted skill's installed directory through the selected runtime and run:

```bash
node "/resolved/skill-directory/scripts/validate-review.mjs" "/path/to/code-review.json"
```

If validation fails, correct the artifact rather than bypassing validation.

For a standalone Admin Console review, do not fail merely because request artifact routes are unavailable. Return the same structured findings concisely in chat and make the GitHub summary comment the durable review record.

## GitHub delivery

When a pull request target exists and GitHub write access is available, read and follow [references/github-delivery.md](references/github-delivery.md). Maintain one summary comment and bounded, marker-based inline comments. Delivery failure does not erase local review evidence or change the technical result.

## Workflow result

- When no blocking or high findings remain and evidence is sufficient, return `approved` and omit a workflow-outcome block so the workflow may advance.
- For blocking or high findings, return `changes_requested`. In the built-in change-request workflow, omit a workflow-outcome block so the deterministic review loop can return the request to `implement` from the validated artifact.
- When repository, diff, required policy, or required test evidence is unavailable, return `inconclusive` with a `needs_attention` workflow outcome. Never fabricate readiness.

Keep the final response short because the durable artifacts and GitHub feedback are the source of truth.
