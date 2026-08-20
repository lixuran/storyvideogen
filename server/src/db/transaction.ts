import type {SqliteDatabase} from "./database.js";

export type TransactionMode = "deferred" | "immediate" | "exclusive";

export function runInTransaction<T>(
  database: SqliteDatabase,
  work: () => T,
  mode: TransactionMode = "immediate"
): T {
  const transaction = database.transaction(work);
  if (mode === "deferred") {
    return transaction.deferred();
  }
  if (mode === "exclusive") {
    return transaction.exclusive();
  }
  return transaction.immediate();
}
