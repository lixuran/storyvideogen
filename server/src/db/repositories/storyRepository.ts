import {randomUUID} from "node:crypto";

import type {SqliteDatabase} from "../database.js";
import {runInTransaction} from "../transaction.js";

export type StoryStatus = "draft" | "planning" | "planned" | "generating_images" | "images_ready" | "generating_audio" | "rendering" | "completed" | "failed" | "archived";
export interface StoryRecord {id: string; userId: string; name: string; sourceText: string; sourceLanguage: string; narrationLanguage: string; status: StoryStatus; version: number; wordCount: number; estimatedDurationMs: number; lastErrorCode: string | null; lastErrorMessage: string | null; createdAt: string; updatedAt: string; archivedAt: string | null}
export interface SceneRecord {id: string; storyId: string; position: number; sourceStart: number; sourceEnd: number; sourceText: string; narrationText: string; status: string; version: number; estimatedDurationMs: number; createdAt: string; updatedAt: string}
export interface PromptRecord {id: string; sceneId: string; position: number; promptText: string; provider: string | null; model: string | null; status: string; version: number; createdAt: string; updatedAt: string}
export interface PlannedScene {sourceStart: number; sourceEnd: number; sourceText: string; narrationText: string; estimatedDurationMs: number; prompts: string[]}

interface StoryRow {id: string; user_id: string; name: string; source_text: string; source_language: string; narration_language: string; status: StoryStatus; version: number; word_count: number; estimated_duration_ms: number; last_error_code: string | null; last_error_message: string | null; created_at: string; updated_at: string; archived_at: string | null}
interface SceneRow {id: string; story_id: string; position: number; source_start: number; source_end: number; source_text: string; narration_text: string; status: string; version: number; estimated_duration_ms: number; created_at: string; updated_at: string}
interface PromptRow {id: string; scene_id: string; position: number; prompt_text: string; provider: string | null; model: string | null; status: string; version: number; created_at: string; updated_at: string}

export class StoryRepository {
  constructor(private readonly database: SqliteDatabase) {}

  create(userId: string, name: string, sourceText: string, wordCount: number, now: string): StoryRecord {
    const id = randomUUID();
    this.database.prepare("INSERT INTO stories (id, user_id, name, source_text, word_count, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)").run(id, userId, name, sourceText, wordCount, now, now);
    return this.findOwned(userId, id)!;
  }

  findOwned(userId: string, id: string): StoryRecord | undefined {
    const row = this.database.prepare("SELECT * FROM stories WHERE id = ? AND user_id = ?").get(id, userId) as StoryRow | undefined;
    return row && mapStory(row);
  }

  listOwned(userId: string, options: {status?: StoryStatus; search?: string; limit: number; offset: number}): {items: StoryRecord[]; total: number} {
    const clauses = ["user_id = ?"];
    const parameters: Array<string | number> = [userId];
    if (options.status) { clauses.push("status = ?"); parameters.push(options.status); }
    if (options.search) { clauses.push("name LIKE ? ESCAPE '\\'"); parameters.push(`%${escapeLike(options.search)}%`); }
    const where = clauses.join(" AND ");
    const total = (this.database.prepare(`SELECT COUNT(*) AS count FROM stories WHERE ${where}`).get(...parameters) as {count: number}).count;
    const rows = this.database.prepare(`SELECT * FROM stories WHERE ${where} ORDER BY updated_at DESC, id DESC LIMIT ? OFFSET ?`).all(...parameters, options.limit, options.offset) as StoryRow[];
    return {items: rows.map(mapStory), total};
  }

  updateOwned(userId: string, id: string, expectedVersion: number, values: {name: string; sourceText: string; sourceLanguage: string; narrationLanguage: string; wordCount: number}, now: string): boolean {
    return this.database.prepare(`UPDATE stories SET name = ?, source_text = ?, source_language = ?, narration_language = ?, word_count = ?, version = version + 1, updated_at = ? WHERE id = ? AND user_id = ? AND version = ? AND status = 'draft'`).run(values.name, values.sourceText, values.sourceLanguage, values.narrationLanguage, values.wordCount, now, id, userId, expectedVersion).changes === 1;
  }

  archiveOwned(userId: string, id: string, expectedVersion: number, now: string): boolean {
    return this.database.prepare("UPDATE stories SET status = 'archived', archived_at = ?, updated_at = ?, version = version + 1 WHERE id = ? AND user_id = ? AND version = ? AND status != 'archived'").run(now, now, id, userId, expectedVersion).changes === 1;
  }

