import type Database from "better-sqlite3";
import { createHash, randomUUID } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import express, { type NextFunction, type Request, type Response } from "express";
import { gatewayAuth, requireLeaseCaller, requireSiteCaller } from "./auth.js";
import { GatewayStore, GatewayStoreError } from "./store.js";
import type { GatewayCaller, GatewayConfig, GatewayInvocationContext } from "./types.js";

type AppDependencies = {
  config: GatewayConfig;
  db: Database.Database;
  store: GatewayStore;
  migrationCount: number;
  startedAt?: Date;
};

function textField(value: unknown, field: string, maxLength = 200) {
  const normalized = typeof value === "string" ? value.trim() : "";
  if (!normalized || normalized.length > maxLength) {
    throw new GatewayStoreError(`${field.toUpperCase()}_INVALID`, 400);
  }
  return normalized;
}

function credentialsField(value: unknown) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new GatewayStoreError("CONNECTION_CREDENTIALS_REQUIRED", 400);
  }
  const credentials: Record<string, string> = {};
  for (const [key, candidate] of Object.entries(value as Record<string, unknown>)) {
    if (typeof candidate !== "string" || !candidate) {
      throw new GatewayStoreError("CONNECTION_CREDENTIAL_INVALID", 400);
    }
    credentials[key] = candidate;
  }
  return credentials;
}

function isProtectedStoredCredentialName(name: string) {
  return name.startsWith("RAILWAY_")
    || name.startsWith("GATEWAY_")
    || name.startsWith("PRISM_")
    || name.startsWith("BAK_")
    || name === "INTERNAL_SERVICE_TOKEN"
    || name === "APP_API_SERVICE_TOKEN"
    || name === "PRISM_AGENT_SERVICE_TOKEN"
    || name === "TASK_RUNNER_TOKEN"
    || name === "COMMUNICATION_ADAPTER_TOKEN"
    || /_PRISM_API_(?:READ_)?KEY$/.test(name)
    || /^CODEX_(?:ACCESS|REFRESH|ID)_TOKEN$/.test(name);
}

function isProtectedLeasedEnvironmentName(name: string) {
  return new Set([
    "PATH", "HOME", "SHELL", "PWD", "TMPDIR", "NODE_OPTIONS",
    "INTERNAL_SERVICE_TOKEN", "APP_API_SERVICE_TOKEN", "TASK_RUNNER_TOKEN",
    "COMMUNICATION_ADAPTER_TOKEN",
  ]).has(name)
    || ["PRISM_", "RAILWAY_", "GATEWAY_", "CODEX_", "NODE_", "NPM_", "npm_", "LD_", "DYLD_"]
      .some((prefix) => name.startsWith(prefix));
}

function storedCredentialsField(value: unknown) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new GatewayStoreError("STORED_CREDENTIALS_INVALID", 400);
  }
  const credentials: Record<string, string> = {};
  for (const [name, candidate] of Object.entries(value as Record<string, unknown>)) {
    if (typeof candidate !== "string" || !candidate) {
      throw new GatewayStoreError("STORED_CREDENTIAL_INVALID", 400);
    }
    credentials[name] = candidate;
  }
  if (Object.keys(credentials).length === 0 || Object.keys(credentials).length > 100) {
    throw new GatewayStoreError("STORED_CREDENTIALS_INVALID", 400);
  }
  if (Object.keys(credentials).some(isProtectedStoredCredentialName)) {
    throw new GatewayStoreError("STORED_CREDENTIAL_PROTECTED", 400);
  }
  return credentials;
}

function storedCredentialBindingsField(value: unknown) {
  const input = recordField(value, "STORED_CREDENTIAL_BINDINGS_INVALID");
  const bindings: Record<string, string> = {};
  for (const [secretName, storedName] of Object.entries(input)) {
    if (
      !/^[a-zA-Z][a-zA-Z0-9_.-]{0,63}$/.test(secretName)
      || typeof storedName !== "string"
      || !/^[A-Z_][A-Z0-9_]{0,119}$/.test(storedName)
    ) throw new GatewayStoreError("STORED_CREDENTIAL_BINDING_INVALID", 400);
    bindings[secretName] = storedName;
  }
  if (!Object.keys(bindings).length || Object.keys(bindings).length > 20) {
    throw new GatewayStoreError("STORED_CREDENTIAL_BINDINGS_INVALID", 400);
  }
  return bindings;
}

