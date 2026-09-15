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
- `POST /agent/tasks/:key/trigger`
- `GET /agent/tasks/runs`
- `GET /agent/task-scripts`
- `POST /agent/task-scripts`
- `GET /agent/task-scripts/:key`
- `PATCH /agent/task-scripts/:key`
- `DELETE /agent/task-scripts/:key`
- `GET /agent/task-scripts/:key/content`

Use `POST /agent/tasks/:key/trigger` to run an existing task immediately. The
Site proxies this request to task-runner so normal preflight, runtime handoff,
delivery, and run finalization all occur. `POST /agent/tasks/runs` is a durable
bookkeeping endpoint for task-runner; creating a run row does not dispatch the
task. `POST /agent/tasks/runs` and `PATCH /agent/tasks/runs/:id` require both
service authentication and task-runner control authentication. Ordinary agents
may list runs but cannot create or finalize them.

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
- `GET /agent/hooks/:key/requests/:requestNumber/result`

Workflow event consumers:

- `GET /agent/workflow-events`

The workflow-event feed follows Site's durable monotonic event sequence and is
cursorable. Consumers may filter
with repeated or comma-separated `eventType` parameters, pass the returned
opaque `cursor`, and set `limit` from 1 to 500. The feed is an event log, not a
delivery queue: scheduled tasks or agents own their checkpoint and delivery
policy, while the communication adapter owns transport behavior.

Consumers should persist `nextCursor` only after successful processing. The
lightweight task pattern stores it in the successful task run's
`outputSnapshot.body` JSON and reads the previous successful run through
`GET /agent/tasks/runs?taskKey=<key>`. A workflow may trigger the task for lower
latency, but the periodic schedule is the recovery mechanism. Do not place the
Site service token in task parameters or scripts.

Requests and artifacts:

- `GET /agent/target-apps`
- `POST /agent/target-apps`
- `PATCH /agent/target-apps/:id`
- `POST /agent/change-board/requests`
- `GET /agent/change-board/requests/:id`
- `PATCH /agent/change-board/requests/:id`
- `GET /agent/change-board/requests/by-number/:requestNumber/review`
- `GET /agent/change-board/requests/by-number/:requestNumber/artifacts`
- `POST /agent/change-board/requests/by-number/:requestNumber/workflow/continue`
- `POST /agent/change-board/requests/by-number/:requestNumber/workflow/reconcile`
- `POST /agent/change-board/requests/:id/artifacts`
- `GET /agent/change-board/requests/:id/artifacts/:artifactId/content`
- `POST /agent/source-attachments/ingest`
- `POST /agent/source-attachments/resolve-and-ingest`
- `GET /agent/change-board/requests/:id/external-refs`
- `POST /agent/change-board/requests/:id/external-refs`

`POST /agent/target-apps` registers an HTTPS GitHub repository and creates its
standard writable development environment. `name`, `slug`, and
`defaultBranch` are optional and derive from the repository URL with `main` as
the branch default. Repeating the same repository request returns the existing
target instead of creating a duplicate.

`PATCH /agent/target-apps/:id` updates an existing target's agent-safe metadata:
`name`, `description`, `repoUrl`, `defaultBranch`, and `agentEnabled`. When the
default branch changes, Prism also updates the default agent environment if it
is the conventional `<target-slug>-default` environment or still follows the
target's previous default branch. An explicitly divergent environment branch is
preserved and `defaultEnvironmentBranchSynced` is returned as `false`.

`workflow/reconcile` is a maintenance operation for terminal workflow runs with
stale request or step projection. It also closes a request timeline that
remained open after its workflow run completed. It is dry-run by default,
refuses active workflow and agent runs, and does not execute workflow steps.
Send `{"dryRun":false}` to apply a verified repair.
When a workflow has multiple terminal steps, include the selected
`terminalStepKey` returned by the dry-run candidates.

