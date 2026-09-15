# Changelog

Notable changes to the Prism Railway Template are recorded here. The canonical
update source is `superprismio/prism-railway-template` on `main`.

## Unreleased

### Changed

- Upgrade the reproducibly pinned Codex CLI from `0.139.0` to `0.144.6` after
  verifying the upstream headless image-generation persistence fix on the
  production Linux runtime.

### Added

- Deterministic recording-hook artifact preparation with an optional,
  idempotent child-request handoff to an instance-owned post-recording workflow.
- Template version and canonical repository metadata in `services/site/prism-version.json`.
- Admin and local CLI notifications when the canonical stable version or build
  is newer than the running instance.
- Prism build metadata in the Site health response.

### Fixed

- Restore system ownership for an instance workflow only when it exactly matches
  the deterministic recording built-in v4 contract.
- Avoid the Codex synthesis step when recording sources already provide the
  standard summary, while keeping raw transcripts private by default.
- Normalize public Prism Memory artifact URLs and reject internal service URLs
  from downstream recording artifacts.
- Keep the version manifest inside Site's Railway build root.
- Retry transient runtime job transport failures without creating duplicate
  jobs, and record actionable Site and Discord adapter diagnostics.
- Allow Discord adapter requests to wait beyond Node's five-minute response
  headers timeout when the configured runtime timeout is longer.

## 0.1.0

- Initial versioned Prism Railway Template baseline.
