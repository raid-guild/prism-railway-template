# Discord Access Policy Checklist

Triage date: 2026-05-18

## Problem

Discord gives Prism a broad community-facing input surface. The current bridge accepts mentions and slash commands, forwards prompts to Codex Runtime, and posts the model response back to Discord. That is useful, but it needs explicit access policy before Discord becomes a safe workflow control surface.

## Current Shape

- `services/source-adapter` is the Discord-facing service.
- Discord mentions and slash commands call `runDiscordPrompt`.
- The adapter stores Discord session/message history through site `/agent/agent-sessions/*`.
- The adapter calls `codex-runtime /v1/responses` directly.
- The adapter sends replies back to the originating Discord channel/thread.
- Adapter output routes `/destinations`, `/messages`, and `/sync` are protected by `SOURCE_ADAPTER_TOKEN`.

## First Slice

- [x] Add a shared public-output sanitizer utility.
  - Redact internal Railway/private service URLs.
  - Redact obvious token, API key, private key, and bearer-secret patterns.
  - Redact local filesystem paths when they appear in public-facing output.
  - Keep the original text available in internal logs/artifacts; sanitize only before public delivery.

- [x] Use the sanitizer in Discord replies.
  - Apply before `sendAssistantMessage`.
  - Preserve useful error shape while hiding internal hostnames and secrets.

- [x] Add Discord bridge policy modes.
  - `off`: ignore non-admin Discord prompts.
  - `readonly`: answer/read context only.
  - `run-approved`: run existing tasks/workflows but do not author new skills/tasks/workflows.
  - `full`: current behavior, intended only for trusted channels/roles.

- [x] Add site-owned platform policy config.
  - Persist policy under the site service data root.
  - Expose `/admin/source-adapter-policy` for the browser settings UI.
  - Expose `/agent/source-adapter-policy` for source-adapter and runtime callers.
  - Keep `DISCORD_ACCESS_POLICY_JSON` as an emergency/bootstrap fallback only.
  - Use generic `targets`, `groups`, and `users` instead of Discord-only `channels` and `roles`.

- [x] Add admin UI for policy edits.
  - Configure default mode and rate limits without env changes.
  - Configure target/group/user JSON maps for instance-specific IDs.

- [x] Add user/role policy hooks.
  - Capture Discord user id and member role ids in runtime metadata.
  - Do not require a full role UI in the first slice.
  - Leave clear extension points for mapping role ids to Prism capabilities.

- [x] Pass resolved Discord policy into runtime metadata.
  - Include `mode`, `capabilities`, `guildId`, `channelId`, `threadId`, `authorId`.
  - Make the policy visible to Codex Runtime and Prism skills.

- [x] Add rate limits for Discord prompts.
  - Per user id.
  - Per channel/thread.
  - Separate readonly chat from workflow/task execution.
  - First slice can be in-memory; durable limits can come later.

## Runtime/Agent Follow-Up

- [ ] Teach Codex Runtime and hosted skills to respect Discord policy metadata.
  - Readonly should avoid writer endpoints.
  - Run-approved should only invoke pre-existing tasks/workflows.
  - Authoring skills should refuse Discord-origin requests unless policy allows.

- [ ] Consider routing high-risk Discord requests into Prism requests.
  - Example: “publish this”, “create a workflow”, “send an announcement”.
  - The agent can create a request with a human gate instead of executing directly.

- [ ] Add audit events for Discord-triggered actions.
  - Record Discord user/channel/thread/message ids.
  - Record resolved mode/capabilities.
  - Record task/workflow/request ids touched.
  - Record outbound Discord message ids.

## Later Social/X Direction

- [ ] Treat X/Twitter as a collector plus moderated workflow first, not as a source adapter.
  - Poll mentions/replies/search/follows with checkpoint state.
  - Create Prism requests for items that need response.
  - Use a human review gate before any outbound post.

- [ ] Add an X publishing skill only behind workflow approval.
  - The agent drafts response options.
  - A human approves or edits.
  - The publisher posts through the X API and attaches the resulting tweet/post as an external ref.

- [ ] Generalize social output adapters later.
  - Discord, Slack, Telegram, X, Ghost, and other publishing targets should share the sanitizer and audit model.
  - Avoid turning each platform into a one-off full agent surface.
