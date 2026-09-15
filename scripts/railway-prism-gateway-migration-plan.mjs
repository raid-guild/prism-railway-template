#!/usr/bin/env node

import { spawnSync } from "node:child_process";
import { resolve } from "node:path";

const service = process.argv[2] || "codex-runtime";
const root = resolve(import.meta.dirname, "..");

const groups = [
  { key: "storage.s3", secrets: ["AWS_ACCESS_KEY_ID", "AWS_SECRET_ACCESS_KEY"], config: ["STORAGE_S3_BUCKET", "STORAGE_S3_ENDPOINT", "STORAGE_S3_PREFIX", "STORAGE_S3_REGION"] },
  { key: "github.admin", secrets: ["TARGET_REPO_GITHUB_TOKEN"], config: [] },
  { key: "nextcrm.admin", secrets: ["NEXTCRM_API_TOKEN"], config: ["NEXTCRM_BASE_URL", "NEXTCRM_MCP_URL", "NEXTCRM_MCP_SSE_URL"] },
  { key: "x.admin", secrets: ["X_ACCESS_TOKEN", "X_ACCESS_TOKEN_SECRET", "X_API_KEY", "X_API_SECRET", "X_BEARER_TOKEN", "X_CONSUMER_KEY", "X_CONSUMER_SECRET"], config: [] },
  { key: "bankr.admin", secrets: ["BANKR_API_KEY"], config: [] },
  { key: "clawbank.admin", secrets: ["CLAWBANK_API_KEY"], config: ["CLAWBANK_MCP_URL"] },
  { key: "hive-mind.admin", secrets: ["HIVE_MIND_API_KEY"], config: [] },
  { key: "wallet.admin", secrets: ["PRIVATE_KEY"], config: ["ACCOUNT_ADDRESS"] },
];

const retained = new Set([
  "APP_API_SERVICE_TOKEN",
  "COMMUNICATION_ADAPTER_TOKEN",
  "PRISM_API_KEY",
  "PRISM_GATEWAY_TOKEN",
  "VENICE_API_KEY",
]);
const knownNonSecret = new Set([
  "PRISM_RUNTIME_KEY",
  "RAILWAY_PRIVATE_DOMAIN",
]);

function fail(message) {
  console.error(message);
  process.exit(1);
}

const result = spawnSync("railway", ["variables", "--service", service, "--json"], {
  cwd: root,
  encoding: "utf8",
  maxBuffer: 10 * 1024 * 1024,
});
if (result.status !== 0) fail(result.stderr.trim() || "Could not read Railway variables");

let variables;
try {
  variables = JSON.parse(result.stdout || "{}");
} catch {
  fail("Railway returned invalid variable JSON");
}
const names = new Set(Object.keys(variables));

function references(variableNames) {
  const byFile = new Map();
  for (const variable of variableNames) {
    const search = spawnSync("rg", ["-l", "--fixed-strings", "--glob", "!.git/**", variable, "."], {
      cwd: root,
      encoding: "utf8",
    });
    if (search.status !== 0 && search.status !== 1)
      fail(search.stderr.trim() || `Could not search references for ${variable}`);
    for (const file of search.stdout.split("\n").filter(Boolean)) {
      const normalized = file.replace(/^\.\//, "");
      byFile.set(normalized, [...(byFile.get(normalized) || []), variable]);
    }
  }
  return [...byFile.entries()]
    .map(([file, variables]) => ({ file, variables }))
    .sort((a, b) => a.file.localeCompare(b.file));
}

const plan = groups
  .map((group) => {
    const secrets = group.secrets.filter((name) => names.has(name));
    const config = group.config.filter((name) => names.has(name));
    if (!secrets.length && !config.length) return null;
    return {
      credential: group.key,
      credentialVariables: secrets,
      configurationVariables: config,
      references: references([...secrets, ...config]),
      removableAfterValidation: secrets,
    };
  })
  .filter(Boolean);

const classified = new Set(plan.flatMap((entry) => [...entry.credentialVariables, ...entry.configurationVariables]));
const retainedCredentialVariables = [...names].filter((name) => retained.has(name)).sort();
const unclassifiedSensitiveVariables = [...names]
  .filter((name) => /(KEY|TOKEN|SECRET|PASSWORD|PRIVATE)/.test(name))
  .filter((name) => !classified.has(name) && !retained.has(name) && !knownNonSecret.has(name))
  .sort();

console.log(JSON.stringify({
  service,
  generatedAt: new Date().toISOString(),
  valuesExposed: false,
  migrationGroups: plan,
  retainedCredentialVariables,
  unclassifiedSensitiveVariables,
}, null, 2));
