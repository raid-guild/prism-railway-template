# Codex Runtime Prompt Transport And Bounded Workflow Context

## Status

Proposed feature and reliability spec.

## Summary

Prism currently assembles runtime instructions, metadata, conversation history,
skill descriptions, and selected `SKILL.md` bodies into one prompt and passes
that prompt to `codex exec` as a command-line argument. Large workflow steps can
exceed the operating system's argument-size limit before Codex starts, producing
`spawn E2BIG`.

The same incident exposed several independent sources of avoidable context
growth:

- selected skills are embedded in full,
- the complete available-skill catalog is also summarized,
- duplicate skill names can exist across Site and Prism Memory catalogs,
- workflow step instructions can be included twice in runtime metadata,
- Admin Console runs add broad operational skills independently of the
  workflow manifest,
- hook-level skills can be unioned with every skill declared by the current
  workflow step, and
- workflow steps can reuse one Codex continuation even when durable artifacts
  are intended to be the handoff boundary.

This spec proposes a layered fix. Prompt transport moves to stdin first so OS
argument limits cannot prevent process creation. Prompt composition is then
made deterministic and observable. Finally, request workflows gain an explicit
bounded-context policy so each step can start a fresh Codex continuation and
consume durable artifacts from prior steps.

## Incident Signal

A production content-distribution workflow repeatedly failed before Codex
started. The request body was small, but the composed prompt included a large
Portal operations skill, several editorial skills, the available-skill catalog,
and a long workflow instruction twice. Splitting the workflow into narrower
artifact-producing steps allowed it to complete, but that configuration change
is a mitigation rather than a runtime-level fix.

The incident established these facts:

- `E2BIG` happens at process spawn, before the model or workflow logic runs.
- Retrying the same composed prompt cannot recover.
- Hook and UI skill defaults can defeat step-level skill scoping.
- A workflow can be logically split into steps without receiving bounded model
  contexts if the runtime continuation is reused.
- Prompt composition needs byte-level diagnostics that do not expose prompt or
  credential contents.

## Goals

- Eliminate OS argument-size failures for Codex prompts.
- Make workflow step skill selection authoritative and deterministic.
- Include each workflow instruction and skill body at most once.
- Prevent UI and hook defaults from silently expanding workflow contexts.
- Support a fresh Codex continuation per workflow agent step.
- Preserve durable request artifacts as the canonical handoff between bounded
  steps.
- Add safe prompt-size telemetry and actionable errors.
- Maintain compatibility for existing direct chat sessions and workflows that
  intentionally use one continuation.
- Add regression tests for large prompts, skill deduplication, metadata
  composition, and continuation policy.

## Non-Goals

- Do not impose a universal small token budget on every Codex interaction.
- Do not replace `SKILL.md` with a new skill format.
- Do not infer workflow state from chat summaries.
- Do not move durable workflow state out of Site-owned request records and
  artifacts.
- Do not split every large skill automatically.
- Do not make the browser responsible for selecting trusted runtime policy.
- Do not log prompt bodies, conversation text, artifact bodies, or leased
  credential values.

## Current Behavior

### Prompt Transport

`services/codex-runtime/src/codex-runtime.ts` builds one prompt string, appends
it to the `codex exec` argument array, and spawns the configured Codex binary
with stdin ignored.

This makes the process subject to both:

- the total argument and environment limit exposed as `ARG_MAX`, and
- the smaller per-argument limit commonly enforced by Linux.

The per-argument limit is the relevant failure mode because the complete prompt
is one argument.

### Prompt Composition

The composed prompt can contain:

1. fixed transport instructions,
2. trusted policy instructions,
3. serialized session and workflow metadata,
4. descriptions for every available Prism skill,
5. the full bodies of selected Prism skills,
6. recent conversation history, and
7. the latest user message.

For request workflows, the workflow step instruction can also appear inside
both `metadata.workflow.stepInstruction` and
`metadata.linkedChangeRequestInstruction`.

### Skill Resolution

Codex Runtime currently combines the Prism Memory and Site skill indexes. Skill
names are sorted but not resolved into one unique record before selection.

The Site response layer also unions request-provided skills with
`agentConfig.skills` from the active workflow step. This is useful for explicit
one-run additions, but broad hook or UI defaults can unintentionally load the
skill set for an entire workflow into its first step.

### Workflow Continuations

The Site stores a runtime continuation on the agent session. Later workflow
steps can resume that continuation. This is appropriate for conversational
sessions, but artifact-driven request workflows often intend a stronger
boundary:

```text
step A -> durable artifacts -> fresh step B context
```

Reusing one continuation instead produces:

```text
step A conversation -> step B conversation -> step C conversation
            \ durable artifacts are additional context /
```

Adding more workflow steps alone therefore does not guarantee bounded model
context.

