---
name: prism-workflow-author
description: Use this skill when Codex is asked to create, update, or reason about Prism request workflows, workflow steps, gates, manifests, or workflow instruction files.
---

Use this skill to author Prism workflows in the style expected by the site service.

Every workflow should have exactly one accountable domain. Include
`accountabilityDomainKey` alongside `key`, `manifest`, and `files` when posting a
new custom workflow. The domain owns maintenance and audit follow-through; it
does not constrain which profiles individual steps may execute.

When this skill is loaded in a deployed Prism instance, do not fall back to browser admin routes or local filesystem probing before using the site service workflow API. Missing local files under `/data/codex/skills`, `/data/workflows`, or `/app` do not mean the workflow is inaccessible. Runtime agents usually cannot write the site service volume directly.

Prism workflows are markdown-first and DB-indexed:

- Workflow and step instructions are human/agent-authored markdown.
- The workflow manifest is thin structure for UI display and deterministic routing.
- Workflow state, approvals, agent runs, and event history belong in the DB, not markdown.

## Storage

Built-in workflows live in the template repo:

```text
services/site/workflows/<workflow-key>/
  workflow.md
  steps/
    <step-key>.md
```

Built-ins are allowed to evolve when the behavior is generally useful across
Prism instances. Prefer updating a built-in workflow when all of these are true:

- the behavior belongs to the platform contract rather than one workspace's
  private policy
- the workflow can remain configurable through payload metadata, hook template
  constraints, environment variables, or editable markdown instructions
- the change reduces duplicate custom workflows or legacy adapter logic
- existing instances can be migrated with a numbered site migration

Keep instance-specific decisions in the hook payload, instance custom workflow
markdown, custom skills, or workspace configuration. Do not hard-code one
community's IDs, channels, recurrence rules, API keys, or publication policy
into a template built-in.

When a custom workflow overlaps a new built-in, decide whether the overlap is
generic or instance-specific. Generic behavior can move into the built-in.
Instance-specific behavior should remain in an instance custom workflow or custom
skill, with the built-in producing a durable handoff artifact when useful.
Example: `recording-transcript-review-publish` can produce transcript, summary,
Memory, and downstream handoff artifacts, while an instance-specific
post-recording workflow can continue to own external publishing, recurrence, and
agenda creation.

Instance custom workflows should use the site-owned volume when that API/storage path exists:

```text
/data/workflows/<workflow-key>/
  manifest.proposal.json
  workflow.md
  steps/
    <step-key>.md
```

Do not store runtime approval state, current step, retry state, or run history in workflow files.

In deployed Prism instances, runtime adapters usually receive `APP_API_BASE_URL` and `APP_API_SERVICE_TOKEN`, then expose them to agents as `PRISM_AGENT_API_BASE_URL` and `PRISM_AGENT_SERVICE_TOKEN`. If the `PRISM_*` names are missing, check the `APP_*` names before concluding the API is unavailable.

Runtime agents should not assume they can write the site service volume directly. To install a chat-authored workflow, call the site workflow endpoint with the manifest and files:

```json
{
  "key": "example-workflow",
  "manifest": {
    "key": "example-workflow",
    "name": "Example Workflow",
    "entrypoint": "triage",
    "workflowPath": "workflow.md",
    "steps": [
      {
        "key": "triage",
        "label": "Triage",
        "type": "agent",
        "instructionPath": "steps/triage.md"
      }
    ]
  },
  "files": {
    "workflow.md": "# Example Workflow\n...",
    "steps/triage.md": "# Triage\n..."
  }
}
```

Use `POST /agent/workflows` with `x-service-token` service auth. The site service writes the files under `/data/workflows/<workflow-key>/`, normalizes manifest paths, and registers the workflow.
If the route returns `Workflow manifest not found at /data/workflows/...`, the request did not include a usable manifest body. Retry with `manifest` as a JSON object plus the markdown `files`; do not try to write the site volume from a runtime adapter.

To run a request workflow step from another service, use the site response route with internal service auth:

```json
{
  "input": [
    {
      "role": "user",
      "content": "Run the current workflow step using the request context and step instructions."
    }
  ],
  "linked_change_request_id": "<request-id>"
}
```

Send that body to `POST /agent/responses` with `x-service-token` service auth. For gate steps, do not set `workflow_action`; the gate records a continue event and moves to its `next` step. For checkpoint steps, do not set `workflow_action`; run the checkpoint step itself.

Workflow steps should save durable files through the request artifact API instead of leaving important outputs only in chat text. Use artifacts for drafts, image prompts, generated images, publish packets, JSON plans, or any step output that future steps or humans should inspect.

## Scheduled Workflow Ownership

