import {randomUUID} from "node:crypto";

import type {JobEventRecord, JobRecord, JobRepository} from "../db/repositories/jobRepository.js";
import type {ImageCandidateRepository} from "../db/repositories/imageCandidateRepository.js";
import type {StoryRepository} from "../db/repositories/storyRepository.js";
import {ApiError} from "../http/errors.js";
import type {AssetService} from "../assets/assetService.js";
import type {BillingService} from "../billing/billingService.js";
import {runInTransaction} from "../db/transaction.js";
import type {AutomationSettings} from "./autoPipelineCoordinator.js";

export class JobService {
  constructor(private readonly jobs: JobRepository, private readonly stories: StoryRepository, private readonly candidates: ImageCandidateRepository, private readonly assets: AssetService, private readonly billing: BillingService, private readonly fixtureMode: boolean, private readonly fixture: string, private readonly textModel: string, private readonly imageModel: string) {}

  enqueuePlan(userId: string, storyId: string, idempotencyValue: unknown, input: Record<string, unknown> = {}, automation?: AutomationSettings): {job: PublicJob; created: boolean} {
    const idempotencyKey = typeof idempotencyValue === "string" && /^[A-Za-z0-9_.:-]{8,160}$/.test(idempotencyValue) ? idempotencyValue : randomUUID();
    const existing = this.jobs.findByIdempotency(userId, idempotencyKey); if (existing) return {job: publicJob(existing), created: false};
    this.billing.assertEntitled(userId, "planning_jobs");
    const story = this.stories.findOwned(userId, storyId);
    if (!story) throw new ApiError(404, "STORY_NOT_FOUND", "The story was not found.");
    const allowedFixtures = new Set(["success", "invalid_json", "crash", "timeout", "duplicate_completion", "malicious_path"]);
    const fixture = this.fixtureMode && typeof input.fixture === "string" && allowedFixtures.has(input.fixture) ? input.fixture : this.fixtureMode ? this.fixture : "success";
    const chunkSeconds = automation?.chunkSeconds ?? sceneDurationSeconds(input.chunkSeconds);
    const result = this.jobs.enqueue({userId, storyId, type: "plan_story", idempotencyKey, payload: {contractVersion: 1, operation: "plan_story", fixture, provider: this.fixtureMode ? "fixture" : "zhipu", model: this.textModel, sourceText: story.sourceText, storyName: story.name, requireLlm: !this.fixtureMode, chunkSeconds, ...automationPayload(automation)}}, new Date().toISOString());
    return {job: publicJob(result.job), created: result.created};
  }

  enqueueImages(userId: string, sceneId: string, input: Record<string, unknown>, idempotencyValue: unknown, automation?: AutomationSettings): {job: PublicJob; created: boolean} {
    const idempotencyKey = typeof idempotencyValue === "string" && /^[A-Za-z0-9_.:-]{8,160}$/.test(idempotencyValue) ? idempotencyValue : randomUUID();
    const existing = this.jobs.findByIdempotency(userId, idempotencyKey); if (existing) return {job: publicJob(existing), created: false};
    const scene = this.stories.findSceneOwned(userId, sceneId); if (!scene) throw new ApiError(404, "SCENE_NOT_FOUND", "The scene was not found.");
    const promptId = typeof input.promptId === "string" ? input.promptId : ""; const prompt = this.stories.findPromptOwned(userId, promptId);
    if (!prompt || prompt.sceneId !== scene.id) throw new ApiError(400, "IMAGE_PROMPT_INVALID", "Choose an image prompt from this scene.");
    const provider = providerName(input.provider); const count = candidateCount(input.count); this.billing.assertEntitled(userId, "image_assets", automation ? 1 : count); const model = provider === "zhipu" ? this.imageModel : typeof input.model === "string" ? input.model.trim().slice(0, 120) || null : null;
    const effectiveProvider = this.fixtureMode ? "fixture" : provider;
    return runInTransaction(this.stories.databaseHandle(), () => {
      const concurrentExisting = this.jobs.findByIdempotency(userId, idempotencyKey);
      if (concurrentExisting) return {job: publicJob(concurrentExisting), created: false};
      const now = new Date().toISOString(); const slots = this.candidates.createSlots(scene.id, prompt.id, provider, model, count, now);
      const result = this.jobs.enqueue({userId, storyId: scene.storyId, type: "generate_images", idempotencyKey, maxAttempts: 1, payload: {contractVersion: 1, operation: "generate_images", fixture: this.fixtureMode ? this.fixture : "success", provider: effectiveProvider, candidateProvider: provider, model, prompt: prompt.promptText, sceneId: scene.id, promptId: prompt.id, candidateIds: slots.map((slot) => slot.id), stopAfterFirstSuccess: automation !== undefined, ...automationPayload(automation)}}, now);
      return {job: publicJob(result.job), created: result.created};
    });
  }

