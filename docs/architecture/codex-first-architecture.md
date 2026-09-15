# Codex-First Architecture

This document describes the Codex-first operating model.

## Goal

Make Codex the primary operator for:

- checking and triaging change requests
- running repo-local skills
- editing target apps
- publishing review branches and reporting preview environments
- posting updates back to Discord

Make GitHub the canonical source of truth for:

- long-lived CR branches
- pull request review and merge state
- production `main`
- developer pull-down and local review

## Target Shape

Primary runtime:

- Codex CLI
- local Codex skills
- shell scripts for deploy, bootstrap, and target operations

Persistent services:

- app surface for change-board UI and internal APIs
- `prism-memory`
- `source-adapter` for Discord ingestion into memory
- `discord-adapter` for Discord sync plus live chat transport
- `codex-runtime` as the shared Codex CLI runtime
- trigger/cron services

Operator interfaces:

- Codex CLI for deep execution and repo work
- a minimal admin Codex console inside the app for lightweight chat, request triage, status, and run control
- Discord for lightweight chat, retrieval, trigger, and notification flows

## Recommended Service Direction

Near-term:

- keep `services/api`
- keep `services/site`
- keep `services/prism-memory`
- keep `services/source-adapter`
- add `services/codex-runtime`
- keep `services/prism-trigger`
- keep `services/site` and `services/api` split for one more iteration
- add the first admin Codex console to `services/site`, backed by `services/api`

After the Codex bridge works:

- decide whether to flatten `services/site` and `services/api` into one Next.js app

Why the split stays for now:

- `discord-adapter` and `codex-runtime` are a fresh bridge/runtime rollout and should not be coupled to an app merge
- `api` already owns the system-of-record schema and agent-run records
- `site` already owns the current admin surface
- merging now adds migration risk without improving operator validation

## Discord Bridge

The Discord bridge should:

1. Receive direct mentions, thread replies, and selected slash commands.
2. Use Prism Memory retrieval skills and APIs to answer conversational questions.
3. Fetch or create change-request work items from the app API when a structured operator action is needed.
4. Trigger approved backend workflows or app API actions without executing arbitrary workspace operations locally.
5. Send chat replies, summaries, failures, and status updates back to Discord.
6. Create or reuse a Discord thread when possible so the conversation stays scoped and readable.
7. Create or reuse an app-side chat session keyed to the Discord conversation so agent history is preserved across turns.

Implementation direction:

- consolidate Discord-facing code onto TypeScript/`discord.js` so chat, slash commands, meeting flows, and future voice features live behind one Discord control plane instead of splitting Discord concerns across Python and TypeScript

Boundary:

- `discord-adapter` is a transport bridge for chat, sync, commands, and notifications
- `codex-runtime` is the shared execution engine
- it should not become the system of record for requests, runs, targets, or deploy state
- it should not be a general workspace execution agent
- durable state belongs in the app API and database
- conversational retrieval should prefer Prism Memory APIs and local retrieval-oriented skills

Current execution policy:

- allow Prism Memory API access and retrieval-oriented skills
- allow app API reads and approved action-trigger calls
- keep Discord transport and Codex runtime split so other adapters can reuse the same engine
- reserve deep repo execution for Codex CLI and explicitly approved operator paths

Conversation state policy:

- when a new Discord interaction starts in a normal channel, create a dedicated thread when permissions and channel type allow it
- when already inside a thread, continue in that thread instead of branching the conversation
- create or resume an app/API chat session linked to the Discord channel/thread id
- persist enough history to support follow-up retrieval and response continuity
- use the Discord thread as the user-visible conversation container and the app-side chat session as the durable agent session record

Recommended first-pass commands:

- mention reply
- thread reply
- `/ask-prism <question>`
- `/next-request`
- `/run-request <id>`
- `/request-status <id>`
- `/deploy-status <target>`
- `/codex-health`

## Codex Skills

Initial Codex-owned skill set:

- `change-request-runner`
- `target-deploy-ops`
- `railway-ops`
- `discord-ops`
- `prism-memory-ops`

Bridge-usable subset:

- retrieval-oriented Prism Memory skills
- Discord formatting/posting helpers
- safe app API reader/writer helpers

Bridge-excluded subset:

- any skill that assumes unrestricted local workspace execution
- deep target-repo editing or deploy logic inside the Discord service itself

These should be implemented as Codex-local skills or app API helpers.

## App Surface

The app surface should remain the system of record for:

