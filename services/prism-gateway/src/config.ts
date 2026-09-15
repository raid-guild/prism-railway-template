import path from "node:path";
import { parseMasterKey } from "./crypto.js";
import type { GatewayCaller, GatewayConfig } from "./types.js";

function positiveInteger(value: string | undefined, fallback: number): number {
  const parsed = Number.parseInt(value?.trim() || "", 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function addCaller(
  callers: GatewayCaller[],
  token: string | undefined,
  identity: Omit<GatewayCaller, "token">,
) {
  const normalized = token?.trim();
  if (!normalized) return;
  if (normalized.length < 16) {
    throw new Error(`${identity.id} gateway token must contain at least 16 characters`);
  }
  callers.push({ ...identity, token: normalized });
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): GatewayConfig {
  const dataRoot = env.GATEWAY_DATA_ROOT?.trim()
    || env.RAILWAY_VOLUME_MOUNT_PATH?.trim()
    || path.resolve(process.cwd(), ".prism-gateway");
  const callers: GatewayCaller[] = [];

  addCaller(callers, env.GATEWAY_SITE_TOKEN, {
    id: "site",
    kind: "service",
    runtimeKey: null,
  });
  addCaller(callers, env.GATEWAY_CODEX_RUNTIME_TOKEN, {
    id: "codex-runtime",
    kind: "runtime",
    runtimeKey: env.GATEWAY_CODEX_RUNTIME_KEY?.trim() || "codex-default",
  });
  addCaller(callers, env.GATEWAY_TASK_RUNNER_TOKEN, {
    id: "task-runner",
    kind: "service",
    runtimeKey: null,
  });

  if (callers.length === 0) {
    throw new Error("At least one GATEWAY_*_TOKEN caller token is required");
  }
  if (new Set(callers.map((caller) => caller.token)).size !== callers.length) {
    throw new Error("Gateway caller tokens must be unique per service");
  }

  const masterKeyValue = env.GATEWAY_MASTER_ENCRYPTION_KEY?.trim();
  if (!masterKeyValue) {
    throw new Error("GATEWAY_MASTER_ENCRYPTION_KEY is required");
  }
  const masterKeyVersion = env.GATEWAY_MASTER_KEY_VERSION?.trim() || "v1";
  const previousMasterKeyValue = env.GATEWAY_PREVIOUS_MASTER_ENCRYPTION_KEY?.trim() || "";
  const previousMasterKeyVersion = env.GATEWAY_PREVIOUS_MASTER_KEY_VERSION?.trim() || "";
  if (Boolean(previousMasterKeyValue) !== Boolean(previousMasterKeyVersion)) {
    throw new Error("GATEWAY_PREVIOUS_MASTER_ENCRYPTION_KEY and GATEWAY_PREVIOUS_MASTER_KEY_VERSION must be set together");
  }
  if (previousMasterKeyVersion && previousMasterKeyVersion === masterKeyVersion) {
    throw new Error("Gateway current and previous master key versions must differ");
  }

  return {
    port: positiveInteger(env.PORT, 8794),
    dbPath: env.GATEWAY_DB_PATH?.trim() || path.resolve(dataRoot, "prism-gateway.sqlite"),
    masterKey: parseMasterKey(masterKeyValue),
    masterKeyVersion,
    previousMasterKeys: previousMasterKeyValue
      ? [{ key: parseMasterKey(previousMasterKeyValue), keyVersion: previousMasterKeyVersion }]
      : [],
    callers,
  };
}
