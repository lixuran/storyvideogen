import {ApiError} from "../http/errors.js";
import type {PromptRecord, SceneRecord, StoryRecord, StoryRepository, StoryStatus} from "../db/repositories/storyRepository.js";
import {runInTransaction} from "../db/transaction.js";

const maxWords = 30_000;
const storyStatuses = new Set<StoryStatus>(["draft", "planning", "planned", "generating_images", "images_ready", "generating_audio", "rendering", "completed", "failed", "archived"]);

export class StoryService {
  constructor(private readonly repository: StoryRepository) {}

  create(userId: string, input: Record<string, unknown>): StoryRecord {
    const name = storyName(input.name); const sourceText = storyText(input.sourceText); const wordCount = countWords(sourceText);
    ensureWordLimit(wordCount);
    return this.repository.create(userId, name, sourceText, wordCount, new Date().toISOString());
  }

  read(userId: string, id: string): StoryRecord & {scenes: SceneRecord[]} {
    const story = this.repository.findOwned(userId, id);
    if (!story) throw new ApiError(404, "STORY_NOT_FOUND", "The story was not found.");
    return {...story, scenes: this.repository.listScenes(userId, id).map((scene) => ({...scene, prompts: this.repository.listPrompts(userId, scene.id)}))};
  }

  list(userId: string, query: Record<string, unknown>) {
    const page = positiveInteger(query.page, 1, 1, 100_000); const pageSize = positiveInteger(query.pageSize, 20, 1, 50);
    const statusValue = typeof query.status === "string" && query.status ? query.status : undefined;
    if (statusValue && !storyStatuses.has(statusValue as StoryStatus)) throw new ApiError(400, "STORY_STATUS_INVALID", "The story status filter is invalid.");
    const search = typeof query.search === "string" ? query.search.trim().slice(0, 200) : undefined;
    const result = this.repository.listOwned(userId, {
      ...(statusValue ? {status: statusValue as StoryStatus} : {}),
      ...(search ? {search} : {}),
      limit: pageSize,
      offset: (page - 1) * pageSize
    });
    return {...result, page, pageSize, pageCount: Math.ceil(result.total / pageSize)};
  }

  update(userId: string, id: string, input: Record<string, unknown>): StoryRecord {
    const existing = this.read(userId, id); const version = versionNumber(input.version);
    const values = {name: input.name === undefined ? existing.name : storyName(input.name), sourceText: input.sourceText === undefined ? existing.sourceText : storyText(input.sourceText), sourceLanguage: language(input.sourceLanguage, existing.sourceLanguage), narrationLanguage: language(input.narrationLanguage, existing.narrationLanguage), wordCount: 0};
    values.wordCount = countWords(values.sourceText); ensureWordLimit(values.wordCount);
    if (!this.repository.updateOwned(userId, id, version, values, new Date().toISOString())) this.throwUpdateFailure(userId, id, version);
    return this.read(userId, id);
  }

  archive(userId: string, id: string, versionValue: unknown): StoryRecord & {scheduledDeletionAt: string | null} {
    const version = versionNumber(versionValue);
    if (!this.repository.archiveOwned(userId, id, version, new Date().toISOString())) this.throwUpdateFailure(userId, id, version);
    const story = this.read(userId, id);
    return {...story, scheduledDeletionAt: story.archivedAt ? new Date(Date.parse(story.archivedAt) + 30 * 24 * 60 * 60 * 1000).toISOString() : null};
  }

  updateScene(userId: string, sceneId: string, input: Record<string, unknown>): SceneRecord {
    const current = this.repository.findSceneOwned(userId, sceneId);
    if (!current) throw new ApiError(404, "SCENE_NOT_FOUND", "The scene was not found.");
    const narrationText = input.narrationText === undefined ? current.narrationText : boundedText(input.narrationText, "Narration", 20_000, true);
    const version = versionNumber(input.version);
    if (!this.repository.updateSceneOwned(userId, sceneId, version, narrationText, new Date().toISOString())) throw new ApiError(409, "SCENE_VERSION_CONFLICT", "This scene changed in another session. Reload before saving.");
    return this.repository.findSceneOwned(userId, sceneId)!;
  }

  splitScene(userId: string, sceneId: string, input: Record<string, unknown>): SceneRecord[] {
    const scene = this.repository.findSceneOwned(userId, sceneId);
    if (!scene) throw new ApiError(404, "SCENE_NOT_FOUND", "The scene was not found.");
    if (versionNumber(input.version) !== scene.version) throw new ApiError(409, "SCENE_VERSION_CONFLICT", "This scene changed in another session. Reload before saving.");
    const offset = positiveInteger(input.offset, -1, 1, scene.sourceText.length - 1);
    const leftText = scene.sourceText.slice(0, offset); const rightText = scene.sourceText.slice(offset);
    if (!leftText.trim() || !rightText.trim()) throw new ApiError(400, "SCENE_SPLIT_INVALID", "Split the scene where both resulting scenes contain text.");
    return runInTransaction(this.repository.databaseHandle(), () => {
      const now = new Date().toISOString(); const sourceSplit = scene.sourceStart + offset;
      this.repository.shiftScenePositions(scene.storyId, scene.position + 1, 1);
      this.repository.updateSceneSource(scene.id, {sourceEnd: sourceSplit, sourceText: leftText, narrationText: leftText}, now);
      this.repository.createScene(scene.storyId, scene.position + 1, sourceSplit, scene.sourceEnd, rightText, rightText, now);
      return this.repository.listScenes(userId, scene.storyId);
    });
  }

