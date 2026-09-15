#!/usr/bin/env bash
set -euo pipefail

repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$repo_root"

load_env_file() {
  local env_file="$1"
  if [[ -f "$env_file" ]]; then
    set -a
    # shellcheck disable=SC1090
    source "$env_file"
    set +a
  fi
}

load_env_file "$repo_root/.env.example"
load_env_file "$repo_root/.env"
load_env_file "$repo_root/.env.local"

export SITE_PORT="${SITE_PORT:-3100}"
export PORT="${PORT:-${SITE_PORT}}"
export CODEX_RUNTIME_PORT="${CODEX_RUNTIME_PORT:-3030}"
export PRISM_API_PORT="${PRISM_API_PORT:-8788}"
export SOURCE_ADAPTER_PORT="${SOURCE_ADAPTER_PORT:-8789}"
export TASK_RUNNER_PORT="${TASK_RUNNER_PORT:-8790}"
export PRISM_GATEWAY_PORT="${PRISM_GATEWAY_PORT:-8794}"
export NEXT_PUBLIC_API_BASE_URL="${NEXT_PUBLIC_API_BASE_URL:-http://127.0.0.1:${SITE_PORT}}"
export API_INTERNAL_BASE_URL="${API_INTERNAL_BASE_URL:-http://127.0.0.1:${SITE_PORT}}"
export APP_API_BASE_URL="${APP_API_BASE_URL:-http://127.0.0.1:${SITE_PORT}}"
export CODEX_RUNTIME_BASE_URL="${CODEX_RUNTIME_BASE_URL:-http://127.0.0.1:${CODEX_RUNTIME_PORT}}"
export PRISM_API_BASE="${PRISM_API_BASE:-http://127.0.0.1:${PRISM_API_PORT}}"
export PRISM_MEMORY_BASE_URL="${PRISM_MEMORY_BASE_URL:-http://127.0.0.1:${PRISM_API_PORT}}"
export TASK_RUNNER_BASE_URL="${TASK_RUNNER_BASE_URL:-http://127.0.0.1:${TASK_RUNNER_PORT}}"
export PRISM_GATEWAY_BASE_URL="${PRISM_GATEWAY_BASE_URL:-http://127.0.0.1:${PRISM_GATEWAY_PORT}}"
export PRISM_GATEWAY_ENABLED="${PRISM_GATEWAY_ENABLED:-true}"

echo "[dev-local-stack] site=${SITE_PORT} codex-runtime=${CODEX_RUNTIME_PORT} prism-memory=${PRISM_API_PORT} source-adapter=${SOURCE_ADAPTER_PORT} task-runner=${TASK_RUNNER_PORT} gateway=${PRISM_GATEWAY_PORT}"
exec bash "$repo_root/scripts/dev-all.sh"
