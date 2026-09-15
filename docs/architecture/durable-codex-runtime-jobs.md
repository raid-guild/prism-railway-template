# Durable Codex Runtime Jobs

Future feature spec for making long-running Codex work recoverable across browser disconnects, service restarts, and transient network failures.

## Problem

Prism Console already creates a site-side background job before calling Codex Runtime, so the browser does not need to hold one long request open. The site job still performs one blocking HTTP request to `codex-runtime /v1/responses`.

If that site-to-runtime request fails while Codex is working, the site marks the console job failed with errors such as:

```text
CODEX_RUNTIME_FETCH_FAILED:fetch failed
```

This is especially common for prompts that create or update skills, workflows, tasks, or other managed Prism content because those runs can be long and tool-heavy.

Increasing timeouts helps only when the runtime itself times out. It does not solve dropped HTTP connections, runtime restarts, site restarts, proxy interruptions, or the browser navigating away during a polling cycle.

## Goal

Make Codex work durable and inspectable as a first-class run:

- A caller starts a run and receives a job id quickly.
- Codex Runtime owns the long-running process.
- Site polls or subscribes to job status instead of holding one blocking runtime request.
- Transient polling failures do not fail the underlying run.
- Results, trace events, errors, artifacts, and linked Prism changes can be recovered later.

## Non-Goals

- Replace task runs, workflow-step agent runs, or request artifacts immediately.
- Build a distributed queue system as the first slice.
- Require websockets before the basic model works.
- Make every tool call stream live in the first implementation.

## UX Model

Prism Console should treat a submitted prompt as a background run.

When the user sends a prompt:

1. The user message is appended immediately.
2. A visible run card appears with status.
3. The input unlocks after the job starts.
4. The user can leave the tab or switch workspaces.
5. Returning to Prism Console reloads active and recent runs.
6. Completion appends the assistant response to chat history.

Suggested status labels:

- `queued`
- `running`
- `waiting`
- `retrying connection`
- `succeeded`
- `failed`
- `canceled`

The run card should expose:

- current status
- started/finished timestamps
- runtime trace summary
- final assistant response
- linked session id
- created/updated Prism objects when known
- retry/cancel/view details actions where supported

For transient runtime polling failures, the UI should show a recoverable state such as:

```text
Runtime connection interrupted. Retrying...
```

It should not immediately mark the run failed unless the runtime job reports failure, expires, or cannot be found after a bounded retry window.

## Architecture

### Current Shape

```text
Browser -> Site console job -> blocking fetch -> Codex Runtime /v1/responses
```

### Target Shape

```text
Browser -> Site console job -> Codex Runtime job create
Browser -> Site job status polling
Site    -> Runtime job status polling
Runtime -> Codex child process
Runtime -> persisted job result and trace
```

## Runtime API

Add Codex Runtime job endpoints.

### Create Runtime Job

```http
POST /v1/response-jobs
content-type: application/json
```

Body should match the current `/v1/responses` payload:

```json
{
  "prompt": "Create a workflow...",
  "sessionId": "site-session-id",
  "codexThreadId": null,
  "recentHistory": [],
  "metadata": {
    "transport": "site"
  }
}
```

Response:

```json
{
  "ok": true,
  "jobId": "runtime-job-id",
  "status": "queued"
}
```

### Get Runtime Job

```http
GET /v1/response-jobs/:jobId
```

Response:

```json
{
  "ok": true,
  "job": {
    "id": "runtime-job-id",
    "status": "running",
    "sessionId": "site-session-id",
    "codexThreadId": "codex-thread-id",
    "createdAt": "2026-05-26T20:00:00.000Z",
    "startedAt": "2026-05-26T20:00:01.000Z",
    "finishedAt": null,
    "outputText": null,
    "error": null,
    "trace": []
  }
}
```

Terminal statuses:

- `succeeded`
- `failed`
- `canceled`
- `expired`

### Cancel Runtime Job

```http
POST /v1/response-jobs/:jobId/cancel
```

Cancel should terminate the active Codex child process if it is still running and mark the job `canceled`.

## Site Changes

The existing site `agent_response_jobs` table can remain the browser-facing job record.

Add fields or metadata for:

- runtime job id
- runtime job status
- last runtime poll timestamp
- runtime polling failure count
- last runtime polling error

Site console job flow:

1. Create site job.
2. Start runtime job.
3. Store runtime job id.
4. Poll runtime job until terminal state.
5. Copy final output, trace, thread id, and error into the site job.
6. Persist assistant response into the agent session on success.

Polling should use bounded retry/backoff:

- short interval while active, for example 2-5 seconds
- tolerate transient fetch failures
- fail only after a configured retry window, for example 5-10 minutes without a successful poll
- if runtime returns `404`, retry briefly before treating as lost

## Activity UI

Prism Console can start with local run cards. A later global activity surface can aggregate:

- active console jobs
- active workflow-step agent runs
- task runs
- hook-triggered requests
- recent failures

Possible labels:

- `Activity`
- `Runs`
- `Background work`

Initial scope should avoid building a full queue dashboard. A small active/recent run panel in Prism Console is enough.

## Workflow And Task Migration

After Prism Console is stable, migrate other long-running callers:

- workflow agent steps
- task-runner prompt tasks
- hook-triggered workflow requests

The goal is one execution model:

```text
start run -> observe run -> recover run -> persist result
```

Task and workflow records should keep their existing domain-specific tables, but their Codex execution can reference the runtime job id for recovery and trace inspection.

## Open Questions

- Should runtime jobs persist to SQLite on the runtime volume, JSON files, or another durable store?
- How long should completed runtime jobs be retained?
- Should runtime support server-sent events for trace updates after polling works?
- Should the runtime expose partial assistant text, or only trace events until completion?
- How should site recover in-progress jobs after a site restart?
- Should task-runner call runtime jobs directly, or should it continue calling site APIs that own task-run records?

## Suggested Implementation Phases

### Phase 1: Runtime Job API

- Add in-memory or file-backed runtime job registry.
- Add `POST /v1/response-jobs`.
- Add `GET /v1/response-jobs/:id`.
- Add `POST /v1/response-jobs/:id/cancel`.
- Keep `/v1/responses` as compatibility path.

### Phase 2: Console Uses Runtime Jobs

- Update site console job worker to create and poll runtime jobs.
- Show `retrying connection` instead of immediate failure for transient polling errors.
- Persist runtime job id on the site job.

### Phase 3: Better Console Run UI

- Add visible run cards in Prism Console.
- Show trace summary and final output.
- Add cancel and retry where supported.

### Phase 4: Workflow/Task Adoption

- Add runtime job id to workflow-step agent-run metadata.
- Add runtime job id to task run metadata.
- Use runtime polling for prompt-based task runs and workflow agent steps.

### Phase 5: Streaming

- Add SSE endpoint for runtime job trace updates if polling feels too slow.
- Keep polling fallback for reliability.
