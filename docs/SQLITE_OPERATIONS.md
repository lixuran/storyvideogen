# SQLite migration, backup, and rollback operations

The Node API owns the product database. Its default path is
`output/storyvideogen.sqlite3`; override it with
`STORYVIDEOGEN_DATABASE_PATH`. Migrations are read from
`server/migrations` unless `STORYVIDEOGEN_MIGRATIONS_DIR` is set for an
isolated test fixture.

## Startup and migration safety

- The API opens one `better-sqlite3` connection per process.
- Every connection enables foreign keys, WAL mode, a bounded busy timeout,
  normal synchronous mode, and disables trusted schemas.
- Startup applies all pending migrations inside one exclusive transaction.
- `schema_migrations` records each migration filename and SHA-256 checksum.
- An altered, missing, or failed migration leaves readiness at HTTP 503 and
  renders a generic unavailable page. Migration details are never returned to
  the browser.
- Migration files are forward-only. Never edit an applied migration; add the
  next numbered migration instead.

## Backup before deployment

SQLite metadata and the configured media-storage directory are one backup set.
To capture a deployment backup:

1. Stop the API and media worker so no new jobs or asset moves can begin.
2. Record the application revision and latest migration version.
3. Run `PRAGMA wal_checkpoint(TRUNCATE);` against the configured database.
4. Use SQLite's online `.backup` command to write a new backup file on the same
   host, then copy that file to backup storage.
5. Snapshot the matching media-storage directory after the database backup.
6. Validate the copied database with `PRAGMA integrity_check;` and confirm that
   it reports `ok`.

Example using the SQLite CLI on a stopped local instance:

```bash
sqlite3 output/storyvideogen.sqlite3 "PRAGMA wal_checkpoint(TRUNCATE);"
sqlite3 output/storyvideogen.sqlite3 ".backup 'backup/storyvideogen.sqlite3'"
sqlite3 backup/storyvideogen.sqlite3 "PRAGMA integrity_check;"
```

## Rollback after a failed release

There are no automatic down migrations. If a release must be rolled back:

1. Keep the API and worker stopped.
2. Preserve the failed database and logs for diagnosis.
3. Restore the pre-deployment SQLite backup and its matching media snapshot as
   a pair.
4. Restore the application revision recorded with that backup.
5. Start one API process and confirm `/health/ready` returns HTTP 200 and the
   expected schema version before starting the worker or admitting traffic.

Never restore only the SQLite file when jobs may have created, replaced, or
removed media assets after the backup point.

## Production retention and restore drill

Store the SQLite backup, matching `assets/` snapshot, application revision, and
master-key version in one dated backup directory. Keep 30 daily sets and 12
month-end sets. Prune only backup sets that have passed both SQLite integrity
and sampled asset checksum checks; never prune the active data directory.

At least monthly, restore one set beneath a new isolated root, configure a
loopback-only API against the restored database/media, and verify:

1. `PRAGMA integrity_check` returns `ok`.
2. Every ready asset's storage key stays below the restored asset root.
3. A checksum sample matches `assets.checksum_sha256`.
4. `/health/ready`, login, Library, and one authenticated asset download pass.

The deployment health check in `deploy/storyvideogen-healthcheck.sh` checks API
readiness and a configurable free-space floor. Run it from a systemd timer or
the host monitor. Temporary worker directories may be removed only when they
are older than the maximum job runtime and are not referenced by queued,
running, or cancel-requested jobs. Do not automatically delete ready assets.

## Legacy cutover and rollback

1. Stop the legacy Python UI and take the coordinated pre-cutover backup.
2. Run `npm run import:legacy -- --auth-db <legacy.sqlite3> --user-root <ui_users> --dry-run true` and review exact counts/errors.
3. Run the same command with `--dry-run false`; run it a second time and confirm
   every record is skipped as already imported.
4. Start `storyvideogen.service` and `storyvideogen-worker.service`, then point
   Caddy at Node on `127.0.0.1:3000`.
5. Require imported users to sign in again. Legacy sessions are never copied.

During the rollback window, stop Node and the worker, restore the paired
pre-cutover database/media backup, and restore the previous Caddy/Python unit.
Do not run the legacy Python UI and Node API against the same writable data.