  listScenes(userId: string, storyId: string): SceneRecord[] {
    const rows = this.database.prepare("SELECT scenes.* FROM scenes JOIN stories ON stories.id = scenes.story_id WHERE scenes.story_id = ? AND stories.user_id = ? ORDER BY scenes.position").all(storyId, userId) as SceneRow[];
    return rows.map(mapScene);
  }

  findSceneOwned(userId: string, sceneId: string): SceneRecord | undefined {
    const row = this.database.prepare("SELECT scenes.* FROM scenes JOIN stories ON stories.id = scenes.story_id WHERE scenes.id = ? AND stories.user_id = ?").get(sceneId, userId) as SceneRow | undefined;
    return row && mapScene(row);
  }

  updateSceneOwned(userId: string, sceneId: string, expectedVersion: number, narrationText: string, now: string): boolean {
    return this.database.prepare("UPDATE scenes SET narration_text = ?, version = version + 1, updated_at = ? WHERE id = ? AND version = ? AND EXISTS (SELECT 1 FROM stories WHERE stories.id = scenes.story_id AND stories.user_id = ?)").run(narrationText, now, sceneId, expectedVersion, userId).changes === 1;
  }

  createScene(storyId: string, position: number, sourceStart: number, sourceEnd: number, sourceText: string, narrationText: string, now: string): SceneRecord {
    const id = randomUUID();
    this.database.prepare("INSERT INTO scenes (id, story_id, position, source_start, source_end, source_text, narration_text, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)").run(id, storyId, position, sourceStart, sourceEnd, sourceText, narrationText, now, now);
    return mapScene(this.database.prepare("SELECT * FROM scenes WHERE id = ?").get(id) as SceneRow);
  }

  shiftScenePositions(storyId: string, fromPosition: number, delta: number): void {
    this.database.prepare("UPDATE scenes SET position = position + 100000 WHERE story_id = ? AND position >= ?").run(storyId, fromPosition);
    this.database.prepare("UPDATE scenes SET position = position - 100000 + ? WHERE story_id = ? AND position >= 100000 + ?").run(delta, storyId, fromPosition);
  }

  updateSceneSource(sceneId: string, values: {sourceEnd: number; sourceText: string; narrationText: string}, now: string): void {
    this.database.prepare("UPDATE scenes SET source_end = ?, source_text = ?, narration_text = ?, version = version + 1, updated_at = ? WHERE id = ?").run(values.sourceEnd, values.sourceText, values.narrationText, now, sceneId);
  }

  listPrompts(userId: string, sceneId: string): PromptRecord[] {
    const rows = this.database.prepare("SELECT image_prompts.* FROM image_prompts JOIN scenes ON scenes.id = image_prompts.scene_id JOIN stories ON stories.id = scenes.story_id WHERE image_prompts.scene_id = ? AND stories.user_id = ? ORDER BY image_prompts.position").all(sceneId, userId) as PromptRow[];
    return rows.map(mapPrompt);
  }

  findPromptOwned(userId: string, promptId: string): PromptRecord | undefined {
    const row = this.database.prepare("SELECT image_prompts.* FROM image_prompts JOIN scenes ON scenes.id = image_prompts.scene_id JOIN stories ON stories.id = scenes.story_id WHERE image_prompts.id = ? AND stories.user_id = ?").get(promptId, userId) as PromptRow | undefined;
    return row && mapPrompt(row);
  }

  createPrompt(sceneId: string, promptText: string, now: string): PromptRecord {
    const id = randomUUID();
    const position = (this.database.prepare("SELECT COALESCE(MAX(position), -1) + 1 AS position FROM image_prompts WHERE scene_id = ?").get(sceneId) as {position: number}).position;
    this.database.prepare("INSERT INTO image_prompts (id, scene_id, position, prompt_text, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)").run(id, sceneId, position, promptText, now, now);
    return mapPrompt(this.database.prepare("SELECT * FROM image_prompts WHERE id = ?").get(id) as PromptRow);
  }

  updatePromptOwned(userId: string, promptId: string, expectedVersion: number, promptText: string, now: string): boolean {
    return this.database.prepare("UPDATE image_prompts SET prompt_text = ?, status = 'draft', version = version + 1, updated_at = ? WHERE id = ? AND version = ? AND EXISTS (SELECT 1 FROM scenes JOIN stories ON stories.id = scenes.story_id WHERE scenes.id = image_prompts.scene_id AND stories.user_id = ?)").run(promptText, now, promptId, expectedVersion, userId).changes === 1;
  }

  deletePromptOwned(userId: string, promptId: string, expectedVersion: number): boolean {
    return this.database.prepare("DELETE FROM image_prompts WHERE id = ? AND version = ? AND EXISTS (SELECT 1 FROM scenes JOIN stories ON stories.id = scenes.story_id WHERE scenes.id = image_prompts.scene_id AND stories.user_id = ?)").run(promptId, expectedVersion, userId).changes === 1;
  }

