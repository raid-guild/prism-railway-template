# Work

Implement the approved request in the target repository.

Use the `prism-codegen` skill for orchestration and delegation boundaries.

Use the triage summary, suggested changes, request description, linked thread history, and target environment context. Keep the work scoped to the request.

Expected behavior:

- prepare or reuse the request branch
- read `triage-fix-notes.md` when it exists and use it as primary implementation guidance
- when returning from verification or review, read `verification.json` and `code-review.json`, then address failed checks and open findings without discarding finding history
- make the code/content/config changes
- run relevant checks when practical
- commit the result
- push the branch when remote access is configured
- create a pull request from the request branch into the target repository base branch when remote access is configured and no linked PR already exists
- attach or update a GitHub `pull_request` external ref for the PR
- leave a short linked GitHub issue comment when a linked issue exists, summarizing the branch/PR and what changed
- return a review summary with branch, commit, PR, test, and preview context when available

If review sends the request back with changes requested, continue from the existing request thread and address the review feedback in the next agent run.

## Delegation

This step may use runtime-native delegates when the implementation can be split into independent ownership areas, such as frontend, backend, docs, test verification, or deployment investigation. If the selected runtime does not support delegation, complete the work in the parent run.

Delegation rules:

- keep integration responsibility with the main agent
- do not delegate the immediate blocking task
- give each delegate a concrete, bounded task
- assign clear file or module ownership for code changes
- avoid overlapping write scopes between delegates
- use at most three delegates for this step
- keep commits, pushes, pull-request or issue updates, deployments, and other external mutations in the parent run
- request an isolated request workspace, but let the runtime choose the checkout mechanism; do not assume Git worktrees
