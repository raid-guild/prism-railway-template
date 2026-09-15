import assert from "node:assert/strict";
import test from "node:test";

import {
  gatewayCredentialImportNames,
  gatewayImportableEnvNames,
  parseEnvText,
  protectedGatewayEnvNames,
} from "./gateway-env-import";

test("environment import parses exports, quotes, and values containing equals", () => {
  assert.deepEqual(
    parseEnvText(`
# comment
export TARGET_REPO_GITHUB_TOKEN="github=value"
AWS_ACCESS_KEY_ID='access-key'
EMPTY=
INVALID LINE
`),
    {
      TARGET_REPO_GITHUB_TOKEN: "github=value",
      AWS_ACCESS_KEY_ID: "access-key",
    },
  );
});

test("generic credential import accepts instance secrets and protects platform credentials", () => {
  const parsed = {
    GRAPH_API_KEY: "graph",
    PINATA_JWT_TOKEN: "pinata",
    PRIVATE_KEY: "wallet",
    PRISM_API_KEY: "platform",
    PRISM_MEMORY_OPS_KEY: "platform-ops",
    RAIDGUILD_PRISM_API_READ_KEY: "platform-read",
    PRISM_GATEWAY_TOKEN: "gateway",
    RAILWAY_PROJECT_TOKEN: "railway",
    BAK_CODEX_ACCESS_TOKEN: "backup",
    GRAPH_URL: "https://example.org",
  };
  assert.deepEqual(gatewayCredentialImportNames(parsed), [
    "GRAPH_API_KEY",
    "PINATA_JWT_TOKEN",
    "PRIVATE_KEY",
  ]);
  assert.deepEqual(gatewayImportableEnvNames(parsed), [
    "GRAPH_API_KEY",
    "PINATA_JWT_TOKEN",
    "PRIVATE_KEY",
    "GRAPH_URL",
  ]);
  assert.deepEqual(protectedGatewayEnvNames(parsed), [
    "PRISM_API_KEY",
    "PRISM_MEMORY_OPS_KEY",
    "RAIDGUILD_PRISM_API_READ_KEY",
    "PRISM_GATEWAY_TOKEN",
    "RAILWAY_PROJECT_TOKEN",
    "BAK_CODEX_ACCESS_TOKEN",
  ]);
});