## Proposed Design

### 1. Send The Prompt Through Stdin

Change Codex process invocation so the prompt is never a command-line argument.

For a new execution, use the equivalent of:

```text
codex exec [options] -
```

For a resumed execution, use:

```text
codex exec resume <continuation-id> [options] -
```

Spawn the child with stdin set to `pipe`, install error and exit handlers, then
end stdin with the complete UTF-8 prompt.

Conceptual TypeScript:

```ts
args.push("-")

const child = spawn(config.codexBinary, args, {
  cwd: executionWorkspaceRoot,
  env,
  stdio: ["pipe", "pipe", "pipe"],
})

child.stdin.on("error", handleStdinError)
child.stdin.end(prompt, "utf8")
```

Requirements:

- Support both start and resume commands.
- Do not append the prompt to `args` after adding `-`.
- Handle early child exit and `EPIPE` without an unhandled process error.
- Preserve cancellation, timeout, JSONL parsing, final-response capture, and
  output-file cleanup.
- Do not write the prompt to a persistent file.
- Do not include prompt content in spawn or error logs.

This change is the release-blocking reliability fix. Prompt compaction is not a
substitute for it.

### 2. Build A Prompt Manifest Before Rendering

Refactor prompt assembly into a pure intermediate representation before joining
text sections.

Suggested shape:

```ts
type PromptSection = {
  key: string
  content: string
  sensitive: boolean
}

type PromptManifest = {
  sections: PromptSection[]
  selectedSkills: Array<{ name: string; bytes: number; source: string }>
  totalBytes: number
}
```

The manifest enables deterministic rendering, byte accounting, focused unit
tests, and safe diagnostics. It must remain in memory and must not be persisted
as an artifact or log payload.

Measure bytes with `Buffer.byteLength(value, "utf8")`, not JavaScript string
length.

### 3. Include Workflow Instructions Once

Use `metadata.workflow.stepInstruction` as the canonical workflow step body.

`linkedChangeRequestInstruction` should contain only operational request
context that is not already present elsewhere, such as:

- current request and run identifiers,
- artifact API guidance,
- the expected next step,
- checkpoint behavior, and
- workflow outcome formatting.

It must not repeat the step instruction body.

Add a composition test using a unique sentinel in the step markdown and assert
that it appears exactly once in the final prompt.

### 4. Make Skill Resolution Deterministic

Normalize and deduplicate available skills by exact normalized name before
selection or download.

Precedence for duplicate names:

1. Site-hosted skill returned by `/agent/skills`,
2. Prism Memory skill,
3. ignore later duplicates.

Site-hosted content wins because the Site owns instance workflow and skill
configuration. Emit a warning metric for a cross-source name collision without
logging skill bodies.

The resolved skill index should drive all of these operations:

- available skill summaries,
- explicit skill selection,
- heuristic skill selection,
- content download, and
- credential requirement extraction.

Load each selected `SKILL.md` at most once.

### 5. Bound Available-Skill Summaries

When a deterministic workflow explicitly selects skills, do not include the
complete available-skill catalog in the prompt. Include only selected skill
names and bodies.

For unscoped direct chat where discovery is useful:

- include name and short description only,
- impose a configurable total byte cap,
- report how many descriptions were omitted, and
- never truncate a description in the middle of a UTF-8 code point.

Suggested initial configuration:

```text
CODEX_RUNTIME_SKILL_CATALOG_MAX_BYTES=16384
```

The exact default should be confirmed with production prompt telemetry before
release.

### 6. Make Workflow Step Skills Authoritative

For a linked workflow request, the server owns the effective skill set. The
browser must not silently add policy skills.

Change the Admin Console run action so it does not always submit
`change-request-ops` and `target-deploy-ops`. The request body should contain
only skills explicitly selected by the operator, if that UI capability exists.

Effective skills for a workflow agent run should be:

```text
active step agentConfig.skills
+ explicit one-run operator additions
+ target/source policy additions authorized by the server
```

They should not include browser hardcoded defaults.

Hook `autoRun.requestedSkills` remains supported for compatibility, but its
scope is the entry run only. Workflow authors should put deterministic skill
requirements on each step. Add an authoring warning when a hook supplies skills
and the target workflow already defines step skills.

Request-level skills must not persist into later auto-continued steps unless the
workflow manifest explicitly requests them there.

### 7. Add A Workflow Continuation Policy

Add an explicit manifest-level context policy for agent steps.

Proposed shape:

```json
{
  "agentConfig": {
    "contextPolicy": {
      "continuation": "step",
      "handoff": "artifacts"
    }
  }
}
```

Supported continuation values:

- `session`: preserve the current shared runtime continuation behavior.
- `step`: start a fresh runtime continuation whenever the workflow moves to a
  different agent step.

