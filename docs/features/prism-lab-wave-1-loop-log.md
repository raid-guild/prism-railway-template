# Prism Lab Wave 1 Loop Log

Short evidence log for the Slices 0–2 implementation gauntlet.

## Iteration 0 — Bootstrap

- Component: coordination and scope
- Evaluated: branch/worktree isolation and feature specification
- Largest gap: the implementation worktree did not contain the approved feature reference
- Fix: created the isolated worktree, brought over the feature document, and fixed Wave 1 scope to Slices 0–2
- Result: ready to establish component ownership and baseline checks
- Remaining risk: implementation and runtime baselines have not yet been measured

## Iteration 1 — Deterministic baseline

- Component: repository quality gates
- Evaluated: clean install, Site test suite, Site typecheck, and production build
- Largest gap: the isolated worktree had no installed dependencies or recorded baseline
- Fix: installed exactly from the lockfile with `npm ci` and ran the existing Site gates
- Result: 59 tests passed; typecheck passed; production build passed with 82 generated routes
- Remaining risk: Node 20 is below `@discordjs/voice`'s declared Node 22 engine and the existing dependency audit reports 19 vulnerabilities; neither was introduced by Lab

## Iteration 2 — Foundation builder wave

- Component: contracts/read models, Lab shell, and browser review/continue routes
- Evaluated: 11 contract tests, 5 route-helper tests, Site typecheck, production build, and scoped diff checks
- Largest gap: independent critics found the rollout flag defaulted on and remote split-service mode returned `501` for both live Lab routes
- Fix: returned each isolated defect to its original builder for a focused correction and route-boundary coverage
- Result: local canonical reads/actions, constrained normal continuation, shell/accessibility structure, and build are green; critic fixes are in progress
- Remaining risk: remote compatibility and fail-closed rollout must pass re-review before inbox/workspace integration

## Iteration 3 — Contract semantic correction

- Component: request phase and allowed-action read model
- Evaluated: independent comparison with canonical workflow entrypoint resolution
- Largest gap: a null projected step incorrectly selected the first declared step instead of the workflow entrypoint
- Fix: resolve current step, then configured entrypoint, then first step; added a non-first gate-entrypoint regression
- Result: 12 focused tests and typecheck pass; independent re-critic passed the component
- Remaining risk: none identified in the focused contracts/read-model component

## Iteration 4 — Fail-closed rollout correction

- Component: Lab shell and rollout controls
- Evaluated: absent/true/false flag cases, configuration references, standard Site suite, typecheck, build, and independent re-review
- Largest gap: an unset flag enabled the unfinished field-test route on every instance
- Fix: only explicit `PRISM_LAB_ENABLED=true` enables Lab; documented the default and registered focused tests in the standard suite
- Result: focused flag tests, 61-test suite at the time of correction, build, and scoped critic review pass
- Remaining risk: field-test operators must deliberately set the flag, as intended

## Iteration 5 — Split-service route compatibility

- Component: request review and normal workflow continuation routes
- Evaluated: local and remote contracts, authority fields, dependency failures, duplicate receipts, standard test registration, typecheck, and independent re-review
- Largest gap: supported non-local mode returned `501` instead of reaching canonical state
- Fix: composed review from evidenced admin endpoints and routed constrained continuation through the established response contract
- Result: 8 route tests, typecheck, diff check, and independent re-critic pass; the combined standard suite contains 69 passing tests
- Remaining risk: the legacy split API is contract-tested but unavailable locally for a live end-to-end probe

## Iteration 6 — Request inbox builder and active-run correction

- Component: live request inbox, URL filters, and request-number deep links
- Evaluated: canonical/auth paths, filters, attribution labels, indicators, responsive semantics, build, and independent critic
- Largest gap: workflow-run `running` was mislabeled as an active agent execution, including while paused at a human gate
- Fix: returned the read model to the contracts builder to consume actual queued/claimed/running agent-run records in local and split-service board data
- Result: inbox behavior otherwise passed; canonical active-run correction and regressions are in progress
- Remaining risk: no component pass until a gated workflow without an active agent run is verified as not running

## Iteration 7 — Canonical active agent runs

