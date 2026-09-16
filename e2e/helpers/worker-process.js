import {spawn} from "node:child_process";

export function startFixtureWorker(extraEnv = {}) {
  const runId = process.env.STORYVIDEOGEN_E2E_RUN_ID;
  if (!runId) throw new Error("STORYVIDEOGEN_E2E_RUN_ID is required; run Playwright through scripts/run-playwright.mjs.");
  const databasePath = `output/e2e/${runId}/node.sqlite3`;
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, ["server/dist/worker.js", "--once"], {cwd: process.cwd(), windowsHide: true, stdio: ["ignore", "pipe", "pipe"], env: {...process.env, STORYVIDEOGEN_NODE_LOG_LEVEL: "silent", STORYVIDEOGEN_DATABASE_PATH: databasePath, STORYVIDEOGEN_MIGRATIONS_DIR: "server/migrations", STORYVIDEOGEN_SECRET_MASTER_KEY: "BwcHBwcHBwcHBwcHBwcHBwcHBwcHBwcHBwcHBwcHBwc=", STORYVIDEOGEN_SECRET_KEY_ID: "e2e-v1", STORYVIDEOGEN_STORAGE_ROOT: `output/e2e/${runId}/assets`, STORYVIDEOGEN_WORKER_ROOT: `output/e2e/${runId}/worker`, STORYVIDEOGEN_WORKER_LEASE_SECONDS: "5", STORYVIDEOGEN_WORKER_FIXTURE_MODE: "1", ...extraEnv}});
    let output = ""; child.stdout.on("data", (chunk) => {output += String(chunk);}); child.stderr.on("data", (chunk) => {output += String(chunk);}); child.once("error", reject); child.once("exit", (code) => code === 0 ? resolve(code) : reject(new Error(`Worker exited ${code}: ${output}`)));
  });
}
