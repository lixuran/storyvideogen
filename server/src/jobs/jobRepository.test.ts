import assert from "node:assert/strict";
import path from "node:path";
import test from "node:test";

import {AuthService} from "../auth/authService.js";
import {openDatabase} from "../db/database.js";
import {migrateDatabase} from "../db/migrate.js";
import {IdentityRepository} from "../db/repositories/identityRepository.js";
import {JobRepository} from "../db/repositories/jobRepository.js";
import {StoryRepository} from "../db/repositories/storyRepository.js";
import {StoryService} from "../stories/storyService.js";

test("durable jobs are idempotent, leased, recoverable, cancellable, and monotonic", () => {
  const database = openDatabase({filename: ":memory:", busyTimeoutMs: 5_000}); migrateDatabase(database, path.resolve("server", "migrations"));
  try {
    const identities = new IdentityRepository(database); const user = new AuthService(identities, 3600).register("job-owner", "owner-password").user; const stories = new StoryService(new StoryRepository(database)); const story = stories.create(user.id, {name: "Job story", sourceText: "A complete source story."}); const jobs = new JobRepository(database);
    const first = jobs.enqueue({userId: user.id, storyId: story.id, type: "plan_story", idempotencyKey: "stable-operation-key", payload: {fixture: "success"}}, "2026-01-01T00:00:00.000Z");
    const duplicate = jobs.enqueue({userId: user.id, storyId: story.id, type: "plan_story", idempotencyKey: "stable-operation-key", payload: {fixture: "success"}}, "2026-01-01T00:00:01.000Z");
    assert.equal(first.created, true); assert.equal(duplicate.created, false); assert.equal(duplicate.job.id, first.job.id);
    const claimed = jobs.claim("worker-a", "2026-01-01T00:00:02.000Z", "2026-01-01T00:00:03.000Z")!; assert.equal(claimed.attempt, 1);
    const recovered = jobs.claim("worker-b", "2026-01-01T00:00:04.000Z", "2026-01-01T00:00:10.000Z")!; assert.equal(recovered.id, claimed.id); assert.equal(recovered.attempt, 2); assert.equal(recovered.leaseOwner, "worker-b");
    assert.equal(jobs.complete(recovered.id, "worker-a", {}, "2026-01-01T00:00:05.000Z"), false); assert.equal(jobs.complete(recovered.id, "worker-b", {ok: true}, "2026-01-01T00:00:05.000Z"), true); assert.equal(jobs.complete(recovered.id, "worker-b", {}, "2026-01-01T00:00:06.000Z"), false);
    const cancelJob = jobs.enqueue({userId: user.id, storyId: story.id, type: "plan_story", idempotencyKey: "cancel-operation-key", payload: {}}, "2026-01-01T00:00:07.000Z").job; assert.equal(jobs.requestCancel(user.id, cancelJob.id, "2026-01-01T00:00:08.000Z")?.state, "cancelled");
    const events = jobs.eventsOwned(user.id, 0); assert.deepEqual([...events.map((event) => event.id)].sort((a, b) => a - b), events.map((event) => event.id)); assert.ok(events.some((event) => event.eventType === "recovered"));
  } finally { database.close(); }
});
