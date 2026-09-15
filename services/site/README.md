# Site Service

Starter Next.js shell for:

- public community pages
- member directory
- account and admin surfaces

Immediate goal:

- port the current portfolio/site app into this service
- switch it from path-prefix assumptions to standalone site hosting

Current scaffold:

- `/` is a public landing page for the Prism Agent stack
- `/admin` is a password-gated board shell for target apps, environments, and change requests
- admin auth is currently a shared password cookie that the site forwards to the API as `x-admin-password`

Deploy check:

- site service deploys from the SuperPrism fork `main` branch
