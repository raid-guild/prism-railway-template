---
name: change-request-ops
description: Use this skill when Codex needs to pull the next or current Prism request, inspect request/workflow state, create requests, attach external refs, inspect agent runs, or continue workflow steps through the Prism Agent API.
---

Use this skill when Codex is operating on tracked change requests instead of freeform chat.

Required environment:

- `PRISM_AGENT_API_BASE_URL`
- `PRISM_AGENT_SERVICE_TOKEN`
- optional `PRISM_TARGET_APP_ID`

Always send `x-service-token: $PRISM_AGENT_SERVICE_TOKEN`.

In deployed Prism instances, Codex Runtime usually receives `APP_API_BASE_URL` and `APP_API_SERVICE_TOKEN`, then exposes them to Codex as `PRISM_AGENT_API_BASE_URL` and `PRISM_AGENT_SERVICE_TOKEN`. If the `PRISM_*` names are missing, check the `APP_*` names before concluding the API is unavailable.

Do not use browser admin routes such as `/admin/board` from Codex Runtime. Runtime agents should use the `/agent/...` routes below with service-token auth. A `401` from a browser admin route usually means "wrong surface", not that the operation is impossible.

Core endpoints:

- `GET /agent/target-apps`
- `POST /agent/target-apps`
- `PATCH /agent/target-apps/:id`
- `POST /agent/change-board/requests`
- `GET /agent/change-board/requests/next`
- `GET /agent/change-board/requests/current`
- `GET /agent/change-board/requests/by-number/:requestNumber/review`
- `GET /agent/change-board/requests/by-number/:requestNumber/artifacts`
- `POST /agent/change-board/requests/by-number/:requestNumber/workflow/continue`
- `GET /agent/change-board/requests/:id`
- `PATCH /agent/change-board/requests/:id`
- `GET /agent/change-board/requests/:id/external-refs`
- `POST /agent/change-board/requests/:id/external-refs`
- `GET /agent/change-board/requests/:id/artifacts`
- `POST /agent/change-board/requests/:id/artifacts`
- `GET /agent/change-board/requests/:id/artifacts/:artifactId/content`
- `POST /agent/source-attachments/ingest`
- `POST /agent/source-attachments/resolve-and-ingest`
- `GET /agent/runs`
- `GET /agent/change-board/requests/:id/executions`
- `GET /agent/change-board/requests/:id/deploy-plan`

To rerun the current agent, checkpoint, or loop step without advancing an
attention state, call the by-number workflow continue route with
`{"retryCurrentStep":true,"comment":"..."}`. Do not combine a current-step
retry with `workflowAction`.

Queue reads:

```bash
curl -fsSL \
  -H "x-service-token: $PRISM_AGENT_SERVICE_TOKEN" \
  "$PRISM_AGENT_API_BASE_URL/agent/change-board/requests/next${PRISM_TARGET_APP_ID:+?targetAppId=$PRISM_TARGET_APP_ID}"
```

```bash
curl -fsSL \
  -H "x-service-token: $PRISM_AGENT_SERVICE_TOKEN" \
  "$PRISM_AGENT_API_BASE_URL/agent/change-board/requests/current${PRISM_TARGET_APP_ID:+?targetAppId=$PRISM_TARGET_APP_ID}"
```

Review a completed or stuck workflow run by request number:

```bash
curl -fsSL \
  -H "x-service-token: $PRISM_AGENT_SERVICE_TOKEN" \
  "$PRISM_AGENT_API_BASE_URL/agent/change-board/requests/by-number/$REQUEST_NUMBER/review"
```

Use this endpoint when a user asks what happened to request `#10`, why a workflow got stuck, or what should improve next time. It returns the request, workflow definition, workflow run, agent runs, legacy executions, workflow events, artifacts, external refs, latest linked agent session, and agent messages. Review the agent runs and workflow events before recommending changes. Treat `legacyExecutions` as historical compatibility data only.

Inspect request artifacts by request number:

```bash
curl -fsSL \
  -H "x-service-token: $PRISM_AGENT_SERVICE_TOKEN" \
  "$PRISM_AGENT_API_BASE_URL/agent/change-board/requests/by-number/$REQUEST_NUMBER/artifacts"
```

The by-number artifact route includes text, markdown, and JSON bodies by default. Use query params when narrowing the read:

- `?name=draft.md`
- `?artifactId=<artifact-id>`
- `?kind=markdown`
- `?includeContent=false`
- `?includeBinary=true`
- `?maxBytes=500000`

If a user asks whether artifacts were created for a request number, this endpoint is the first API to call. Do not claim the board is admin-password gated until the `/agent/.../by-number/...` routes have been tried with service-token auth.