  mergeScene(userId: string, sceneId: string, versionValue: unknown): SceneRecord[] {
    const scene = this.repository.findSceneOwned(userId, sceneId);
    if (!scene) throw new ApiError(404, "SCENE_NOT_FOUND", "The scene was not found.");
    if (versionNumber(versionValue) !== scene.version) throw new ApiError(409, "SCENE_VERSION_CONFLICT", "This scene changed in another session. Reload before saving.");
    const scenes = this.repository.listScenes(userId, scene.storyId); const next = scenes.find((item) => item.position === scene.position + 1);
    if (!next) throw new ApiError(400, "SCENE_MERGE_INVALID", "There is no following scene to merge.");
    return runInTransaction(this.repository.databaseHandle(), () => {
      this.repository.mergeScenes(scene.id, next.id, {sourceEnd: next.sourceEnd, sourceText: `${scene.sourceText}${next.sourceText}`, narrationText: `${scene.narrationText}\n\n${next.narrationText}`}, scene.storyId, next.position, new Date().toISOString());
      return this.repository.listScenes(userId, scene.storyId);
    });
  }

  createPrompt(userId: string, sceneId: string, value: unknown): PromptRecord {
    if (!this.repository.findSceneOwned(userId, sceneId)) throw new ApiError(404, "SCENE_NOT_FOUND", "The scene was not found.");
    return this.repository.createPrompt(sceneId, boundedText(value, "Image prompt", 4_000), new Date().toISOString());
  }

  updatePrompt(userId: string, promptId: string, input: Record<string, unknown>): PromptRecord {
    const current = this.repository.findPromptOwned(userId, promptId);
    if (!current) throw new ApiError(404, "PROMPT_NOT_FOUND", "The image prompt was not found.");
    if (!this.repository.updatePromptOwned(userId, promptId, versionNumber(input.version), boundedText(input.promptText, "Image prompt", 4_000), new Date().toISOString())) throw new ApiError(409, "PROMPT_VERSION_CONFLICT", "This image prompt changed in another session. Reload before saving.");
    return this.repository.findPromptOwned(userId, promptId)!;
  }

  deletePrompt(userId: string, promptId: string, versionValue: unknown): void {
    if (!this.repository.findPromptOwned(userId, promptId)) throw new ApiError(404, "PROMPT_NOT_FOUND", "The image prompt was not found.");
    if (!this.repository.deletePromptOwned(userId, promptId, versionNumber(versionValue))) throw new ApiError(409, "PROMPT_VERSION_CONFLICT", "This image prompt changed in another session. Reload before saving.");
  }

  private throwUpdateFailure(userId: string, id: string, version: number): never {
    const current = this.repository.findOwned(userId, id);
    if (!current) throw new ApiError(404, "STORY_NOT_FOUND", "The story was not found.");
    if (current.version !== version) throw new ApiError(409, "STORY_VERSION_CONFLICT", "This story changed in another session. Reload before saving.");
    throw new ApiError(409, "STORY_NOT_EDITABLE", "Only draft stories can be edited.");
  }
}

function storyName(value: unknown): string { return boundedText(value, "Story name", 160); }
function storyText(value: unknown): string { return boundedText(value, "Story", 2_000_000); }
function boundedText(value: unknown, label: string, maximum: number, allowEmpty = false): string { if (typeof value !== "string") throw new ApiError(400, "STORY_INPUT_INVALID", `${label} is required.`); const text = value.trim(); if ((!allowEmpty && !text) || text.length > maximum) throw new ApiError(400, "STORY_INPUT_INVALID", `${label} must contain ${allowEmpty ? "no more than" : "between 1 and"} ${maximum} characters.`); return text; }
function countWords(text: string): number { const segmenter = new Intl.Segmenter(undefined, {granularity: "word"}); return [...segmenter.segment(text)].filter((segment) => segment.isWordLike).length; }
function ensureWordLimit(count: number): void { if (count > maxWords) throw new ApiError(413, "STORY_TOO_LONG", `Stories can contain at most ${maxWords.toLocaleString("en-US")} words.`); }
function versionNumber(value: unknown): number { if (!Number.isSafeInteger(value) || (value as number) < 1) throw new ApiError(400, "VERSION_INVALID", "A positive story version is required."); return value as number; }
function positiveInteger(value: unknown, fallback: number, minimum: number, maximum: number): number { if (value === undefined) return fallback; const parsed = typeof value === "string" && /^\d+$/.test(value) ? Number(value) : value; if (!Number.isSafeInteger(parsed) || (parsed as number) < minimum || (parsed as number) > maximum) throw new ApiError(400, "PAGINATION_INVALID", `Value must be an integer between ${minimum} and ${maximum}.`); return parsed as number; }
function language(value: unknown, fallback: string): string { if (value === undefined) return fallback; if (typeof value !== "string" || !/^[A-Za-z]{2,8}(?:-[A-Za-z0-9]{1,8})*$|^auto$/.test(value)) throw new ApiError(400, "LANGUAGE_INVALID", "The language code is invalid."); return value; }
