---
name: change-request-ops
description: Use this skill when Codex needs to pull the next or current Prism request, inspect request/workflow state, create requests, attach external refs, or create and update execution records through the Prism Agent API.
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
- `POST /agent/change-board/requests`
- `GET /agent/change-board/requests/next`
- `GET /agent/change-board/requests/current`
- `GET /agent/change-board/requests/by-number/:requestNumber/review`
- `GET /agent/change-board/requests/:id`
- `PATCH /agent/change-board/requests/:id`
- `GET /agent/change-board/requests/:id/external-refs`
- `POST /agent/change-board/requests/:id/external-refs`
- `GET /agent/change-board/requests/:id/executions`
- `POST /agent/change-board/requests/:id/executions`
- `PATCH /agent/change-board/executions/:executionId`
- `GET /agent/change-board/requests/:id/deploy-plan`

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

Use this endpoint when a user asks what happened to request `#10`, why a workflow got stuck, or what should improve next time. It returns the request, workflow definition, workflow run, executions, workflow events, artifacts, external refs, latest linked agent session, and agent messages. Review the timeline before recommending changes.

Create request pattern:

1. If the user is asking to create or open a tracked change request, do not write to Prism memory.
2. If the target app is unclear, list target apps first and either infer the best match or ask a focused follow-up.
3. Create the request through the internal change-board API.
4. Confirm the new request number, title, target app, and initial status back to the user.
5. By default, workflow-backed requests auto-start when their entry step is an agent step. Send `"autoStart": false` only when the user explicitly wants to create a request without running it.
6. If the entry step is a gate, the request waits for an operator decision.
7. The create response returns the created row as `request`; read `changeRequest` only as a compatibility fallback.
8. Valid `requestType` values are `bug`, `feature`, `issue`, `content`, `design`, `config`, and `ops`.

List target apps:

```bash
curl -fsSL \
  -H "x-service-token: $PRISM_AGENT_SERVICE_TOKEN" \
  "$PRISM_AGENT_API_BASE_URL/agent/target-apps"
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
    "targetAppId": "'"$TARGET_APP_ID"'",
    "priority": "'"${PRIORITY:-normal}"'",
    "source": "chat",
    "autoStart": true
  }'
```

Start-of-run pattern:

1. Fetch `current`.
2. If `current.changeRequest` is null, fetch `next`.
3. Read `changeRequest`, `targetApp`, `targetEnvironment`, `deployPlan`, `latestExecution`, and `externalRefs`.
4. During triage, write substantive detail into `triageSummary` and `agentRecommendation` before routing the request onward.
5. If operating on a queued request, create an execution record before changing code.
6. Request `status` is only a coarse projection: use `submitted`, `in-progress`, or `closed`.
7. Do not use legacy queue statuses such as `ready-for-agent`, `awaiting-review`, `changes-requested`, `approved`, or `rejected`.
8. The current workflow step is stored in `workflow_runs.current_step_key` and exposed as `currentWorkflowStepKey`; use that field to understand where the request is.
9. Do not begin implementation, deployment, or execution in the same turn that finishes triage unless the user explicitly says to continue immediately on an already reviewed request.

Create execution:

```bash
curl -fsSL \
  -X POST \
  -H "content-type: application/json" \
  -H "x-service-token: $PRISM_AGENT_SERVICE_TOKEN" \
  "$PRISM_AGENT_API_BASE_URL/agent/change-board/requests/$CHANGE_REQUEST_ID/executions" \
  -d '{
    "status": "running",
    "actorType": "codex",
    "startedAt": "'"$(date -u +"%Y-%m-%dT%H:%M:%SZ")"'"
  }'
```

Patch request metadata or coarse board status:

```bash
curl -fsSL \
  -X PATCH \
  -H "content-type: application/json" \
  -H "x-service-token: $PRISM_AGENT_SERVICE_TOKEN" \
  "$PRISM_AGENT_API_BASE_URL/agent/change-board/requests/$CHANGE_REQUEST_ID" \
  -d '{"status":"in-progress"}'
```

Attach external records when the request interacts with a live system outside Prism. Use this for GitHub issues, GitHub pull requests, Discord messages or threads, deployments, publishing targets, or DAO proposal pages. Do not leave these only in comments if later workflow steps need to inspect or sync them.

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

For richer triage updates, patch the request with both status and suggested changes:

```bash
curl -fsSL \
  -X PATCH \
  -H "content-type: application/json" \
  -H "x-service-token: $PRISM_AGENT_SERVICE_TOKEN" \
  "$PRISM_AGENT_API_BASE_URL/agent/change-board/requests/$CHANGE_REQUEST_ID" \
  -d '{
    "status": "in-progress",
    "triageSummary": "'"$TRIAGE_SUMMARY"'",
    "agentRecommendation": "'"$SUGGESTED_CHANGES"'"
  }'
```

Update execution with results:

```bash
curl -fsSL \
  -X PATCH \
  -H "content-type: application/json" \
  -H "x-service-token: $PRISM_AGENT_SERVICE_TOKEN" \
  "$PRISM_AGENT_API_BASE_URL/agent/change-board/executions/$EXECUTION_ID" \
  -d '{
    "status": "completed",
    "branchName": "'"$BRANCH_NAME"'",
    "commitSha": "'"$COMMIT_SHA"'",
    "deployUrl": "'"$DEPLOY_URL"'",
    "summary": "'"$SUMMARY"'",
    "finishedAt": "'"$(date -u +"%Y-%m-%dT%H:%M:%SZ")"'"
  }'
```

End-of-run pattern:

1. A triage pass should end by recording useful triage details and leaving the workflow/request ready for the next explicit workflow step.
2. An execution pass should update execution records and any durable artifacts/external refs. Workflow step movement is owned by the site workflow engine when running through `/agent/responses`.
3. Update the execution with branch, commit, deploy URL, summary, error, timestamps, and notable runtime trace details.
4. If work fails, record the failure on the execution and leave the request on the current workflow step with status `in-progress` unless the workflow reaches a terminal step.

Rules:

- Treat the API as the source of truth.
- Re-read the request if the scope seems stale.
- If the user explicitly asks to create a change request, prefer the change-board API path over Prism memory writing.
- A chat-created request should default to `submitted`, then move through workflow steps. It should not auto-run implementation unless the user or task explicitly requests workflow execution.
- Do not use request `status` as the workflow source of truth. The current workflow step is stored in `workflow_runs.current_step_key` and is exposed on request records as `currentWorkflowStepKey`.
- Keep summaries factual, but make triage useful enough that a human can understand the proposed edits without reopening the whole conversation.
- `agentRecommendation` should describe the suggested changes, touched areas, and intended outcome, not just say "ready for agent".
- Store machine-usable fields in execution metadata instead of burying them in prose.