When a user references a Discord message link with an attachment, use the high-level resolver so the agent does not need to manually extract ids:

```bash
curl -fsSL \
  -X POST \
  -H "content-type: application/json" \
  -H "x-service-token: $PRISM_AGENT_SERVICE_TOKEN" \
  "$PRISM_AGENT_API_BASE_URL/agent/source-attachments/resolve-and-ingest" \
  -d '{
    "messageUrl": "'"$DISCORD_MESSAGE_URL"'",
    "intent": "summarize"
  }'
```

Intent defaults:

- "summarize this attachment" -> `intent: "summarize"`; writes text-like files to Memory as `session_attachment` context.
- "promote this to memory" -> `intent: "promote-memory"`; returns a shareable Memory artifact URL.
- "use this in request/workflow" -> `intent: "workflow-input"` with `requestId`.
- "promote this to knowledge" -> `intent: "promote-knowledge"`; explain that source-backed Knowledge is usually better for long-term canonical docs and ask for confirmation.

When a user references exact Discord attachment ids that should be used by a request or workflow, do not rely on the raw Discord CDN URL as durable storage. Ask the site to fetch it through the communication adapter and create a request artifact:

```bash
curl -fsSL \
  -X POST \
  -H "content-type: application/json" \
  -H "x-service-token: $PRISM_AGENT_SERVICE_TOKEN" \
  "$PRISM_AGENT_API_BASE_URL/agent/source-attachments/ingest" \
  -d '{
    "platform": "discord",
    "requestId": "'"$REQUEST_ID"'",
    "channelId": "'"$DISCORD_CHANNEL_ID"'",
    "messageId": "'"$DISCORD_MESSAGE_ID"'",
    "attachmentId": "'"$DISCORD_ATTACHMENT_ID"'",
    "lane": "request-artifact",
    "purpose": "workflow-input"
  }'
```

Use `lane: "workflow-input"` when the attachment is meant as input to the current workflow. For "summarize this attachment" or temporary session context, prefer `lane: "memory-inbox"` for text-like attachments so Prism returns a shareable memory artifact without treating it as Knowledge:

```json
{
  "platform": "discord",
  "channelId": "<discord-channel-id>",
  "messageId": "<discord-message-id>",
  "attachmentId": "<discord-attachment-id>",
  "lane": "memory-inbox",
  "purpose": "summarize-attachment"
}
```

Only promote to Knowledge after explicit confirmation. If the user asks for long-term/canonical knowledge, explain that a linked GitHub or source-backed knowledge source is usually better before writing to Knowledge inbox.

Continue or approve a workflow by request number:

```bash
curl -fsSL \
  -X POST \
  -H "content-type: application/json" \
  -H "x-service-token: $PRISM_AGENT_SERVICE_TOKEN" \
  "$PRISM_AGENT_API_BASE_URL/agent/change-board/requests/by-number/$REQUEST_NUMBER/workflow/continue" \
  -d '{
    "comment": "'"$OPERATOR_COMMENT"'"
  }'
```

Use this route when a user approves a gate or asks to move a request along from Discord or another non-browser surface. It uses the normal workflow runner; do not manually patch `currentWorkflowStepKey` to bypass gates. Prefer simple `next` flow and do not send `workflowAction` for normal continues. The workflow continues through agent steps until it reaches a gate, checkpoint, terminal step, failure, or emergency continuation guard.

Reconcile terminal projection drift by request number when a terminal workflow
run projects stale request or step state. This includes completed or closed
requests whose completed/canceled run still projects a non-terminal step, and
requests left open even though their workflow run already completed. In the
second case, reconciliation closes the request timeline too. This operation
never executes workflow steps. Dry-run first:

```bash
curl -fsSL \
  -X POST \
  -H "content-type: application/json" \
  -H "x-service-token: $PRISM_AGENT_SERVICE_TOKEN" \
  "$PRISM_AGENT_API_BASE_URL/agent/change-board/requests/by-number/$REQUEST_NUMBER/workflow/reconcile" \
  -d '{"dryRun":true}'
```

Apply only a verified `would_repair` result with `"dryRun":false`. If the result
is `TERMINAL_STEP_AMBIGUOUS`, select the intended key from
`terminalStepCandidates` and send it as `terminalStepKey`. Never use this route
while the workflow run or an agent run is active, to skip work, or to repeat a
side-effecting step.

Create request pattern:

Select the execution lane before creating a request. Discover applicable provider
skills/APIs and enabled workflows with `GET /agent/workflows`. CMS catalog/media
records, Action Items, and configuration supported by existing APIs are operational
work, not repository implementation. Perform an authorized bounded operation in
chat or select an appropriate operational workflow. Do not create a code request
merely to track work, because a repository URL was mentioned, or because an API
call failed. Missing credentials and unknown endpoints do not prove code is needed.