function credentialConfigurationField(value: unknown) {
  if (value === undefined) return {};
  const input = recordField(value, "CREDENTIAL_CONFIGURATION_INVALID");
  const configuration: Record<string, string> = {};
  for (const [envName, candidate] of Object.entries(input)) {
    if (
      !/^[A-Z_][A-Z0-9_]{0,119}$/.test(envName)
      || isProtectedLeasedEnvironmentName(envName)
      || typeof candidate !== "string"
      || !candidate
      || candidate.length > 10_000
    ) throw new GatewayStoreError("CREDENTIAL_CONFIGURATION_INVALID", 400);
    configuration[envName] = candidate;
  }
  if (Object.keys(configuration).length > 50) {
    throw new GatewayStoreError("CREDENTIAL_CONFIGURATION_INVALID", 400);
  }
  return configuration;
}

function credentialEnvBindingsField(value: unknown) {
  if (value === undefined) return {};
  const input = recordField(value, "CREDENTIAL_ENV_BINDINGS_INVALID");
  const bindings: Record<string, string> = {};
  for (const [envName, secretName] of Object.entries(input)) {
    if (
      !/^[A-Z_][A-Z0-9_]{0,119}$/.test(envName)
      || isProtectedLeasedEnvironmentName(envName)
      || typeof secretName !== "string"
      || !/^[a-zA-Z][a-zA-Z0-9_.-]{0,63}$/.test(secretName)
    ) throw new GatewayStoreError("CREDENTIAL_ENV_BINDINGS_INVALID", 400);
    bindings[envName] = secretName;
  }
  if (Object.keys(bindings).length > 50) {
    throw new GatewayStoreError("CREDENTIAL_ENV_BINDINGS_INVALID", 400);
  }
  return bindings;
}

function routeParam(value: string | string[]) {
  return Array.isArray(value) ? value[0] || "" : value;
}

function recordField(value: unknown, errorCode: string) {
  if (value === undefined || value === null) return {};
  if (typeof value !== "object" || Array.isArray(value)) throw new GatewayStoreError(errorCode, 400);
  return value as Record<string, unknown>;
}

function invocationContext(value: unknown): GatewayInvocationContext {
  const input = recordField(value, "INVOCATION_CONTEXT_INVALID");
  const result: GatewayInvocationContext = {};
  for (const key of ["delegatedActorId", "requestId", "workflowRunId", "workflowStepKey", "runtimeJobId"] as const) {
    const candidate = input[key];
    if (candidate === undefined || candidate === null || candidate === "") continue;
    if (typeof candidate !== "string" || candidate.length > 200) {
      throw new GatewayStoreError("INVOCATION_CONTEXT_INVALID", 400);
    }
    result[key] = candidate;
  }
  return result;
}

function asyncRoute(
  handler: (request: Request, response: Response) => Promise<void>,
) {
  return (request: Request, response: Response, next: NextFunction) => {
    void handler(request, response).catch(next);
  };
}

async function sha256File(filename: string) {
  const hash = createHash("sha256");
  const stream = fs.createReadStream(filename);
  for await (const chunk of stream) hash.update(chunk);
  return hash.digest("hex");
}

