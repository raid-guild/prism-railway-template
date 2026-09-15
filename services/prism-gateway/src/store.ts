import { randomUUID } from "node:crypto";
import type Database from "better-sqlite3";
import { decryptSecret, encryptSecret, type EncryptedSecret } from "./crypto.js";
import type {
  GatewayConnection,
  GatewayStoredCredential,
  GatewayAuditEvent,
  GatewayCaller,
  GatewayInvocationContext,
} from "./types.js";

export class GatewayStoreError extends Error {
  constructor(
    public readonly code: string,
    public readonly status: number,
  ) {
    super(code);
  }
}

type ConnectionRow = {
  id: string;
  credential_key: string | null;
  provider: string;
  label: string;
  auth_type: string;
  configuration_json: string;
  env_bindings_json: string;
  status: GatewayConnection["status"];
  last_tested_at: string | null;
  last_used_at: string | null;
  created_at: string;
  updated_at: string;
};

type SecretRow = EncryptedSecret & {
  id?: string;
  connection_id?: string;
  secret_name: string;
};

type StoredCredentialRow = EncryptedSecret & {
  id: string;
  name: string;
  source: GatewayStoredCredential["source"];
  created_at: string;
  updated_at: string;
};

type AuditRow = {
  id: string;
  trace_id: string;
  credential_key: string;
  authenticated_caller_id: string;
  delegated_actor_id: string | null;
  request_id: string | null;
  workflow_run_id: string | null;
  workflow_step_key: string | null;
  status: GatewayAuditEvent["status"];
  policy_decision: string;
  latency_ms: number | null;
  error_code: string | null;
  input_summary_json: string | null;
  output_summary_json: string | null;
  created_at: string;
};

function parseJson(value: string | null): Record<string, unknown> | null {
  if (!value) return null;
  return JSON.parse(value) as Record<string, unknown>;
}

function stringRecord(value: string | null): Record<string, string> {
  const parsed = parseJson(value);
  if (!parsed) return {};
  return Object.fromEntries(
    Object.entries(parsed).filter((entry): entry is [string, string] => typeof entry[1] === "string"),
  );
}

function credentialKey(value: string) {
  const normalized = value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9.-]+/g, "-")
    .replace(/^[^a-z]+/, "")
    .replace(/-+/g, "-")
    .replace(/^[-.]+|[-.]+$/g, "")
    .slice(0, 120);
  return normalized.length >= 2 ? normalized : "credential";
}

