import path from "node:path";
import {fileURLToPath} from "node:url";

const workspaceRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const logLevels = new Set(["fatal", "error", "warn", "info", "debug", "trace", "silent"]);

export interface AppConfig {
  host: string;
  port: number;
  bodyLimit: number;
  logLevel: string;
  webRoot: string;
  databasePath: string;
  databaseBusyTimeoutMs: number;
  migrationsDir: string;
  sessionTtlSeconds: number;
  secureCookies: boolean;
  secretMasterKey: string | undefined;
  secretKeyId: string;
  providerTestMode: "fixture" | "live";
  storageRoot: string;
  maxUploadBytes: number;
  workerRoot: string;
  workerPollMs: number;
  workerLeaseSeconds: number;
  workerTimeoutSeconds: number;
  workerSilenceSeconds: number;
  workerFixtureMode: boolean;
  workerFixture: string;
  authAttemptLimit: number;
  zhipuTextModel: string;
  zhipuImageModel: string;
  paymentMode: "disabled" | "fake";
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): AppConfig {
  const host = env.STORYVIDEOGEN_NODE_HOST?.trim() || "127.0.0.1";
  const port = integerSetting(env.STORYVIDEOGEN_NODE_PORT, 3000, "STORYVIDEOGEN_NODE_PORT", 1, 65_535);
  const bodyLimit = integerSetting(
    env.STORYVIDEOGEN_NODE_BODY_LIMIT,
    1_048_576,
    "STORYVIDEOGEN_NODE_BODY_LIMIT",
    1_024,
    10_485_760
  );
  const logLevel = env.STORYVIDEOGEN_NODE_LOG_LEVEL?.trim().toLowerCase() || "info";
  if (!logLevels.has(logLevel)) {
    throw new Error(`STORYVIDEOGEN_NODE_LOG_LEVEL must be one of ${[...logLevels].join(", ")}.`);
  }

  const configuredWebRoot = env.STORYVIDEOGEN_WEB_ROOT?.trim();
  const webRoot = path.resolve(configuredWebRoot || path.join(workspaceRoot, "web", "dist"));
  const configuredDatabasePath = env.STORYVIDEOGEN_DATABASE_PATH?.trim();
  const databasePath = path.resolve(configuredDatabasePath || path.join(workspaceRoot, "output", "storyvideogen.sqlite3"));
  const databaseBusyTimeoutMs = integerSetting(
    env.STORYVIDEOGEN_SQLITE_BUSY_TIMEOUT_MS,
    5_000,
    "STORYVIDEOGEN_SQLITE_BUSY_TIMEOUT_MS",
    100,
    60_000
  );
  const configuredMigrationsDir = env.STORYVIDEOGEN_MIGRATIONS_DIR?.trim();
  const migrationsDir = path.resolve(configuredMigrationsDir || path.join(workspaceRoot, "server", "migrations"));
  const sessionTtlSeconds = integerSetting(
    env.STORYVIDEOGEN_SESSION_TTL_SECONDS,
    14 * 24 * 60 * 60,
    "STORYVIDEOGEN_SESSION_TTL_SECONDS",
    60,
    31_536_000
  );
  const secureCookies = booleanSetting(env.STORYVIDEOGEN_SECURE_COOKIES, false, "STORYVIDEOGEN_SECURE_COOKIES");
  const secretMasterKey = env.STORYVIDEOGEN_SECRET_MASTER_KEY?.trim() || undefined;
  const secretKeyId = env.STORYVIDEOGEN_SECRET_KEY_ID?.trim() || "v1";
  const providerTestModeValue = env.STORYVIDEOGEN_PROVIDER_TEST_MODE?.trim().toLowerCase() || "fixture";
  if (providerTestModeValue !== "fixture" && providerTestModeValue !== "live") {
    throw new Error("STORYVIDEOGEN_PROVIDER_TEST_MODE must be fixture or live.");
  }
  const providerTestMode = providerTestModeValue;
  const configuredStorageRoot = env.STORYVIDEOGEN_STORAGE_ROOT?.trim();
  const storageRoot = path.resolve(configuredStorageRoot || path.join(workspaceRoot, "output", "assets"));
  const maxUploadBytes = integerSetting(env.STORYVIDEOGEN_MAX_UPLOAD_BYTES, 10_485_760, "STORYVIDEOGEN_MAX_UPLOAD_BYTES", 1_024, 52_428_800);
  const workerRoot = path.resolve(env.STORYVIDEOGEN_WORKER_ROOT?.trim() || path.join(workspaceRoot, "output", "worker"));
  const workerPollMs = integerSetting(env.STORYVIDEOGEN_WORKER_POLL_MS, 500, "STORYVIDEOGEN_WORKER_POLL_MS", 50, 60_000);
  const workerLeaseSeconds = integerSetting(env.STORYVIDEOGEN_WORKER_LEASE_SECONDS, 30, "STORYVIDEOGEN_WORKER_LEASE_SECONDS", 5, 3600);
  const workerTimeoutSeconds = integerSetting(env.STORYVIDEOGEN_WORKER_TIMEOUT_SECONDS, 3600, "STORYVIDEOGEN_WORKER_TIMEOUT_SECONDS", 1, 86_400);
  const workerSilenceSeconds = integerSetting(env.STORYVIDEOGEN_WORKER_SILENCE_SECONDS, 720, "STORYVIDEOGEN_WORKER_SILENCE_SECONDS", 1, 3600);
  const workerFixtureMode = booleanSetting(env.STORYVIDEOGEN_WORKER_FIXTURE_MODE, false, "STORYVIDEOGEN_WORKER_FIXTURE_MODE");
  const workerFixture = env.STORYVIDEOGEN_WORKER_FIXTURE?.trim() || "success";
  const authAttemptLimit = integerSetting(env.STORYVIDEOGEN_AUTH_ATTEMPT_LIMIT, 10, "STORYVIDEOGEN_AUTH_ATTEMPT_LIMIT", 1, 10_000);
  const zhipuTextModel = env.STORYVIDEOGEN_ZHIPU_TEXT_MODEL?.trim() || "glm-5.2";
  const zhipuImageModel = env.STORYVIDEOGEN_ZHIPU_IMAGE_MODEL?.trim() || "cogview-3-flash";
  const paymentModeValue = env.STORYVIDEOGEN_PAYMENT_MODE?.trim().toLowerCase() || "disabled"; if (paymentModeValue !== "disabled" && paymentModeValue !== "fake") throw new Error("STORYVIDEOGEN_PAYMENT_MODE must be disabled or fake."); const paymentMode = paymentModeValue;
  return {
    host,
    port,
    bodyLimit,
    logLevel,
    webRoot,
    databasePath,
    databaseBusyTimeoutMs,
    migrationsDir,
    sessionTtlSeconds,
    secureCookies,
    secretMasterKey,
    secretKeyId,
    providerTestMode,
    storageRoot,
    maxUploadBytes,
    workerRoot,
    workerPollMs,
    workerLeaseSeconds,
    workerTimeoutSeconds,
    workerSilenceSeconds,
    workerFixtureMode,
    workerFixture,
    authAttemptLimit,
    zhipuTextModel,
    zhipuImageModel,
    paymentMode
  };
}

function booleanSetting(value: string | undefined, fallback: boolean, name: string): boolean {
  if (value === undefined || value.trim() === "") return fallback;
  if (value === "1" || value.toLowerCase() === "true") return true;
  if (value === "0" || value.toLowerCase() === "false") return false;
  throw new Error(`${name} must be true, false, 1, or 0.`);
}

function integerSetting(
  value: string | undefined,
  fallback: number,
  name: string,
  minimum: number,
  maximum: number
): number {
  if (value === undefined || value.trim() === "") {
    return fallback;
  }
  if (!/^\d+$/.test(value.trim())) {
    throw new Error(`${name} must be an integer between ${minimum} and ${maximum}.`);
  }
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < minimum || parsed > maximum) {
    throw new Error(`${name} must be an integer between ${minimum} and ${maximum}.`);
  }
  return parsed;
}