Every creation call must supply `workflowKey` explicitly. Missing/blank values
return `WORKFLOW_KEY_REQUIRED` without creating or starting anything. Do not
blindly retry that error with `change-request-default`; that workflow is only for
actual authorized repository changes. Record the concrete missing capability
before proposing code work. If no suitable workflow exists, explain the gap
without creating a repository issue or expanding the task's scope.

1. If the user is asking to create or open a tracked change request, do not write to Prism memory.
2. If the target app is unclear, list target apps first and either infer the best match or ask a focused follow-up.
3. Create the request through the internal change-board API.
4. Confirm the new request number, title, target app, and current workflow step back to the user.
5. By default, workflow-backed requests auto-start when their entry step is an agent step. Send `"autoStart": false` only when the user explicitly wants to create a request without running it.
6. If the entry step is a gate, the request waits for an operator decision.
7. The create response returns the created row as `request`; read `changeRequest` only as a compatibility fallback.
8. Valid `requestType` values are `bug`, `feature`, `issue`, `content`, `design`, `config`, and `ops`.
9. Include `estimatedHumanHours` when there is enough context to infer a coarse whole-request human effort estimate. Include expected human gates, review/approval time, coordination, and likely loopbacks such as review changes that return the workflow to an earlier step. Choose one bucket from `0.25`, `0.5`, `1`, `2`, `4`, `8`, `16`, `24`, or `40`; omit only when the request scope is genuinely unclear.

List target apps:

```bash
curl -fsSL \
  -H "x-service-token: $PRISM_AGENT_SERVICE_TOKEN" \
  "$PRISM_AGENT_API_BASE_URL/agent/target-apps"
```

When the user explicitly asks to register a GitHub repository as a target app,
create it through the same Agent API. The route derives `name`, `slug`, and the
`main` default branch when omitted, creates the standard writable development
environment, and safely returns the existing target on an exact repository
retry:

```bash
curl -fsSL \
  -X POST \
  -H "content-type: application/json" \
  -H "x-service-token: $PRISM_AGENT_SERVICE_TOKEN" \
  "$PRISM_AGENT_API_BASE_URL/agent/target-apps" \
  -d '{"repoUrl":"https://github.com/owner/repository","defaultBranch":"main"}'
```

Create tracked change request:

```bash
curl -fsSL \
  -X POST \
  -H "content-type: application/json" \
  -H "x-service-token: $PRISM_AGENT_SERVICE_TOKEN" \
  "$PRISM_AGENT_API_BASE_URL/agent/change-board/requests" \
  -d '{
    "title": "'"$TITLE"'",
    "description": "'"$DESCRIPTION"'",
    "requestType": "'"$REQUEST_TYPE"'",
    "workflowKey": "'"$WORKFLOW_KEY"'",
    "targetAppId": "'"$TARGET_APP_ID"'",
    "priority": "'"${PRIORITY:-normal}"'",
    "estimatedHumanHours": 2,
    "source": "chat",
    "autoStart": true
  }'
```

Start-of-run pattern:

1. Fetch `current`.
2. If `current.changeRequest` is null, fetch `next`.
3. Read `changeRequest`, `targetApp`, `targetEnvironment`, `deployPlan`, `latestAgentRun`, and `externalRefs`.
4. During triage, write substantive detail into `triageSummary` and `agentRecommendation` before routing the request onward. If `estimatedHumanHours` is missing and the scope is clear, patch it once using the same bucket list used during request creation.
5. Do not create `change_request_executions`. Workflow work is represented by `agent_runs` and should be started through the workflow continue route or request autostart.
6. Do not use legacy queue statuses such as `submitted`, `in-progress`, `ready-for-agent`, `awaiting-review`, `changes-requested`, `approved`, or `rejected`.
7. The current workflow step is stored in `workflow_runs.current_step_key` and exposed as `currentWorkflowStepKey`; use that field to understand where the request is.
8. Do not begin implementation, deployment, or agent-run work in the same turn that finishes triage unless the user explicitly says to continue immediately on an already reviewed request.

Patch request metadata:

```bash
curl -fsSL \
  -X PATCH \
  -H "content-type: application/json" \
  -H "x-service-token: $PRISM_AGENT_SERVICE_TOKEN" \
  "$PRISM_AGENT_API_BASE_URL/agent/change-board/requests/$CHANGE_REQUEST_ID" \
  -d '{"triageSummary":"...","agentRecommendation":"..."}'
```

