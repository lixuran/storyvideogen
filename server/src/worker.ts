import {randomUUID} from "node:crypto";

import {loadConfig} from "./config.js";
import {openDatabase} from "./db/database.js";
import {migrateDatabase} from "./db/migrate.js";
import {JobRepository} from "./db/repositories/jobRepository.js";
import {MediaWorkerSupervisor} from "./media-worker/supervisor.js";
import {ProviderSecretRepository} from "./db/repositories/providerSecretRepository.js";
import {ProviderService} from "./providers/providerService.js";
import {SecretCipher} from "./security/secretCipher.js";
import {StoryRepository} from "./db/repositories/storyRepository.js";
import {PlanningPersistence} from "./stories/planningPersistence.js";
import {AssetRepository} from "./db/repositories/assetRepository.js";
import {AssetService} from "./assets/assetService.js";
import {ImageCandidateRepository} from "./db/repositories/imageCandidateRepository.js";
import {ImagePersistence} from "./images/imagePersistence.js";
import {RenderPersistence} from "./render/renderPersistence.js";
import {BillingRepository} from "./billing/billingRepository.js";
import {BillingService} from "./billing/billingService.js";
import {JobService} from "./jobs/jobService.js";
import {AutoPipelineCoordinator} from "./jobs/autoPipelineCoordinator.js";
import {ApiError} from "./http/errors.js";

const config = loadConfig(); const database = openDatabase({filename: config.databasePath, busyTimeoutMs: config.databaseBusyTimeoutMs}); migrateDatabase(database, config.migrationsDir);
const jobs = new JobRepository(database); const workerId = `worker-${randomUUID()}`; const supervisor = new MediaWorkerSupervisor(config, jobs, workerId); const stories = new StoryRepository(database); const assetService = new AssetService(new AssetRepository(database), stories, config.storageRoot); const candidates = new ImageCandidateRepository(database); const planning = new PlanningPersistence(stories, config.workerRoot); const images = new ImagePersistence(candidates, assetService, config.workerRoot); const rendering = new RenderPersistence(assetService, stories, config.workerRoot); const billingRepository = new BillingRepository(database); billingRepository.seed(new Date().toISOString()); const billing = new BillingService(billingRepository, config.paymentMode === "fake"); const jobService = new JobService(jobs, stories, candidates, assetService, billing, config.workerFixtureMode, config.workerFixture, config.zhipuTextModel, config.zhipuImageModel); const automation = new AutoPipelineCoordinator(jobs, stories, candidates, billing, jobService); const cipher = config.secretMasterKey ? new SecretCipher(config.secretMasterKey, config.secretKeyId) : undefined; const providers = new ProviderService(new ProviderSecretRepository(database), cipher); const once = process.argv.includes("--once"); let stopping = false;
for (const signal of ["SIGINT", "SIGTERM"] as const) process.on(signal, () => { stopping = true; });
automation.reconcile();
try {
  do {
    const now = new Date(); const job = jobs.claim(workerId, now.toISOString(), new Date(now.getTime() + config.workerLeaseSeconds * 1000).toISOString());
    if (job) {
      try {
        const credentials: Record<string, string> = {};
        if (job.payload.provider === "zhipu") credentials.ZAI_API_KEY = providers.resolve(job.userId, "zhipu").value;
        if (job.payload.provider === "siliconflow") credentials.SILICONFLOW_API_KEY = providers.resolve(job.userId, "siliconflow").value;
        if (job.payload.provider === "pexels") {
          credentials.PEXELS_API_KEY = providers.resolve(job.userId, "pexels").value;
          try { credentials.ZAI_API_KEY = providers.resolve(job.userId, "zhipu").value; }
          catch (error) { if (!(error instanceof ApiError && error.code === "PROVIDER_UNAVAILABLE")) throw error; }
        }
        if (job.payload.provider === "pixabay") credentials.PIXABAY_API_KEY = providers.resolve(job.userId, "pixabay").value;
        const execution = await supervisor.execute(job, credentials);
        if (execution) {
          const result = job.type === "plan_story" && execution.resultFile ? await planning.apply(job, execution.resultFile) : job.type === "generate_images" && execution.resultFile ? await images.apply(job, execution.resultFile) : job.type === "render_video" && execution.resultFile ? await rendering.apply(job, execution.resultFile) : {};
          automation.beforeComplete(job);
          const completed = jobs.complete(job.id, workerId, {contractVersion: 1, sequence: execution.sequence, operation: job.type, ...result}, new Date().toISOString());
          if (completed) { const unit = job.type === "plan_story" ? "planning_jobs" : job.type === "generate_images" ? "image_assets" : job.type === "render_video" ? "render_jobs" : undefined; const quantity = job.type === "generate_images" ? Number((result as Record<string, unknown>).readyCount ?? 0) : 1; if (unit && quantity > 0) billing.record(job.userId, unit, quantity, job.storyId, job.id); try { automation.afterComplete(job); } catch (error) { automation.markError(job, error, "AUTO_PIPELINE_FAILED"); throw error; } }
        }
      } catch (error) {
        const code = error instanceof ApiError ? error.code : "WORKER_RESULT_INVALID";
        const message = error instanceof ApiError ? error.message : "The media worker result could not be applied.";
        const now = new Date(); const state = jobs.fail(job.id, workerId, code, message, now.toISOString(), new Date(now.getTime() + Math.min(60, 2 ** job.attempt) * 1000).toISOString()); if (state === "failed") automation.markFailed(job, code, message);
        console.error(`Worker job ${job.id} could not be applied: ${error instanceof Error ? error.message : "unknown error"}`);
      }
    } else if (!once) await new Promise((resolve) => setTimeout(resolve, config.workerPollMs));
  } while (!stopping && !once);
} finally { database.close(); }
