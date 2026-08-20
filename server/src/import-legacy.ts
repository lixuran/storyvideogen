import path from "node:path";

import {loadConfig} from "./config.js";
import {openDatabase} from "./db/database.js";
import {migrateDatabase} from "./db/migrate.js";
import {importLegacy} from "./legacy/importLegacy.js";
import {SecretCipher} from "./security/secretCipher.js";

const args = new Map<string, string>();
for (let index = 2; index < process.argv.length; index += 2) {
  const key = process.argv[index];
  const value = process.argv[index + 1];
  if (!key?.startsWith("--") || value === undefined) throw new Error("Usage: import:legacy --auth-db <path> --user-root <path> [--dry-run true|false]");
  args.set(key, value);
}
const config = loadConfig();
const authDatabasePath = path.resolve(args.get("--auth-db") ?? "output/ui_auth.sqlite3");
const userRoot = path.resolve(args.get("--user-root") ?? "output/ui_users");
const dryRun = (args.get("--dry-run") ?? "true") !== "false";
const database = openDatabase({filename: dryRun ? ":memory:" : config.databasePath, busyTimeoutMs: config.databaseBusyTimeoutMs});
try {
  migrateDatabase(database, config.migrationsDir);
  const cipher = config.secretMasterKey ? new SecretCipher(config.secretMasterKey, config.secretKeyId) : undefined;
  const report = importLegacy(database, {authDatabasePath, userRoot, storageRoot: config.storageRoot, dryRun, cipher});
  console.log(JSON.stringify(report));
  if (report.corrupt.length) process.exitCode = 1;
} finally {
  database.close();
}
