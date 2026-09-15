#!/usr/bin/env bash
set -euo pipefail

project_id=""
environment="production"
apply=false
deploy=false

usage() {
  cat <<'EOF'
Usage:
  bash scripts/railway-setup-prism-gateway.sh \
    --project-id <railway-project-id> \
    [--environment production] \
    [--apply] \
    [--deploy]

Default behavior is a read-only plan. --apply creates missing Railway resources
and variables. --deploy implies --apply and deploys the current checkout from
services/prism-gateway.

The script never prints generated secret values. The checkout must already be
linked to the exact target project.
EOF
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    --project-id)
      project_id="$2"
      shift 2
      ;;
    --environment)
      environment="$2"
      shift 2
      ;;
    --apply)
      apply=true
      shift
      ;;
    --deploy)
      apply=true
      deploy=true
      shift
      ;;
    -h|--help)
      usage
      exit 0
      ;;
    *)
      echo "Unknown argument: $1" >&2
      usage >&2
      exit 1
      ;;
  esac
done

if [[ -z "$project_id" ]]; then
  echo "--project-id is required" >&2
  usage >&2
  exit 1
fi

for command in railway node openssl; do
  if ! command -v "$command" >/dev/null 2>&1; then
    echo "$command is required" >&2
    exit 1
  fi
done

linked_status="$(railway status --json | node -e '
  let input = "";
  process.stdin.on("data", (chunk) => { input += chunk; });
  process.stdin.on("end", () => {
    const payload = JSON.parse(input);
    const environments = payload.environments?.edges || [];
    const environment = environments.length === 1 ? environments[0].node?.name || "" : "";
    process.stdout.write(`${payload.id || ""}\t${environment}`);
  });
')"
IFS=$'\t' read -r linked_project_id linked_environment <<<"$linked_status"

if [[ "$linked_project_id" != "$project_id" ]]; then
  echo "Linked Railway project does not match --project-id" >&2
  echo "Expected: $project_id" >&2
  echo "Actual:   ${linked_project_id:-unlinked}" >&2
  exit 1
fi

if [[ "$linked_environment" != "$environment" ]]; then
  echo "Linked Railway environment does not match --environment" >&2
  echo "Expected: $environment" >&2
  echo "Actual:   ${linked_environment:-unknown or multiple environments}" >&2
  exit 1
fi

service_exists() {
  local service="$1"
  railway service list --environment "$environment" --json | SERVICE_NAME="$service" node -e '
    let input = "";
    process.stdin.on("data", (chunk) => { input += chunk; });
    process.stdin.on("end", () => {
      const payload = JSON.parse(input || "[]");
      const services = Array.isArray(payload) ? payload : payload.services || [];
      process.exit(services.some((candidate) => candidate.name === process.env.SERVICE_NAME) ? 0 : 1);
    });
  '
}

volume_exists() {
  railway volume --service prism-gateway --environment "$environment" list --json | node -e '
    let input = "";
    process.stdin.on("data", (chunk) => { input += chunk; });
    process.stdin.on("end", () => {
      const payload = JSON.parse(input || "{}");
      const volumes = Array.isArray(payload.volumes) ? payload.volumes : [];
      process.exit(volumes.some((volume) => volume.serviceName === "prism-gateway" && volume.mountPath === "/data") ? 0 : 1);
    });
  '
}

variable_exists() {
  local service="$1"
  local key="$2"
  railway variable list --service "$service" --environment "$environment" --json \
    | VARIABLE_KEY="$key" node -e '
      let input = "";
      process.stdin.on("data", (chunk) => { input += chunk; });
      process.stdin.on("end", () => {
        const variables = JSON.parse(input || "{}");
        process.exit(Object.hasOwn(variables, process.env.VARIABLE_KEY) ? 0 : 1);
      });
    '
}

set_generated_secret() {
  local service="$1"
  local key="$2"
  local kind="$3"
  if variable_exists "$service" "$key"; then
    echo "  keep $service.$key"
    return
  fi
  echo "  create $service.$key"
  if [[ "$apply" != true ]]; then return; fi
  if [[ "$kind" == "base64" ]]; then
    local generated
    generated="$(openssl rand -base64 32)"
    printf '%s' "$generated" \
      | railway variable set "$key" --stdin --service "$service" --environment "$environment" --skip-deploys --json >/dev/null
  else
    local generated
    generated="$(openssl rand -hex 32)"
    printf '%s' "$generated" \
      | railway variable set "$key" --stdin --service "$service" --environment "$environment" --skip-deploys --json >/dev/null
  fi
}