- Component: board read contract and inbox lifecycle projection
- Evaluated: local/remote active-run reads and gate-versus-agent execution regressions
- Largest gap: the inbox had no actual agent-run rows and conflated workflow activity with execution
- Fix: added request-linked queued/claimed/running agent runs to board data and derived Running/action locks only from those rows
- Result: 12 focused tests, 81-test Site suite, typecheck, build, and diff check pass; independent re-review is running
- Remaining risk: split-service active-run reads are contract-tested rather than exercised against a live legacy API

## Iteration 8 — Active-run capability hardening

- Component: active-run board projection
- Evaluated: independent capability and legacy-payload review after behavioral correction
- Largest gap: full agent-run input, result, trace, and session fields crossed the weaker request-view board boundary
- Fix: returned the board contract for a minimal server-derived request/status activity projection plus sensitive-key regression coverage
- Result: behavioral correction remains valid; security correction is in progress
- Remaining risk: component remains failed until the board payload is proven free of run contents and identifiers not needed by the inbox

## Iteration 9 — Minimal activity projection

- Component: active-run capability boundary
- Evaluated: local/remote serialization, sensitive-key regression, lifecycle behavior, full suite, build, and independent re-review
- Largest gap: privileged run contents crossed the general board response
- Fix: project only `{ id, requestId, status }`, allowlist active statuses, and drop unlinked rows before board serialization
- Result: 83-test Site suite, typecheck, build, diff check, and independent security re-critic pass
- Remaining risk: none identified in the active-run board projection

## Iteration 10 — Request workspace builder and Ask authority correction

- Component: chat-first request workspace
- Evaluated: conversation, status grounding, comments, continuation, uploads, state handling, polling, evidence drawer, and independent critic
- Largest gap: Ask Prism used the linked console-job path, which can execute the current workflow step or advance a gate
- Fix: returned Ask for a dedicated server-enforced, review-grounded utility runtime path that persists conversation without workflow mutations
- Result: workspace UI/build gates pass; Ask route implementation and zero-workflow-mutation regression are in progress
- Remaining risk: Ask must not call linked response/console paths or create workflow-step runs/events

## Iteration 11 — Runtime-enforced Ask authority

- Component: Site-to-Runtime utility invocation boundary
- Evaluated: real Codex Runtime launch authority, environment inheritance, Site service token injection, Gateway/tool access, and mocked Ask service test
- Largest gap: `readOnlyUtility` was prompt metadata while Codex still launched with sandbox bypass and mutation credentials
- Fix: assigned an explicit typed read-only utility authority mode through the normalized runtime contract, with credential stripping and non-write execution enforced by the bundled runtime
- Result: dedicated Ask route/session behavior passes; runtime boundary implementation and actual launch-contract tests are in progress
- Remaining risk: no Ask component pass until the child environment and command are proven unable to mutate Site or workspace state

## Iteration 12 — Restricted adapter capability negotiation

- Component: Runtime profile and live capability trust boundary
- Evaluated: external normalized adapters that accept but ignore `authorityMode`
- Largest gap: Site treated any normalized `2xx` as proof that read-only authority was enforced
- Fix: require the registered profile and live capabilities endpoint to advertise matching runtime identity, contract, and `read-only-utility-authority` before restricted submission; preserve the prior full-authority wire shape by omitting the new field outside restricted calls
- Result: unsupported adapters receive no job POST, restricted calls cannot fall back to legacy, bundled-profile upgrades are narrowly scoped, 88 Site tests and 13 Codex Runtime tests pass, both typechecks pass, and independent re-review passes
- Remaining risk: non-bundled runtime adapters must deliberately implement and advertise the authority contract before Lab Ask is available through them

## Iteration 13 — Request-switch isolation

- Component: live request workspace refresh and mutation state
- Evaluated: A→B and A→B→A navigation, overlapping polls/manual refreshes, abort/finally behavior, and mutation completion
- Largest gap: a late review response for request A could overwrite request B because one shared mounted flag became true again after navigation
- Fix: added request generations, latest-load sequencing, abort controllers, and mutation-scope guards with deterministic regressions
- Result: 3 coordinator regressions, the standard Site suite, typecheck, build, diff check, and independent re-review pass
- Remaining risk: the repository has no mounted React DOM harness, so the race is proven at the extracted coordinator plus code-integration boundary

## Iteration 14 — Narrow-screen request selection

