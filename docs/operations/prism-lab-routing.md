# Lab entry routing and legacy compatibility

Lab is the default workspace:

- Missing, empty, or `true` `PRISM_LAB_ENABLED` enables Lab and redirects
  authenticated **bare** `/admin` to `/admin/lab`.
- Only `PRISM_LAB_ENABLED=false` (case-insensitive, whitespace trimmed) opts out:
  bare `/admin` renders legacy and direct Lab routes show the disabled surface.
  This does not change data, API routes, jobs, or permissions.
- `PRISM_LAB_DEFAULT` is retired and ignored. Existing installations with
  `PRISM_LAB_ENABLED=false` stay opted out; remove it or set true to use Lab.

Authentication is checked before promotion. Any query string stays on the
legacy page, preserving form errors, success messages, credential setup URLs,
request selectors, and settings tabs. No permanent/cacheable redirect is used.
`/admin?legacy=true` is the explicit escape hatch. Legacy pages have a return
link to Lab when enabled. Existing login/logout endpoints are unchanged.

## Link inventory and disposition

| Surface | Destination | Treatment |
| --- | --- | --- |
| Bare authenticated entry | `/admin` | Lab by default; explicit false opts out |
| Lab sidebar legacy escape | `/admin?legacy=true` | Always render legacy, no loop |
| Gateway credential setup links | `/admin?tab=settings&settings=gateway&connection=...&action=credential&secretName=...` | Keep secure legacy forms and parameters unchanged |
| Interfaces / runtime adapters | `/admin?tab=settings&settings=interfaces` / `runtimes` | Keep legacy forms, label them explicitly in Lab |
| Agent source access | `/admin/lab/agents` | Direct Lab link; no longer send users to legacy source policy configuration |
| Branding, members, targets, environments, dispatch, diagnostics | `/admin?tab=settings&settings=status` and existing section links | Keep legacy settings until parity exists |
| Target/environment POST form redirects | `/admin?tab=settings...` | Preserve errors and completion feedback |
| Request POST form redirects | `/admin` or `/admin?error=...` | Bare success follows rollout; explicit errors stay legacy |
| Admin Console | `/admin/lab/agents/admin-agent` | Direct destination; remove misleading unused `focus` query from settings links |
| Old `/admin/lab/console` bookmarks | existing console redirect | Keep compatibility alias |
| `/admin/*` API/form endpoints | existing handlers | Unchanged; never blanket-redirect this prefix |

## Before enabling in production

Run `npm run test:routing`, typecheck, and production build. On the deployed
candidate, check signed-out login, admin/operator/viewer access, both flag
states, a credential deep link, target form feedback, mobile legacy escape,
and return navigation. Do not remove legacy pages in this release.
