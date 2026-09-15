# Admin UI Feedback Checklist

Triage date: 2026-05-18

## Validated Items

- [x] Add URL routing/deep links for admin tabs and selected requests.
  - Implemented query-state links for admin tab and selected request.
  - Current shape: `/admin?tab=requests&request=12`, `/admin?tab=tasks`.

- [x] Default the request list to open requests.
  - `lifecycleFilter` now defaults to `"open"` and closed remains available through the filter.

- [x] Add multi-select workflow step filtering to the request list.
  - Added a workflow step popover filter sourced from current request step keys.

- [x] Show running status on request list cards.
  - Request rows show a running badge when `workflowRunStatus === "running"`.

- [x] Improve global working status indicator.
  - Added a tab-header level "Prism is working" indicator when requests are running.
  - Request detail already has a pulse/spinner in the workflow subway map during active agent runs.
  - Reference implementation is available at `../reference-implementation-demos`.
  - Reuse or adapt `components/ui/prism-loader.tsx` for a Prism-branded working indicator, and consider `components/ui/thinking-loader.tsx` for compact text-only states.

- [x] Simplify Prism Console controls.
  - Removed Reader/Writer/Ops skill chips and the optional-skill helper text.

- [x] Disable or visually blur console input while waiting.
  - Console textarea is disabled while `isPending`; focus behavior remains after completion.

- [x] Request thread should scroll/focus to latest comments.
  - Request detail comments scroll to the newest thread message when messages load or update.

- [x] Add a stop button for active request workflow runs.
  - Implemented as a cancel model, not a process kill.
  - The active agent run is marked `canceled`, the workflow moves to a terminal step, and late runtime completion/failure updates for that run are ignored.
  - Canceled runs get destructive/red visual treatment in request rows and the workflow subway map.

- [x] Fix Skills view dialog overflow.
  - Skill preview dialog is constrained to viewport width with a scrollable content area.

- [x] Improve Workflows list layout for long workflows.
  - Workflow cards now show all steps in a wrapping compact rail instead of truncating to `+N more steps`.

## Needs Runtime Verification

- [ ] Last review gate not moving to closed.
  - Code has gate route support and default workflow routes `approved -> closed`, but this may depend on a specific custom workflow manifest.
  - Verify against the affected workflow/request and inspect `/agent/change-board/requests/by-number/:number/review`.

- [ ] Missing PR/branch links in request detail.
  - This mainly applies to the built-in change request workflow.
  - Detail log can show branch URLs, compare/PR links, and deploy URLs from agent-run results, and linked records/external refs may now cover some of this.
  - If missing, verify whether the built-in workflow is writing linked issue/PR records and whether request detail surfaces them clearly, not just agent-run compare links.
  - Verify with a request that should have a branch/PR and inspect agent runs/external refs.

## Suggested Work Order

- [x] Quick UI cleanup pass:
  - default request filter to open
  - remove console skill chips/help text
  - disable console input while pending
  - fix skills dialog overflow

- [x] Request navigation/filter pass:
  - URL state for tabs/request selection
  - request list multi-step filter
  - request thread auto-scroll

- [x] Workflow visibility pass:
  - workflow list all-step layout
  - request list running indicator
  - shared working loader/status cue

- [x] Runtime-control pass:
  - design stop/cancel semantics
  - add stop endpoint and UI
  - verify gate close and PR/branch link issues against live request data
