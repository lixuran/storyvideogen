import { defineConfig, devices } from "@playwright/test";

const legacyPort = Number(process.env.STORYVIDEOGEN_E2E_PORT || 18760);
const nodePort = Number(process.env.STORYVIDEOGEN_NODE_E2E_PORT || 18761);
const runId = process.env.STORYVIDEOGEN_E2E_RUN_ID || String(process.pid);
const e2eRoot = `output/e2e/${runId}`;
const browserName = process.env.STORYVIDEOGEN_E2E_BROWSER || "chromium";

export default defineConfig({
  testDir: "./e2e",
  timeout: 45_000,
  fullyParallel: false,
  workers: 1,
  reporter: "list",
  use: {
    trace: "on-first-retry"
  },
  projects: [
    {
      name: "legacy-python",
      grepInvert: /@live-/,
      testMatch: /storyvideogen\.spec\.js/,
      use: {
        ...devices["Desktop Chrome"],
        baseURL: `http://127.0.0.1:${legacyPort}`
      }
    },
    {
      name: "chromium-desktop",
      grepInvert: /@live-/,
      testMatch: /(app-shell|database-bootstrap|identity-settings|stories-library|durable-jobs|full-story-planning|image-candidates|render-episode|subscription|wechat-boundary|admin|legacy-import|release-hardening|auto-mode)\.spec\.js/,
      use: {
        ...devices["Desktop Chrome"],
        browserName,
        baseURL: `http://127.0.0.1:${nodePort}`
      }
    },
    {
      name: "live-zhipu",
      grep: /@live-zhipu-/,
      testMatch: /live-zhipu.*\.spec\.[jt]s/,
      use: {
        ...devices["Desktop Chrome"],
        browserName,
        baseURL: `http://127.0.0.1:${nodePort}`
      }
    }
  ],
  webServer: [
    {
      command: `node scripts/run-python.mjs -m storyvideogen ui --host 127.0.0.1 --port ${legacyPort}`,
      url: `http://127.0.0.1:${legacyPort}`,
      reuseExistingServer: false,
      stdout: "pipe",
      stderr: "pipe",
      timeout: 120_000,
      env: {
        ...process.env,
        STORYVIDEOGEN_E2E_TEST_MODE: "1",
        STORYVIDEOGEN_AUTH_DB: `${e2eRoot}/ui_auth.sqlite3`,
        STORYVIDEOGEN_USER_ROOT: `${e2eRoot}/ui_users`,
        STORYVIDEOGEN_MAX_STORIES_PER_USER: "100",
        STORYVIDEOGEN_MAX_PREPARE_JOBS_PER_DAY: "100",
        STORYVIDEOGEN_MAX_COMPOSE_JOBS_PER_DAY: "100",
        STORYVIDEOGEN_GENERATION_RATE_LIMIT: "100"
      }
    },
    {
      command: "node server/dist/index.js",
      url: `http://127.0.0.1:${nodePort}/health/ready`,
      reuseExistingServer: false,
      stdout: "pipe",
      stderr: "pipe",
      timeout: 120_000,
      env: {
        ...process.env,
        STORYVIDEOGEN_NODE_HOST: "127.0.0.1",
        STORYVIDEOGEN_NODE_PORT: String(nodePort),
        STORYVIDEOGEN_NODE_LOG_LEVEL: "warn",
        STORYVIDEOGEN_DATABASE_PATH: `${e2eRoot}/node.sqlite3`,
        STORYVIDEOGEN_MIGRATIONS_DIR: "server/migrations",
        STORYVIDEOGEN_SECRET_MASTER_KEY: "BwcHBwcHBwcHBwcHBwcHBwcHBwcHBwcHBwcHBwcHBwc=",
        STORYVIDEOGEN_SECRET_KEY_ID: "e2e-v1",
        STORYVIDEOGEN_PROVIDER_TEST_MODE: "fixture",
        STORYVIDEOGEN_PAYMENT_MODE: "fake",
        STORYVIDEOGEN_STORAGE_ROOT: `${e2eRoot}/assets`,
        STORYVIDEOGEN_WORKER_ROOT: `${e2eRoot}/worker`,
        STORYVIDEOGEN_WORKER_FIXTURE_MODE: "1",
        STORYVIDEOGEN_WORKER_POLL_MS: "50",
        STORYVIDEOGEN_WORKER_LEASE_SECONDS: "5",
        STORYVIDEOGEN_AUTH_ATTEMPT_LIMIT: "200"
      }
    }
  ]
});