- Component: inbox-to-workspace navigation
- Evaluated: mobile ordering, desktop master/detail order, filter-preserving deep links, fragment targeting, assistive DOM order, and focus stability
- Largest gap: selected request detail was buried after the complete inbox on narrow screens
- Fix: selected detail precedes results on mobile and in assistive DOM order, desktop restores list-left/detail-right, and request links target a stable focusable workspace fragment
- Result: focused link regression, typecheck, production build, and independent re-review pass
- Remaining risk: no browser screenshot regression suite is currently registered for the responsive layout

## Iteration 15 — Conversation viewport behavior

- Component: request-scoped conversation
- Evaluated: initial history, request switches, background polling, own Ask/context responses, older-message reading position, and focus behavior
- Largest gap: long threads opened at the oldest message and newly completed answers could remain off-screen
- Fix: added deterministic viewport decisions, near-bottom auto-reveal, reading-position preservation, and an accessible New messages control without focus theft
- Result: focused viewport regressions, 95-test Site suite, typecheck, and independent re-review pass
- Remaining risk: viewport policy is unit-tested through the pure decision helper because no mounted DOM harness exists

## Iteration 16 — Live inbox and artifact capability alignment

- Component: operational inbox freshness and request evidence
- Evaluated: canonical server refresh, URL/selection/client-state preservation, hidden-tab behavior, overlapping refreshes, artifact upload/read roles, and request/artifact association
- Largest gaps: list state remained a frozen server snapshot, and members could upload context but not reopen request artifacts
- Fix: added quiet visible-tab `router.refresh` plus a manual control; aligned artifact content reads and links to `canViewRequests` while leaving upload on `canComment`
- Result: refresh helper regressions, typecheck, diff check, and independent capability/refresh re-review pass
- Remaining risk: split-service artifact content retains the upstream admin contract and may return its explicit authorization response

## Iteration 17 — Request-scoped input isolation

- Component: request composer and upload selection
- Evaluated: A→B navigation versus same-request server refresh
- Largest gap: draft text and a selected file could survive a request switch and be sent to the wrong request
- Fix: reset draft and upload form only in the request-id effect; same-request inbox refresh preserves in-progress input
- Result: typecheck, diff check, independent re-review, and the combined Slices 0–2 rubric pass
- Remaining risk: none identified at the combined workspace acceptance boundary

## Iteration 18 — Fresh integration and rendered probes

- Component: combined Slices 0–2 branch
- Evaluated: full diff/interface consistency, Site and Codex Runtime suites/builds, fail-closed and authenticated HTTP behavior, mutation auth, and desktop/mobile rendered layouts in isolated state
- Largest gap: the workspace still treated `planned` records as active executions even though the canonical activity projection admits only queued, claimed, and running
- Fix: removed `planned` from request-workspace active execution semantics
- Result: 96 Site tests, 13 Codex Runtime tests, both typechecks/builds, 82-route Site production build, diff check, isolated HTTP probes, and authenticated Playwright inspection at 1440×1000 and 390×844 pass
- Remaining risks: split-service paths were contract-tested without a live legacy API; split-service Ask remains deliberately unavailable; non-bundled runtimes require explicit read-only authority support; populated real request detail was logic-tested but not browser-probed

## Iteration 19 — Direct Slice 3 provenance build

- Component: request-origin provenance and interaction-profile segmentation
- Evaluated: trusted session resolution, immutable snapshots, conservative legacy backfill, external-subject privacy, Lab facets, and Discord/Telegram profile parity with Buzz/external
- Fix: added nullable `request_origins`, accepted only source session/message references at request creation, resolved and snapshotted Site-owned metadata, exposed platform/target/profile/initiator filters and provenance labels, and applied referenced profile runtime/persona/memory/version behavior across communication adapters
- Result: focused provenance/privacy/filter/auth tests, the 102-test Site suite, the 24-test Source Adapter suite, both typechecks/builds, and a complete fresh 39-migration database run pass
- Remaining risk: deployed end-to-end validation still needs real Discord, Telegram, Buzz, and external-interface traffic; legacy split-service mode returns origin snapshots only when its upstream request-detail deployment includes Slice 3

## Iteration 20 — Direct Slice 4 operations observability build

