# GitHub Review Delivery

Use this procedure for a linked pull request or an explicit pull-request URL supplied by an Admin Console operator when the job has GitHub write access.

The skill bundle includes `scripts/github-review.mjs` for authenticated inspection and idempotent comment delivery. Prefer it over hand-building API requests. It reads `GH_TOKEN`, `GITHUB_TOKEN`, or `TARGET_REPO_GITHUB_TOKEN` from the environment and never prints the credential. Run `node scripts/github-review.mjs help` from this skill's resolved directory for its exact commands.

## Invariants

- Verify the repository, pull request number, base SHA, and current head SHA immediately before publishing.
- Never publish against a stale or ambiguous head.
- Use ordinary conversation and inline review comments only. Never submit an `APPROVE` or `REQUEST_CHANGES` review event.
- Do not change labels, assignees, milestones, branches, checks, merge state, or repository files.
- List existing issue and review comments before creating or updating feedback.

## Summary comment

Maintain exactly one top-level pull-request conversation comment containing the concise result, reviewed head SHA, checks, prioritized findings, resolved findings, and Prism request reference when one exists.

Preserve the existing request marker when linked to a Prism request; use the console marker for a standalone Admin Console review. The helper adds the appropriate marker:

```text
<!-- prism-code-review request:<request-number> -->
<!-- prism-code-review console -->
```

If a comment by the authenticated Prism identity already contains the marker, update it. Otherwise create it.

## Inline comments

Publish inline comments for open `blocking`, `high`, or `medium` findings with `high` or `medium` confidence when the path and line map reliably to the current diff. Keep low-severity, low-confidence, or unmappable observations in the summary artifact.

Use one stable marker per finding:

```text
<!-- prism-code-review request:<request-number> finding:<stable-finding-id> -->
<!-- prism-code-review console finding:<stable-finding-id> -->
```

Before creating a comment, search existing pull-request review comments for that marker:

- If none exists, create one comment at the current diff line.
- If one exists and the finding remains open, update its body only when the evidence, severity, recommendation, or reviewed head changed materially.
- If one exists and the finding is resolved, update its body to say which head resolved it. Preserve the original discussion rather than deleting it.
- Do not create another thread merely because the line moved. Keep the stable thread and describe the current location in the updated body.

Each inline body should contain the finding title, severity, concrete failure scenario, concise evidence, smallest safe correction, reviewed head SHA, and hidden marker.

Publish at most 20 new inline comments in one run. Put additional findings in the summary comment and durable artifacts. Do not post a review when there are no actionable findings.

## Failure handling

If GitHub rejects an outdated line, re-fetch the head and diff. If the head changed, stop delivery and mark the run inconclusive or request a re-review. If the head is unchanged but the line cannot be mapped, keep the finding in the summary instead of guessing a location.

Record returned issue-comment and review-comment identifiers in the review artifact when practical. GitHub delivery errors must be reported separately from the technical review status.