The by-number workflow continue route accepts `{"retryCurrentStep":true}` to
rerun an agent, checkpoint, or loop step without advancing past its attention
state. A retry uses the latest saved workflow definition and current request
evidence. Do not combine `retryCurrentStep` with `workflowAction`.

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

Agent-created requests should include `estimatedHumanHours` when there is enough context to infer a coarse whole-request human effort estimate. Include expected human gates, review/approval time, coordination, and likely loopbacks such as review changes that return the workflow to an earlier step. Choose the nearest bucket from `0.25`, `0.5`, `1`, `2`, `4`, `8`, `16`, `24`, or `40`. The field is optional and must be a finite number from `0` through `999`.

When a request originates in a Site-owned communication session, include
`sourceSessionId` and, when available, `sourceMessageId`. Site resolves the
immutable platform, channel/target, interaction profile, and initiator snapshot
from that trusted session. Callers must not provide display identity fields;
external subject values are intentionally excluded from request provenance.

Source attachment ingest:

```bash
curl -fsSL \
  -X POST \
  -H "content-type: application/json" \
  -H "x-service-token: $PRISM_AGENT_SERVICE_TOKEN" \
  "$PRISM_AGENT_API_BASE_URL/agent/source-attachments/ingest" \
  -d '{
    "platform": "discord",
    "requestId": "<request-id>",
    "channelId": "<discord-channel-id>",
    "messageId": "<discord-message-id>",
    "attachmentId": "<discord-attachment-id>",
    "lane": "request-artifact",
    "purpose": "workflow-input"
  }'
```

The first slice supports Discord attachments and the `request-artifact`,
`workflow-input`, or `memory-inbox` lanes. The site fetches bytes through the
communication adapter and preserves source provenance. Request/workflow lanes
store a private request artifact. The memory lane writes text-like attachments
to Prism Memory as `session_attachment` records and returns the Memory artifact
URL when available.

When the caller has a Discord message URL rather than explicit ids, use the
resolver route:

```bash
curl -fsSL \
  -X POST \
  -H "content-type: application/json" \
  -H "x-service-token: $PRISM_AGENT_SERVICE_TOKEN" \
  "$PRISM_AGENT_API_BASE_URL/agent/source-attachments/resolve-and-ingest" \
  -d '{
    "messageUrl": "https://discord.com/channels/<guild>/<channel>/<message>",
    "intent": "summarize"
  }'
```

Supported intents:

- `summarize`: writes a text-like attachment to Memory as current-session context.
- `promote-memory`: writes a text-like attachment to Memory and returns the shareable artifact URL.
- `request-artifact`: requires `requestId` and creates a private request artifact.
- `workflow-input`: requires `requestId` and creates a private workflow input artifact.
- `promote-knowledge`: returns a confirmation warning; prefer source-backed Knowledge for long-term canonical docs.

Branding:

- `GET /agent/site-content/branding`
- `PATCH /agent/site-content/branding`

Use the branding routes for logo, platform title, brand name, workspace label, and logo alt text updates.

Source adapter access policy:

- `GET /agent/source-adapter-policy`
- `PATCH /agent/source-adapter-policy`
- `GET /agent/source-history/capabilities`
- `POST /agent/source-history/search`
- `POST /agent/source-history/context`

Use source adapter policy routes for public chat/input access controls. Policies
are platform-scoped. For Discord, `platforms.discord.targets` are channel or
thread IDs, `platforms.discord.groups` are role IDs, and
`platforms.discord.users` are Discord user IDs. The default mode is `readonly`.
For Buzz, targets are channel UUIDs and users are Nostr hex public keys. Buzz
defaults to `off`; every enabled rule should include an
`interactionProfileKey` whose profile mode matches the rule mode. A target rule
may also include a validated `skills` list; those Site-hosted skills are loaded
for every runtime interaction from that target.