function environmentPrefix(value: string) {
  return value
    .replace(/\.admin$|\.read$|\.write$/, "")
    .replace(/([a-z0-9])([A-Z])/g, "$1_$2")
    .replace(/[^a-zA-Z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .toUpperCase();
}

function secretEnvironmentSuffix(value: string) {
  const normalized = environmentPrefix(value);
  if (normalized === "APIKEY" || normalized === "API_KEY") return "API_KEY";
  if (normalized === "ACCESSTOKEN" || normalized === "ACCESS_TOKEN") return "ACCESS_TOKEN";
  if (normalized === "SECRETCREDENTIAL" || normalized === "SECRET_CREDENTIAL") return "SECRET";
  return normalized || "SECRET";
}

function validateCredentialConfiguration(input: Record<string, string>) {
  if (Object.keys(input).length > 50) throw new GatewayStoreError("CREDENTIAL_CONFIGURATION_INVALID", 400);
  for (const [name, value] of Object.entries(input)) {
    if (!/^[A-Z_][A-Z0-9_]{0,119}$/.test(name) || !value || value.length > 10_000) {
      throw new GatewayStoreError("CREDENTIAL_CONFIGURATION_INVALID", 400);
    }
  }
}

function validateCredentialEnvBindings(input: Record<string, string>) {
  if (Object.keys(input).length > 50) throw new GatewayStoreError("CREDENTIAL_ENV_BINDINGS_INVALID", 400);
  for (const [envName, secretName] of Object.entries(input)) {
    if (
      !/^[A-Z_][A-Z0-9_]{0,119}$/.test(envName)
      || !/^[a-zA-Z][a-zA-Z0-9_.-]{0,63}$/.test(secretName)
    ) {
      throw new GatewayStoreError("CREDENTIAL_ENV_BINDINGS_INVALID", 400);
    }
  }
}

function connectionFromRow(
  db: Database.Database,
  row: ConnectionRow,
): GatewayConnection {
  const secretNames = (db.prepare(
    `SELECT secret_name AS name FROM encrypted_secrets WHERE connection_id = ?
     UNION
     SELECT secret_name AS name FROM stored_credential_bindings WHERE connection_id = ?
     ORDER BY name`,
  ).all(row.id, row.id) as Array<{ name: string }>).map((entry) => entry.name);
  return {
    id: row.id,
    key: row.credential_key || row.id,
    provider: row.provider,
    label: row.label,
    authType: row.auth_type,
    configuration: stringRecord(row.configuration_json),
    envBindings: stringRecord(row.env_bindings_json),
    status: row.status,
    secretNames,
    lastTestedAt: row.last_tested_at,
    lastUsedAt: row.last_used_at,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function storedCredentialFromRow(row: StoredCredentialRow): GatewayStoredCredential {
  return {
    id: row.id,
    name: row.name,
    source: row.source,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function auditFromRow(row: AuditRow): GatewayAuditEvent {
  return {
    id: row.id,
    traceId: row.trace_id,
    credentialKey: row.credential_key,
    authenticatedCallerId: row.authenticated_caller_id,
    delegatedActorId: row.delegated_actor_id,
    requestId: row.request_id,
    workflowRunId: row.workflow_run_id,
    workflowStepKey: row.workflow_step_key,
    status: row.status,
    policyDecision: row.policy_decision,
    latencyMs: row.latency_ms,
    errorCode: row.error_code,
    inputSummary: parseJson(row.input_summary_json),
    outputSummary: parseJson(row.output_summary_json),
    createdAt: row.created_at,
  };
}

export class GatewayStore {
  private readonly decryptionKeys: Map<string, Buffer>;

  constructor(
    private readonly db: Database.Database,
    private readonly encryption: {
      key: Buffer;
      keyVersion: string;
      previousKeys?: Array<{ key: Buffer; keyVersion: string }>;
    },
  ) {
    this.decryptionKeys = new Map([
      [encryption.keyVersion, encryption.key],
      ...(encryption.previousKeys ?? []).map((entry) => [entry.keyVersion, entry.key] as const),
    ]);
    this.backfillCredentialBundles();
  }

  private backfillCredentialBundles() {
    const rows = this.db.prepare(
      "SELECT * FROM integration_connections ORDER BY created_at, id",
    ).all() as ConnectionRow[];
    const usedKeys = new Set(rows.flatMap((row) => row.credential_key ? [row.credential_key] : []));
    const update = this.db.prepare(`
      UPDATE integration_connections
      SET credential_key = ?, configuration_json = ?, env_bindings_json = ?, updated_at = ?
      WHERE id = ?
    `);

    this.db.transaction(() => {
      for (const row of rows) {
        let key = row.credential_key;
        if (!key) {
          const base = credentialKey(row.provider !== "none" ? row.provider : row.label);
          key = base;
          let suffix = 2;
          while (usedKeys.has(key)) key = `${base.slice(0, 116)}-${suffix++}`;
          usedKeys.add(key);
        }

        const configuration = stringRecord(row.configuration_json);
        const envBindings = stringRecord(row.env_bindings_json);
        const secretNames = connectionFromRow(this.db, row).secretNames;
        const prefix = environmentPrefix(key);
        for (const secretName of secretNames) {
          const envName = `${prefix}_${secretEnvironmentSuffix(secretName)}`;
          envBindings[envName] ??= secretName;
        }

        const configurationJson = JSON.stringify(configuration);
        const envBindingsJson = JSON.stringify(envBindings);
        if (
          key !== row.credential_key
          || configurationJson !== row.configuration_json
          || envBindingsJson !== row.env_bindings_json
        ) {
          update.run(
            key,
            configurationJson,
            envBindingsJson,
            new Date().toISOString(),
            row.id,
          );
        }
      }
    })();
  }

  encryptionStatus() {
    const connectionVersions = this.db.prepare(`
      SELECT key_version AS keyVersion, COUNT(*) AS count
      FROM encrypted_secrets GROUP BY key_version ORDER BY key_version
    `).all() as Array<{ keyVersion: string; count: number }>;
    const storedVersions = this.db.prepare(`
      SELECT key_version AS keyVersion, COUNT(*) AS count
      FROM stored_credentials GROUP BY key_version ORDER BY key_version
    `).all() as Array<{ keyVersion: string; count: number }>;
    const versionCounts = new Map<string, number>();
    for (const entry of [...connectionVersions, ...storedVersions]) {
      versionCounts.set(entry.keyVersion, (versionCounts.get(entry.keyVersion) ?? 0) + entry.count);
    }
    const versions = Array.from(versionCounts, ([keyVersion, count]) => ({ keyVersion, count }))
      .sort((left, right) => left.keyVersion.localeCompare(right.keyVersion));
    const rows = this.db.prepare(`
      SELECT connection_id, secret_name, encrypted_value AS encryptedValue,
        nonce, auth_tag AS authTag, key_version AS keyVersion,
        associated_data_json AS associatedDataJson
      FROM encrypted_secrets
    `).all() as Array<SecretRow & { connection_id: string }>;
    let unreadableSecretCount = 0;
    for (const row of rows) {
      const key = this.decryptionKeys.get(row.keyVersion);
      if (!key) {
        unreadableSecretCount += 1;
        continue;
      }
      try {
        decryptSecret(row, {
          connectionId: row.connection_id,
          secretName: row.secret_name,
          key,
        });
      } catch {
        unreadableSecretCount += 1;
      }
    }
    const storedRows = this.db.prepare(`
      SELECT id, name, source, encrypted_value AS encryptedValue,
        nonce, auth_tag AS authTag, key_version AS keyVersion,
        associated_data_json AS associatedDataJson, created_at, updated_at
      FROM stored_credentials
    `).all() as StoredCredentialRow[];
    for (const row of storedRows) {
      const key = this.decryptionKeys.get(row.keyVersion);
      if (!key) {
        unreadableSecretCount += 1;
        continue;
      }
      try {
        decryptSecret(row, {
          connectionId: `stored:${row.id}`,
          secretName: row.name,
          key,
        });
      } catch {
        unreadableSecretCount += 1;
      }
    }
    return {
      currentKeyVersion: this.encryption.keyVersion,
      encryptedSecretCount: versions.reduce((total, entry) => total + entry.count, 0),
      unreadableSecretCount,
      versions,
      rotationRequired: versions.some((entry) => entry.keyVersion !== this.encryption.keyVersion),
      unavailableVersions: versions
        .map((entry) => entry.keyVersion)
        .filter((version) => !this.decryptionKeys.has(version)),
    };
  }

  rotateEncryptionKey() {
    const rows = this.db.prepare(`
      SELECT id, connection_id, secret_name, encrypted_value AS encryptedValue,
        nonce, auth_tag AS authTag, key_version AS keyVersion,
        associated_data_json AS associatedDataJson
      FROM encrypted_secrets ORDER BY connection_id, secret_name
    `).all() as Required<SecretRow>[];
    const pending = rows.filter((row) => row.keyVersion !== this.encryption.keyVersion);
    const storedRows = this.db.prepare(`
      SELECT id, name, source, encrypted_value AS encryptedValue,
        nonce, auth_tag AS authTag, key_version AS keyVersion,
        associated_data_json AS associatedDataJson, created_at, updated_at
      FROM stored_credentials ORDER BY name
    `).all() as StoredCredentialRow[];
    const storedPending = storedRows.filter((row) => row.keyVersion !== this.encryption.keyVersion);

    const update = this.db.prepare(`
      UPDATE encrypted_secrets
      SET encrypted_value = ?, nonce = ?, auth_tag = ?, key_version = ?,
        associated_data_json = ?, updated_at = ?
      WHERE id = ?
    `);
    this.db.transaction(() => {
      for (const row of pending) {
        const previousKey = this.decryptionKeys.get(row.keyVersion);
        if (!previousKey) throw new GatewayStoreError("ENCRYPTION_KEY_VERSION_UNAVAILABLE", 409);
        const plaintext = decryptSecret(row, {
          connectionId: row.connection_id,
          secretName: row.secret_name,
          key: previousKey,
        });
        const encrypted = encryptSecret(plaintext, {
          connectionId: row.connection_id,
          secretName: row.secret_name,
          key: this.encryption.key,
          keyVersion: this.encryption.keyVersion,
        });
        update.run(
          encrypted.encryptedValue,
          encrypted.nonce,
          encrypted.authTag,
          encrypted.keyVersion,
          encrypted.associatedDataJson,
          new Date().toISOString(),
          row.id,
        );
      }
      const updateStored = this.db.prepare(`
        UPDATE stored_credentials
        SET encrypted_value = ?, nonce = ?, auth_tag = ?, key_version = ?,
          associated_data_json = ?, updated_at = ?
        WHERE id = ?
      `);
      for (const row of storedPending) {
        const previousKey = this.decryptionKeys.get(row.keyVersion);
        if (!previousKey) throw new GatewayStoreError("ENCRYPTION_KEY_VERSION_UNAVAILABLE", 409);
        const plaintext = decryptSecret(row, {
          connectionId: `stored:${row.id}`,
          secretName: row.name,
          key: previousKey,
        });
        const encrypted = encryptSecret(plaintext, {
          connectionId: `stored:${row.id}`,
          secretName: row.name,
          key: this.encryption.key,
          keyVersion: this.encryption.keyVersion,
        });
        updateStored.run(
          encrypted.encryptedValue,
          encrypted.nonce,
          encrypted.authTag,
          encrypted.keyVersion,
          encrypted.associatedDataJson,
          new Date().toISOString(),
          row.id,
        );
      }
    })();
    return {
      rotated: pending.length + storedPending.length,
      skipped: rows.length - pending.length + storedRows.length - storedPending.length,
      ...this.encryptionStatus(),
    };
  }

  stats() {
    const count = (table: string) => (
      this.db.prepare(`SELECT COUNT(*) AS count FROM ${table}`).get() as { count: number }
    ).count;
    return {
      connections: count("integration_connections"),
      credentials: count("stored_credentials"),
      auditEvents: count("audit_events"),
    };
  }

  listStoredCredentials() {
    return (this.db.prepare(
      "SELECT * FROM stored_credentials ORDER BY name",
    ).all() as StoredCredentialRow[]).map(storedCredentialFromRow);
  }

  upsertStoredCredentials(
    credentials: Record<string, string>,
    source: GatewayStoredCredential["source"] = "environment-import",
  ) {
    const entries = Object.entries(credentials);
    if (!entries.length || entries.length > 100) {
      throw new GatewayStoreError("STORED_CREDENTIALS_INVALID", 400);
    }
    const select = this.db.prepare("SELECT id, created_at FROM stored_credentials WHERE name = ?");
    const upsert = this.db.prepare(`
      INSERT INTO stored_credentials
        (id, name, source, encrypted_value, nonce, auth_tag, key_version,
         associated_data_json, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(name) DO UPDATE SET
        source = excluded.source,
        encrypted_value = excluded.encrypted_value,
        nonce = excluded.nonce,
        auth_tag = excluded.auth_tag,
        key_version = excluded.key_version,
        associated_data_json = excluded.associated_data_json,
        updated_at = excluded.updated_at
    `);
    const imported: GatewayStoredCredential[] = [];
    this.db.transaction(() => {
      for (const [name, value] of entries) {
        if (!/^[A-Z_][A-Z0-9_]{0,119}$/.test(name) || !value || value.length > 100_000) {
          throw new GatewayStoreError("STORED_CREDENTIAL_INVALID", 400);
        }
        const existing = select.get(name) as { id: string; created_at: string } | undefined;
        const id = existing?.id ?? randomUUID();
        const now = new Date().toISOString();
        const encrypted = encryptSecret(value, {
          connectionId: `stored:${id}`,
          secretName: name,
          keyVersion: this.encryption.keyVersion,
          key: this.encryption.key,
        });
        upsert.run(
          id, name, source, encrypted.encryptedValue, encrypted.nonce,
          encrypted.authTag, encrypted.keyVersion, encrypted.associatedDataJson,
          existing?.created_at ?? now, now,
        );
        const row = this.db.prepare("SELECT * FROM stored_credentials WHERE id = ?").get(id) as StoredCredentialRow;
        imported.push(storedCredentialFromRow(row));
      }
    })();
    return imported;
  }

  bindStoredCredentials(connectionId: string, bindings: Record<string, string>) {
    const connection = this.getConnection(connectionId);
    if (!connection || connection.status === "revoked") {
      throw new GatewayStoreError("CONNECTION_UNAVAILABLE", 404);
    }
    const entries = Object.entries(bindings);
    if (!entries.length || entries.length > 20) {
      throw new GatewayStoreError("STORED_CREDENTIAL_BINDINGS_INVALID", 400);
    }
    const resolved = entries.map(([secretName, storedName]) => {
      if (!/^[a-zA-Z][a-zA-Z0-9_.-]{0,63}$/.test(secretName) || !/^[A-Z_][A-Z0-9_]{0,119}$/.test(storedName)) {
        throw new GatewayStoreError("STORED_CREDENTIAL_BINDING_INVALID", 400);
      }
      const stored = this.db.prepare(
        "SELECT id FROM stored_credentials WHERE name = ?",
      ).get(storedName) as { id: string } | undefined;
      if (!stored) throw new GatewayStoreError("STORED_CREDENTIAL_NOT_FOUND", 404);
      return { secretName, storedCredentialId: stored.id };
    });
    const now = new Date().toISOString();
    this.db.transaction(() => {
      this.db.prepare("DELETE FROM encrypted_secrets WHERE connection_id = ?").run(connectionId);
      this.db.prepare("DELETE FROM stored_credential_bindings WHERE connection_id = ?").run(connectionId);
      const insert = this.db.prepare(`
        INSERT INTO stored_credential_bindings
          (connection_id, secret_name, stored_credential_id, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?)
      `);
      for (const binding of resolved) {
        insert.run(connectionId, binding.secretName, binding.storedCredentialId, now, now);
      }
      this.db.prepare(`
        UPDATE integration_connections
        SET status = 'untested', last_tested_at = NULL, updated_at = ?
        WHERE id = ?
      `).run(now, connectionId);
    })();
    return this.getConnection(connectionId)!;
  }

  listConnections() {
    const rows = this.db.prepare(
      "SELECT * FROM integration_connections ORDER BY label, id",
    ).all() as ConnectionRow[];
    return rows.map((row) => connectionFromRow(this.db, row));
  }

  getConnection(id: string) {
    const row = this.db.prepare(
      "SELECT * FROM integration_connections WHERE id = ?",
    ).get(id) as ConnectionRow | undefined;
    return row ? connectionFromRow(this.db, row) : null;
  }

  getCredential(keyOrAlias: string) {
    const direct = this.db.prepare(
      "SELECT * FROM integration_connections WHERE credential_key = ? OR id = ?",
    ).get(keyOrAlias, keyOrAlias) as ConnectionRow | undefined;
    return direct ? connectionFromRow(this.db, direct) : null;
  }

  createConnection(input: {
    key?: string;
    provider: string;
    label: string;
    authType: string;
    credentials: Record<string, string>;
    configuration?: Record<string, string>;
    envBindings?: Record<string, string>;
  }) {
    const id = randomUUID();
    const now = new Date().toISOString();
    const entries = Object.entries(input.credentials);
    const key = credentialKey(input.key || input.label);
    const configuration = input.configuration ?? {};
    const prefix = environmentPrefix(key);
    const envBindings = input.envBindings ?? Object.fromEntries(
      entries.map(([name]) => [`${prefix}_${secretEnvironmentSuffix(name)}`, name]),
    );
    validateCredentialConfiguration(configuration);
    validateCredentialEnvBindings(envBindings);
    if (this.getCredential(key)) throw new GatewayStoreError("CREDENTIAL_KEY_CONFLICT", 409);

    this.db.transaction(() => {
      this.db.prepare(`
        INSERT INTO integration_connections
          (id, credential_key, provider, label, auth_type, configuration_json,
           env_bindings_json, status, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, 'untested', ?, ?)
      `).run(
        id,
        key,
        input.provider,
        input.label,
        input.authType,
        JSON.stringify(configuration),
        JSON.stringify(envBindings),
        now,
        now,
      );
      if (entries.length > 0) this.writeCredentials(id, entries, now);
    })();

    return this.getConnection(id)!;
  }

  updateCredentialBundle(id: string, input: {
    label?: string;
    authType?: string;
    configuration?: Record<string, string>;
    envBindings?: Record<string, string>;
  }) {
    const connection = this.getConnection(id);
    if (!connection) throw new GatewayStoreError("CONNECTION_NOT_FOUND", 404);
    if (connection.status === "revoked") throw new GatewayStoreError("CONNECTION_UNAVAILABLE", 409);
    const configuration = input.configuration ?? connection.configuration;
    const envBindings = input.envBindings ?? connection.envBindings;
    validateCredentialConfiguration(configuration);
    validateCredentialEnvBindings(envBindings);
    const label = input.label?.trim() || connection.label;
    const authType = input.authType?.trim() || connection.authType;
    this.db.prepare(`
      UPDATE integration_connections
      SET label = ?, auth_type = ?, configuration_json = ?, env_bindings_json = ?, updated_at = ?
      WHERE id = ?
    `).run(
      label,
      authType,
      JSON.stringify(configuration),
      JSON.stringify(envBindings),
      new Date().toISOString(),
      id,
    );
    return this.getConnection(id)!;
  }

  replaceConnectionCredentials(id: string, credentials: Record<string, string>) {
    const entries = Object.entries(credentials);
    if (!this.getConnection(id)) throw new GatewayStoreError("CONNECTION_NOT_FOUND", 404);
    if (entries.length === 0) throw new GatewayStoreError("CONNECTION_CREDENTIALS_REQUIRED", 400);
    const now = new Date().toISOString();
    this.db.transaction(() => {
      this.db.prepare("DELETE FROM encrypted_secrets WHERE connection_id = ?").run(id);
      this.db.prepare("DELETE FROM stored_credential_bindings WHERE connection_id = ?").run(id);
      this.writeCredentials(id, entries, now);
      this.db.prepare(`
        UPDATE integration_connections
        SET status = 'untested', last_tested_at = NULL, updated_at = ?
        WHERE id = ?
      `).run(now, id);
    })();
    return this.getConnection(id)!;
  }

  revokeConnection(id: string) {
    if (!this.getConnection(id)) throw new GatewayStoreError("CONNECTION_NOT_FOUND", 404);
    const now = new Date().toISOString();
    this.db.transaction(() => {
      this.db.prepare("DELETE FROM encrypted_secrets WHERE connection_id = ?").run(id);
      this.db.prepare("DELETE FROM stored_credential_bindings WHERE connection_id = ?").run(id);
      this.db.prepare(`
        UPDATE integration_connections SET status = 'revoked', updated_at = ? WHERE id = ?
      `).run(now, id);
    })();
    return this.getConnection(id)!;
  }

  getConnectionCredentials(id: string) {
    if (!this.getConnection(id)) throw new GatewayStoreError("CONNECTION_NOT_FOUND", 404);
    const rows = this.db.prepare(`
      SELECT
        secret_name,
        encrypted_value AS encryptedValue,
        nonce,
        auth_tag AS authTag,
        key_version AS keyVersion,
        associated_data_json AS associatedDataJson
      FROM encrypted_secrets WHERE connection_id = ? ORDER BY secret_name
    `).all(id) as SecretRow[];
    const credentials: Record<string, string> = Object.fromEntries(rows.map((row) => [
      row.secret_name,
      decryptSecret(row, {
        connectionId: id,
        secretName: row.secret_name,
        key: this.decryptionKeys.get(row.keyVersion)
          ?? (() => { throw new GatewayStoreError("ENCRYPTION_KEY_VERSION_UNAVAILABLE", 503); })(),
      }),
    ]));
    const bindings = this.db.prepare(`
      SELECT b.secret_name, c.id, c.name, c.source,
        c.encrypted_value AS encryptedValue, c.nonce,
        c.auth_tag AS authTag, c.key_version AS keyVersion,
        c.associated_data_json AS associatedDataJson,
        c.created_at, c.updated_at
      FROM stored_credential_bindings b
      JOIN stored_credentials c ON c.id = b.stored_credential_id
      WHERE b.connection_id = ?
      ORDER BY b.secret_name
    `).all(id) as Array<StoredCredentialRow & { secret_name: string }>;
    for (const binding of bindings) {
      const key = this.decryptionKeys.get(binding.keyVersion);
      if (!key) throw new GatewayStoreError("ENCRYPTION_KEY_VERSION_UNAVAILABLE", 503);
      credentials[binding.secret_name] = decryptSecret(binding, {
        connectionId: `stored:${binding.id}`,
        secretName: binding.name,
        key,
      });
    }
    return credentials;
  }

  private writeCredentials(id: string, entries: Array<[string, string]>, now: string) {
    const insert = this.db.prepare(`
      INSERT INTO encrypted_secrets
        (id, connection_id, secret_name, encrypted_value, nonce, auth_tag, key_version,
         associated_data_json, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);
    for (const [secretName, value] of entries) {
      if (!/^[a-zA-Z][a-zA-Z0-9_.-]{0,63}$/.test(secretName) || !value) {
        throw new GatewayStoreError("CONNECTION_CREDENTIAL_INVALID", 400);
      }
      const encrypted = encryptSecret(value, {
        connectionId: id,
        secretName,
        keyVersion: this.encryption.keyVersion,
        key: this.encryption.key,
      });
      insert.run(
        randomUUID(), id, secretName, encrypted.encryptedValue, encrypted.nonce,
        encrypted.authTag, encrypted.keyVersion, encrypted.associatedDataJson, now, now,
      );
    }
  }

  markConnectionLeased(id: string) {
    const now = new Date().toISOString();
    this.db.prepare(`
      UPDATE integration_connections
      SET status = CASE WHEN status = 'untested' THEN 'leased' ELSE status END,
          last_used_at = ?, updated_at = ?
      WHERE id = ? AND status != 'revoked'
    `).run(now, now, id);
  }

  recordCredentialLease(input: {
    traceId: string;
    credentialKey: string;
    caller: GatewayCaller;
    context: GatewayInvocationContext;
    environmentNames: string[];
  }) {
    const now = new Date().toISOString();
    this.db.prepare(`
      INSERT INTO audit_events
        (id, trace_id, credential_key, authenticated_caller_id, delegated_actor_id,
         request_id, workflow_run_id, workflow_step_key, status, policy_decision,
         latency_ms, error_code, input_summary_json, output_summary_json, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'succeeded', 'trusted_runtime_credential_lease',
        0, NULL, ?, ?, ?)
    `).run(
      randomUUID(), input.traceId, input.credentialKey, input.caller.id,
      input.context.delegatedActorId || null, input.context.requestId || null,
      input.context.workflowRunId || null, input.context.workflowStepKey || null,
      JSON.stringify({ action: "lease" }),
      JSON.stringify({ envNames: input.environmentNames }),
      now,
    );
  }

  listAuditEvents(limit = 100) {
    const normalized = Math.min(Math.max(limit, 1), 500);
    return (this.db.prepare("SELECT * FROM audit_events ORDER BY created_at DESC LIMIT ?").all(normalized) as AuditRow[])
      .map(auditFromRow);
  }

  getAuditEvent(traceId: string) {
    const row = this.db.prepare("SELECT * FROM audit_events WHERE trace_id = ?").get(traceId) as AuditRow | undefined;
    return row ? auditFromRow(row) : null;
  }
}