Attach external records when the request interacts with a live system outside Prism. Use this for GitHub issues, GitHub pull requests, Discord messages or threads, deployments, publishing targets, or DAO proposal pages. Do not leave these only in comments if later workflow steps need to inspect or sync them.

For the built-in repository-backed change request workflow, first establish that actual repository changes are required and authorized. Only then should triage create a GitHub issue in the target repository when repository access is configured and no GitHub issue external ref already exists. Operational/CMS work must not create a GitHub issue. Do not create a duplicate issue when the request was imported from GitHub or already has an issue ref; attach the existing source issue instead.

```bash
curl -fsSL \
  -X POST \
  -H "content-type: application/json" \
  -H "x-service-token: $PRISM_AGENT_SERVICE_TOKEN" \
  "$PRISM_AGENT_API_BASE_URL/agent/change-board/requests/$CHANGE_REQUEST_ID/external-refs" \
  -d '{
    "provider": "github",
    "kind": "pull_request",
    "externalId": "42",
    "title": "'"$PR_TITLE"'",
    "url": "'"$PR_URL"'",
    "state": "open",
    "metadata": {
      "repo": "'"$GITHUB_REPO"'",
      "branch": "'"$BRANCH_NAME"'",
      "base": "main"
    }
  }'
```

When a request has a linked GitHub issue, leave concise issue comments for meaningful workflow state changes such as triage completed, PR opened, review changes requested, checks passing, or ready for final review. Do not spam the issue with every internal run update.

When implementation pushes a request branch and repository access is configured, create a pull request from the request feature branch into the target repository base branch. Then attach it as a GitHub `pull_request` external ref. If a PR ref already exists, reuse and update it instead of creating duplicates.

Checkpoint steps should use external refs as live lookup handles. For the default change request workflow, the `pr-review` checkpoint should inspect linked PR reviews, review comments, check status, and merge readiness. If changes were requested, summarize the specific fixes and recommend moving back to `implement`; if the PR is ready, recommend moving to `review`.

Create request artifacts for durable notes that later steps or humans need to inspect. Triage should write detailed fix notes as `triage-fix-notes.md`:

```bash
curl -fsSL \
  -X POST \
  -H "content-type: application/json" \
  -H "x-service-token: $PRISM_AGENT_SERVICE_TOKEN" \
  "$PRISM_AGENT_API_BASE_URL/agent/change-board/requests/$CHANGE_REQUEST_ID/artifacts" \
  -d '{
    "kind": "triage-fix-notes",
    "name": "triage-fix-notes.md",
    "mimeType": "text/markdown",
    "encoding": "utf8",
    "content": "'"$TRIAGE_FIX_NOTES"'",
    "metadata": {
      "workflowStep": "triage"
    }
  }'
```

When the workflow prompt provides a current agent run id, include it as
`agent_run_id` in artifact creation requests so operators can trace artifacts
back to the run that produced them.

For richer triage updates, patch the request with both summary and suggested changes:

```bash
curl -fsSL \
  -X PATCH \
  -H "content-type: application/json" \
  -H "x-service-token: $PRISM_AGENT_SERVICE_TOKEN" \
  "$PRISM_AGENT_API_BASE_URL/agent/change-board/requests/$CHANGE_REQUEST_ID" \
  -d '{
    "triageSummary": "'"$TRIAGE_SUMMARY"'",
    "agentRecommendation": "'"$SUGGESTED_CHANGES"'"
  }'
```

End-of-run pattern:

1. A triage pass should end by recording useful triage details and leaving the workflow/request ready for the next explicit workflow step.
2. An agent run should save durable artifacts/external refs needed by later steps. Workflow step movement is owned by the site workflow engine when running through `/agent/responses` or the workflow continue route.
3. Branch, commit, runtime trace, and failure details are recorded on `agent_runs.result` by the site runtime path. Do not patch legacy execution routes.
4. If work fails, let the agent run fail and leave the request on the current workflow step unless the workflow reaches a terminal step.

Rules:

- Treat the API as the source of truth.
- Re-read the request if the scope seems stale.
- If the user explicitly asks to create a change request, prefer the change-board API path over Prism memory writing.
- A chat-created request should start at the workflow entry step. It should not auto-run implementation unless the user or task explicitly requests an agent run.
- Do not use request `status`; request progress is owned by `workflow_runs.current_step_key` and exposed on request records as `currentWorkflowStepKey`.
- Keep summaries factual, but make triage useful enough that a human can understand the proposed edits without reopening the whole conversation.
- `agentRecommendation` should describe the suggested changes, touched areas, and intended outcome, not just say "ready for agent".
- Store machine-usable fields in request artifacts, external refs, or `agent_runs.result` instead of burying them in prose.
