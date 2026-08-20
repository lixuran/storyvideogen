import {createHash} from "node:crypto";
import {readdirSync, readFileSync} from "node:fs";
import path from "node:path";

import type {SqliteDatabase} from "./database.js";
import {SchemaMigrationRepository} from "./repositories/schemaMigrationRepository.js";

const migrationNamePattern = /^(\d{4})_([a-z0-9_]+)\.sql$/;
export const latestSchemaVersion = 6;

export interface Migration {
  version: number;
  name: string;
  checksum: string;
  sql: string;
}

export interface MigrationResult {
  currentVersion: number;
  appliedVersions: number[];
}

export function loadMigrations(migrationsDir: string): Migration[] {
  const migrations = readdirSync(migrationsDir, {withFileTypes: true})
    .filter((entry) => entry.isFile() && entry.name.endsWith(".sql"))
    .map((entry) => {
      const match = migrationNamePattern.exec(entry.name);
      if (!match) {
        throw new Error(`Invalid migration filename: ${entry.name}`);
      }
      const sql = readFileSync(path.join(migrationsDir, entry.name), "utf8").replace(/\r\n?/g, "\n");
      return {
        version: Number(match[1]),
        name: entry.name,
        checksum: createHash("sha256").update(sql).digest("hex"),
        sql
      };
    })
    .sort((left, right) => left.version - right.version);

  migrations.forEach((migration, index) => {
    const expectedVersion = index + 1;
    if (migration.version !== expectedVersion) {
      throw new Error(`Expected migration version ${expectedVersion}, found ${migration.version}.`);
    }
  });
  return migrations;
}

export function migrateDatabase(database: SqliteDatabase, migrationsDir: string): MigrationResult {
  const migrations = loadMigrations(migrationsDir);
  const availableVersion = migrations.at(-1)?.version ?? 0;
  if (availableVersion !== latestSchemaVersion) {
    throw new Error(`Expected latest migration version ${latestSchemaVersion}, found ${availableVersion}.`);
  }
  return applyMigrations(database, migrations);
}

export function applyMigrations(database: SqliteDatabase, migrations: readonly Migration[]): MigrationResult {
  validateMigrationSequence(migrations);
  database.exec("BEGIN EXCLUSIVE");
  try {
    database.exec(`
      CREATE TABLE IF NOT EXISTS schema_migrations (
        version INTEGER PRIMARY KEY,
        name TEXT NOT NULL UNIQUE,
        checksum TEXT NOT NULL,
        applied_at TEXT NOT NULL
      ) STRICT
    `);
    const repository = new SchemaMigrationRepository(database);
    const applied = repository.list();
    const availableByVersion = new Map(migrations.map((migration) => [migration.version, migration]));

    for (const [index, existing] of applied.entries()) {
      if (existing.version !== index + 1) {
        throw new Error("Applied migration history must be a contiguous prefix.");
      }
      const available = availableByVersion.get(existing.version);
      if (!available) {
        throw new Error(`Applied migration ${existing.version} is not available.`);
      }
      if (available.name !== existing.name || available.checksum !== existing.checksum) {
        throw new Error(`Applied migration ${existing.version} no longer matches its recorded checksum.`);
      }
    }

    const appliedVersions: number[] = [];
    const appliedVersionSet = new Set(applied.map((migration) => migration.version));
    for (const migration of migrations) {
      if (appliedVersionSet.has(migration.version)) {
        continue;
      }
      database.exec(migration.sql);
      repository.record(migration, new Date().toISOString());
      appliedVersions.push(migration.version);
    }
    database.exec("COMMIT");
    return {
      currentVersion: migrations.at(-1)?.version ?? 0,
      appliedVersions
    };
  } catch (error) {
    if (database.inTransaction) {
      database.exec("ROLLBACK");
    }
    throw error;
  }
}

function validateMigrationSequence(migrations: readonly Migration[]): void {
  migrations.forEach((migration, index) => {
    const expectedVersion = index + 1;
    if (migration.version !== expectedVersion) {
      throw new Error(`Expected migration version ${expectedVersion}, found ${migration.version}.`);
    }
  });
}
