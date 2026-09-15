# Prism Gateway Backup, Restore, and Key Rotation

Status: active operations runbook

This runbook covers the Gateway SQLite database and its external master
encryption key. A usable recovery requires both. The database contains encrypted
provider credentials; Railway variables contain the key material needed to
decrypt them.

## Invariants

- Never print, commit, download into the repository, or send master keys through
  chat.
- Keep `GATEWAY_MASTER_ENCRYPTION_KEY` in the deployment secret store.
- Give every key a stable, unique `GATEWAY_MASTER_KEY_VERSION` such as `v1` or
  `2026-07`.
- Preserve the key version named by a backup manifest for as long as that backup
  is retained.
- Stop Gateway before replacing its live database.
- Do not remove a previous key until health reports only the current version.
- Treat local snapshots on the Gateway volume as recovery points, not as
  protection against loss of that volume.

## Create a Snapshot

Call the authenticated operations route from a trusted server-side environment:

```bash
curl -fsSL \
  -X POST \
  -H "x-gateway-token: $GATEWAY_SITE_TOKEN" \
  "$PRISM_GATEWAY_BASE_URL/ops/backup"
```

Gateway writes these files under `<database-directory>/backups/`:

```text
prism-gateway-<timestamp>.sqlite
prism-gateway-<timestamp>.sqlite.json
```

The JSON manifest records the creation time, byte count, SHA-256 checksum,
current key version, and all encrypted-secret versions in the snapshot. It does
not contain a key. Export the snapshot and manifest together or ensure the
mounted volume has an independent backup policy.

Create a snapshot before schema changes, credential migrations, and master-key
rotation. Create another after a successful rotation so the newest recovery
point requires only the new key.

## Restore a Snapshot

1. Locate the `.sqlite` snapshot, its `.json` manifest, and the deployment
   secret matching every `encryptedSecretVersions[].keyVersion` in the manifest.
2. Verify the snapshot SHA-256 against the manifest.
3. Stop the Gateway service so no process has the live SQLite database open.
4. Preserve the current database and any `-wal` or `-shm` files as a rollback
   copy.
5. Copy the snapshot to the configured `GATEWAY_DB_PATH` and remove stale
   `<GATEWAY_DB_PATH>-wal` and `<GATEWAY_DB_PATH>-shm` files.
6. Configure the manifest's current key as
   `GATEWAY_MASTER_ENCRYPTION_KEY`/`GATEWAY_MASTER_KEY_VERSION`. If the snapshot
   contains another version, configure it as the previous key pair.
7. Start Gateway and inspect `GET /health`. Require database `ok: true`, no
   `encryption.unavailableVersions`, zero `encryption.unreadableSecretCount`,
   and HTTP `200`.
8. Test one read-only connected service, one trusted-runtime compatibility lease
   if used, and Site connection listing before reopening normal traffic.
9. Create a fresh snapshot after recovery.

If health returns `503` with an unavailable key version, stop. Do not replace
credentials or rotate. Restore the missing matching key first.

## Rotate the Master Key

Rotation is a two-deploy procedure. The re-encryption operation is transactional
and idempotent: either every old row is committed under the new version or the
database remains unchanged.

1. Create and export a pre-rotation snapshot.
2. Record the current key and version in the deployment secret store as:

   ```text
   GATEWAY_PREVIOUS_MASTER_ENCRYPTION_KEY=<old current key>
   GATEWAY_PREVIOUS_MASTER_KEY_VERSION=<old current version>
   ```

3. Generate a new 32-byte key and unique version, then set them as:

   ```text
   GATEWAY_MASTER_ENCRYPTION_KEY=<new key>
   GATEWAY_MASTER_KEY_VERSION=<new version>
   ```

4. Deploy Gateway. `GET /health` should return `200` with
   `encryption.rotationRequired: true` and no unavailable versions.
5. Trigger re-encryption:

   ```bash
   curl -fsSL \
     -X POST \
     -H "x-gateway-token: $GATEWAY_SITE_TOKEN" \
     "$PRISM_GATEWAY_BASE_URL/ops/rotate-master-key"
   ```

6. Require `rotationRequired: false`, `unavailableVersions: []`, and only the new
   version in `encryption.versions`. Repeating the call should report zero rows
   rotated.
7. Test representative connected services and create/export a post-rotation
   snapshot.
8. Remove both `GATEWAY_PREVIOUS_*` variables and deploy again.
9. Recheck health and the representative connected services.

If step 4 fails, restore the environment variables to the old key as current.
If step 5 fails, the transaction leaves the rows under their prior versions;
keep both keys configured, inspect the error, and retry only after correction.

## Retention

Retention is operator-owned in this slice. Keep at minimum:

- the latest verified post-change snapshot
- one verified snapshot from before the latest migration or key rotation
- the matching key versions in the deployment secret store

Delete snapshots and retire old keys together. A snapshot without its matching
key is not recoverable; an old key with no retained snapshot or encrypted rows
has no operational value.