  mergeScenes(firstId: string, secondId: string, values: {sourceEnd: number; sourceText: string; narrationText: string}, storyId: string, secondPosition: number, now: string): void {
    this.database.prepare("UPDATE scenes SET source_end = ?, source_text = ?, narration_text = ?, version = version + 1, updated_at = ? WHERE id = ?").run(values.sourceEnd, values.sourceText, values.narrationText, now, firstId);
    this.database.prepare("DELETE FROM scenes WHERE id = ?").run(secondId);
    this.shiftScenePositions(storyId, secondPosition + 1, -1);
  }

  databaseHandle(): SqliteDatabase { return this.database; }

  markAutomationStatus(userId: string, storyId: string, status: StoryStatus, now: string): void { this.database.prepare("UPDATE stories SET status = ?, updated_at = ?, last_error_code = NULL, last_error_message = NULL WHERE id = ? AND user_id = ? AND status != 'completed' AND status != 'archived'").run(status, now, storyId, userId); }
  markAutomationFailed(userId: string, storyId: string, code: string, message: string, now: string): void { this.database.prepare("UPDATE stories SET status = 'failed', last_error_code = ?, last_error_message = ?, updated_at = ? WHERE id = ? AND user_id = ? AND status != 'completed' AND status != 'archived'").run(code, message, now, storyId, userId); }

  markCompleted(userId: string, storyId: string, now: string): void { this.database.prepare("UPDATE stories SET status = 'completed', completed_at = ?, updated_at = ?, version = version + 1, last_error_code = NULL, last_error_message = NULL WHERE id = ? AND user_id = ?").run(now, now, storyId, userId); }

  persistInitialPlan(userId: string, storyId: string, expectedSourceText: string, scenes: PlannedScene[], planningSource: string, model: string | null, now: string): void {
    runInTransaction(this.database, () => {
      const story = this.findOwned(userId, storyId);
      if (!story) throw new Error("Story no longer exists.");
      if (story.sourceText !== expectedSourceText) throw new Error("Story source changed while planning.");
      const existingCount = (this.database.prepare("SELECT COUNT(*) AS count FROM scenes WHERE story_id = ?").get(storyId) as {count: number}).count;
      if (existingCount > 0) return;
      scenes.forEach((scene, position) => {
        const sceneId = randomUUID();
        this.database.prepare("INSERT INTO scenes (id, story_id, position, source_start, source_end, source_text, narration_text, status, estimated_duration_ms, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, 'planned', ?, ?, ?)").run(sceneId, storyId, position, scene.sourceStart, scene.sourceEnd, scene.sourceText, scene.narrationText, scene.estimatedDurationMs, now, now);
        scene.prompts.forEach((promptText, promptPosition) => this.database.prepare("INSERT INTO image_prompts (id, scene_id, position, prompt_text, provider, model, status, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, 'ready', ?, ?)").run(randomUUID(), sceneId, promptPosition, promptText, planningSource, model, now, now));
      });
      const estimatedDuration = scenes.reduce((total, scene) => total + scene.estimatedDurationMs, 0);
      this.database.prepare("UPDATE stories SET status = 'planned', estimated_duration_ms = ?, version = version + 1, updated_at = ?, last_error_code = NULL, last_error_message = NULL WHERE id = ? AND user_id = ?").run(estimatedDuration, now, storyId, userId);
    });
  }
}

function mapStory(row: StoryRow): StoryRecord { return {id: row.id, userId: row.user_id, name: row.name, sourceText: row.source_text, sourceLanguage: row.source_language, narrationLanguage: row.narration_language, status: row.status, version: row.version, wordCount: row.word_count, estimatedDurationMs: row.estimated_duration_ms, lastErrorCode: row.last_error_code, lastErrorMessage: row.last_error_message, createdAt: row.created_at, updatedAt: row.updated_at, archivedAt: row.archived_at}; }
function mapScene(row: SceneRow): SceneRecord { return {id: row.id, storyId: row.story_id, position: row.position, sourceStart: row.source_start, sourceEnd: row.source_end, sourceText: row.source_text, narrationText: row.narration_text, status: row.status, version: row.version, estimatedDurationMs: row.estimated_duration_ms, createdAt: row.created_at, updatedAt: row.updated_at}; }
function mapPrompt(row: PromptRow): PromptRecord { return {id: row.id, sceneId: row.scene_id, position: row.position, promptText: row.prompt_text, provider: row.provider, model: row.model, status: row.status, version: row.version, createdAt: row.created_at, updatedAt: row.updated_at}; }
function escapeLike(value: string): string { return value.replace(/[\\%_]/g, (match) => `\\${match}`); }
