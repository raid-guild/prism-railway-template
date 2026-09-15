---
name: prism-scheduled-task-runner
description: Use this skill when Codex is executing a stored scheduled Prism task prompt through task-runner.
---

You are running as a scheduled task. Execute the stored prompt directly and return a concise run summary.

Scheduled execution rules:

1. Do not ask follow-up questions.
2. If required config is missing, fail clearly and list the missing keys or services.
3. Prefer existing Prism APIs and repo scripts over inventing new behavior.
4. Keep side effects limited to what the prompt explicitly requests.
5. Do not create long-lived background processes.
6. Do not store new executable code in the task row or database.
7. If you need repeatable helper code, create or reference a reviewed script outside the task row.
8. Summarize actions taken, outputs written/sent, and any failures.
9. If `metadata.outputConfig.outputDestinations` is present, return the exact content that should be delivered. The task-runner handles adapter delivery after Codex returns.
10. Do not attempt to post to Discord or another adapter yourself unless the prompt explicitly asks you to bypass configured task output delivery.

Useful environment variables may include:

- `PRISM_API_BASE`
- `PRISM_API_KEY`
- `PRISM_API_READ_KEY`
- `PRISM_AGENT_API_BASE_URL`
- `PRISM_AGENT_SERVICE_TOKEN`
- `APP_API_BASE_URL`
- `APP_API_SERVICE_TOKEN`
- `PORTAL_TASK_SECRET`
- `COMMUNICATION_ADAPTER_BASE_URL`
- `COMMUNICATION_ADAPTER_TOKEN`

In deployed Prism instances, Codex Runtime usually receives `APP_API_BASE_URL` and `APP_API_SERVICE_TOKEN`, then exposes them to Codex as `PRISM_AGENT_API_BASE_URL` and `PRISM_AGENT_SERVICE_TOKEN`. If the `PRISM_*` names are missing, check the `APP_*` names before concluding the site API is unavailable.

Portal email queue dispatch should use a deterministic `http-post` task with
key `portal-notification-email-dispatch`. Do not create a recurring
`codex-prompt` task for five-minute email dispatch.

If the stored task has `metadata.outputConfig.outputDestinations`, do not call the adapter directly. Return the final message body and let task-runner deliver it.

If the prompt explicitly asks you to send a one-off message through Discord now, first resolve the channel from the adapter:

```bash
curl -fsSL \
  -H "X-Adapter-Token: $COMMUNICATION_ADAPTER_TOKEN" \
  "$COMMUNICATION_ADAPTER_BASE_URL/destinations"
```

Then send to the resolved destination id:

```bash
curl -fsSL \
  -X POST \
  -H "content-type: application/json" \
  -H "X-Adapter-Token: $COMMUNICATION_ADAPTER_TOKEN" \
  "$COMMUNICATION_ADAPTER_BASE_URL/messages" \
  -d '{"destinationId":"<channel-id>","content":"Test message"}'
```

If `COMMUNICATION_ADAPTER_TOKEN` is missing, report that direct adapter delivery is not wired into Codex Runtime. Do not use `APP_API_SERVICE_TOKEN` or `PRISM_AGENT_SERVICE_TOKEN` against adapter `/messages`.

For Prism Memory reads, use:

```bash
curl -fsSL \
  -H "X-Prism-Api-Key: ${PRISM_API_READ_KEY:-$PRISM_API_KEY}" \
  "$PRISM_API_BASE/memory/latest"
```

For Prism Knowledge search, use:

```bash
curl -fsSL \
  -H "X-Prism-Api-Key: ${PRISM_API_READ_KEY:-$PRISM_API_KEY}" \
  "$PRISM_API_BASE/knowledge/search?q=QUERY"
```

Return only the scheduled task result summary.
