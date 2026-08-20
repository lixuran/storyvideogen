import {loadConfig} from "./config.js";
import {openDatabase} from "./db/database.js";
import {migrateDatabase} from "./db/migrate.js";
import {IdentityRepository} from "./db/repositories/identityRepository.js";

const username = process.argv[2]?.trim().toLowerCase();
if (!username) {
  console.error("Usage: npm run admin:bootstrap -- <existing-username>");
  process.exitCode = 2;
} else {
  const config = loadConfig();
  const database = openDatabase({filename: config.databasePath, busyTimeoutMs: config.databaseBusyTimeoutMs});
  try {
    migrateDatabase(database, config.migrationsDir);
    const result = new IdentityRepository(database).promoteToAdmin(username, new Date().toISOString());
    if (result === "not-found") {
      console.error("No matching user exists. Register the account first.");
      process.exitCode = 1;
    } else {
      console.log(result === "updated" ? `Promoted ${username} to admin.` : `${username} is already an admin.`);
    }
  } finally {
    database.close();
  }
}
