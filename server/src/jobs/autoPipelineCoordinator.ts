import type {JobRecord, JobRepository} from "../db/repositories/jobRepository.js";
import type {ImageCandidateRepository} from "../db/repositories/imageCandidateRepository.js";
import type {StoryRepository} from "../db/repositories/storyRepository.js";
import type {BillingService} from "../billing/billingService.js";
import {ApiError} from "../http/errors.js";
import type {JobService} from "./jobService.js";

export class AutoPipelineCoordinator {
  constructor(
    private readonly jobs: JobRepository,
    private readonly stories: StoryRepository,
    private readonly candidates: ImageCandidateRepository,
    private readonly billing: BillingService,
    private readonly jobService: JobService
  ) {}

  beforeComplete(job: JobRecord): void {
    if (!isAutomatic(job) || job.type !== "generate_images") return;
    const candidateIds = stringArray(job.payload.candidateIds);
    const selected = candidateIds.map((id) => this.candidates.findById(id)).find((candidate) => candidate?.status === "ready" && candidate.assetId);
    if (!selected || !this.candidates.selectOwned(job.userId, selected.id, new Date().toISOString())) {
      throw new Error("Auto mode could not generate a usable image for one scene.");
    }
  }

  afterComplete(job: JobRecord): void {
    if (!isAutomatic(job) || !job.storyId) return;
    const story = this.stories.findOwned(job.userId, job.storyId);
    if (!story || story.status === "failed" || story.status === "archived" || story.status === "completed") return;
    if (job.type === "plan_story") this.queueImages(job);
    else if (job.type === "generate_images") this.queueRenderWhenReady(job);
  }

  reconcile(): void {
    const recoveryJobs = this.jobs.listAutomaticRecovery();
    for (const job of recoveryJobs.filter((item) => item.state === "failed")) this.markFailed(job, "AUTO_STAGE_FAILED");
    for (const job of recoveryJobs.filter((item) => item.state === "succeeded")) {
      try { this.afterComplete(job); }
      catch (error) { this.markError(job, error, "AUTO_PIPELINE_RECOVERY_FAILED"); }
    }
  }

  markFailed(job: JobRecord, code: string, message = "Auto mode stopped. Open the story to review the failed stage."): void {
    if (!isAutomatic(job) || !job.storyId) return;
    this.stories.markAutomationFailed(job.userId, job.storyId, code, message, new Date().toISOString());
  }

  markError(job: JobRecord, error: unknown, fallbackCode: string): void { if (error instanceof ApiError) this.markFailed(job, error.code, error.message); else this.markFailed(job, fallbackCode); }

  private queueImages(job: JobRecord): void {
    const storyId = job.storyId!;
    const scenes = this.stories.listScenes(job.userId, storyId);
    if (!scenes.length) throw new Error("Auto mode planning produced no scenes.");
    const count = integer(job.payload.autoCandidateCount, 1, 4);
    const existingSceneIds = new Set(this.jobs.listForStory(job.userId, storyId).filter((item) => item.type === "generate_images" && item.payload.autoRootJobId === job.id).map((item) => String(item.payload.sceneId ?? "")));
    const missingScenes = scenes.filter((scene) => !existingSceneIds.has(scene.id));
    if (!missingScenes.length) return;
    this.billing.assertEntitled(job.userId, "image_assets", missingScenes.length);
    this.billing.assertEntitled(job.userId, "render_jobs");
    const settings = automationSettings(job);
    for (const scene of missingScenes) {
      const prompt = this.stories.listPrompts(job.userId, scene.id)[0];
      if (!prompt) throw new Error("Auto mode scene has no image prompt.");
      this.jobService.enqueueImages(job.userId, scene.id, {promptId: prompt.id, provider: settings.imageProvider, count}, `auto:${job.id}:image:${scene.id}`, settings);
    }
    const story = this.stories.findOwned(job.userId, storyId);
    if (story && ["planning", "planned"].includes(story.status)) this.stories.markAutomationStatus(job.userId, storyId, "generating_images", new Date().toISOString());
  }

  private queueRenderWhenReady(job: JobRecord): void {
    const storyId = job.storyId!;
    const rootJobId = String(job.payload.autoRootJobId ?? "");
    const autoImageJobs = this.jobs.listForStory(job.userId, storyId).filter((item) => item.type === "generate_images" && item.payload.autoRootJobId === rootJobId);
    const scenes = this.stories.listScenes(job.userId, storyId);
    if (autoImageJobs.length !== scenes.length || autoImageJobs.some((item) => item.state !== "succeeded")) return;
    const candidates = this.candidates.listForStory(job.userId, storyId);
    if (scenes.some((scene) => !candidates.some((candidate) => candidate.sceneId === scene.id && candidate.isSelected && candidate.assetId))) return;
    const settings = automationSettings(job);
    this.jobService.enqueueRender(job.userId, storyId, {voice: settings.voice}, `auto:${rootJobId}:render`, settings);
    this.stories.markAutomationStatus(job.userId, storyId, "rendering", new Date().toISOString());
  }
}

export interface AutomationSettings {rootJobId?: string; imageProvider: string; candidateCount: number; voice: string; chunkSeconds: number}
function isAutomatic(job: JobRecord): boolean { return job.payload.autoMode === true; }
function automationSettings(job: JobRecord): AutomationSettings { return {rootJobId: String(job.payload.autoRootJobId ?? job.id), imageProvider: String(job.payload.autoImageProvider ?? "zhipu"), candidateCount: integer(job.payload.autoCandidateCount, 1, 4), voice: String(job.payload.autoVoice ?? "zh-CN-XiaoxiaoNeural"), chunkSeconds: integer(job.payload.autoChunkSeconds ?? 30, 15, 120)}; }
function integer(value: unknown, minimum: number, maximum: number): number { if (!Number.isSafeInteger(value) || (value as number) < minimum || (value as number) > maximum) throw new Error("Auto mode settings are invalid."); return value as number; }
function stringArray(value: unknown): string[] { if (!Array.isArray(value) || value.some((item) => typeof item !== "string")) throw new Error("Auto mode candidate identifiers are invalid."); return value as string[]; }
