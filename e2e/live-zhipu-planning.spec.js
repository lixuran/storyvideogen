import {spawn} from "node:child_process";
import {randomBytes} from "node:crypto";
import {createServer} from "node:net";
import path from "node:path";

import {expect, test} from "@playwright/test";
import Database from "better-sqlite3";

test("@live-zhipu-text encrypted Settings key plans one story through the private worker", async ({page}, testInfo) => {
  test.setTimeout(180_000);
  const apiKey = readLegacyZhipuKey();
  const port = await getFreePort(); const baseURL = `http://127.0.0.1:${port}`; const databasePath = testInfo.outputPath("live-zhipu.sqlite3"); const workerRoot = testInfo.outputPath("worker"); const masterKey = randomBytes(32).toString("base64");
  const sharedEnv = {STORYVIDEOGEN_DATABASE_PATH: databasePath, STORYVIDEOGEN_MIGRATIONS_DIR: path.resolve("server", "migrations"), STORYVIDEOGEN_SECRET_MASTER_KEY: masterKey, STORYVIDEOGEN_SECRET_KEY_ID: "live-e2e-v1", STORYVIDEOGEN_WORKER_ROOT: workerRoot, STORYVIDEOGEN_WORKER_FIXTURE_MODE: "0", STORYVIDEOGEN_ZHIPU_TEXT_MODEL: process.env.STORYVIDEOGEN_ZHIPU_TEXT_MODEL || "glm-5.2", STORYVIDEOGEN_WORKER_LEASE_SECONDS: "10", STORYVIDEOGEN_WORKER_TIMEOUT_SECONDS: "150", STORYVIDEOGEN_WORKER_SILENCE_SECONDS: "120"};
  let server = startProcess(["server/dist/index.js"], {...sharedEnv, STORYVIDEOGEN_NODE_HOST: "127.0.0.1", STORYVIDEOGEN_NODE_PORT: String(port), STORYVIDEOGEN_NODE_LOG_LEVEL: "warn"});
  let worker;
  try {
    await waitForReady(`${baseURL}/health/ready`, server);
    await page.goto(`${baseURL}/settings/providers`);
    await page.getByRole("button", {name: "Need an account? Register"}).click();
    await page.getByLabel("Username").fill("live-zhipu-user"); await page.getByLabel("Password").fill("live-zhipu-password"); await page.getByRole("button", {name: "Create account"}).click();
    await page.getByLabel("Zhipu AI API key").fill(apiKey); await page.getByRole("button", {name: "Save", exact: true}).first().click();
    await expect(page.getByText("Provider key saved securely.")).toBeVisible(); await expect(page.locator("body")).not.toContainText(apiKey);

    await page.goto(`${baseURL}/create`); await page.getByLabel("Story name").fill("Live Zhipu planning check"); await page.getByLabel("Full story").fill("At midnight, Mara entered the silent lighthouse. A brass bell rang above her, although the tower had been abandoned for fifty years."); await page.getByRole("button", {name: "Save draft"}).click(); await expect(page).toHaveURL(/\/create\?story=/);
    const [queuedResponse] = await Promise.all([page.waitForResponse((response) => response.url().includes("/actions/plan") && response.request().method() === "POST"), page.getByRole("button", {name: "Plan full story"}).click()]);
    const queued = await queuedResponse.json();
    worker = startProcess(["server/dist/worker.js", "--once"], {...sharedEnv, STORYVIDEOGEN_NODE_LOG_LEVEL: "silent"});
    await expect.poll(async () => (await (await page.request.get(`${baseURL}/api/v1/jobs/${queued.job.id}`)).json()).job.state, {timeout: 150_000, intervals: [1000, 2000, 3000]}).toBe("succeeded");
    expect(await waitForExit(worker, 20_000)).toBe(0);
    const jobPayload = await (await page.request.get(`${baseURL}/api/v1/jobs/${queued.job.id}`)).json();
    expect(jobPayload.job.result).toMatchObject({planningSource: "zhipu", provider: "zhipu", model: sharedEnv.STORYVIDEOGEN_ZHIPU_TEXT_MODEL, sceneCount: 1});
    const storyId = new URL(page.url()).searchParams.get("story"); const storyPayload = await (await page.request.get(`${baseURL}/api/v1/stories/${storyId}`)).json();
    expect(storyPayload.story.scenes).toHaveLength(1); expect(storyPayload.story.scenes[0].narrationText).toMatch(/[\u4e00-\u9fff]/); expect(storyPayload.story.scenes[0].prompts).toHaveLength(3); expect(storyPayload.story.scenes[0].prompts[0]).toMatchObject({provider: "zhipu", model: sharedEnv.STORYVIDEOGEN_ZHIPU_TEXT_MODEL});
    expect(`${server.output.join("")} ${worker.output.join("")} ${JSON.stringify(jobPayload)} ${JSON.stringify(storyPayload)}`).not.toContain(apiKey);
  } finally {
    await stopProcess(worker); await stopProcess(server);
  }
});

function readLegacyZhipuKey() {
  const database = new Database(path.resolve("output", "ui_auth.sqlite3"), {readonly: true, fileMustExist: true});
  try { const row = database.prepare("SELECT value FROM user_api_keys WHERE name = 'ZAI_API_KEY' AND length(trim(value)) > 0 ORDER BY updated_at DESC LIMIT 1").get(); if (!row?.value) throw new Error("No ZAI_API_KEY is saved in the legacy Settings database."); return String(row.value); } finally { database.close(); }
}
function startProcess(args, environment) { const output = []; const child = spawn(process.execPath, args, {cwd: process.cwd(), env: {...process.env, ...environment}, windowsHide: true, stdio: ["ignore", "pipe", "pipe"]}); child.stdout.on("data", (chunk) => output.push(String(chunk))); child.stderr.on("data", (chunk) => output.push(String(chunk))); child.output = output; return child; }
async function waitForReady(url, child) { const deadline = Date.now() + 20_000; while (Date.now() < deadline) { if (child.exitCode !== null) throw new Error(`Server exited early: ${child.output.join("")}`); try { if ((await fetch(url)).status === 200) return; } catch {} await new Promise((resolve) => setTimeout(resolve, 100)); } throw new Error(`Server readiness timed out: ${child.output.join("")}`); }
function waitForExit(child, timeout) { if (child.exitCode !== null) return Promise.resolve(child.exitCode); return Promise.race([new Promise((resolve) => child.once("exit", resolve)), new Promise((_, reject) => setTimeout(() => reject(new Error(`Process timed out: ${child.output.join("")}`)), timeout))]); }
async function stopProcess(child) { if (!child || child.exitCode !== null) return; const exited = new Promise((resolve) => child.once("exit", resolve)); child.kill("SIGTERM"); await Promise.race([exited, new Promise((resolve) => setTimeout(resolve, 5000))]); if (child.exitCode === null) { child.kill("SIGKILL"); await exited; } }
function getFreePort() { return new Promise((resolve, reject) => { const server = createServer(); server.unref(); server.once("error", reject); server.listen(0, "127.0.0.1", () => { const address = server.address(); if (!address || typeof address === "string") { server.close(); reject(new Error("Unable to allocate a live-test port.")); return; } server.close((error) => error ? reject(error) : resolve(address.port)); }); }); }
