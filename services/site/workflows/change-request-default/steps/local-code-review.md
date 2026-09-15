# Local Code Review

Independently review the implemented repository change before waiting on external pull-request reviewers.

Use the `prism-code-review` skill. Start from fresh step context and verify the actual diff against the request requirements; do not rely on the implementation agent's conclusions. Read `triage-fix-notes.md`, the linked pull request external ref, implementation artifacts, current `verification.md` and `verification.json`, and any prior `code-review.json` artifact.

Required outcomes:

- identify immutable base and head SHAs
- load applicable repository review policy, including path-scoped `AGENTS.md`
- inspect the complete relevant diff
- run focused local checks when practical
- confirm verification evidence targets the current head; turn each material conclusive verification failure into a blocking or high finding
- on re-review, compare the prior and current heads, re-evaluate every prior finding, and preserve resolved finding history
- write or replace `code-review.md` and `code-review.json` with the current agent run id
- maintain the single idempotent Prism summary comment and bounded marker-based inline findings on the linked GitHub pull request when GitHub comment access is available
- do not modify code, commit, push, merge, approve, deploy, or mutate unrelated request/GitHub state

For a conclusive review, complete this step whether the verdict is `approved` or `changes_requested`; the following deterministic review loop reads the validated artifact and routes the request. Use `needs_attention` only when the result is `inconclusive` or the required repository, policy, diff, or verification evidence is unavailable.
