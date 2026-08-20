import type {Statement} from "better-sqlite3";

import type {SqliteDatabase} from "../database.js";

interface StatusRow {
  schema_version: number | null;
  migration_count: number;
}

export interface DatabaseStatus {
  status: "ready";
  schemaVersion: number;
  migrationCount: number;
}

export class DatabaseStatusRepository {
  readonly #statusStatement: Statement<[], StatusRow>;

  constructor(database: SqliteDatabase) {
    this.#statusStatement = database.prepare<[], StatusRow>(
      "SELECT MAX(version) AS schema_version, COUNT(*) AS migration_count FROM schema_migrations"
    );
  }

  read(): DatabaseStatus {
    const row = this.#statusStatement.get();
    if (!row) {
      throw new Error("SQLite schema status is unavailable.");
    }
    return {
      status: "ready",
      schemaVersion: row.schema_version ?? 0,
      migrationCount: row.migration_count
    };
  }
}
