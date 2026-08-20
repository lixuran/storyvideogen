import assert from "node:assert/strict";
import {mkdirSync, mkdtempSync, rmSync, writeFileSync} from "node:fs";
import {tmpdir} from "node:os";
import path from "node:path";
import test, {type TestContext} from "node:test";

import {openDatabase, type SqliteDatabase} from "./database.js";
import {applyMigrations, loadMigrations, migrateDatabase, type Migration} from "./migrate.js";
import {DatabaseStatusRepository} from "./repositories/databaseStatusRepository.js";
import {runInTransaction} from "./transaction.js";

const migrationsDir = path.resolve("server", "migrations");

test("database connections enforce the approved SQLite pragmas", (context) => {
  const {database} = createTestDatabase(context, "pragmas.sqlite3");
  assert.equal(Number(database.pragma("foreign_keys", {simple: true})), 1);
  assert.equal(String(database.pragma("journal_mode", {simple: true})).toLowerCase(), "wal");
  assert.equal(Number(database.pragma("busy_timeout", {simple: true})), 5_000);
  assert.equal(Number(database.pragma("trusted_schema", {simple: true})), 0);
});

test("every prior schema version migrates deterministically to the latest version", (context) => {
  const root = createTempRoot(context);
  const migrations = loadMigrations(migrationsDir);
  assert.deepEqual(migrations.map((migration) => migration.version), [1, 2, 3, 4, 5, 6]);

  for (let previousVersion = 0; previousVersion <= migrations.length; previousVersion += 1) {
    const database = openDatabase({
      filename: path.join(root, `from-${previousVersion}.sqlite3`),
      busyTimeoutMs: 5_000
    });
    try {
      const previousMigrations = migrations.slice(0, previousVersion);
      const initial = applyMigrations(database, previousMigrations);
      assert.equal(initial.currentVersion, previousVersion);

      const upgraded = applyMigrations(database, migrations);
      assert.equal(upgraded.currentVersion, 6);
      assert.deepEqual(
        upgraded.appliedVersions,
        migrations.slice(previousVersion).map((migration) => migration.version)
      );

      const repeated = applyMigrations(database, migrations);
      assert.equal(repeated.currentVersion, 6);
      assert.deepEqual(repeated.appliedVersions, []);
      assert.deepEqual(new DatabaseStatusRepository(database).read(), {
        status: "ready",
        schemaVersion: 6,
        migrationCount: 6
      });
    } finally {
      database.close();
    }
  }
});

test("reopening an existing database does not duplicate migration state", (context) => {
  const root = createTempRoot(context);
  const filename = path.join(root, "restart.sqlite3");

  const first = openDatabase({filename, busyTimeoutMs: 5_000});
  const firstResult = migrateDatabase(first, migrationsDir);
  assert.deepEqual(firstResult.appliedVersions, [1, 2, 3, 4, 5, 6]);
  first.close();

  const second = openDatabase({filename, busyTimeoutMs: 5_000});
  try {
    const secondResult = migrateDatabase(second, migrationsDir);
    assert.deepEqual(secondResult.appliedVersions, []);
    assert.deepEqual(new DatabaseStatusRepository(second).read(), {
      status: "ready",
      schemaVersion: 6,
      migrationCount: 6
    });
  } finally {
    second.close();
  }
});

test("foreign keys and explicit transaction rollback protect repository writes", (context) => {
  const {database} = createTestDatabase(context, "constraints.sqlite3");
  migrateDatabase(database, migrationsDir);

  const insertStory = database.prepare(`
    INSERT INTO stories (id, user_id, name, source_text, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?)
  `);
  assert.throws(
    () => insertStory.run("story-1", "missing-user", "Story", "Full story", now(), now()),
    /FOREIGN KEY constraint failed/
  );

  const insertUser = database.prepare(`
    INSERT INTO users (id, username, password_hash, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?)
  `);
  assert.throws(
    () => runInTransaction(database, () => {
      insertUser.run("user-1", "alice", "hash", now(), now());
      throw new Error("rollback marker");
    }),
    /rollback marker/
  );
  const userCount = database.prepare<[], {count: number}>("SELECT COUNT(*) AS count FROM users").get();
  assert.equal(userCount?.count, 0);
});