  enqueueRender(userId: string, storyId: string, input: Record<string, unknown>, idempotencyValue: unknown, automation?: AutomationSettings): {job: PublicJob; created: boolean} {
    const idempotencyKey = typeof idempotencyValue === "string" && /^[A-Za-z0-9_.:-]{8,160}$/.test(idempotencyValue) ? idempotencyValue : randomUUID();
    const existing = this.jobs.findByIdempotency(userId, idempotencyKey); if (existing) return {job: publicJob(existing), created: false};
    this.billing.assertEntitled(userId, "render_jobs");
    const story = this.stories.findOwned(userId, storyId); if (!story) throw new ApiError(404, "STORY_NOT_FOUND", "The story was not found."); const scenes = this.stories.listScenes(userId, storyId); if (!scenes.length) throw new ApiError(409, "STORY_NOT_PLANNED", "Plan the story before rendering."); const candidates = this.candidates.listForStory(userId, storyId);
    const renderScenes = scenes.map((scene) => { const selected = candidates.find((candidate) => candidate.sceneId === scene.id && candidate.isSelected && candidate.assetId); if (!selected?.assetId) throw new ApiError(409, "SCENE_IMAGE_REQUIRED", "Choose one image for every scene before rendering."); const asset = this.assets.findOwned(userId, selected.assetId); return {id: scene.id, narrationText: scene.narrationText, imagePath: this.assets.absolutePath(asset.storageKey), provider: selected.provider, sourceUrl: selected.sourceUrl, attributionText: selected.attributionText, licenseCode: selected.licenseCode}; });
    const musicAssetId = typeof input.musicAssetId === "string" && input.musicAssetId ? input.musicAssetId : undefined; let musicPath: string | undefined; if (musicAssetId) { const music = this.assets.findOwned(userId, musicAssetId); if (music.storyId !== storyId || music.kind !== "music") throw new ApiError(400, "MUSIC_ASSET_INVALID", "Choose music uploaded to this story."); musicPath = this.assets.absolutePath(music.storageKey); }
    const musicVolume = typeof input.musicVolume === "number" ? input.musicVolume : 0.18; if (!Number.isFinite(musicVolume) || musicVolume < 0 || musicVolume > 1) throw new ApiError(400, "MUSIC_VOLUME_INVALID", "Music volume must be between 0 and 1."); const voice = narrationVoice(input.voice);
    const result = this.jobs.enqueue({userId, storyId, type: "render_video", idempotencyKey, maxAttempts: 2, payload: {contractVersion: 1, operation: "render_video", fixture: "success", storyName: story.name, scenes: renderScenes, musicPath: musicPath ?? "", musicVolume, ttsProvider: this.fixtureMode ? "silent" : "edge", voice, ...automationPayload(automation)}}, new Date().toISOString()); return {job: publicJob(result.job), created: result.created};
  }

  enqueueAuto(userId: string, storyId: string, input: Record<string, unknown>, idempotencyValue: unknown): {job: PublicJob; created: boolean} {
    const idempotencyKey = typeof idempotencyValue === "string" && /^[A-Za-z0-9_.:-]{8,160}$/.test(idempotencyValue) ? idempotencyValue : randomUUID();
    const existing = this.jobs.findByIdempotency(userId, idempotencyKey);
    if (existing) return {job: publicJob(existing), created: false};
    const story = this.stories.findOwned(userId, storyId);
    if (!story) throw new ApiError(404, "STORY_NOT_FOUND", "The story was not found.");
    if (story.status !== "draft") throw new ApiError(409, "AUTO_MODE_UNAVAILABLE", "Auto mode can only start from a draft.");
    const settings: AutomationSettings = {imageProvider: providerName(input.imageProvider), candidateCount: candidateCount(input.candidateCount), voice: narrationVoice(input.voice), chunkSeconds: sceneDurationSeconds(input.chunkSeconds)};
    const result = this.enqueuePlan(userId, storyId, idempotencyKey, {}, settings);
    if (result.created) this.stories.markAutomationStatus(userId, storyId, "planning", new Date().toISOString());
    return result;
  }