Every scheduled agent task should be a thin `workflow-runner` launcher. Each
scheduled occurrence creates and starts a native request; the workflow owns the
work itself. Keep analysis, durable artifacts, retries, operator recovery,
external delivery, delivery verification, provenance, and terminal closure in
workflow steps rather than in task-runner output delivery. Keep ad hoc prompts
in an Agent Console or an explicitly invoked disabled utility task.

If external delivery is part of the promised outcome:

- save the exact deliverable as a request artifact before sending it
- send from the workflow step through the authorized adapter or provider skill
- require a provider-accepted identifier before reporting success
- attach the external message or publication as a request external ref when the
  API supports that provider
- leave a retryable, accurately described workflow failure when delivery fails;
  never close merely because content generation succeeded

A valid no-op or empty-result report may close when the workflow contract says
it is a successful outcome. Keep newly authored scheduled tasks disabled until
the request lifecycle, artifacts, delivery, and closure have been validated.

If a triage or intake step sees a request without `estimatedHumanHours` and the scope is clear, patch the request once with a coarse whole-request human effort estimate. Include expected human gates, review/approval time, coordination, and likely loopbacks such as review changes that return the workflow to an earlier step. Use one bucket from `0.25`, `0.5`, `1`, `2`, `4`, `8`, `16`, `24`, or `40`. Do not add rationale/source fields or per-step estimates.

```json
{
  "kind": "markdown",
  "name": "draft.md",
  "mimeType": "text/markdown",
  "content": "# Draft\n...",
  "encoding": "utf8",
  "metadata": {
    "workflowStep": "draft"
  }
}
```

Send that body to `POST /agent/change-board/requests/<request-id>/artifacts` with internal service auth. Use `encoding: "base64"` for image or other binary content. When the workflow prompt provides a current agent run id, include it as `agent_run_id` so the artifact links back to the run that produced it. Artifacts are owned by the site service, stored under `/data/workflow-artifacts`, listed on the request Artifacts tab, and recorded as `artifact.created` workflow events.

If a workflow expects a user-supplied Discord attachment, instruct the agent to use the attachment handoff route instead of pasting or trusting a Discord CDN URL:

```json
{
  "platform": "discord",
  "requestId": "<request-id>",
  "channelId": "<discord-channel-id>",
  "messageId": "<discord-message-id>",
  "attachmentId": "<discord-attachment-id>",
  "lane": "workflow-input",
  "purpose": "workflow-input",
  "agent_run_id": "<current-agent-run-id>"
}
```

Send that body to `POST /agent/source-attachments/ingest`. The site calls the communication adapter, stores the bytes as a private request artifact, and preserves source provenance. Text or Markdown attachments should only be promoted to Prism Memory when the operator explicitly asks for a shareable memory artifact.

For "summarize this attachment" style workflows where the attachment is current-session context rather than a durable request input, use `lane: "memory-inbox"` for text-like files. This writes a `session_attachment` memory inbox artifact and returns a shareable Memory artifact URL. Do not route these directly to Knowledge; for long-term canonical docs, ask for confirmation and recommend a linked source-backed Knowledge path when appropriate.

If the workflow only has a Discord message URL, use `POST /agent/source-attachments/resolve-and-ingest` with an intent such as `summarize`, `promote-memory`, `request-artifact`, or `workflow-input`. If the message has multiple attachments, the route returns candidates and the agent should ask the operator which attachment to use.

When a later workflow step needs prior artifact bodies, read them through the site API instead of guessing volume paths:

```http
GET /agent/change-board/requests/by-number/<request-number>/artifacts
GET /agent/change-board/requests/by-number/<request-number>/artifacts?name=draft.md
GET /agent/change-board/requests/<request-id>/artifacts/<artifact-id>/content?format=json
```

The by-number route returns artifact metadata plus text/json/markdown bodies. Binary content is omitted by default unless `includeBinary=true` is passed.

Use external refs for live records outside Prism. Do not store GitHub issues, GitHub pull requests, Discord messages, deployment URLs, CMS posts, or DAO proposal links only in comments or artifacts when they need later lookup or sync.

```json
{
  "provider": "github",
  "kind": "pull_request",
  "externalId": "42",
  "title": "Add request external refs",
  "url": "https://github.com/example/repo/pull/42",
  "state": "open",
  "metadata": {
    "repo": "example/repo",
    "branch": "prism/request-12",
    "base": "main"
  }
}
```

Send that body to `POST /agent/change-board/requests/<request-id>/external-refs` with internal service auth. Common refs include `github` `issue`, `github` `pull_request`, `discord` `message`, `railway` `deployment`, and publishing targets such as `ghost` `post`. Workflow steps can then say: if no GitHub issue ref exists, create one and attach it; if a linked PR is merged, move to post-merge cleanup.

## Manifest Rules

The manifest is stored in `workflows.definition_json`. Keep it small.

Use it for:

