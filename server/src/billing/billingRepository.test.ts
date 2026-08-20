import assert from "node:assert/strict";
import path from "node:path";
import test from "node:test";

import {openDatabase} from "../db/database.js";
import {migrateDatabase} from "../db/migrate.js";
import {BillingRepository} from "./billingRepository.js";

test("plan seeding grants and refreshes the 1000 image quota", () => {
  const database = openDatabase({filename: ":memory:", busyTimeoutMs: 5_000});
  try {
    migrateDatabase(database, path.resolve("server", "migrations"));
    const repository = new BillingRepository(database);
    repository.seed("2026-08-18T00:00:00.000Z");

    database.prepare("UPDATE plans SET quota_json = ? WHERE code = 'trial'").run(JSON.stringify({planning_jobs: 5, image_assets: 10, render_jobs: 2}));
    repository.seed("2026-08-18T00:01:00.000Z");
    repository.seed("2026-08-18T00:02:00.000Z");

    const plans = Object.fromEntries(repository.plans().map((plan) => [plan.code, JSON.parse(plan.quotaJson)]));
    assert.equal(plans.trial.image_assets, 1_000);
    assert.equal(plans.creator.image_assets, 1_000);
    const trial = database.prepare("SELECT updated_at AS updatedAt FROM plans WHERE code = 'trial'").get() as {updatedAt: string};
    assert.equal(trial.updatedAt, "2026-08-18T00:01:00.000Z");
  } finally {
    database.close();
  }
});
