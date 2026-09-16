import {spawn} from "node:child_process";
import {randomBytes, randomUUID} from "node:crypto";
import {createServer} from "node:net";
import path from "node:path";

import {expect, test} from "@playwright/test";
import Database from "better-sqlite3";

test("@live-pexels encrypted Settings key searches, downloads, and selects a Pexels image", async ({page}, testInfo) => {
  test.setTimeout(180_000);
  const apiKey = readPexelsKey();
  const port = await getFreePort();
  const baseURL = `http://127.0.0.1:${port}`;
  const databasePath = testInfo.outputPath("live-pexels.sqlite3");
  const workerRoot = testInfo.outputPath("worker");
  const storageRoot = testInfo.outputPath("assets");
  const sharedEnv = {
    STORYVIDEOGEN_DATABASE_PATH: databasePath,
    STORYVIDEOGEN_MIGRATIONS_DIR: path.resolve("server", "migrations"),
    STORYVIDEOGEN_SECRET_MASTER_KEY: randomBytes(32).toString("base64"),
    STORYVIDEOGEN_SECRET_KEY_ID: "live-pexels-e2e-v1",
    STORYVIDEOGEN_WORKER_ROOT: workerRoot,
    STORYVIDEOGEN_STORAGE_ROOT: storageRoot,
    STORYVIDEOGEN_WORKER_FIXTURE_MODE: "0",
    STORYVIDEOGEN_WORKER_LEASE_SECONDS: "10",
    STORYVIDEOGEN_WORKER_TIMEOUT_SECONDS: "120",
    STORYVIDEOGEN_WORKER_SILENCE_SECONDS: "60",
  };
  let server = startProcess(["server/dist/index.js"], {...sharedEnv, STORYVIDEOGEN_NODE_HOST: "127.0.0.1", STORYVIDEOGEN_NODE_PORT: String(port), STORYVIDEOGEN_NODE_LOG_LEVEL: "warn"});
  let worker;
  try {
    await waitForReady(`${baseURL}/health/ready`, server);
    await page.goto(`${baseURL}/settings/providers`);
    await page.getByRole("button", {name: "Need an account? Register"}).click();
    await page.getByLabel("Username").fill("live-pexels-user");
    await page.getByLabel("Password").fill("live-pexels-password");
    await page.getByRole("button", {name: "Create account"}).click();
    await page.getByLabel("Pexels API key").fill(apiKey);
    const pexelsCard = page.locator(".provider-card").filter({has: page.getByRole("heading", {name: "Pexels", exact: true})});
    await pexelsCard.getByRole("button", {name: "Save", exact: true}).click();
    await expect(pexelsCard.getByText(`Saved key ending ${apiKey.slice(-4)}`)).toBeVisible();

    await page.goto(`${baseURL}/create`);
    await page.getByLabel("Story name").fill("Live Pexels image check");
    await page.getByLabel("Full story").fill("A solitary lighthouse stands above a moonlit sea.");
    await page.getByRole("button", {name: "Save draft"}).click();
    await expect(page).toHaveURL(/\/create\?story=/);
    const storyId = new URL(page.url()).searchParams.get("story");
    const seeded = seedPlannedScene(databasePath, storyId);
    await page.reload();
    await expect(page.getByRole("heading", {name: "Review 1 scenes"})).toBeVisible();
    await page.getByLabel("Image source").selectOption("pexels");

    const queued = await page.evaluate(async ({sceneId, promptId}) => {
      const csrf = document.cookie.split("; ").find((entry) => entry.startsWith("storyvideogen_csrf="))?.split("=")[1];
      const response = await fetch(`/api/v1/scenes/${sceneId}/actions/images`, {method: "POST", credentials: "same-origin", headers: {"content-type": "application/json", "idempotency-key": crypto.randomUUID(), "x-csrf-token": csrf || ""}, body: JSON.stringify({promptId, provider: "pexels", count: 1})});
      if (!response.ok) throw new Error(await response.text());
      return response.json();
    }, seeded);
    worker = startProcess(["server/dist/worker.js", "--once"], {...sharedEnv, STORYVIDEOGEN_NODE_LOG_LEVEL: "silent"});
    await expect.poll(async () => (await (await page.request.get(`${baseURL}/api/v1/jobs/${queued.job.id}`)).json()).job.state, {timeout: 120_000, intervals: [500, 1000, 3000]}).toBe("succeeded");
    expect(await waitForExit(worker, 10_000)).toBe(0);

    const candidates = await (await page.request.get(`${baseURL}/api/v1/stories/${storyId}/image-candidates`)).json();
    expect(candidates.candidates).toHaveLength(1);
    expect(candidates.candidates[0]).toMatchObject({provider: "pexels", status: "ready"});
    expect(candidates.candidates[0].sourceUrl).toMatch(/^https:\/\/www\.pexels\.com\/photo\//);
    expect(candidates.candidates[0].licenseCode).toBe("Pexels License");
    expect(candidates.candidates[0].asset.mimeType).toMatch(/^image\/(jpeg|png|webp)$/);
    expect(candidates.candidates[0].asset.byteSize).toBeGreaterThan(100);
    expect(`${server.output.join("")} ${worker.output.join("")} ${JSON.stringify(candidates)}`).not.toContain(apiKey);
  } finally {
    await stopProcess(worker);
    await stopProcess(server);
  }
});

function seedPlannedScene(databasePath, storyId) {
  if (!storyId) throw new Error("Story ID is missing.");
  const database = new Database(databasePath);
  try {
    const story = database.prepare("SELECT source_text FROM stories WHERE id = ?").get(storyId);
    if (!story) throw new Error("Story was not persisted.");
    const sceneId = randomUUID();
    const promptId = randomUUID();
    const now = new Date().toISOString();
    database.transaction(() => {
      database.prepare("INSERT INTO scenes (id, story_id, position, source_start, source_end, source_text, narration_text, status, created_at, updated_at) VALUES (?, ?, 0, 0, ?, ?, ?, 'planned', ?, ?)").run(sceneId, storyId, story.source_text.length, story.source_text, "A solitary lighthouse stands above a moonlit sea.", now, now);
      database.prepare("INSERT INTO image_prompts (id, scene_id, position, prompt_text, provider, model, status, created_at, updated_at) VALUES (?, ?, 0, ?, 'pexels', NULL, 'ready', ?, ?)").run(promptId, sceneId, "solitary lighthouse moonlit sea", now, now);
      database.prepare("UPDATE stories SET status = 'planned', version = version + 1, updated_at = ? WHERE id = ?").run(now, storyId);
    })();
    return {sceneId, promptId};
  } finally {
    database.close();
  }
}

function readPexelsKey() {
  if (process.env.PEXELS_API_KEY?.trim()) return process.env.PEXELS_API_KEY.trim();
  const database = new Database(path.resolve("output", "ui_auth.sqlite3"), {readonly: true, fileMustExist: true});
  try {
    const row = database.prepare("SELECT value FROM user_api_keys WHERE name = 'PEXELS_API_KEY' AND length(trim(value)) > 0 ORDER BY updated_at DESC LIMIT 1").get();
    if (!row?.value) throw new Error("Set PEXELS_API_KEY or save it in the legacy Settings page before running the live Pexels test.");
    return String(row.value);
  } finally {
    database.close();
  }
}

function startProcess(args, environment) {
  const output = [];
  const child = spawn(process.execPath, args, {cwd: process.cwd(), env: {...process.env, ...environment}, windowsHide: true, stdio: ["ignore", "pipe", "pipe"]});
  child.stdout.on("data", (chunk) => output.push(String(chunk)));
  child.stderr.on("data", (chunk) => output.push(String(chunk)));
  child.output = output;
  return child;
}

async function waitForReady(url, child) {
  const deadline = Date.now() + 20_000;
  while (Date.now() < deadline) {
    if (child.exitCode !== null) throw new Error(`Server exited early: ${child.output.join("")}`);
    try { if ((await fetch(url)).status === 200) return; } catch {}
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error(`Server readiness timed out: ${child.output.join("")}`);
}

function waitForExit(child, timeout) {
  if (child.exitCode !== null) return Promise.resolve(child.exitCode);
  return Promise.race([new Promise((resolve) => child.once("exit", resolve)), new Promise((_, reject) => setTimeout(() => reject(new Error(`Process timed out: ${child.output.join("")}`)), timeout))]);
}

async function stopProcess(child) {
  if (!child || child.exitCode !== null) return;
  const exited = new Promise((resolve) => child.once("exit", resolve));
  child.kill("SIGTERM");
  await Promise.race([exited, new Promise((resolve) => setTimeout(resolve, 5000))]);
  if (child.exitCode === null) { child.kill("SIGKILL"); await exited; }
}

function getFreePort() {
  return new Promise((resolve, reject) => {
    const server = createServer();
    server.unref();
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      if (!address || typeof address === "string") { server.close(); reject(new Error("Unable to allocate a live-test port.")); return; }
      server.close((error) => error ? reject(error) : resolve(address.port));
    });
  });
}
