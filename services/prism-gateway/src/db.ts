import fs from "node:fs";
import path from "node:path";
import Database from "better-sqlite3";
import { gatewayMigrations } from "./migrations.js";

function ensureMigrationTable(db: Database.Database) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      name TEXT PRIMARY KEY,
      applied_at TEXT NOT NULL
    );
  `);
}

export function openGatewayDatabase(dbPath: string): Database.Database {
  fs.mkdirSync(path.dirname(dbPath), { recursive: true });
  const db = new Database(dbPath);
  db.pragma("journal_mode = WAL");
  db.pragma("foreign_keys = ON");
  db.pragma("busy_timeout = 5000");
  ensureMigrationTable(db);
  return db;
}

export function runGatewayMigrations(db: Database.Database) {
  ensureMigrationTable(db);
  const applied = new Set(
    (db.prepare("SELECT name FROM schema_migrations").all() as Array<{ name: string }>)
      .map((row) => row.name),
  );
  const recordMigration = db.prepare(
    "INSERT INTO schema_migrations (name, applied_at) VALUES (?, ?)",
  );
  const executed: string[] = [];

  for (const migration of gatewayMigrations) {
    if (applied.has(migration.name)) continue;
    db.transaction(() => {
      db.exec(migration.sql);
      recordMigration.run(migration.name, new Date().toISOString());
    })();
    executed.push(migration.name);
  }

  return { executed, totalKnown: gatewayMigrations.length };
}