test("a failed migration rolls back without advancing the recorded version", (context) => {
  const {database} = createTestDatabase(context, "broken.sqlite3");
  const migrations = loadMigrations(migrationsDir);
  applyMigrations(database, migrations.slice(0, 1));

  const broken: Migration = {
    version: 2,
    name: "0002_broken.sql",
    checksum: "broken-checksum",
    sql: "CREATE TABLE migration_should_rollback (id TEXT) STRICT; THIS IS NOT SQL;"
  };
  assert.throws(() => applyMigrations(database, [migrations[0]!, broken]), /syntax error/i);
  assert.deepEqual(new DatabaseStatusRepository(database).read(), {
    status: "ready",
    schemaVersion: 1,
    migrationCount: 1
  });
  const rolledBackTable = database.prepare<[], {count: number}>(`
    SELECT COUNT(*) AS count FROM sqlite_master WHERE type = 'table' AND name = 'migration_should_rollback'
  `).get();
  assert.equal(rolledBackTable?.count, 0);
});

test("an applied migration cannot be silently modified", (context) => {
  const {database} = createTestDatabase(context, "checksum.sqlite3");
  const [first] = loadMigrations(migrationsDir);
  assert.ok(first);
  applyMigrations(database, [first]);

  assert.throws(
    () => applyMigrations(database, [{...first, checksum: "different"}]),
    /recorded checksum/
  );
});

test("migration checksums are stable across platform line endings", (context) => {
  const root = createTempRoot(context);
  const lfDirectory = path.join(root, "lf");
  const crlfDirectory = path.join(root, "crlf");
  mkdirSync(lfDirectory);
  mkdirSync(crlfDirectory);
  writeFileSync(path.join(lfDirectory, "0001_test.sql"), "CREATE TABLE test (id TEXT) STRICT;\n", "utf8");
  writeFileSync(path.join(crlfDirectory, "0001_test.sql"), "CREATE TABLE test (id TEXT) STRICT;\r\n", "utf8");

  const [lfMigration] = loadMigrations(lfDirectory);
  const [crlfMigration] = loadMigrations(crlfDirectory);
  assert.ok(lfMigration);
  assert.ok(crlfMigration);
  assert.equal(lfMigration.checksum, crlfMigration.checksum);
});

test("production migration startup rejects an incomplete migration set", (context) => {
  const root = createTempRoot(context);
  const incompleteDirectory = path.join(root, "incomplete");
  mkdirSync(incompleteDirectory);
  writeFileSync(
    path.join(incompleteDirectory, "0001_only.sql"),
    "CREATE TABLE incomplete (id TEXT) STRICT;\n",
    "utf8"
  );
  const database = openDatabase({filename: path.join(root, "incomplete.sqlite3"), busyTimeoutMs: 5_000});
  try {
    assert.throws(() => migrateDatabase(database, incompleteDirectory), /latest migration version 6/i);
  } finally {
    database.close();
  }
});

test("migration history must be a contiguous applied prefix", (context) => {
  const {database} = createTestDatabase(context, "history-gap.sqlite3");
  const migrations = loadMigrations(migrationsDir);
  applyMigrations(database, migrations.slice(0, 1));
  const third = migrations[2];
  assert.ok(third);
  database.prepare(`
    INSERT INTO schema_migrations (version, name, checksum, applied_at)
    VALUES (?, ?, ?, ?)
  `).run(third.version, third.name, third.checksum, now());

  assert.throws(() => applyMigrations(database, migrations), /contiguous prefix/i);
});

function createTestDatabase(context: TestContext, filename: string): {database: SqliteDatabase; root: string} {
  const root = mkdtempSync(path.join(tmpdir(), "storyvideogen-m2-"));
  const database = openDatabase({filename: path.join(root, filename), busyTimeoutMs: 5_000});
  context.after(() => {
    if (database.open) {
      database.close();
    }
    rmSync(root, {recursive: true, force: true});
  });
  return {database, root};
}

function createTempRoot(context: TestContext): string {
  const root = mkdtempSync(path.join(tmpdir(), "storyvideogen-m2-"));
  context.after(() => rmSync(root, {recursive: true, force: true}));
  return root;
}

function now(): string {
  return new Date().toISOString();
}