set_plain_variable() {
  local service="$1"
  local key="$2"
  local value="$3"
  if variable_exists "$service" "$key"; then
    echo "  keep $service.$key"
    return
  fi
  echo "  set $service.$key"
  if [[ "$apply" == true ]]; then
    railway variable set "$key=$value" --service "$service" --environment "$environment" --skip-deploys --json >/dev/null
  fi
}

echo "Prism Gateway Railway setup"
echo "  project: $project_id"
echo "  environment: $environment"
echo "  mode: $([[ "$apply" == true ]] && echo apply || echo plan)"

if service_exists prism-gateway; then
  echo "  keep service prism-gateway"
else
  echo "  create service prism-gateway"
  if [[ "$apply" == true ]]; then
    railway add --service prism-gateway --json >/dev/null
  fi
fi

if [[ "$apply" == true ]] && ! service_exists prism-gateway; then
  echo "prism-gateway service creation failed" >&2
  exit 1
fi

if [[ "$apply" == true ]]; then
  if volume_exists; then
    echo "  keep prism-gateway /data volume"
  else
    echo "  create prism-gateway /data volume"
    # Railway CLI 4.x can panic when adding a volume to a new empty service via
    # --service. Link the service for this operation, then restore the normal
    # repository link to Site.
    railway service link prism-gateway >/dev/null
    if ! railway volume add --mount-path /data --json >/dev/null; then
      railway service link site >/dev/null || true
      exit 1
    fi
    railway service link site >/dev/null
  fi
else
  echo "  ensure prism-gateway /data volume"
fi

if [[ "$apply" == true ]]; then
  set_plain_variable prism-gateway NODE_ENV production
  set_plain_variable prism-gateway PORT 8794
  set_plain_variable prism-gateway GATEWAY_MASTER_KEY_VERSION v1
  set_generated_secret prism-gateway GATEWAY_MASTER_ENCRYPTION_KEY base64
  set_generated_secret prism-gateway GATEWAY_SITE_TOKEN hex
  set_generated_secret prism-gateway GATEWAY_CODEX_RUNTIME_TOKEN hex
  set_generated_secret prism-gateway GATEWAY_TASK_RUNNER_TOKEN hex

  set_plain_variable site PRISM_GATEWAY_ENABLED false
  set_plain_variable site PRISM_GATEWAY_BASE_URL 'http://${{prism-gateway.RAILWAY_PRIVATE_DOMAIN}}:${{prism-gateway.PORT}}'
  set_plain_variable site PRISM_GATEWAY_TOKEN '${{prism-gateway.GATEWAY_SITE_TOKEN}}'

  set_plain_variable codex-runtime PRISM_GATEWAY_ENABLED false
  set_plain_variable codex-runtime PRISM_GATEWAY_BASE_URL 'http://${{prism-gateway.RAILWAY_PRIVATE_DOMAIN}}:${{prism-gateway.PORT}}'
  set_plain_variable codex-runtime PRISM_GATEWAY_TOKEN '${{prism-gateway.GATEWAY_CODEX_RUNTIME_TOKEN}}'
  set_plain_variable codex-runtime PRISM_RUNTIME_KEY codex-default

  set_plain_variable task-runner PRISM_GATEWAY_ENABLED false
  set_plain_variable task-runner PRISM_GATEWAY_BASE_URL 'http://${{prism-gateway.RAILWAY_PRIVATE_DOMAIN}}:${{prism-gateway.PORT}}'
  set_plain_variable task-runner PRISM_GATEWAY_TOKEN '${{prism-gateway.GATEWAY_TASK_RUNNER_TOKEN}}'
else
  echo "  ensure generated gateway encryption and caller secrets"
  echo "  ensure disabled Site, Codex Runtime, and Task Runner gateway references"
fi

if [[ "$deploy" == true ]]; then
  echo "  deploy current checkout to prism-gateway"
  railway up --service prism-gateway --environment "$environment" --path-as-root services/prism-gateway --ci
else
  echo "  deployment skipped"
fi

echo "Prism Gateway setup complete."