- Component: unified request timeline, workflow explorer, and cross-request Activity/Needs Attention views
- Evaluated: deterministic same-timestamp ordering, bounded older-event disclosure, artifact-to-run provenance, workflow branch/loop rendering, attention precedence, capability-safe cross-request summaries, and live refresh behavior
- Fix: merged request messages/events/runs/artifacts/external refs into one chronological read model, added an event-linked workflow map, promoted Activity to a real Lab route, and kept raw traces in the existing collapsed technical evidence surface
- Result: focused timeline/workflow/activity regressions, the 106-test Site suite, Site typecheck, 83-route production build, and diff check pass
- Remaining risk: cross-request Activity intentionally uses the minimal canonical board projection rather than distributing privileged run/event payloads; deeper event-level global pagination can be added behind a dedicated capability-checked feed if field testing shows it is needed

## Iteration 21 — Direct Slice 5 console and focused-settings build

- Component: Lab Console, Capture context mode, console-to-request promotion, focused Settings, and capability-aware navigation
- Evaluated: durable session/job reuse, console/request conversation isolation, trusted provenance, bounded promotion fields, workflow/target validation, normal auto-start, credential-safe configuration links, and role capability visibility
- Fix: enabled Console and Settings routes, embedded existing Capture behavior as a console mode, added a capability-checked promotion boundary with a separate request session, and added allowlisted non-secret configuration planning prompts
- Result: focused promotion/configuration/session-isolation tests, the 110-test Site suite, Site typecheck, production build with Console/Settings/promotion routes, and diff check pass
- Remaining risk: split-service promotion depends on the upstream Slice 3 request-create contract honoring `sourceSessionId`; the local Site-owned path enforces and tests the complete provenance boundary

## Iteration 22 — Scoped Memory Explorer and agent conversations

- Component: workspace Memory navigation, Timeline, Knowledge search, Agent Profile Memory scopes, and read-only agent conversation handoff
- Evaluated: configuration/offline states, rolling-date aliases, evidence provenance, knowledge facets and audience policy, browser-reference distrust, immutable profile-version scope, member versus Admin Agent access, runtime mutation authority, durable session attribution, and Activity visibility
- Fix: added authenticated Site-owned Memory read contracts, Timeline and Knowledge UI, `canChatAgents`, fail-closed versioned Memory scopes, eligible-agent resolution across every selected record, and observable `prism-memory-explorer` sessions backed by the runtime-enforced `read_only_utility` mode
- Result: focused scope/reference/authorization tests, the 111-test Site suite, Site typecheck, a 92-page production build containing `/admin/lab/memory`, and diff check pass
- Remaining risk: the deployed Prism Memory instance must expose its existing rolling-memory and knowledge endpoints; a full relationship graph remains intentionally deferred until stable explicit edge provenance exists

## Iteration 23 — Workspace and agent identity polish

- Component: persistent Lab identity cues and Agent Profile visual differentiation
- Fix: surfaced the configured workspace avatar and label in the Lab header; added a versioned, allowlisted neon accent to Agent Profiles, deterministic fallbacks for existing agents, accessible theme-aware labels, and accent-aware avatars/navigation/profile headers
- Result: fresh 41-migration database pass, focused profile validation, the 111-test Site suite, typecheck, production build, and diff check pass
- Remaining risk: custom workspace logos still rely on the existing branding URL and upload/configuration path; this slice does not introduce another image store

## Iteration 24 — Historical rolling-memory index

- Component: Memory Timeline date discovery across Site and Prism Memory
- Largest gap: Site queried the Memory inbox artifact index, which does not enumerate `memory/rolling/*.json`, so only the separately loaded latest snapshot appeared
- Fix: added bounded authenticated `GET /memory/dates`, backed by canonical rolling files with section/entry/bucket counts; Site now consumes that index and exposes a rollout warning when an older Memory deployment lacks it
- Result: deterministic newest-first storage/index tests, focused Site parsing tests, full Site regression/build gates, and Python compile validation pass
- Deployment note: both Site and Prism Memory must use this branch for the historical timeline; the latest-only fallback remains honest during a staggered rollout

## Iteration 25 — Agent navigator working queue

- Component: high-level multi-agent queue awareness in the persistent Lab navigator
- Fix: added a minimal capability-checked queue projection keyed by Agent Profile and five-second visible-tab polling; queued work pulses, while claimed/running work spins in the agent's accent color
- Correctness boundary: only canonical `queued`, `claimed`, and `running` agent runs activate the label; open sessions and workflow projections do not create false working signals, and run inputs/results/traces never enter the feed
- Compatibility: unattributed legacy/system activity remains explicitly unknown rather than being silently assigned to an agent
