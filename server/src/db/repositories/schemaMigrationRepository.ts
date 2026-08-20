import type {Statement} from "better-sqlite3";

import type {SqliteDatabase} from "../database.js";

export interface AppliedMigration {
  version: number;
  name: string;
  checksum: string;
  appliedAt: string;
}

interface AppliedMigrationRow {
  version: number;
  name: string;
  checksum: string;
  applied_at: string;
}

export class SchemaMigrationRepository {
  readonly #listStatement: Statement<[], AppliedMigrationRow>;
  readonly #insertStatement: Statement<[number, string, string, string]>;

  constructor(database: SqliteDatabase) {
    this.#listStatement = database.prepare<[], AppliedMigrationRow>(
      "SELECT version, name, checksum, applied_at FROM schema_migrations ORDER BY version"
    );
    this.#insertStatement = database.prepare<[number, string, string, string]>(
      "INSERT INTO schema_migrations (version, name, checksum, applied_at) VALUES (?, ?, ?, ?)"
    );
  }

  list(): AppliedMigration[] {
    return this.#listStatement.all().map((row) => ({
      version: row.version,
      name: row.name,
      checksum: row.checksum,
      appliedAt: row.applied_at
    }));
  }

  record(migration: Omit<AppliedMigration, "appliedAt">, appliedAt: string): void {
    this.#insertStatement.run(migration.version, migration.name, migration.checksum, appliedAt);
  }
}
