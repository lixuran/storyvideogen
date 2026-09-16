import {spawn} from "node:child_process";
import {randomBytes} from "node:crypto";
import {createServer} from "node:net";
import path from "node:path";

import {expect, test} from "@playwright/test";

test("@live-pexels full story planning and semantic Pexels selection", async ({page}, testInfo) => {
  test.setTimeout(360_000);
  const pexelsKey = requiredKey("PEXELS_API_KEY");
  const zhipuKey = requiredKey("ZAI_API_KEY");
  const port = await getFreePort();
  const baseURL = `http://127.0.0.1:${port}`;
  const sharedEnv = {
    STORYVIDEOGEN_DATABASE_PATH: testInfo.outputPath("live-pexels-story.sqlite3"),
    STORYVIDEOGEN_MIGRATIONS_DIR: path.resolve("server", "migrations"),
    STORYVIDEOGEN_SECRET_MASTER_KEY: randomBytes(32).toString("base64"),
    STORYVIDEOGEN_SECRET_KEY_ID: "live-pexels-story-e2e-v1",
    STORYVIDEOGEN_STORAGE_ROOT: testInfo.outputPath("assets"),
    STORYVIDEOGEN_WORKER_ROOT: testInfo.outputPath("worker"),
    STORYVIDEOGEN_WORKER_FIXTURE_MODE: "0",
    STORYVIDEOGEN_WORKER_LEASE_SECONDS: "10",
    STORYVIDEOGEN_WORKER_TIMEOUT_SECONDS: "300",
    STORYVIDEOGEN_WORKER_SILENCE_SECONDS: "120",
  };
  const server = startProcess(["server/dist/index.js"], {...sharedEnv, STORYVIDEOGEN_NODE_HOST: "127.0.0.1", STORYVIDEOGEN_NODE_PORT: String(port), STORYVIDEOGEN_NODE_LOG_LEVEL: "warn"});
  let worker;
  try {
    await waitForReady(`${baseURL}/health/ready`, server);
    await page.goto(`${baseURL}/settings/providers`);
    await page.getByRole("button", {name: "Need an account? Register"}).click();
    await page.getByLabel("Username").fill("live-pexels-story-user");
    await page.getByLabel("Password").fill("live-pexels-story-password");
    await page.getByRole("button", {name: "Create account"}).click();
    await saveProviderKey(page, "Zhipu AI", "Zhipu AI API key", zhipuKey);
    await saveProviderKey(page, "Pexels", "Pexels API key", pexelsKey);

    await page.goto(`${baseURL}/create`);
    await page.getByLabel("Story name").fill("Live Pexels semantic story check");
    await page.getByLabel("Full story").fill("A solitary lighthouse stands above a moonlit sea. A keeper carries a brass lantern up the stairs as waves strike the cliff below.");
    await page.getByRole("button", {name: "Save draft"}).click();
    await expect(page).toHaveURL(/\/create\?story=/);

    const planned = await clickAndReadJob(page, "Plan full story");
    worker = startProcess(["server/dist/worker.js", "--once"], {...sharedEnv, STORYVIDEOGEN_NODE_LOG_LEVEL: "silent"});
    await expect.poll(() => jobState(page, baseURL, planned.id), {timeout: 240_000, intervals: [1000, 2000, 5000]}).toBe("succeeded");
    expect(await waitForExit(worker, 30_000)).toBe(0);
    await page.reload();
    await expect(page.getByRole("heading", {name: /Review \d+ scenes/})).toBeVisible();

    await page.getByLabel("Image source").selectOption("pexels");
    const imageJob = await clickAndReadJob(page, "Generate 2 images with Pexels");
    worker = startProcess(["server/dist/worker.js", "--once"], {...sharedEnv, STORYVIDEOGEN_NODE_LOG_LEVEL: "silent"});
    await expect.poll(() => jobState(page, baseURL, imageJob.id), {timeout: 180_000, intervals: [1000, 2000, 5000]}).toBe("succeeded");
    expect(await waitForExit(worker, 30_000)).toBe(0);

    const storyId = new URL(page.url()).searchParams.get("story");
    const candidates = await (await page.request.get(`${baseURL}/api/v1/stories/${storyId}/image-candidates`)).json();
    const ready = candidates.candidates.filter((candidate) => candidate.provider === "pexels" && candidate.status === "ready");
    expect(ready.length).toBeGreaterThan(0);
    expect(ready[0].sourceUrl).toMatch(/^https:\/\/www\.pexels\.com\/photo\//);
    expect(ready[0].licenseCode).toBe("Pexels License");
    expect(ready[0].asset.mimeType).toMatch(/^image\/(jpeg|png|webp)$/);
    expect(`${server.output.join("")} ${worker.output.join("")} ${JSON.stringify(candidates)}`).not.toContain(pexelsKey);
    expect(`${server.output.join("")} ${worker.output.join("")} ${JSON.stringify(candidates)}`).not.toContain(zhipuKey);
  } finally {
    await stopProcess(worker);
    await stopProcess(server);
  }
});

async function saveProviderKey(page, heading, label, value) {
  const card = page.locator(".provider-card").filter({has: page.getByRole("heading", {name: heading, exact: true})});
  await card.getByLabel(label).fill(value);
  await card.getByRole("button", {name: "Save", exact: true}).click();
  await expect(card.getByText(`Saved key ending ${value.slice(-4)}`)).toBeVisible();
}

async function clickAndReadJob(page, name) {
  const [response] = await Promise.all([
    page.waitForResponse((item) => item.url().includes("/actions/") && item.request().method() === "POST"),
    page.getByRole("button", {name}).click(),
  ]);
  return (await response.json()).job;
}

async function jobState(page, baseURL, jobId) {
  return (await (await page.request.get(`${baseURL}/api/v1/jobs/${jobId}`)).json()).job.state;
}

function requiredKey(name) {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`${name} must be set for the live semantic Pexels test.`);
  return value;
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
