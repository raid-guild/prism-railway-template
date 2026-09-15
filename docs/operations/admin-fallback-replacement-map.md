# Admin Fallback Replacement Map

Recorded: 2026-09-01

Status: step-2 executor migration complete. The Participation batch was applied
to the live `prism-stack` instance on 2026-09-01. The Accounting, Knowledge
Steward, clear existing-profile, and explicit Platform Operations batches were
applied on 2026-09-03. The final mixed Brand, Sync, and Knowledge workflow batch
was applied on 2026-09-04.

This map is based on the live `prism-stack` accountability audit after the
step-1 domain and steward-category reorganization. The initial audit reported
172 Admin fallbacks across 56 definitions. After the completed migration, zero
implicit Admin fallbacks remain. The purpose of this pass was to replace genuine
fallbacks with explicit domain or specialist Agent Profiles, preserve deliberate
cross-domain execution, and make intentional Control Plane use of the Admin
Agent explicit.

Changing an executor does not transfer definition ownership. A workflow or task
continues to belong to its Accountability Domain even when a specialist profile
from another domain executes one of its steps.

## Summary

| Accountability domain | Initial fallbacks | Proposed default executor | Review state |
| --- | ---: | --- | --- |
| Accounting | 1 | `accounting-steward-agent` | Applied 2026-09-03; 0 remain |
| BizDev | 2 | `bizdev-agent` | Applied 2026-09-03; 0 remain |
| Brand & Communications | 105 | `brand-agent` | Applied 2026-09-04; 0 remain, including explicit Sync handoffs |
| Community Operations | 20 | `sync-steward-agent` | Applied 2026-09-03; 0 remain |
| Governance | 1 | `rip-steward` | Applied 2026-09-03; 0 remain, intentional cross-domain execution |
| Handbook & Knowledge | 22 | `knowledge-steward-agent` | Applied 2026-09-04; 0 remain, including explicit Brand handoffs |
| Participation | 10 | `participation-steward-agent` | Applied 2026-09-01; 0 remain |
| Platform Operations | 9 | Explicit `admin-agent` | Applied 2026-09-03; 0 implicit fallbacks remain |
| Software Delivery | 2 | `codegen-agent` | Applied 2026-09-03; 0 remain |

Veydrift Operations has no Admin fallbacks requiring replacement.

## Accounting

Applied on 2026-09-03: created workspace-owned
`accounting-steward-agent` and assigned it explicitly to:

- task `weekly-raidguild-accounting-sync`.

The profile is narrowly scoped to published accounting evidence collection,
reconciliation, discrepancy reporting, and durable provenance. It may use a
policy-authorized leased credential only for the fixed data-access fee defined
by the authoritative accounting sync skill. It cannot initiate discretionary
payments, transfer treasury assets, sign or broadcast treasury transactions, or
mutate accounting systems.

The task remains enabled on `15 9 * * 1` in `America/New_York`; its instructions,
output configuration, and `evm-wallet` Gateway lease are unchanged. The
post-migration accountability audit resolves it as `task-explicit`, reports no
cross-domain execution, and reports no remaining Accounting Admin fallbacks.

## BizDev

Applied on 2026-09-03: assigned `bizdev-agent` explicitly to:

- workflow `crm-document-ingest-enrich`, step `intake`;
- workflow `project-kpi-snapshot`, step `collect-snapshot`.

Other BizDev execution is already explicit.

## Brand & Communications

Applied on 2026-09-03: assigned `brand-agent` as the workflow default for all
falling-back agent steps in these unambiguous workflows:

- `blog-post-draft-review-publish`;
- `blog-post-steered-draft-review-publish`;
- `daily-memory-brief-review`;
- `fireside-blog-post-draft-publish`;
- `internal-daily-brief-podcast-publish`;
- `member-highlight-research-review-publish`;
- `member-newsletter-draft`;
- `portal-post-editorial-revision-publish`;
- `publish-queen-raida-article`;
- `queen-raida-portal-launch-campaign`;
- `queen-raida-x-follow-scout-review-follow`;
- `queen-raida-x-response-draft-review-publish`;
- `weekly-public-brief-podcast-publish`.

