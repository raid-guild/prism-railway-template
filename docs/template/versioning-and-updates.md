# Template Versioning and Updates

The canonical Prism Railway Template is
`superprismio/prism-railway-template` on the `main` branch. Do not derive the
update source from a checkout's Git remote names because forks and older
upstream remotes may use different names.

## Version source

`services/site/prism-version.json` is the release-version source of truth. It
contains the stable semantic version, release channel, canonical repository,
and canonical branch. It lives inside Site's Railway service root so both
Railpack and local monorepo builds can bundle it. Update that file and
`CHANGELOG.md` when a merge establishes a new user-facing release boundary.

Package versions identify individual npm workspaces and do not determine
whether a template update is available.

## Update detection

Site caches successful server-side checks for six hours and retries failed
checks after 15 minutes. It compares the installed manifest with the canonical
manifest and, when build SHA metadata is available, compares the running commit
with canonical `main` through GitHub.

An update is available when either:

- the canonical semantic version is newer; or
- canonical `main` has changed files after the running build commit.

Merge-only commits whose resulting file tree has no changed files do not
produce an alert. A canonical-manifest failure leaves update state unknown; a
commit-comparison failure skips commit-level drift detection. Neither failure
affects health checks or other Site operations.

Railway GitHub-triggered deployments use Railway's provided
`RAILWAY_GIT_COMMIT_SHA` and `RAILWAY_GIT_BRANCH`. The local Compose launcher
stamps Site images with `PRISM_BUILD_SHA` and `PRISM_BUILD_BRANCH` during a
build. Deployments without build SHA metadata still receive semantic-version
checks, but cannot receive commit-level drift checks.

## Operator experience

- Admin users see a persistent banner when an update is available.
- **Settings > Status** displays the installed version, short build SHA,
  canonical source, and update state.
- `npm run local:up`, `npm run local:status`, and `npm run local:doctor` report
  available updates without modifying the checkout.
- Railway may also show its native template update notification.

Update checks never pull, merge, redeploy, or modify local files. Operators
should review the linked comparison and preserve local changes before applying
an update.
