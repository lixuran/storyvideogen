import type {FastifyInstance} from "fastify";

import {AuthService} from "./auth/authService.js";
import {buildApp} from "./app.js";
import type {AppConfig} from "./config.js";
import {openDatabase, type SqliteDatabase} from "./db/database.js";
import {migrateDatabase} from "./db/migrate.js";
import {DatabaseStatusRepository} from "./db/repositories/databaseStatusRepository.js";
import {IdentityRepository} from "./db/repositories/identityRepository.js";
import {ProviderSecretRepository} from "./db/repositories/providerSecretRepository.js";
import {ProviderService} from "./providers/providerService.js";
import {SecretCipher} from "./security/secretCipher.js";
import {StoryRepository} from "./db/repositories/storyRepository.js";
import {AssetRepository} from "./db/repositories/assetRepository.js";
import {StoryService} from "./stories/storyService.js";
import {AssetService} from "./assets/assetService.js";
import {JobRepository} from "./db/repositories/jobRepository.js";
import {JobService} from "./jobs/jobService.js";
import {ImageCandidateRepository} from "./db/repositories/imageCandidateRepository.js";
import {ImageCandidateService} from "./images/imageCandidateService.js";
import {BillingRepository} from "./billing/billingRepository.js";
import {BillingService} from "./billing/billingService.js";
import {AdminRepository} from "./admin/adminRepository.js";

export interface BootstrapResult {
  app: FastifyInstance;
  database?: SqliteDatabase;
}

export async function bootstrapApp(config: AppConfig): Promise<BootstrapResult> {
  let database: SqliteDatabase | undefined;
  try {
    database = openDatabase({
      filename: config.databasePath,
      busyTimeoutMs: config.databaseBusyTimeoutMs
    });
    migrateDatabase(database, config.migrationsDir);
    const databaseStatus = new DatabaseStatusRepository(database).read();
    const identities = new IdentityRepository(database);
    const auth = new AuthService(identities, config.sessionTtlSeconds);
    const cipher = config.secretMasterKey ? new SecretCipher(config.secretMasterKey, config.secretKeyId) : undefined;
    const providers = new ProviderService(new ProviderSecretRepository(database), cipher);
    const storyRepository = new StoryRepository(database);
    const stories = new StoryService(storyRepository);
    const assets = new AssetService(new AssetRepository(database), storyRepository, config.storageRoot);
    const candidateRepository = new ImageCandidateRepository(database);
    const images = new ImageCandidateService(candidateRepository, storyRepository, assets);
    const billingRepository = new BillingRepository(database); billingRepository.seed(new Date().toISOString()); const billing = new BillingService(billingRepository, config.paymentMode === "fake");
    const jobs = new JobService(new JobRepository(database), storyRepository, candidateRepository, assets, billing, config.workerFixtureMode, config.workerFixture, config.zhipuTextModel, config.zhipuImageModel);
    const admin = new AdminRepository(database); const app = await buildApp(config, {databaseStatus, services: {auth, identities, providers, stories, assets, images, jobs, billing, admin}});
    app.addHook("onClose", async () => {
      if (database?.open) {
        database.close();
      }
    });
    return {app, database};
  } catch (error) {
    if (database?.open) {
      database.close();
    }
    const app = await buildApp(config, {databaseStatus: {status: "unavailable"}});
    app.log.error({err: error}, "database bootstrap failed");
    return {app};
  }
}
