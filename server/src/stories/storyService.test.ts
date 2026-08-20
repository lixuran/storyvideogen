import assert from "node:assert/strict";
import path from "node:path";
import test from "node:test";

import {openDatabase} from "../db/database.js";
import {migrateDatabase} from "../db/migrate.js";
import {IdentityRepository} from "../db/repositories/identityRepository.js";
import {StoryRepository} from "../db/repositories/storyRepository.js";
import {AuthService} from "../auth/authService.js";
import {StoryService} from "./storyService.js";

test("stories are owner-scoped, versioned, searchable, and limited", () => {
  const database = openDatabase({filename: ":memory:", busyTimeoutMs: 5_000});
  migrateDatabase(database, path.resolve("server", "migrations"));
  try {
    const identities = new IdentityRepository(database); const auth = new AuthService(identities, 3600); const repository = new StoryRepository(database); const service = new StoryService(repository);
    const owner = auth.register("story-owner", "owner-password").user; const stranger = auth.register("story-stranger", "stranger-password").user;
    const created = service.create(owner.id, {name: "A lighthouse", sourceText: "One quiet night at sea."});
    assert.equal(created.version, 1); assert.equal(created.wordCount, 5); assert.equal(service.list(owner.id, {search: "light"}).total, 1); assert.equal(service.list(stranger.id, {}).total, 0);
    assert.throws(() => service.read(stranger.id, created.id), /not found/i);
    const updated = service.update(owner.id, created.id, {version: 1, name: "The lighthouse"});
    assert.equal(updated.version, 2);
    assert.throws(() => service.update(owner.id, created.id, {version: 1, name: "Stale"}), /another session/i);
    assert.throws(() => service.create(owner.id, {name: "Too long", sourceText: Array(30_001).fill("word").join(" ")}), /30,000 words/);
  } finally { database.close(); }
});

test("scene split, merge, narration, and prompt edits require current versions", () => {
  const database = openDatabase({filename: ":memory:", busyTimeoutMs: 5_000}); migrateDatabase(database, path.resolve("server", "migrations"));
  try {
    const identities = new IdentityRepository(database); const user = new AuthService(identities, 3600).register("scene-owner", "owner-password").user; const repository = new StoryRepository(database); const service = new StoryService(repository);
    const story = service.create(user.id, {name: "Scene story", sourceText: "First half. Second half."}); const scene = repository.createScene(story.id, 0, 0, story.sourceText.length, story.sourceText, story.sourceText, new Date().toISOString());
    const narrated = service.updateScene(user.id, scene.id, {version: 1, narrationText: "Narrated first and second."}); assert.equal(narrated.version, 2);
    assert.throws(() => service.splitScene(user.id, scene.id, {version: 1, offset: 11}), /another session/i);
    const split = service.splitScene(user.id, scene.id, {version: 2, offset: 11}); assert.equal(split.length, 2); assert.equal(split.map((item) => item.sourceText).join(""), story.sourceText);
    const prompt = service.createPrompt(user.id, split[0]!.id, "A lighthouse at midnight"); const edited = service.updatePrompt(user.id, prompt.id, {version: 1, promptText: "A lonely lighthouse at midnight"}); assert.equal(edited.version, 2);
    assert.throws(() => service.deletePrompt(user.id, prompt.id, 1), /another session/i); service.deletePrompt(user.id, prompt.id, 2);
    const merged = service.mergeScene(user.id, split[0]!.id, split[0]!.version); assert.equal(merged.length, 1); assert.match(merged[0]!.sourceText, /First half.*Second half/s);
  } finally { database.close(); }
});
