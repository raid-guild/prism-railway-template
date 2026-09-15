# Codex Runtime Service

Minimal HTTP wrapper around the Codex CLI.

Behavior:

- exposes `GET /health`
- exposes `GET /codex/health`
- exposes `POST /v1/responses`
- starts or resumes Codex CLI sessions using `codex exec` and `codex exec resume`
- persists Codex auth and session state through `CODEX_HOME`
- exposes Site-hosted Prism skills through Codex's native `$HOME/.agents/skills`
  discovery for each full-authority invocation

Required env:

- `PORT=3030`
- `CODEX_HOME=/data/codex`

Recommended env:

- `CODEX_BIN=codex`
- `CODEX_RUNTIME_TIMEOUT_MS=600000`
- `CODEX_IMAGE_GENERATION_ENABLED=true`
- `CODEX_WORKSPACE_ROOT=/app`
- `CODEX_TARGET_WORKSPACE_ROOT=/data/workspaces`
- `CODEX_MODEL=<optional>`
- `CODEX_MODEL_ECONOMY=<required when the economy tier is used>`
- `CODEX_MODEL_STANDARD=<optional; falls back to CODEX_MODEL or the CLI default>`
- `CODEX_MODEL_DEEP=<required when the deep tier is used>`
- `CODEX_REASONING_EFFORT_ECONOMY=low`
- `CODEX_REASONING_EFFORT_STANDARD=<optional>`
- `CODEX_REASONING_EFFORT_DEEP=high`
- `PRISM_API_BASE=<optional>`
- `PRISM_API_READ_KEY=<optional>`
- `APP_API_BASE_URL=<your api base url>`
- `APP_API_SERVICE_TOKEN=<same internal service token as api>`
- `TARGET_REPO_GITHUB_TOKEN=<github token for private target repos>`
- `PRISM_GATEWAY_ENABLED=false`
- `PRISM_GATEWAY_BASE_URL=<private Prism Gateway URL>`
- `PRISM_GATEWAY_TOKEN=<runtime-specific Gateway caller token>`
- `PRISM_GATEWAY_TIMEOUT_MS=70000`

Gateway calls are made by the runtime parent process. Do not pass the long-lived
Gateway service token into prompts, tool arguments, traces, or agent-visible
configuration. The parent leases selected credential bundles and injects their
configured variables only into the child job environment.

The runtime image includes Playwright and its pinned Chromium build. Browser
automation can read Gateway-leased variables from the child job environment in
the same way as other provider clients. For example, a Reddit connection can map
secret fields to `REDDIT_USERNAME` and `REDDIT_PASSWORD`; the browser script must
read those values from `process.env` and must not print them, copy them into task
input, or persist them in browser storage. Persist reusable browser state under
the `/data` volume rather than `/app` so it survives deployments.

Site-owned deterministic jobs may assign credential keys through agent config:

```json
{
  "gatewayCredentials": ["sendgrid"]
}
```

Trusted Admin Console and full-access source contexts receive active credentials
from Site policy without another access-profile step.

For interactive full-authority sessions, the runtime downloads the hosted skill
bundles into an isolated per-invocation home. Codex initially receives native
skill metadata and loads the complete `SKILL.md`, scripts, and references only
when it selects a matching skill. Deterministic calls with
`metadata.skillSelectionMode="exact"` expose only their explicitly selected
hosted skills. Read-only utility calls expose no hosted operational skills.

Railway notes:

- attach a persistent volume at `/data`
- set `CODEX_HOME=/data/codex`
- keep external target repos under `/data/workspaces`
- run a one-time `codex login` inside the running service environment
- adapters like Discord or Slack should call this service instead of embedding Codex directly

## Model tiers

Prism sends the provider-neutral tiers `economy`, `standard`, and `deep` in the
runtime job contract. Codex Runtime maps those tiers to provider model IDs and
reasoning effort through the environment variables above. Workflow, task, and
agent-profile definitions must not contain Codex model IDs.

An omitted tier preserves the existing `CODEX_MODEL` behavior. `standard` may
also use that default. `economy` and `deep` fail closed with
`MODEL_TIER_UNAVAILABLE` until their mappings are configured, preventing a
silent fallback to a model with different cost or capability characteristics.