- `entrypoint`
- `workflowPath`
- optional target requirement, for example `{ "target": { "kind": "repository", "required": true } }`
- ordered `steps`
- step `key`
- step `label`
- step `type`
- `instructionPath`
- simple `next` flow
- loop control fields for `type: "loop"` steps
- shared `agentConfig`
- deterministic delegation policy in `agentConfig.delegation`
- context isolation policy in `agentConfig.contextPolicy`
- an explicit `executorAgent` on a step when it differs from the workflow default

Use `defaultAgent` only when it is a deliberate workflow-wide executor choice.
Omitting both the step executor and workflow default invokes the visible Admin
fallback and should be treated as authoring debt, not an implicit design. Review
the executor-resolution matrix in `GET /agent/accountability/audit` before
enabling a workflow. Cross-domain execution is allowed when intentional and
should remain visible in that audit.

When a step uses a skill, put the skill name in `agentConfig.skills`. Generic
skills remain Gateway-agnostic. Trusted workflow runs inherit active
credentials. A deterministic task or instance-owned skill may declare specific
keys with `agentConfig.gatewayCredentials` or `metadata.gateway-credentials`.
Use the provider's normal SDK, CLI, HTTP API, OpenAPI client, or MCP client
through the leased environment and configuration variables.
Before enabling a workflow, verify its referenced skills and Gateway
requirements exist and run Prism Doctor.

Scope skills to the smallest step that needs them. Put a skill in the shared
workflow `agentConfig.skills` only when every agent step needs it. Do not use
hook- or request-level requested skills as a substitute for step-local skill
configuration in a deterministic workflow.

Treat each agent step as a context boundary. For workflows whose steps hand off
through request artifacts, set the shared policy explicitly:

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

With `continuation: "step"`, each agent step starts a fresh runtime session and
loads only its effective step skills. The default remains `session` for
backward compatibility. A step may override the shared policy when preserving
one Codex session is genuinely required.

For artifact handoffs:

- hand off durable artifacts instead of expecting later steps to inherit the
  prior agent's prompt or working context
- name the exact input artifacts in the receiving step's markdown
- keep large research, operations, publishing, and audit skills off steps that
  only write, review, or format an existing artifact
- inspect the effective skill union from workflow, step, hook, and request
  configuration before enabling the workflow

Do not add gates solely to reset runtime context. Use `continuation: "step"`
with explicit artifact handoffs. Keep gates for actual human decisions and
checkpoints for operator-triggered external-state checks.

Omit runtime routing fields to use the instance's current default runtime
profile. Set `agentConfig.runtimeProfileKey` only when the workflow must be
deliberately pinned to a configured Site runtime profile. Do not add the legacy
`agentConfig.runtime` field to new workflows, and do not infer the active
runtime from that field when inspecting an older workflow.

Use provider-neutral `agentConfig.modelTier` values when a workflow or step has
an intentional cost/quality requirement: `economy`, `standard`, or `deep`.
Step-local configuration overrides the Agent Profile default; omit it to inherit
the profile and Site defaults. Do not hardcode provider model names in workflow
manifests. Reserve `deep` for work whose verification or reasoning needs justify
the added cost, and validate representative outputs before moving work to
`economy`.

Do not put long prompts, implementation logic, scripts, or large prose in the manifest. Put those in markdown.

Do not require a target repository unless the workflow actually needs repo/deploy helpers. Requests can produce artifacts, Discord messages, summaries, or other outputs without a `targetAppId`.

Do not add workflow-specific hacks for board status, terminal status, auto-advance state, or legacy status mapping. The site workflow engine owns:

- current step state through `workflow_runs.current_step_key`
- request status projection for lists and badges
- terminal run state
- gate continue mechanics
- auto-continue behavior
- agent-run and workflow event history

Workflow markdown should define domain truth and evidence:

- what approval means for this workflow
- which comments are sufficient or insufficient for a human gate
- which artifacts prove the step is complete
- which external refs prove a live system action happened
- how to reconcile existing work before starting duplicate jobs
- what the next step should verify before writing or publishing

Put whether delegation is allowed in the manifest:

```json
{
  "agentConfig": {
    "delegation": {
      "allowed": true,
      "maxAgents": 3
    }
  }
}
```

Put when and how to delegate in the step markdown. Only enable delegation for steps that can safely split work into independent ownership areas. For request workflows, implementation steps may allow delegation; triage and human review gates usually should not.

Recommended manifest shape:

