# Agent API Contract

This contract is for Codex Runtime, task-runner, source-adapter, and other machine callers inside a Prism Railway Template instance.

## Route Split

Prism has two API surfaces:

- `/admin/*`: browser/admin UI routes. These require an authenticated admin session.
- `/agent/*`: service-token routes. These are for Codex Runtime and other internal services.

Do not call `/admin/*` with `x-service-token`. If a runtime agent receives `401` from an `/admin/*` route, it should look for the equivalent `/agent/*` route before asking for an admin password.

## Auth

Agents should use:

```bash
PRISM_AGENT_API_BASE_URL
PRISM_AGENT_SERVICE_TOKEN
```

If those names are not present, use the service env names:

```bash
APP_API_BASE_URL
APP_API_SERVICE_TOKEN
```

Send the token as:

```bash
x-service-token: <token>
```

## Common Routes

Tasks:

- `GET /agent/tasks`
- `POST /agent/tasks`
- `DELETE /agent/tasks/:key`
- `GET /agent/tasks/runs`
- `POST /agent/tasks/runs`
- `PATCH /agent/tasks/runs/:id`

Skills:

- `GET /agent/skills`
- `POST /agent/skills`
- `DELETE /agent/skills/:name`
- `GET /agent/skills/:name/download`

Workflows:

- `GET /agent/workflows`
- `POST /agent/workflows`
- `GET /agent/workflows/:key`
- `POST /agent/responses`

Hooks:

- `GET /agent/hooks`
- `POST /agent/hooks`
- `GET /agent/hooks/:key`
- `PATCH /agent/hooks/:key`
- `DELETE /agent/hooks/:key`
- `POST /agent/hooks/:key/trigger`

Requests and artifacts:

- `GET /agent/target-apps`
- `POST /agent/change-board/requests`
- `GET /agent/change-board/requests/:id`
- `PATCH /agent/change-board/requests/:id`
- `GET /agent/change-board/requests/by-number/:requestNumber/review`
- `GET /agent/change-board/requests/by-number/:requestNumber/artifacts`
- `POST /agent/change-board/requests/:id/artifacts`
- `GET /agent/change-board/requests/:id/artifacts/:artifactId/content`
- `GET /agent/change-board/requests/:id/external-refs`
- `POST /agent/change-board/requests/:id/external-refs`

`POST /agent/change-board/requests` returns the created request as `request`. Some older responses also include `changeRequest` as an alias; new agent code should read `request` first.

Request creation accepts these `requestType` values:

- `bug`
- `feature`
- `issue`
- `content`
- `design`
- `config`
- `ops`

Request creation accepts these `priority` values:

- `low`
- `normal`
- `high`
- `urgent`

If a request creation call sends an invalid type or priority, the `400` response includes `validRequestTypes` or `validPriorities` so agents can retry with a supported value.

Branding:

- `GET /agent/site-content/branding`
- `PATCH /agent/site-content/branding`

Use the branding routes for logo, platform title, brand name, workspace label, and logo alt text updates.

Agent sessions:

- `GET /agent/agent-sessions/:sessionId`
- `POST /agent/agent-sessions/:sessionId/messages`
- `GET /agent/agent-sessions/discord/lookup`
- `POST /agent/agent-sessions/discord/upsert`

## Content Ownership

The site service owns Prism-managed custom content:

- Custom skills live under the site-managed skills root and are written through `/agent/skills`.
- Custom workflows live under the site-managed workflows root and are written through `/agent/workflows`.
- Workflow outputs that later steps need should be saved as request artifacts through `/agent/change-board/requests/:id/artifacts`.

Codex Runtime may create temporary local files during a run, but durable Prism content should be written through the site API.