- target apps
- target environments
- change requests
- agent-run history
- deploy artifacts
- review state

The app surface should not become the canonical source of truth for git history.

Git-aware records should instead track:

- CR branch name
- remote branch name
- pull request URL and number
- base commit SHA
- head commit SHA
- preview deploy metadata
- lightweight agent-run and deploy references

If `site` and `api` are merged, the resulting Next.js app should own both admin UI and internal route handlers for Codex and Discord bridge actions.

Current decision:

- keep `api` as the write authority for change requests, agent-run records, targets, and deploy metadata
- keep `site` as the admin and operator UI shell
- let both Discord and browser-triggered operator actions resolve through `api`
- store bridge chat sessions and thread linkage in `api`, not in the Discord transport service

## Admin Codex Console

The app should expose a minimal Codex console for trusted admins.

First-pass goals:

- show recent Codex runs and statuses
- submit lightweight prompts to constrained backend workflows
- trigger common actions such as:
  - next request
  - run request
  - request workflow step
  - summarize target
  - deploy staging
- stream or poll agent-run output
- attach runs to change requests and target environments

Non-goals for first pass:

- recreating a full chat product
- unrestricted shell access from the browser
- replacing the Codex CLI for deep debugging

Placement decision:

- build the first console inside `services/site`
- expose backend run-control endpoints from `services/api`
- let `discord-adapter` and the browser share agent-run records where possible
- let `discord-adapter` and the browser share retrieval and chat-oriented backend contracts where possible
- use one backend chat-session model for both Discord conversations and future admin console chat

## Deployment Model

The repo should support scripted bring-up for:

- app surface
- `prism-memory`
- `source-adapter`
- `codex-runtime`
- `discord-adapter`
- trigger/cron services

Deployment decisions now locked:

- `discord-adapter` and `codex-runtime` are part of the default supported Railway stack
- cron services remain separate from the app and bridge
- `prism-memory` and `discord-adapter` remain separate stateful services

## GitHub and Preview Flow

Change requests should move to a GitHub-first branch model.

Working rules:

1. A new CR starts from the latest `origin/main`.
2. Codex creates one stable branch per CR, for example `codex/cr-123-short-slug`.
3. Existing CRs resume from their own branch first.
4. Existing CRs should fetch and fast-forward their own branch before continuing work.
5. Existing CRs should not automatically merge or rebase `main` during normal resume flow.
6. Humans may update the CR branch outside the board, so Codex should preserve that branch as the working line of history.
7. Production remains driven by merged `main`, not by the board database.

Review and preview model:

1. GitHub becomes the source of truth for code review artifacts such as commits, diffs, branches, and pull requests.
2. The board should focus on workflow state, execution summaries, failure details, preview deploy status, and links out to GitHub and Railway.
3. Preview should use Railway PR environments so each pull request can get its own temporary preview environment.

Railway environment direction:

- Railway supports persistent environments and PR environments.
- PR environments are created when a pull request is opened and removed when it is closed or merged.
- This makes PR environments the natural preview primitive once CR branches are published as pull requests.

Current preview decision:

- use GitHub pull requests and Railway PR environments as the primary preview path
- do not include a separate preview service in the template

## Next Phase

After branch publishing, pull request metadata, and preview flow are stable, the next integration phase should bring GitHub collaboration objects into the orchestration layer.

Future direction:

1. GitHub Issues can be imported into or linked with board change requests as an intake source.
2. A review-ready CR can publish a branch and open a draft PR.
3. Railway PR environments can provide temporary preview URLs for those PRs.
4. GitHub PR review state, comments, and requested changes can sync back into the board.
5. Requested changes should move the CR back into triage or active work on the same CR branch, not create a new branch.
6. The board should remain the orchestration layer while GitHub becomes the canonical developer review surface.

## Migration Order

1. Define the Discord transport to `codex-runtime` contract.
2. Move agent-facing skills into Codex-local skills or app API helpers.
3. Make change-request agent runs work from Codex CLI.
4. Add branch-per-CR workflow and persist git-aware agent-run metadata plus artifacts.
5. Publish CR branches to GitHub and track PR metadata from the board.
6. Enable Railway PR environments for published CR pull requests.
7. Add Discord notifications and command routing.
8. Add the minimal admin Codex console to `site`, backed by `api`.
9. Revisit whether `site` and `api` should be merged only after the bridge, console, and GitHub-aware CR flow are all working.
