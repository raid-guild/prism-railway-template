# Workflow Event Notifications

Status: cursorable workflow-event feed implemented; notification processors are
instance configuration

## Decision

Do not add a notification outbox to Site in the first slice.

Site already has `workflow_events`, an append-only timeline for workflow state.
Task Runner already schedules deterministic scripts or agent tasks and can send
configured task output through the communication adapter. A second Site queue
would duplicate delivery responsibility and make assumptions that belong in the
communication adapter.

The missing template primitive is a service-token workflow-event feed:

```text
GET /agent/workflow-events
```

It returns events in stable chronological order, supports event-type filters,
and provides an opaque cursor. It does not claim, acknowledge, retry, resolve a
recipient, render content, or send anything.

## Intended flow

```text
Site appends workflow_events
        -> scheduled Prism task queries selected event types
        -> task applies instance notification policy
        -> task sends through the communication adapter
           or uses an assigned skill/Gateway tool
        -> task persists its returned cursor/checkpoint
```

For example:

```text
GET /agent/workflow-events
  ?eventType=external_ref.upserted,agent.blocked,agent.needs_attention
  &cursor=<opaque cursor>
  &limit=100
```

The response contains `events`, `nextCursor`, and `hasMore`. Ordering uses a
durable monotonic event sequence assigned by Site, so concurrent or
same-millisecond events paginate safely.

## Operator configuration

An operator decides:

- which workflow event types are notification-worthy,
- any payload conditions, such as a GitHub pull-request external reference,
- how the requester or destination is resolved,
- whether processing is deterministic or agent-assisted,
- the task schedule,
- and which communication-adapter destination or Gateway tool is used.

No notification policy is enabled by default in the template.

A deterministic scheduled script is appropriate for normal lifecycle notices.
An agent task or sending skill is appropriate when content needs judgment. A
one-off interactive send can bypass the feed and call the communication adapter
or Gateway tool directly.

A workflow may trigger the processor task after creating an important event for
lower latency, but the periodic schedule remains the recovery path. The
workflow should not maintain a polling loop itself.

## Cursor persistence

The event feed is a log, not a queue. A processor owns its checkpoint. A task
may store the last successful cursor in durable local state. The preferred first
implementation reuses existing task-run output instead of adding another Site
table:

1. Read `GET /agent/tasks/runs?taskKey=<key>&limit=10`.
2. Ignore the currently running entry and find the newest successful run with a
   cursor in its `outputSnapshot.body` JSON.
3. Query `/agent/workflow-events` with that cursor.
4. Process events in order and stop at the first failed handoff.
5. Emit JSON containing the cursor through the last contiguous successful event.
6. On the next run, resume from that saved cursor.

Example task result:

```json
{
  "ok": true,
  "shouldNotify": false,
  "workflowEventCursor": "<opaque cursor>",
  "eventsRead": 12,
  "notificationsSent": 2
}
```

Task Runner stores script stdout as the task run's `outputSnapshot.body`, so the
next run parses that JSON before reading `workflowEventCursor`. Only advance the
checkpoint after the selected events have been handed off successfully.

A task script must receive Site access through an approved service integration
or a Task Runner implementation that uses Task Runner's existing Site API
client. Do not copy the Site service token into task params, script content, or
an artifact.

This is intentionally a light first slice. If several consumers later require
server-managed checkpoints, add a generic event-consumer cursor rather than a
notification-specific outbox.

## Delivery ownership

The communication adapter should evolve into the common outbound and inbound
communications boundary. It should own transport capabilities, provider
delivery behavior, destination identity, and eventually inbound correlation.
If durable provider handoff, retries, or idempotency are required, add them at
that boundary so email, Discord, Telegram, and future transports share them.

Site remains responsible only for workflow facts and request data. Task Runner
is responsible for scheduling and applying instance policy.

### Current Task Runner delivery caveat

`outputConfig.outputDestinations` is convenient when a task produces one message
for fixed Discord or Telegram destinations. It is not yet a safe checkpoint
boundary for a workflow-event consumer: Task Runner records individual delivery
failures in the run output without failing the task run.

For the first notification processor, either:

- call the communication adapter from the processor, verify its response, and
  only then return the advanced cursor; or
- add deterministic Task Runner support that treats adapter handoff failure as a
  failed run and saves the cursor only after successful delivery.

Do not advance a workflow-event cursor merely because the task rendered output.

## Artifacts and local-first state

Request artifacts remain useful for reviewed message bodies or attachments.
Small processor checkpoints can be local-first files when the task has durable
storage. Neither needs a notification queue table in Site.

## Delivery guarantees

The first slice is cursor-based polling, so the processor must advance its
cursor carefully. A crash after delivery but before checkpoint persistence can
repeat a send. The eventual communication-adapter send contract should accept a
stable idempotency key, such as the workflow event id plus notification policy
key, to close that gap without moving a provider queue into Site.

Until that adapter contract exists, processors should prefer duplicate-safe
messages and stop at the first uncertain result. The design provides at-least-
once observation of workflow events, not exactly-once external delivery.

## Future communication adapter

The future adapter should accept a transport-neutral outbound envelope rather
than make Site or Task Runner speak provider APIs. A possible direction is:

```json
{
  "idempotencyKey": "workflow-event-id:policy-key",
  "channel": "email",
  "destination": { "type": "email-address", "id": "..." },
  "content": { "text": "...", "subject": "..." },
  "metadata": {
    "workflowEventId": "...",
    "requestId": "...",
    "policyKey": "requester-pr-created"
  }
}
```

These fields are a direction, not a frozen API. The adapter should eventually
own:

- idempotent acceptance and durable outbound status,
- transport/provider selection and credentials,
- retry and rate-limit behavior,
- destination normalization and provider message ids,
- delivery, bounce, and failure events,
- inbound message normalization and reply correlation,
- and links between inbound/outbound messages and Prism request context.

Notification-worthiness and requester policy remain outside the adapter. The
processor decides why and whom to notify; the adapter decides how communication
is delivered and correlated.

## Validation

The feed tests cover chronological paging, timestamp tie-breaking, event-type
filtering, payload mapping, and malformed cursor rejection. Site typecheck and
the production build must also pass.
