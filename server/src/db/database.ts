import {mkdirSync} from "node:fs";
import path from "node:path";

import Database from "better-sqlite3";

export type SqliteDatabase = Database.Database;

export interface OpenDatabaseOptions {
  filename: string;
  busyTimeoutMs: number;
}

export function openDatabase(options: OpenDatabaseOptions): SqliteDatabase {
  if (options.filename !== ":memory:") {
    mkdirSync(path.dirname(options.filename), {recursive: true});
  }

  const database = new Database(options.filename);
  try {
    database.unsafeMode(false);
    database.pragma("foreign_keys = ON");
    database.pragma(`busy_timeout = ${options.busyTimeoutMs}`);
    database.pragma("journal_mode = WAL");
    database.pragma("synchronous = NORMAL");
    database.pragma("trusted_schema = OFF");

    if (Number(database.pragma("foreign_keys", {simple: true})) !== 1) {
      throw new Error("SQLite foreign-key enforcement could not be enabled.");
    }
    return database;
  } catch (error) {
    database.close();
    throw error;
  }
}