```json
{
  "key": "example-workflow",
  "name": "Example Workflow",
  "version": 1,
  "entrypoint": "triage",
  "workflowPath": "workflows/example-workflow/workflow.md",
  "agentConfig": {
    "mode": "main-agent",
    "identity": "prism-workflow-agent",
    "skills": [],
    "contextPolicy": {
      "continuation": "step",
      "handoff": "artifacts"
    }
  },
  "steps": [
    {
      "key": "triage",
      "label": "Triage",
      "type": "agent",
      "instructionPath": "workflows/example-workflow/steps/triage.md",
      "next": "review"
    },
    {
      "key": "external-check",
      "label": "External Check",
      "type": "checkpoint",
      "instructionPath": "workflows/example-workflow/steps/external-check.md",
      "resumeLabel": "Check external state",
      "next": "review"
    },
    {
      "key": "checklist-loop",
      "label": "Checklist Loop",
      "type": "loop",
      "loop": {
        "artifactName": "implementation-checklist.json",
        "condition": "all_items_complete",
        "target": "triage",
        "maxIterations": 10,
        "onMaxIterations": "review"
      },
      "next": "review"
    },
    {
      "key": "review",
      "label": "Review",
      "type": "gate",
      "next": "closed"
    },
    {
      "key": "closed",
      "label": "Closed",
      "type": "terminal"
    }
  ]
}
```

## Markdown Rules

`workflow.md` should describe:

- what the workflow is for
- how human gates work
- how loops/retries should be handled
- which state is durable DB state
- any important target/artifact conventions
- which domain evidence is required before a risky step can continue

Each `steps/<step-key>.md` should stay narrow and skill-like:

- describe the step outcome
- list the context the agent should use
- name relevant skills/scripts/files
- state what output should be returned
- state which durable artifacts should be written
- state which external refs should be attached or checked
- state idempotency/reconciliation rules for steps that call live systems
- state delegation rules when `agentConfig.delegation.allowed` is true
- avoid broad instructions that belong to the whole workflow

## Step Types

Use these step types:

- `agent`: Codex performs work for the step.
- `gate`: a human decision is required.
- `checkpoint`: a human-triggered agent check of external or long-running state. Use this for render status, PR reviews, deploy readiness, publication status, or other waits where an operator decides when to ask the agent to check. Checkpoints run their own instructions and stay on the checkpoint after the check; if ready, the agent should state which next step should run and why.
- `loop`: deterministic control flow that reads a structured request artifact and routes back to a target step until an exit condition is met. Loop steps do not run Codex. Use loops when iteration needs workflow history and resumability; use one agent step when the iteration can remain inside a single run; use a gate when the decision is subjective.
- `command`: a reviewed script or service command runs.
- `handoff`: work moves to a channel, target, or person.
- `subworkflow`: another workflow starts.
- `wait`: the workflow pauses for time or an external signal.
- `terminal`: the workflow is complete.

Only add `command`, `handoff`, `subworkflow`, or `wait` when the current product can represent or safely ignore them. For early workflows, prefer `agent`, `gate`, `checkpoint`, `loop`, and `terminal`.

For checklist loops, use a JSON request artifact named in `loop.artifactName`.
The first supported condition is `all_items_complete`, where every item must be
`complete` or `skipped` before the loop exits through `next`.

```json
{
  "version": 1,
  "items": [
    {
      "id": "admin-ui-empty-state",
      "title": "Update admin UI empty state",
      "status": "pending",
      "notes": "Needs implementation"
    }
  ]
}
```

Valid initial statuses are `pending`, `in_progress`, `complete`, `blocked`, and
`skipped`. The step before the loop should update the checklist artifact. The
loop target step should instruct the agent to pick the next incomplete item
instead of redoing the full checklist. Always set `maxIterations`; route
`onMaxIterations` to a gate or checkpoint when a human should decide whether to
continue, revise the checklist, or skip ahead.

## Current Request Workflow

The current built-in request workflow is `change-request-default`.

Its workflow run `current_step_key` is the source of truth. Request `status` is only a coarse board projection for lists and badges.

When modifying current request behavior, preserve existing board semantics unless the user explicitly asks for a migration.

## Authoring Checklist

When creating or changing a workflow:

1. Use lowercase kebab-case workflow and step keys.
2. Update `workflow.md`.
3. Add or update each relevant `steps/<step-key>.md`.
4. Update the manifest `steps[]` order and deterministic `next` links.
5. Keep agent instructions in markdown, not JSON.
6. Keep state and approvals in DB-backed request/workflow records.
7. Call out any required skills, scripts, env vars, or adapter capabilities.
8. Verify shared skills are required by every agent step and review each step's
   effective skill union.
9. Verify adjacent agent steps with different skill sets use explicit artifact
   handoffs and `contextPolicy.continuation: "step"` unless session continuity
   is intentionally required.
10. Return a concise summary of changed files and expected UI/status behavior.
11. Assign one `accountabilityDomainKey` and verify that it is active.
12. Verify every agent step resolves through `step-explicit` or
    `workflow-default`; disclose any temporary `admin-fallback`.
13. Review intentional cross-domain executors rather than copying their domain
    onto the workflow.