Initial compatibility behavior:

- Existing workflows without `contextPolicy` continue using `session`.
- Newly authored artifact-driven request workflows should use `step`.
- Direct Console, Discord, Telegram, and Buzz conversations remain `session`
  unless explicitly linked to a workflow with `step` policy.

With `continuation: step`:

- keep the Site agent session for UI message history,
- do not pass the prior step's runtime continuation ID,
- store the new continuation ID with the agent run or keyed by workflow step,
- do not replace durable artifacts with an LLM-generated handoff summary,
- let step instructions identify the artifacts the step must read, and
- preserve normal workflow events and auto-continue behavior.

The handoff value is initially fixed to `artifacts`. Future values should not be
added until there is a durable, inspectable transport with equivalent audit
properties.

### 8. Add Safe Size Telemetry And Preflight Errors

Record a `prompt.composed` trace entry with non-sensitive metrics:

```json
{
  "totalBytes": 112340,
  "sectionBytes": {
    "fixed": 900,
    "metadata": 12400,
    "skillCatalog": 0,
    "selectedSkills": 84200,
    "history": 11800,
    "latestMessage": 3040
  },
  "selectedSkillCount": 6,
  "historyMessageCount": 8,
  "transport": "stdin"
}
```

Do not include section bodies, credential names, environment values, artifact
bodies, or conversation excerpts.

Add optional thresholds:

```text
CODEX_RUNTIME_PROMPT_WARN_BYTES
CODEX_RUNTIME_PROMPT_MAX_BYTES
```

Behavior:

- Above the warning threshold, emit a warning metric and continue.
- Above a configured hard maximum, fail before spawn with
  `RUNTIME_PROMPT_TOO_LARGE` and a safe size breakdown.
- Do not set a hard maximum by default until the active Codex model/runtime
  contract exposes a reliable input limit.
- Never use the former OS argument limit as the model-context limit.

## Error Contract

Preserve existing normalized runtime job failure behavior while adding specific
codes where the runtime can act before spawn.

New errors:

- `RUNTIME_PROMPT_TOO_LARGE`: configured runtime prompt maximum exceeded.
- `RUNTIME_PROMPT_STDIN_FAILED`: prompt could not be delivered to the child and
  the child did not already exit with a more specific error.
- `RUNTIME_SKILL_NAME_COLLISION`: optional warning/diagnostic code, not a job
  failure when deterministic precedence resolves the collision.

Raw `spawn E2BIG` should no longer be possible because prompt content is absent
from the argument list. An `E2BIG` caused by an independently oversized leased
environment should remain a spawn error and include aggregate environment byte
diagnostics without names or values.

## Security And Privacy

- Never log prompt bodies or stdin contents.
- Never include leased credential values in prompt-size calculations or traces.
- Environment diagnostics may report total bytes and variable count only.
- Do not persist prompt manifests in the Site database or request artifacts.
- Preserve existing Gateway lease boundaries and protected environment-name
  checks.
- Treat workflow artifacts and external record content as untrusted data even
  when they are the canonical handoff.
- Keep trusted workflow instructions separate from artifact bodies in the
  rendered prompt.

## Testing Strategy

### Codex Runtime Unit Tests

- Prompt rendering preserves section order.
- UTF-8 byte counts are correct for multibyte text.
- A workflow instruction sentinel appears exactly once.
- Explicit workflow skills suppress the global skill catalog.
- Catalog summaries respect the configured byte cap.
- Duplicate skill names resolve to the Site record.
- Each selected skill downloads and renders once.
- Prompt diagnostics contain sizes but not content.

### Process Integration Tests

Use a fake Codex executable that records argv and stdin without calling a model.

- A prompt larger than 128 KiB successfully reaches stdin.
- The large prompt does not appear in argv.
- Start mode uses `codex exec ... -`.
- Resume mode uses `codex exec resume <id> ... -`.
- JSONL response parsing and output-file handling remain unchanged.
- Cancellation closes or destroys stdin and terminates the child.
- Early child exit does not produce an unhandled `EPIPE`.
- A configured hard prompt maximum returns `RUNTIME_PROMPT_TOO_LARGE` before
  spawn.

### Site Tests

- A linked workflow run uses step skills without Admin defaults.
- Explicit operator additions apply to one run only.
- Hook entry skills do not persist into later workflow steps.
- `linkedChangeRequestInstruction` does not contain the step body.
- A `step` continuation policy omits the previous continuation ID after a step
  transition.
- Auto-continue creates a new continuation for each agent step while preserving
  one Site session and workflow run.
- A `session` policy preserves current continuation behavior.
- Artifact and workflow event behavior is identical under both policies.

### Browser Test

- Running a custom workflow from request details does not send hardcoded
  operational skills.
- Running the default request workflow still receives every skill declared by
  its manifest.

