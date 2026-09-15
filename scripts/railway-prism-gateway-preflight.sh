#!/usr/bin/env bash
set -euo pipefail

services=(site codex-runtime task-runner communication-adapter prism-memory)

if ! command -v railway >/dev/null 2>&1; then
  echo "railway CLI is required" >&2
  exit 1
fi

if ! command -v node >/dev/null 2>&1; then
  echo "node is required to safely inspect Railway JSON" >&2
  exit 1
fi

echo "Prism Gateway Railway preflight"
echo
railway status
echo

service_json="$(railway service list --json)"

SERVICE_JSON="$service_json" node <<'NODE'
const payload = JSON.parse(process.env.SERVICE_JSON || "[]");
const services = Array.isArray(payload) ? payload : payload.services || [];
const expected = ["site", "codex-runtime", "task-runner", "communication-adapter", "prism-memory"];

console.log("Service baseline:");
for (const name of expected) {
  const service = services.find((candidate) => candidate.name === name);
  if (!service) {
    console.log(`  MISSING ${name}`);
    continue;
  }
  const volumes = Array.isArray(service.volumes)
    ? service.volumes.map((volume) => `${volume.name}:${volume.mountPath}`).join(", ")
    : "";
  console.log(`  ${name}: ${service.status || "unknown"}${volumes ? `; volumes=${volumes}` : "; no volume"}`);
}

const gateway = services.find((candidate) => candidate.name === "prism-gateway");
console.log(`  prism-gateway: ${gateway ? "already exists" : "not present"}`);
NODE

echo
echo "Relevant variable names (values are not printed):"

for service in "${services[@]}"; do
  railway variable list --service "$service" --json \
    | SERVICE_NAME="$service" node -e '
      let input = "";
      process.stdin.on("data", (chunk) => { input += chunk; });
      process.stdin.on("end", () => {
        const variables = JSON.parse(input || "{}");
        const pattern = /(CODEX_RUNTIME|PRISM_GATEWAY|APP_API|SERVICE_TOKEN|COMMUNICATION_ADAPTER|PRISM_MEMORY|PLAUSIBLE|VENICE|NEXTCRM|STORAGE_S3|TARGET_REPO_GITHUB|X_(API|ACCESS|BEARER|CONSUMER))/;
        const names = Object.keys(variables).filter((name) => pattern.test(name)).sort();
        console.log(`  ${process.env.SERVICE_NAME}:`);
        if (names.length === 0) {
          console.log("    (none matched)");
          return;
        }
        for (const name of names) console.log(`    ${name}`);
      });
    '
done

echo
echo "Preflight is read-only. No Railway state was changed."
