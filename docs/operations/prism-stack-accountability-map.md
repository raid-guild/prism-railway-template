# prism-stack Accountability Map

Recorded: 2026-09-01

Status: applied to the live `prism-stack` instance.

This map is accountability metadata only. It does not grant permissions,
change Agent Profile authority, expose credentials, alter workflow routing, or
select executors. `dekan` is the provisional human steward for every domain
until the corresponding RaidGuild delegated role wearers are mapped.

The Lab UI presents the delegated steward mandate as the category heading and
the functional accountability domain as its subtitle. Domains without a
current delegated RaidGuild role retain a provisional functional heading.

The protected `prism-builtins` bootstrap domain remains present but has no
assignments. Built-in/custom is definition origin, not operational ownership.

## Assignment Summary

| Domain | Profiles | Workflows | Tasks |
| --- | ---: | ---: | ---: |
| Platform Operations | 3 | 3 | 12 |
| Software Delivery | 1 | 2 | 0 |
| Quality | 2 | 0 | 0 |
| Community Operations | 2 | 6 | 4 |
| Brand & Communications | 1 | 17 | 11 |
| Handbook & Knowledge | 1 | 4 | 1 |
| BizDev | 1 | 3 | 1 |
| Governance | 1 | 0 | 1 |
| Participation | 0 | 2 | 2 |
| Accounting | 0 | 0 | 1 |
| Veydrift Operations | 1 | 1 | 2 |
| Summer Brigade | 1 | 0 | 1 |

## Steward Category Labels

| Steward category | Accountability domain |
| --- | --- |
| Infrastructure Maestro | Platform Operations |
| Software Delivery | Software Delivery |
| Quality Assurance Delegates | Quality |
| Sync Steward | Community Operations |
| Brand Steward | Brand & Communications |
| Handbook Steward | Handbook & Knowledge |
| BizDev | BizDev |
| RIP Steward | Governance |
| Participation Steward | Participation |
| Angry Dwarf | Accounting |
| Veydrift Operations | Veydrift Operations |
| Summer Brigade | Summer Brigade |

## Profile Assignments

- Platform Operations: `admin-agent`, `buzz-prism-ops`,
  `buzz-prism-run-approved`.
- Software Delivery: `codegen-agent`.
- Quality: `code-review-agent`, `verification-agent`.
- Community Operations: `action-items`, `sync-steward-agent`.
- Brand & Communications: `brand-agent`.
- Handbook & Knowledge: `external-chatbot`.
- BizDev: `bizdev-agent`.
- Governance: `rip-steward`.
- Veydrift Operations: `veydrift-agent`.
- Summer Brigade: `summer-brigade-26`.

The two legacy Buzz profiles remain assigned to Platform Operations until a
separate, execution-aware archive operation removes them.

## Workflow Assignments

- Platform Operations: `platform-ops-followup`, `temp-probe`,
  `workflow-repair-loop`.
- Software Delivery: `change-request-default`, `existing-pr-review`.
- Community Operations: `meeting-transcript-memory-ingest`,
  `portal-session-description-loop`, `portal-session-recording-complete`,
  `raidguild-recording-post-publish`,
  `recording-transcript-review-publish`, `weekly-portal-activity-snapshot`.
- Brand & Communications: `blog-post-draft-review-publish`,
  `blog-post-steered-draft-review-publish`, `content-distribution-bundle`,
  `daily-memory-brief-review`, `field-notes-from-fireside`,
  `fireside-blog-post-draft-publish`, `fireside-recap-video-publish`,
  `internal-daily-brief-podcast-publish`,
  `member-highlight-research-review-publish`, `member-newsletter-draft`,
  `plausible-analytics-report`, `portal-post-editorial-revision-publish`,
  `publish-queen-raida-article`, `queen-raida-portal-launch-campaign`,
  `queen-raida-x-follow-scout-review-follow`,
  `queen-raida-x-response-draft-review-publish`,
  `weekly-public-brief-podcast-publish`.
- Handbook & Knowledge: `fireside-wiki-topic-develop`,
  `lore-entry-draft-review-publish`, `wiki-article-generate`,
  `wiki-topic-expand`.
- BizDev: `crm-document-ingest-enrich`, `project-kpi-snapshot`,
  `raidguild-crm-change-review-apply`.
- Participation: `monthly-share-distro-proposal`,
  `weekly-participation-admin-snapshot`.
- Veydrift Operations: `veydrift-bounded-autopilot`.

Quality and Summer Brigade currently own no workflow definitions. Quality
profiles participate across Software Delivery workflows without transferring
workflow ownership.

## Task Assignments

- Platform Operations: `buzz-message-collection`, `discord-sync`,
  `knowledge-run`, `knowledge-source-sync`, `memory-run`,
  `portal-notification-email-dispatch`, `prism-doctor`, `skill-source-sync`,
  `weekly-state-cleanup-review`, `workflow-repair-loop-every-30m`,
  `workflow-repair-loop-weekday-2h`,
  `workflow-repair-loop-weekend-daily`.
- Community Operations: `bard-calendar-due-approval-check`,
  `daily-bard-calendar-discord-brief`, `raider-roundtable-agenda`,
  `weekly-action-items-discord-digest`.
- Brand & Communications: `blog-post-steered-one-off-request`,
  `blog-post-workflow-weekly-request`,
  `daily-raidguildish-x-activity-report`,
  `internal-daily-brief-podcast-request`,
  `queen-raida-daily-x-response-request`,
  `queen-raida-weekly-x-follow-scout-request`,
  `queen-raida-workday-discord-checkins`, `queen-raida-x-collection`,
  `raidguild-org-weekly-analytics-csv-reminder-2026-06-05`,
  `weekly-public-brief-podcast-request`,
  `weekly-raidguild-org-analytics-report`.
- Handbook & Knowledge: `github-handbook-issue-intake`.
- BizDev: `raidguild-bizdev-daily-review`.
- Governance: `dao-proposal-watcher`.
- Participation: `monthly-share-distro-proposal-request`,
  `weekly-participation-admin-snapshot`.
- Accounting: `weekly-raidguild-accounting-sync`.
- Veydrift Operations: `daily-veydrift-roster-update-for-mediator`,
  `veydrift-bounded-autopilot-30m`.
- Summer Brigade: `summer-brigade-weekly-growth-report`.

Software Delivery and Quality currently own no direct task definitions.

## Follow-up

1. Replace provisional stewardship with the appropriate delegated RaidGuild
   role wearers and governance references.
2. Archive the two legacy Buzz profiles after confirming no active bindings or
   scheduled work still resolves to them.
3. Review genuine `admin-fallback` findings and assign explicit executors
   without changing domain ownership.
4. Preserve historical unknown attribution; do not rewrite old runs.
