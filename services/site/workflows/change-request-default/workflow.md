# Change Request Workflow

This workflow covers repository-backed Prism requests that need a compatible runtime to triage, implement, verify, and prepare work for human review.

The workflow keeps human gates explicit:

- Triage turns an inbox request into a reviewed plan, linked GitHub issue when appropriate, and durable fix-note artifact.
- Approval starts implementation.
- Implementation assigns the protected Codegen Agent, which may split independent work across at most three runtime-native delegates, integrates the result, and creates or updates the request branch and pull request. The runtime owns workspace isolation and checkout mechanics.
- Verification assigns a fresh-context Verification Agent on a runtime that advertises repository, shell, and browser-automation capabilities. It records reproducible build, test, and browser evidence without changing tracked source.
- Local Code Review assigns a fresh-context Code Review Agent to inspect the diff against repository policy, run focused checks, preserve incremental findings, and maintain idempotent GitHub summary and inline comments.
- Review Decision reads the validated review artifact. An approved review advances to the human gate; requested changes, including material verification failures, return automatically to implementation for at most three correction cycles.
- An inconclusive review or exhausted correction loop stops for operator attention instead of advancing on weak evidence.
- Review pauses for final human approval before the workflow closes.

Agent steps use fresh context and durable artifact handoffs. Delegation is runtime-disabled outside implementation. The review loop routes only from validated durable evidence, not free-form model prose.

## Current Behavior

The workflow run stores the current step and is the source of truth for request progress.