The Buzz adapter exposes direct, non-collecting history to trusted service
callers at `GET /agent/buzz/channels/:channelId/messages`. It requires the
shared `x-service-token`, is additionally restricted by the adapter's
`BUZZ_HISTORY_CHANNEL_ALLOWLIST`, and accepts `since`, `limit`, and
`includeOwn` query parameters. Relevant reply threads are expanded and each
message includes root and direct-parent correlation. Reading this route does
not advance `/sync` checkpoints or write to Prism Memory.

Source-history routes expose read-only provider evidence through one Site-owned
contract. The first search implementation uses Discord's native guild message
search. It returns canonical message URLs and supports bounded context reads
without advancing source collection checkpoints or writing to Prism Memory.
Use the built-in `prism-source-history-reader` skill for retrieval order,
coverage handling, retry behavior, and citation guidance.

Discord search reuses the existing communication-adapter configuration and
requires no search-specific environment variables. Target rules may include
`historyScopes` containing Discord channel or thread IDs. When a trusted runtime
supplies `sourceContext`, Site defaults history access to the originating target
and permits broader targets only when listed in `historyScopes`. Age-restricted
search is disabled in the first slice.

Capabilities distinguish provider behavior instead of promising uniform
history: Discord may report `native-search`, Buzz may report bounded
read-through, and Telegram remains unavailable until bot-seen updates are
durably retained in a local index.

External interaction configuration:

- `GET /agent/interaction-profiles`
- `POST /agent/interaction-profiles`
- `GET /agent/interaction-profiles/:key`
- `PATCH /agent/interaction-profiles/:key`
- `DELETE /agent/interaction-profiles/:key`
- `GET /agent/external-interfaces`
- `POST /agent/external-interfaces`
- `GET /agent/external-interfaces/:key`
- `PATCH /agent/external-interfaces/:key`
- `DELETE /agent/external-interfaces/:key`
- `GET /agent/external-interfaces/events`

These routes manage non-secret configuration only. Use the built-in
`prism-interaction-author` skill, create new interfaces disabled, and direct the
operator to **Settings > Interfaces** for one-time credential generation,
rotation, revocation, and enablement. The internal adapter authorization route
is not an agent authoring surface.

Agent sessions:

- `GET /agent/agent-sessions/:sessionId`
- `POST /agent/agent-sessions/:sessionId/messages`
- `GET /agent/agent-sessions/discord/lookup`
- `POST /agent/agent-sessions/discord/upsert`
- `GET /agent/agent-sessions/source/lookup`
- `POST /agent/agent-sessions/source/upsert`

## Adapter Delivery

The site `/agent/*` API owns Prism content. Transport adapters own destination discovery and message delivery.

For Discord one-off sends from Codex Runtime, use the adapter directly only when the user explicitly asks for immediate delivery:

```bash
COMMUNICATION_ADAPTER_BASE_URL
COMMUNICATION_ADAPTER_TOKEN
```

Resolve destinations:

```bash
curl -fsSL \
  -H "X-Adapter-Token: $COMMUNICATION_ADAPTER_TOKEN" \
  "$COMMUNICATION_ADAPTER_BASE_URL/destinations"
```

Send a message after resolving the destination id:

```bash
curl -fsSL \
  -X POST \
  -H "content-type: application/json" \
  -H "X-Adapter-Token: $COMMUNICATION_ADAPTER_TOKEN" \
  "$COMMUNICATION_ADAPTER_BASE_URL/messages" \
  -d '{"destinationId":"<channel-id>","content":"Test message"}'
```

If `COMMUNICATION_ADAPTER_TOKEN` is missing, the adapter returns `401`. Do not use the site service token for adapter `/messages`; it is a different service boundary.

## Content Ownership

The site service owns Prism-managed custom content:

- Custom skills live under the site-managed skills root and are written through `/agent/skills`.
- Custom workflows live under the site-managed workflows root and are written through `/agent/workflows`.
- Workflow outputs that later steps need should be saved as request artifacts through `/agent/change-board/requests/:id/artifacts`.

Codex Runtime may create temporary local files during a run, but durable Prism content should be written through the site API.