Assigned these launcher and reporting tasks explicitly to `brand-agent`:

- `blog-post-steered-one-off-request`;
- `blog-post-workflow-weekly-request`;
- `daily-raidguildish-x-activity-report`;
- `internal-daily-brief-podcast-request`;
- `queen-raida-daily-x-response-request`;
- `queen-raida-weekly-x-follow-scout-request`;
- `queen-raida-workday-discord-checkins`;
- `queen-raida-x-collection`;
- `raidguild-org-weekly-analytics-csv-reminder-2026-06-05`;
- `weekly-public-brief-podcast-request`;
- `weekly-raidguild-org-analytics-report`.

Applied on 2026-09-04: completed the mixed Brand workflow review with explicit
step executors:

| Workflow | Sync Steward steps | Brand Agent steps |
| --- | --- | --- |
| `content-distribution-bundle` | `prepare-and-audit` | `audit-and-plan`, `generate-bundle`, `validate-and-sync` |
| `field-notes-from-fireside` | `intake`, `source-pack`, `publish-session-artifacts` | `angle-plan`, `media-brief`, `bard-calendar-x-draft`, `spawn-content-requests` |
| `fireside-recap-video-publish` | `session-intake`, `publish-session-resources` | `recap-plan`, `tts-render`, `remotion-prep`, `video-render` |
| `plausible-analytics-report` | — | `query` |

These workflows remain owned by Brand & Communications. Sync Steward execution
is an intentional, auditable cross-domain handoff for source/session operations.

## Community Operations / Sync Steward

Applied on 2026-09-03: assigned `sync-steward-agent` as the workflow default for
all falling-back agent steps in:

- `meeting-transcript-memory-ingest`;
- `portal-session-description-loop`;
- `portal-session-recording-complete`;
- `weekly-portal-activity-snapshot`.

Assigned these tasks explicitly to `sync-steward-agent` where not already
correct:

- `daily-bard-calendar-discord-brief`;
- `raider-roundtable-agenda`.

Split `raidguild-recording-post-publish` explicitly:

| Step | Executor |
| --- | --- |
| `raidguild-portal-publish` | `sync-steward-agent` |
| `notify-discord` | `sync-steward-agent` |
| `propose-action-item-changes` | `action-items` |
| `emit-bd-signals` | `bizdev-agent` |

Assigned specialist profiles to these tasks:

- `weekly-action-items-discord-digest` -> `action-items`;
- `summer-brigade-weekly-growth-report` -> `summer-brigade-26`.

Summer Brigade remains categorized under Sync Steward while retaining its
specialized profile.

## Governance

Applied on 2026-09-03: assigned task `dao-proposal-watcher` explicitly to
`rip-steward`.

This is an intentional cross-domain executor reference. The RIP Steward profile
is categorized under Knowledge Steward while continuing to execute RIP lifecycle
work.

## Knowledge Steward

Applied on 2026-09-03: created workspace-owned `knowledge-steward-agent` in the
Handbook & Knowledge domain. The profile owns source-backed handbook, wiki, and
institutional knowledge maintenance while preserving review gates and durable
provenance. It inherits only `prism-api-reader`; research, Portal, publication,
and safety capabilities remain scoped by the workflows that require them.

The existing `external-chatbot` profile remains the bounded handbook-answering
interface and was not repurposed.

Assigned `knowledge-steward-agent` as the explicit workflow default for all
agent steps in:

- `fireside-wiki-topic-develop`;
- `wiki-article-generate`;
- `wiki-topic-expand`.

Assigned task `github-handbook-issue-intake` explicitly to
`knowledge-steward-agent`. Its disabled state and `0 7 * * 1` UTC schedule were
preserved.

The initial Knowledge batch accountability audit resolved 12 workflow steps as
`workflow-default` and the task as `task-explicit`, with no unassigned profiles,
workflows, or tasks.

Prism Doctor completed successfully after the batch. It identified pre-existing
follow-ups in these workflows: the referenced `rg-portal-ops` skill is missing,
some skills are overly broad at workflow scope, and `wiki-article-generate`
needs an explicit artifact/context boundary before its validation step. These
are workflow-health issues rather than ownership failures and were not changed
as part of this executor migration.

