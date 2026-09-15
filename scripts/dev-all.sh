#!/usr/bin/env bash
set -euo pipefail

repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

if [[ -f "$repo_root/.env" ]]; then
  set -a
  # shellcheck disable=SC1091
  source "$repo_root/.env"
  set +a
fi

if [[ -f "$repo_root/.env.local" ]]; then
  set -a
  # shellcheck disable=SC1091
  source "$repo_root/.env.local"
  set +a
fi

cleanup() {
  trap - INT TERM EXIT
  for pid in "${pids[@]:-}"; do
    if kill -0 "$pid" >/dev/null 2>&1; then
      kill "$pid" >/dev/null 2>&1 || true
    fi
  done
  wait || true
}

start_service() {
  local name="$1"
  shift
  echo "[dev-all] starting $name"
  "$@" &
  pids+=("$!")
}

wait_for_health() {
  local name="$1"
  local url="$2"
  local attempts="${3:-60}"
  for ((attempt = 1; attempt <= attempts; attempt++)); do
    if node -e "fetch(process.argv[1]).then(r => process.exit(r.ok ? 0 : 1)).catch(() => process.exit(1))" "$url"; then
      echo "[dev-all] $name healthy at $url"
      return 0
    fi
    sleep 1
  done
  echo "[dev-all] $name did not become healthy at $url" >&2
  return 1
}

pids=()
trap cleanup INT TERM EXIT

export INTERNAL_SERVICE_TOKEN="${INTERNAL_SERVICE_TOKEN:-local-dev-service-token-change-me}"
export APP_API_SERVICE_TOKEN="${APP_API_SERVICE_TOKEN:-$INTERNAL_SERVICE_TOKEN}"
export PRISM_API_KEY="${PRISM_API_KEY:-local-dev-prism-api-key-change-me}"
export PRISM_API_READ_KEY="${PRISM_API_READ_KEY:-$PRISM_API_KEY}"
export GATEWAY_MASTER_ENCRYPTION_KEY="${GATEWAY_MASTER_ENCRYPTION_KEY:-0000000000000000000000000000000000000000000000000000000000000000}"
export GATEWAY_SITE_TOKEN="${GATEWAY_SITE_TOKEN:-local-dev-gateway-site-token}"
export GATEWAY_CODEX_RUNTIME_TOKEN="${GATEWAY_CODEX_RUNTIME_TOKEN:-local-dev-gateway-runtime-token}"
export GATEWAY_TASK_RUNNER_TOKEN="${GATEWAY_TASK_RUNNER_TOKEN:-local-dev-gateway-task-token}"
export PRISM_GATEWAY_TOKEN="${PRISM_GATEWAY_TOKEN:-$GATEWAY_SITE_TOKEN}"
export TASK_RUNNER_TOKEN="${TASK_RUNNER_TOKEN:-local-dev-task-runner-token}"

start_service prism-gateway \
  env \
  PORT="${PRISM_GATEWAY_PORT:-8794}" \
  GATEWAY_DATA_ROOT="${GATEWAY_DATA_ROOT:-$repo_root/services/prism-gateway/data}" \
  npm run dev --workspace @prism-railway/prism-gateway

if [[ -x "$repo_root/services/prism-memory/.venv/bin/python" ]]; then
  start_service prism-memory \
    "$repo_root/services/prism-memory/.venv/bin/python" \
    -m uvicorn app.main:app \
    --app-dir "$repo_root/services/prism-memory" \
    --host 0.0.0.0 \
    --port "${PRISM_API_PORT:-8788}"
else
  echo "[dev-all] prism-memory virtualenv missing, run: npm run bootstrap"
fi

start_service codex-runtime \
  env \
  PORT="${CODEX_RUNTIME_PORT:-3030}" \
  PRISM_GATEWAY_ENABLED="${PRISM_GATEWAY_ENABLED:-true}" \
  PRISM_GATEWAY_BASE_URL="${PRISM_GATEWAY_BASE_URL:-http://127.0.0.1:${PRISM_GATEWAY_PORT:-8794}}" \
  PRISM_GATEWAY_TOKEN="${GATEWAY_CODEX_RUNTIME_TOKEN}" \
  npm run dev --workspace @prism-railway/codex-runtime

start_service site \
  env \
  SITE_PORT="${SITE_PORT:-3100}" \
  PORT="${SITE_PORT:-3100}" \
  PRISM_GATEWAY_ENABLED="${PRISM_GATEWAY_ENABLED:-true}" \
  PRISM_GATEWAY_BASE_URL="${PRISM_GATEWAY_BASE_URL:-http://127.0.0.1:${PRISM_GATEWAY_PORT:-8794}}" \
  PRISM_GATEWAY_TOKEN="${GATEWAY_SITE_TOKEN}" \
  npm run dev --workspace @prism-railway/site

start_service source-adapter \
  env \
  PORT="${SOURCE_ADAPTER_PORT:-8789}" \
  APP_API_BASE_URL="${APP_API_BASE_URL:-http://127.0.0.1:${SITE_PORT:-3100}}" \
  PRISM_API_BASE="${PRISM_API_BASE:-http://127.0.0.1:${PRISM_API_PORT:-8788}}" \
  npm run dev --workspace @prism-railway/source-adapter

wait_for_health prism-gateway "http://127.0.0.1:${PRISM_GATEWAY_PORT:-8794}/health"
wait_for_health site "http://127.0.0.1:${SITE_PORT:-3100}/api/health" 120

start_service task-runner \
  env \
  PORT="${TASK_RUNNER_PORT:-8790}" \
  APP_API_BASE_URL="${APP_API_BASE_URL:-http://127.0.0.1:${SITE_PORT:-3100}}" \
  APP_API_SERVICE_TOKEN="$INTERNAL_SERVICE_TOKEN" \
  CODEX_RUNTIME_BASE_URL="${CODEX_RUNTIME_BASE_URL:-http://127.0.0.1:${CODEX_RUNTIME_PORT:-3030}}" \
  PRISM_MEMORY_BASE_URL="${PRISM_MEMORY_BASE_URL:-http://127.0.0.1:${PRISM_API_PORT:-8788}}" \
  PRISM_GATEWAY_ENABLED="${PRISM_GATEWAY_ENABLED:-true}" \
  PRISM_GATEWAY_BASE_URL="${PRISM_GATEWAY_BASE_URL:-http://127.0.0.1:${PRISM_GATEWAY_PORT:-8794}}" \
  PRISM_GATEWAY_TOKEN="$GATEWAY_TASK_RUNNER_TOKEN" \
  npm run dev --workspace @prism-railway/task-runner

wait_for_health codex-runtime "http://127.0.0.1:${CODEX_RUNTIME_PORT:-3030}/health"
wait_for_health task-runner "http://127.0.0.1:${TASK_RUNNER_PORT:-8790}/health"

wait
