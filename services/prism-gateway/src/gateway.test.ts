import { randomBytes } from "node:crypto";
import { existsSync, mkdtempSync, rmSync } from "node:fs";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import path from "node:path";
import assert from "node:assert/strict";
import test from "node:test";
import { createGatewayApp } from "./app.js";
import { openGatewayDatabase, runGatewayMigrations } from "./db.js";
import { GatewayStore } from "./store.js";
import type { GatewayConfig } from "./types.js";

const siteToken = "site-token-for-gateway-tests";
const codexToken = "codex-token-for-gateway-tests";
const taskRunnerToken = "task-runner-token-for-gateway-tests";

function testConfig(root: string): GatewayConfig {
  return {
    port: 0,
    dbPath: path.join(root, "gateway.sqlite"),
    masterKey: randomBytes(32),
    masterKeyVersion: "test-v1",
    previousMasterKeys: [],
    callers: [
      { id: "site", kind: "service", runtimeKey: null, token: siteToken },
      { id: "codex-runtime", kind: "runtime", runtimeKey: "codex-test", token: codexToken },
      { id: "task-runner", kind: "service", runtimeKey: null, token: taskRunnerToken },
    ],
  };
}

async function jsonRequest(baseUrl: string, pathname: string, init: RequestInit = {}) {
  const response = await fetch(`${baseUrl}${pathname}`, init);
  const text = await response.text();
  return {
    response,
    text,
    body: text ? JSON.parse(text) as Record<string, unknown> : {},
  };
}

test("gateway migrations remove legacy profile and capability storage", () => {
  const root = mkdtempSync(path.join(tmpdir(), "prism-gateway-migration-test-"));
  const db = openGatewayDatabase(path.join(root, "gateway.sqlite"));
  try {
    runGatewayMigrations(db);
    const tables = (db.prepare(
      "SELECT name FROM sqlite_master WHERE type = 'table' ORDER BY name",
    ).all() as Array<{ name: string }>).map((row) => row.name);
    assert.equal(tables.includes("toolset_profiles"), false);
    assert.equal(tables.includes("capabilities"), false);
    assert.equal(tables.includes("capability_grants"), false);
    assert.equal(tables.includes("connector_drivers"), false);
    assert.equal(tables.includes("usage_ledger"), false);
    assert.equal(tables.includes("audit_events"), true);
  } finally {
    db.close();
    rmSync(root, { recursive: true, force: true });
  }
});

