# Review

The human reviewer checks the branch, latest agent-run output, and any preview or compare links.

Use the latest `verification.md`, `verification.json`, `code-review.md`, and `code-review.json`. If a linked pull request exists, final approval should consider verification evidence, local findings, PR review state, requested changes, checks, and the reviewed head SHA. Final merge should still happen through GitHub or the target repository's normal review process unless the operator explicitly directs otherwise.

Review outcome:

- continue the workflow when the work is acceptable and ready to close

When changes are requested, add specific feedback and use the explicit change-step/send-back control to return to implementation. When the request should not proceed, use the explicit cancel/close control.

Do not continue to `closed` while `code-review.json` contains unresolved blocking/high findings, while the latest review is inconclusive, or when the PR head differs from the reviewed head, unless the operator explicitly overrides with a recorded reason.