### Production Canary

Use one non-publishing, artifact-producing workflow with:

- at least three agent steps,
- explicit step skills,
- `continuation: step`,
- a prompt larger than the former per-argument limit, and
- no external side effect beyond reversible draft synchronization.

Confirm runtime traces, artifacts, workflow events, and terminal projection
before broad rollout.

## Implementation Slices

### Slice 1: Stdin Transport

- Change start and resume process invocation to use stdin.
- Add large-prompt process integration tests.
- Preserve all existing runtime job behavior.
- Add `transport: stdin` to safe trace metadata.

This slice should ship independently and first.

### Slice 2: Prompt Manifest And Telemetry

- Extract prompt-section construction.
- Add UTF-8 byte accounting.
- Add warning and optional maximum configuration.
- Add safe prompt composition traces.

### Slice 3: Prompt Deduplication

- Remove duplicated workflow step instructions.
- Deduplicate skill indexes with Site precedence.
- Bound or omit available-skill summaries.
- Add collision diagnostics and regression tests.

### Slice 4: Server-Owned Workflow Skills

- Remove Admin Console hardcoded skills.
- Scope hook-requested skills to the entry run.
- Keep step `agentConfig.skills` authoritative.
- Add workflow authoring validation warnings.

### Slice 5: Bounded Step Continuations

- Add and validate `agentConfig.contextPolicy`.
- Store continuation IDs at the correct run/step scope.
- Start fresh continuations on agent-step transitions.
- Add artifact-handoff and auto-continue integration tests.
- Migrate selected artifact-driven workflows after canary validation.

## Rollout And Compatibility

1. Deploy stdin transport without changing prompt content.
2. Observe prompt-size metrics and confirm the absence of spawn-level `E2BIG`.
3. Deploy prompt deduplication and compare runtime success, latency, and model
   output quality.
4. Remove browser defaults and add hook scoping with compatibility tests.
5. Introduce `contextPolicy` as opt-in.
6. Canary artifact-driven workflows with `continuation: step`.
7. Consider making `step` the default only for newly created request workflows.

No database migration is required for stdin transport or prompt composition.
Continuation IDs may require agent-run metadata or a new normalized field if
step-scoped storage cannot be represented safely in existing result/session
records.

## Observability And Success Metrics

Track:

- runtime jobs failing before `run.started`,
- `E2BIG` spawn failures,
- prompt bytes by section,
- selected skill count and aggregate selected-skill bytes,
- available-skill collision count,
- continuation reuse versus fresh-step creation,
- workflow step latency,
- auto-continue success rate, and
- `RUNTIME_PROMPT_TOO_LARGE` occurrences.

Success criteria after rollout:

- zero prompt-caused `spawn E2BIG` failures,
- no prompt bodies or secrets in logs,
- no duplicate workflow instruction bodies,
- no duplicate selected skill bodies,
- custom workflow runs receive only server-authorized effective skills,
- artifact-driven canary workflows use distinct continuation IDs per step, and
- no regression in cancellation, timeout, workflow events, or terminal state.

## Acceptance Criteria

- A greater-than-128-KiB prompt starts successfully in both new and resume
  modes using stdin.
- The prompt is absent from the process argument list.
- The Site-hosted skill wins a duplicate-name collision with Prism Memory.
- Explicit workflow skills prevent the full available-skill catalog from being
  rendered.
- Workflow step markdown occurs exactly once in the rendered prompt.
- Admin-triggered custom workflow runs do not add broad default skills.
- Hook-requested entry skills do not leak into later steps.
- A workflow configured with `continuation: step` uses a new Codex continuation
  after every agent-step transition.
- Later steps can reconstruct required state from durable request artifacts.
- Safe prompt metrics identify the largest section without revealing content.
- Existing workflows without a context policy preserve their current session
  continuation behavior.

## Open Decisions

- Should `contextPolicy` live in shared workflow `agentConfig`, individual step
  `agentConfig`, or support both with step override?
- Should Site skill precedence be absolute, or should cross-source duplicate
  names fail workflow validation in strict mode?
- What warning threshold should ship after production telemetry is available?
- Should selected skill names appear in internal traces, or only counts and byte
  totals?
- Should direct chat retain a bounded skill catalog, rely entirely on heuristic
  selection, or receive catalog pages on demand?
- Does step-scoped continuation storage require a normalized database field, or
  is structured agent-run result metadata sufficient?

## Follow-Up Content Work

Large multi-domain skills should still be reviewed even after stdin transport
ships. For example, an operational skill that combines read, audit, write,
publish, and administrative behavior may be clearer and safer as several
capability-focused skills.

That work should be driven by responsibility and authorization boundaries, not
by the former OS argument limit. Runtime correctness must not depend on keeping
skill files artificially small.