Applied on 2026-09-04: the reviewed split for
`lore-entry-draft-review-publish` is:

| Steps | Executor |
| --- | --- |
| `intake`, `arc-plan`, `draft`, `revise`, `publish-prep`, `publish` | `knowledge-steward-agent` |
| `media-plan`, `generate-images` | `brand-agent` |
| `seo-aeo-validation` | `brand-agent` |

The workflow remains owned by Handbook & Knowledge. Brand execution for media
and publication validation is an intentional, auditable cross-domain handoff.

## Participation Steward

Applied on 2026-09-01: created workspace-owned
`participation-steward-agent` and assigned it as the workflow default for every
agent step in:

- `monthly-share-distro-proposal`;
- `weekly-participation-admin-snapshot`.

Assigned these tasks explicitly to `participation-steward-agent`:

- `monthly-share-distro-proposal-request`;
- `weekly-participation-admin-snapshot`.

The human review gate before `submit-onchain` remains mandatory. Both schedules
remain disabled. The post-migration accountability audit reports all eight agent
steps as `workflow-default`, both tasks as `task-explicit`, and no remaining
Participation Admin fallbacks.

## Platform Operations

Applied on 2026-09-03: these intentional Control Plane operations now use an
explicit `admin-agent` workflow default for every agent step in:

- `workflow-repair-loop`.

Made `admin-agent` explicit for these tasks:

- `weekly-state-cleanup-review`;
- `workflow-repair-loop-every-30m`;
- `workflow-repair-loop-weekday-2h`;
- `workflow-repair-loop-weekend-daily`.

This removes fallback ambiguity without pretending Control Plane repair belongs
to a domain-specific operating profile. The accountability audit resolves the
five workflow steps as `workflow-default` and the four tasks as
`task-explicit`, with no cross-domain execution. Existing enabled states and
schedules were preserved, including the disabled 30-minute repair task.

## Software Delivery

Applied on 2026-09-03: assigned `codegen-agent` explicitly to:

- workflow `change-request-default`, step `triage`;
- workflow `existing-pr-review`, step `implement`.

The remaining change-request steps already explicitly use Codegen, Verification,
and Code Review built-in profiles.

## Application Order

1. Completed 2026-09-01: create and verify `participation-steward-agent`, then
   migrate Participation.
2. Completed 2026-09-03: create and verify `accounting-steward-agent`, then
   migrate the accounting sync task.
3. Completed 2026-09-03: create and verify the narrowly scoped Knowledge
   Steward profile, migrate the three unambiguous wiki workflows and disabled
   handbook intake task, and defer the mixed lore workflow.
4. Completed 2026-09-03: apply clear existing-profile replacements for BizDev,
   Community Operations, Governance, Software Delivery, and unambiguous Brand
   definitions. This removed 111 Admin fallbacks; 36 remain.
5. Completed 2026-09-03: convert intended Platform Operations use to explicit
   `admin-agent`, removing nine implicit fallbacks without changing execution.
6. Completed 2026-09-04: reviewed the mixed Brand/Sync/Knowledge workflows step
   by step and applied 27 explicit executor assignments.
7. Run the accountability audit and Prism Doctor after each batch.
8. Preserve completed run history; apply executor changes only to new definition
   versions and future runs.

The final accountability audit reports zero unassigned profiles, workflows, or
tasks and zero implicit Admin fallbacks. All intentional cross-domain execution
is now explicit at the workflow-step level.

Prism Doctor completed successfully on 2026-09-04 and refreshed existing repair
request #2028 without creating a duplicate. Its unchanged 26 failures and 62
warnings are pre-existing workflow/skill health findings, not
executor-resolution regressions from this migration.

## Migration Checks

For each batch:

- preview profile and definition changes before confirmation;
- keep schedules disabled unless enablement is separately approved;
- preserve gates and approval requirements;
- read back the updated profile, workflow, task, and domain assignment;
- verify effective executor resolution for every runnable agent step;
- report remaining Admin fallbacks and unresolved executors;
- do not rewrite historical run attribution.