export function createGatewayApp(dependencies: AppDependencies) {
  const app = express();
  const startedAt = dependencies.startedAt || new Date();
  app.disable("x-powered-by");

  app.get("/health", (_request, response) => {
    const quickCheck = dependencies.db.pragma("quick_check", { simple: true });
    const encryption = dependencies.store.encryptionStatus();
    const ok = quickCheck === "ok" && encryption.unreadableSecretCount === 0;
    response.status(ok ? 200 : 503).json({
      ok,
      service: "prism-gateway",
      startedAt: startedAt.toISOString(),
      uptimeSeconds: Math.floor((Date.now() - startedAt.getTime()) / 1000),
      database: {
        ok: quickCheck === "ok",
        migrations: dependencies.migrationCount,
      },
      catalog: dependencies.store.stats(),
      encryption,
      callersConfigured: dependencies.config.callers.map((caller) => caller.id),
    });
  });

  app.use(gatewayAuth(dependencies.config.callers));
  app.use(express.json({ limit: "256kb" }));

  app.post("/ops/backup", requireSiteCaller, asyncRoute(async (_request, response) => {
    const backupDirectory = path.join(path.dirname(dependencies.config.dbPath), "backups");
    fs.mkdirSync(backupDirectory, { recursive: true, mode: 0o700 });
    const createdAt = new Date().toISOString();
    const stamp = createdAt.replace(/[:.]/g, "-");
    const filename = `prism-gateway-${stamp}.sqlite`;
    const backupPath = path.join(backupDirectory, filename);
    await dependencies.db.backup(backupPath);
    await fs.promises.chmod(backupPath, 0o600);
    const { size: bytes } = await fs.promises.stat(backupPath);
    const sha256 = await sha256File(backupPath);
    const encryption = dependencies.store.encryptionStatus();
    const manifest = {
      formatVersion: 1,
      createdAt,
      database: filename,
      bytes,
      sha256,
      currentKeyVersion: encryption.currentKeyVersion,
      encryptedSecretVersions: encryption.versions,
    };
    const manifestFilename = `${filename}.json`;
    const manifestPath = path.join(backupDirectory, manifestFilename);
    await fs.promises.writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, { mode: 0o600 });
    response.json({ ok: true, backup: { ...manifest, manifest: manifestFilename, directory: "backups" } });
  }));

  app.post("/ops/rotate-master-key", requireSiteCaller, (_request, response) => {
    const result = dependencies.store.rotateEncryptionKey();
    response.json({ ok: true, rotation: result });
  });

  app.post("/credential-bundles/lease", requireLeaseCaller, (request, response) => {
    const body = request.body as Record<string, unknown>;
    const keys = Array.isArray(body.credentials)
      ? Array.from(new Set(body.credentials.filter(
        (key): key is string => typeof key === "string" && /^[a-z][a-z0-9.-]{1,119}$/.test(key),
      )))
      : [];
    if (!keys.length || keys.length > 20) {
      throw new GatewayStoreError("CREDENTIAL_LEASE_KEYS_INVALID", 400);
    }
    const context = invocationContext(body.context);
    const caller = response.locals.gatewayCaller as GatewayCaller;
    const env: Record<string, string> = {};
    const leased: string[] = [];
    for (const requestedKey of keys) {
      const credential = dependencies.store.getCredential(requestedKey);
      if (!credential || credential.status === "revoked") {
        throw new GatewayStoreError("CREDENTIAL_LEASE_UNAVAILABLE", 409);
      }
      const secrets = dependencies.store.getConnectionCredentials(credential.id);
      const bundle: Record<string, string> = { ...credential.configuration };
      for (const [envName, secretName] of Object.entries(credential.envBindings)) {
        const value = secrets[secretName];
        if (!value) throw new GatewayStoreError("CREDENTIAL_LEASE_SECRET_MISSING", 409);
        bundle[envName] = value;
      }
      for (const [envName, value] of Object.entries(bundle)) {
        if (isProtectedLeasedEnvironmentName(envName)) {
          throw new GatewayStoreError("CREDENTIAL_LEASE_ENV_PROTECTED", 409);
        }
        if (env[envName] !== undefined && env[envName] !== value) {
          throw new GatewayStoreError("CREDENTIAL_LEASE_ENV_COLLISION", 409);
        }
        env[envName] = value;
      }
      dependencies.store.recordCredentialLease({
        traceId: randomUUID(), credentialKey: credential.key, caller, context,
        environmentNames: Object.keys(bundle).sort(),
      });
      dependencies.store.markConnectionLeased(credential.id);
      leased.push(credential.key);
    }
    response.json({ ok: true, env, leasedCredentials: leased });
  });

  app.get("/connections", requireSiteCaller, (_request, response) => {
    response.json({ ok: true, connections: dependencies.store.listConnections() });
  });

  app.get("/credential-bundles", requireSiteCaller, (_request, response) => {
    response.json({ ok: true, credentials: dependencies.store.listConnections() });
  });

  app.get("/credentials", requireSiteCaller, (_request, response) => {
    response.json({ ok: true, credentials: dependencies.store.listStoredCredentials() });
  });

  app.post("/credentials/import", requireSiteCaller, (request, response) => {
    const body = request.body as Record<string, unknown>;
    const credentials = dependencies.store.upsertStoredCredentials(
      storedCredentialsField(body.credentials),
      "environment-import",
    );
    response.status(201).json({ ok: true, credentials });
  });

  app.post("/connections", requireSiteCaller, (request, response) => {
    const body = request.body as Record<string, unknown>;
    const connection = dependencies.store.createConnection({
      key: typeof body.key === "string" ? body.key : undefined,
      provider: typeof body.provider === "string" && body.provider.trim()
        ? body.provider.trim().slice(0, 120)
        : "custom",
      label: textField(body.label, "label", 200),
      authType: textField(body.authType, "auth_type", 80),
      credentials: credentialsField(body.credentials),
      configuration: credentialConfigurationField(body.configuration),
      ...(body.envBindings !== undefined
        ? { envBindings: credentialEnvBindingsField(body.envBindings) }
        : {}),
    });
    response.status(201).json({ ok: true, connection });
  });

  app.patch("/credential-bundles/:id", requireSiteCaller, (request, response) => {
    const body = request.body as Record<string, unknown>;
    const credential = dependencies.store.updateCredentialBundle(routeParam(request.params.id), {
      ...(typeof body.label === "string" ? { label: body.label } : {}),
      ...(typeof body.authType === "string" ? { authType: body.authType } : {}),
      ...(body.configuration !== undefined
        ? { configuration: credentialConfigurationField(body.configuration) }
        : {}),
      ...(body.envBindings !== undefined
        ? { envBindings: credentialEnvBindingsField(body.envBindings) }
        : {}),
    });
    response.json({ ok: true, credential });
  });

  app.put("/connections/:id/credentials", requireSiteCaller, (request, response) => {
    const body = request.body as Record<string, unknown>;
    const connection = dependencies.store.replaceConnectionCredentials(
      routeParam(request.params.id),
      credentialsField(body.credentials),
    );
    response.json({ ok: true, connection });
  });

  app.put("/connections/:id/credentials/from-store", requireSiteCaller, (request, response) => {
    const body = request.body as Record<string, unknown>;
    const connection = dependencies.store.bindStoredCredentials(
      routeParam(request.params.id),
      storedCredentialBindingsField(body.bindings),
    );
    response.json({ ok: true, connection });
  });

  app.delete("/connections/:id", requireSiteCaller, (request, response) => {
    const connection = dependencies.store.revokeConnection(routeParam(request.params.id));
    response.json({ ok: true, connection });
  });

  app.get("/audit-events", requireSiteCaller, (request, response) => {
    const limit = Number.parseInt(String(request.query.limit || "100"), 10);
    response.json({
      ok: true,
      events: dependencies.store.listAuditEvents(Number.isFinite(limit) ? limit : 100),
    });
  });

  app.get("/audit-events/:traceId", requireSiteCaller, (request, response) => {
    const event = dependencies.store.getAuditEvent(routeParam(request.params.traceId));
    if (!event) throw new GatewayStoreError("AUDIT_EVENT_NOT_FOUND", 404);
    response.json({ ok: true, event });
  });

  app.use((_request, response) => {
    response.status(404).json({ ok: false, error: "GATEWAY_ROUTE_NOT_FOUND" });
  });

  app.use((error: unknown, _request: Request, response: Response, _next: NextFunction) => {
    if (error instanceof GatewayStoreError) {
      response.status(error.status).json({ ok: false, error: error.code });
      return;
    }
    if (error && typeof error === "object" && "status" in error && error.status === 413) {
      response.status(413).json({ ok: false, error: "GATEWAY_REQUEST_TOO_LARGE" });
      return;
    }
    if (error instanceof SyntaxError) {
      response.status(400).json({ ok: false, error: "GATEWAY_JSON_INVALID" });
      return;
    }
    console.error(JSON.stringify({ event: "prism-gateway.request_failed", error: "GATEWAY_INTERNAL_ERROR" }));
    response.status(500).json({ ok: false, error: "GATEWAY_INTERNAL_ERROR" });
  });

  return app;
}