  readAutomation(userId: string, storyId: string): AutomationStatus {
    const story = this.stories.findOwned(userId, storyId);
    if (!story) throw new ApiError(404, "STORY_NOT_FOUND", "The story was not found.");
    const jobs = this.jobs.listForStory(userId, storyId).filter((job) => job.payload.autoMode === true);
    const active = jobs.find((job) => ["queued", "running", "cancel_requested"].includes(job.state));
    const failed = jobs.find((job) => job.state === "failed");
    const state = story.status === "completed" ? "completed" : story.status === "failed" || failed ? "failed" : active ? "active" : "idle";
    return {state, storyStatus: story.status, errorCode: story.lastErrorCode, errorMessage: story.lastErrorMessage, currentJob: active ? publicJob(active) : jobs[0] ? publicJob(jobs[0]) : null, jobCount: jobs.length};
  }

  cancelAutomation(userId: string, storyId: string): AutomationStatus {
    if (!this.stories.findOwned(userId, storyId)) throw new ApiError(404, "STORY_NOT_FOUND", "The story was not found.");
    const now = new Date().toISOString();
    const active = this.jobs.listForStory(userId, storyId).filter((item) => item.payload.autoMode === true && ["queued", "running"].includes(item.state));
    if (!active.length) return this.readAutomation(userId, storyId);
    for (const job of active) this.jobs.requestCancel(userId, job.id, now);
    this.stories.markAutomationFailed(userId, storyId, "AUTO_CANCELLED", "Auto mode was cancelled.", now);
    return this.readAutomation(userId, storyId);
  }

  read(userId: string, jobId: string): {job: PublicJob; events: JobEventRecord[]} {
    const job = this.jobs.findOwned(userId, jobId);
    if (!job) throw new ApiError(404, "JOB_NOT_FOUND", "The job was not found.");
    return {job: publicJob(job), events: this.jobs.eventsForOwnedJob(userId, jobId)};
  }

  cancel(userId: string, jobId: string): PublicJob {
    const job = this.jobs.requestCancel(userId, jobId, new Date().toISOString());
    if (!job) throw new ApiError(404, "JOB_NOT_FOUND", "The job was not found.");
    return publicJob(job);
  }

  events(userId: string, afterValue: unknown): JobEventRecord[] {
    const after = typeof afterValue === "string" && /^\d+$/.test(afterValue) ? Number(afterValue) : 0;
    return this.jobs.eventsOwned(userId, after);
  }
}

function providerName(value: unknown): string { const provider = typeof value === "string" ? value.trim().toLowerCase() : "zhipu"; if (!["zhipu", "siliconflow", "baidu", "pixabay", "openverse", "wikimedia"].includes(provider)) throw new ApiError(400, "IMAGE_PROVIDER_INVALID", "The image provider is not supported."); return provider; }
function candidateCount(value: unknown): number { const count = value === undefined ? 2 : value; if (!Number.isSafeInteger(count) || (count as number) < 1 || (count as number) > 4) throw new ApiError(400, "IMAGE_COUNT_INVALID", "Generate between one and four image candidates."); return count as number; }
function narrationVoice(value: unknown): string { const voice = typeof value === "string" ? value.trim() : "zh-CN-XiaoxiaoNeural"; if (!/^[A-Za-z0-9-]{3,100}$/.test(voice)) throw new ApiError(400, "VOICE_INVALID", "Choose a supported narration voice."); return voice; }
function sceneDurationSeconds(value: unknown): number { const seconds = value === undefined ? 30 : value; if (!Number.isSafeInteger(seconds) || (seconds as number) < 15 || (seconds as number) > 120) throw new ApiError(400, "CHUNK_DURATION_INVALID", "Scene duration must be between 15 and 120 seconds."); return seconds as number; }

export interface PublicJob {id: string; storyId: string | null; type: string; state: string; progress: number; attempt: number; maxAttempts: number; result: Record<string, unknown> | null; errorCode: string | null; errorMessage: string | null; createdAt: string; updatedAt: string}
export interface AutomationStatus {state: "idle" | "active" | "completed" | "failed"; storyStatus: string; errorCode: string | null; errorMessage: string | null; currentJob: PublicJob | null; jobCount: number}
export function publicJob(job: JobRecord): PublicJob { return {id: job.id, storyId: job.storyId, type: job.type, state: job.state, progress: job.progress, attempt: job.attempt, maxAttempts: job.maxAttempts, result: job.result, errorCode: job.errorCode, errorMessage: job.errorMessage, createdAt: job.createdAt, updatedAt: job.updatedAt}; }
function automationPayload(settings?: AutomationSettings): Record<string, unknown> { return settings ? {autoMode: true, ...(settings.rootJobId ? {autoRootJobId: settings.rootJobId} : {}), autoImageProvider: settings.imageProvider, autoCandidateCount: settings.candidateCount, autoVoice: settings.voice, autoChunkSeconds: settings.chunkSeconds} : {}; }