test("gateway stores, leases, audits, rotates, and revokes trusted credentials", async () => {
  const root = mkdtempSync(path.join(tmpdir(), "prism-gateway-test-"));
  const config = testConfig(root);
  const db = openGatewayDatabase(config.dbPath);
  const migrations = runGatewayMigrations(db);
  const store = new GatewayStore(db, { key: config.masterKey, keyVersion: config.masterKeyVersion });
  const server = createGatewayApp({ config, db, store, migrationCount: migrations.totalKnown })
    .listen(0, "127.0.0.1");
  await new Promise<void>((resolve) => server.once("listening", resolve));
  const baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;

  try {
    const plaintext = "sendgrid-secret-value";
    const created = await jsonRequest(baseUrl, "/connections", {
      method: "POST",
      headers: { "content-type": "application/json", "x-gateway-token": siteToken },
      body: JSON.stringify({
        key: "sendgrid",
        provider: "sendgrid",
        label: "SendGrid",
        authType: "api-key",
        credentials: { apiKey: plaintext },
        configuration: { SENDGRID_BASE_URL: "https://api.sendgrid.com" },
        envBindings: { SENDGRID_API_KEY: "apiKey" },
      }),
    });
    assert.equal(created.response.status, 201);
    assert.equal(created.text.includes(plaintext), false);
    const connection = created.body.connection as Record<string, unknown>;
    const connectionId = String(connection.id);

    const runtimeCannotList = await jsonRequest(baseUrl, "/credential-bundles", {
      headers: { "x-gateway-token": codexToken },
    });
    assert.equal(runtimeCannotList.response.status, 403);

    const lease = await jsonRequest(baseUrl, "/credential-bundles/lease", {
      method: "POST",
      headers: { "content-type": "application/json", "x-gateway-token": codexToken },
      body: JSON.stringify({
        credentials: ["sendgrid"],
        context: { delegatedActorId: "admin-console", runtimeJobId: "runtime-job-1" },
      }),
    });
    assert.equal(lease.response.status, 200);
    assert.deepEqual(lease.body.env, {
      SENDGRID_BASE_URL: "https://api.sendgrid.com",
      SENDGRID_API_KEY: plaintext,
    });

    const events = store.listAuditEvents(10);
    assert.equal(events[0]?.credentialKey, "sendgrid");
    assert.equal(events[0]?.authenticatedCallerId, "codex-runtime");
    assert.equal(JSON.stringify(events).includes(plaintext), false);

    const replacement = "replacement-secret-value";
    await jsonRequest(baseUrl, `/connections/${connectionId}/credentials`, {
      method: "PUT",
      headers: { "content-type": "application/json", "x-gateway-token": siteToken },
      body: JSON.stringify({ credentials: { apiKey: replacement } }),
    });
    assert.equal(store.getConnectionCredentials(connectionId).apiKey, replacement);

    await jsonRequest(baseUrl, `/connections/${connectionId}`, {
      method: "DELETE",
      headers: { "x-gateway-token": siteToken },
    });
    const revokedLease = await jsonRequest(baseUrl, "/credential-bundles/lease", {
      method: "POST",
      headers: { "content-type": "application/json", "x-gateway-token": taskRunnerToken },
      body: JSON.stringify({ credentials: ["sendgrid"] }),
    });
    assert.equal(revokedLease.response.status, 409);
  } finally {
    await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
    db.close();
    rmSync(root, { recursive: true, force: true });
  }
});

test("gateway backup and master-key rotation preserve credentials", async () => {
  const root = mkdtempSync(path.join(tmpdir(), "prism-gateway-ops-test-"));
  const config = testConfig(root);
  const oldKey = config.masterKey;
  const newKey = randomBytes(32);
  const db = openGatewayDatabase(config.dbPath);
  const migrations = runGatewayMigrations(db);
  const oldStore = new GatewayStore(db, { key: oldKey, keyVersion: "test-v1" });
  const connection = oldStore.createConnection({
    key: "ops",
    provider: "test",
    label: "Operations",
    authType: "api-key",
    credentials: { apiKey: "credential-survives-rotation" },
  });
  const rotatedConfig = {
    ...config,
    masterKey: newKey,
    masterKeyVersion: "test-v2",
    previousMasterKeys: [{ key: oldKey, keyVersion: "test-v1" }],
  };
  const store = new GatewayStore(db, {
    key: newKey,
    keyVersion: "test-v2",
    previousKeys: rotatedConfig.previousMasterKeys,
  });
  const server = createGatewayApp({
    config: rotatedConfig,
    db,
    store,
    migrationCount: migrations.totalKnown,
  }).listen(0, "127.0.0.1");
  await new Promise<void>((resolve) => server.once("listening", resolve));
  const baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;

  try {
    const rotated = await jsonRequest(baseUrl, "/ops/rotate-master-key", {
      method: "POST",
      headers: { "x-gateway-token": siteToken },
    });
    assert.equal(rotated.response.status, 200);
    assert.equal(store.getConnectionCredentials(connection.id).apiKey, "credential-survives-rotation");

    const backup = await jsonRequest(baseUrl, "/ops/backup", {
      method: "POST",
      headers: { "x-gateway-token": siteToken },
    });
    assert.equal(backup.response.status, 200);
    const details = backup.body.backup as Record<string, unknown>;
    assert.equal(existsSync(path.join(root, "backups", String(details.database))), true);
  } finally {
    await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
    db.close();
    rmSync(root, { recursive: true, force: true });
  }
});
