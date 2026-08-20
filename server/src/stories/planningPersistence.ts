import {readFile, stat} from "node:fs/promises";
import path from "node:path";

import type {JobRecord} from "../db/repositories/jobRepository.js";
import type {PlannedScene, StoryRepository} from "../db/repositories/storyRepository.js";

interface PlanFile {contractVersion: number; storyId: string; planningSource: string; provider: string; model: string | null; scenes: unknown[]}

export class PlanningPersistence {
  constructor(private readonly stories: StoryRepository, private readonly workerRoot: string) {}

  async apply(job: JobRecord, resultFile: string): Promise<{sceneCount: number; planningSource: string; provider: string; model: string | null}> {
    if (!job.storyId) throw new Error("Planning job has no story.");
    const jobRoot = path.resolve(this.workerRoot, job.id); const filePath = path.resolve(jobRoot, resultFile);
    const relative = path.relative(jobRoot, filePath); if (relative.startsWith("..") || path.isAbsolute(relative)) throw new Error("Planning result escaped the job root.");
    if ((await stat(filePath)).size > 2_000_000) throw new Error("Planning result exceeded the size limit.");
    const value = JSON.parse(await readFile(filePath, "utf8")) as unknown;
    const story = this.stories.findOwned(job.userId, job.storyId); if (!story) throw new Error("Story no longer exists.");
    const plan = validatePlan(value, story.id, story.sourceText);
    this.stories.persistInitialPlan(job.userId, story.id, story.sourceText, plan.scenes, plan.planningSource, plan.model, new Date().toISOString());
    return {sceneCount: plan.scenes.length, planningSource: plan.planningSource, provider: plan.provider, model: plan.model};
  }
}

function validatePlan(value: unknown, storyId: string, sourceText: string): {scenes: PlannedScene[]; planningSource: string; provider: string; model: string | null} {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("Planning result must be an object."); const plan = value as Partial<PlanFile>;
  if (plan.contractVersion !== 1 || plan.storyId !== storyId || !Array.isArray(plan.scenes) || plan.scenes.length < 1 || plan.scenes.length > 1000) throw new Error("Planning result envelope is invalid.");
  if (!new Set(["fixture", "zhipu", "deterministic_fallback"]).has(String(plan.planningSource)) || !new Set(["fixture", "zhipu"]).has(String(plan.provider))) throw new Error("Planning provenance is invalid.");
  if (plan.model !== null && typeof plan.model !== "string") throw new Error("Planning model is invalid.");
  let cursor = 0;
  const scenes = plan.scenes.map((item, index): PlannedScene => {
    if (!item || typeof item !== "object" || Array.isArray(item)) throw new Error(`Scene ${index + 1} is invalid.`); const scene = item as Record<string, unknown>;
    const sourceStart = integer(scene.sourceStart); const sourceEnd = integer(scene.sourceEnd);
    if (sourceStart !== cursor || sourceEnd <= sourceStart || sourceEnd > sourceText.length || scene.sourceText !== sourceText.slice(sourceStart, sourceEnd) || !String(scene.sourceText).trim()) throw new Error(`Scene ${index + 1} does not provide exact source coverage.`);
    cursor = sourceEnd; const narrationText = boundedString(scene.narrationText, 20_000, "narration");
    if (!Array.isArray(scene.prompts) || scene.prompts.length < 1 || scene.prompts.length > 5) throw new Error(`Scene ${index + 1} prompts are invalid.`);
    const prompts = scene.prompts.map((prompt) => boundedString(prompt, 4_000, "prompt"));
    const estimatedDurationMs = integer(scene.estimatedDurationMs); if (estimatedDurationMs < 0 || estimatedDurationMs > 3_600_000) throw new Error(`Scene ${index + 1} duration is invalid.`);
    return {sourceStart, sourceEnd, sourceText: scene.sourceText as string, narrationText, estimatedDurationMs, prompts};
  });
  if (cursor !== sourceText.length) throw new Error("Planning result does not cover the complete story.");
  return {scenes, planningSource: String(plan.planningSource), provider: String(plan.provider), model: plan.model ?? null};
}
function integer(value: unknown): number { if (!Number.isSafeInteger(value) || (value as number) < 0) throw new Error("Planning result contains an invalid integer."); return value as number; }
function boundedString(value: unknown, maximum: number, label: string): string { if (typeof value !== "string" || !value.trim() || value.length > maximum) throw new Error(`Planning ${label} is invalid.`); return value; }
