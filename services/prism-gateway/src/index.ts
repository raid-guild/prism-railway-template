import { createGatewayApp } from "./app.js";
import { loadConfig } from "./config.js";
import { openGatewayDatabase, runGatewayMigrations } from "./db.js";
import { GatewayStore } from "./store.js";

const config = loadConfig();
const db = openGatewayDatabase(config.dbPath);
const migrations = runGatewayMigrations(db);
const store = new GatewayStore(db, {
  key: config.masterKey,
  keyVersion: config.masterKeyVersion,
  previousKeys: config.previousMasterKeys,
});

const app = createGatewayApp({
  config,
  db,
  store,
  migrationCount: migrations.totalKnown,
});

const server = app.listen(config.port, "0.0.0.0", () => {
  console.log(JSON.stringify({
    event: "prism-gateway.started",
    port: config.port,
    dbPath: config.dbPath,
    migrationsApplied: migrations.executed,
    callersConfigured: config.callers.map((caller) => caller.id),
  }));
});

function shutdown(signal: string) {
  console.log(JSON.stringify({ event: "prism-gateway.stopping", signal }));
  server.close(() => {
    db.close();
    process.exit(0);
  });
}

process.on("SIGTERM", () => shutdown("SIGTERM"));
process.on("SIGINT", () => shutdown("SIGINT"));
