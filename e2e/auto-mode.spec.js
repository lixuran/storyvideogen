import {expect, test} from "@playwright/test";
import Database from "better-sqlite3";

import {startFixtureWorker} from "./helpers/worker-process.js";

test("@m14 auto mode finishes in the background with concurrent workers", async ({page}) => {
  expect((await page.request.post("/api/v1/auth/register", {data: {username: "m14-auto", password: "auto-mode-password"}})).status()).toBe(201);
  const source = `Opening sentence. ${Array.from({length: 145}, (_, index) => `word${index + 1}`).join(" ")} Final sentence.`;
  await page.goto("/create");
  await page.getByLabel("Story name").fill("Background auto podcast");
  await page.getByLabel("Full story").fill(source);
  await page.getByRole("button", {name: "Save draft"}).click();
  await expect(page).toHaveURL(/\/create\?story=/);
  const storyId = new URL(page.url()).searchParams.get("story");
  expect(storyId).toBeTruthy();

  await page.getByRole("button", {name: "Auto-create podcast"}).click();
  await expect(page.getByRole("status")).toContainText("Auto mode queued");
  expect(await startFixtureWorker()).toBe(0);

  await page.getByRole("link", {name: "Library"}).click();
  await expect(page.getByText("generating images")).toBeVisible();
  expect(await Promise.all([startFixtureWorker(), startFixtureWorker()])).toEqual([0, 0]);

  await expect.poll(async () => (await page.request.get(`/api/v1/stories/${storyId}/automation`)).json(), {timeout: 20_000}).toMatchObject({state: "active", storyStatus: "rendering", jobCount: 4});
  expect(await startFixtureWorker()).toBe(0);

  await expect.poll(async () => (await page.request.get(`/api/v1/stories/${storyId}/automation`)).json(), {timeout: 90_000}).toMatchObject({state: "completed", storyStatus: "completed", jobCount: 4});
  await page.goto(`/create?story=${storyId}`);
  await expect(page.getByRole("link", {name: "Play finished video"})).toBeVisible();
  await expect(page.getByRole("heading", {name: "Review 2 scenes"})).toBeVisible();
  await expect(page.locator(".candidate-card.selected")).toHaveCount(2);
  const database = openDatabase();
  try {
    const imageJobs = database.prepare("SELECT payload_json FROM jobs WHERE story_id = ? AND type = 'generate_images' ORDER BY created_at, id").all(storyId);
    expect(imageJobs).toHaveLength(2);
    for (const row of imageJobs) {
      const candidateIds = JSON.parse(row.payload_json).candidateIds;
      expect(database.prepare("SELECT is_selected FROM image_candidates WHERE id = ?").get(candidateIds[0]).is_selected).toBe(1);
    }
  } finally { database.close(); }
});

function openDatabase() { const runId = process.env.STORYVIDEOGEN_E2E_RUN_ID; if (!runId) throw new Error("Missing E2E run ID."); return new Database(`output/e2e/${runId}/node.sqlite3`); }

test("@m15 slow Zhipu-shaped image work stays alive and produces an MP4", async ({page}) => {
  test.setTimeout(120_000);
  expect((await page.request.post("/api/v1/auth/register", {data: {username: "m15-slow-auto", password: "slow-auto-password"}})).status()).toBe(201);
  const source = `Item #: SCP-173

Object Class: Euclid

Special Containment Procedures: Item SCP-173 is to be kept in a locked container at all times. When personnel must enter SCP-173's container, no fewer than 3 may enter at any time and the door is to be relocked behind them. At all times, two persons must maintain direct eye contact with SCP-173 until all personnel have vacated and relocked the container.

Description: Moved to Site-19 1993. Origin is as of yet unknown. It is constructed from concrete and rebar with traces of Krylon brand spray paint. SCP-173 is animate and extremely hostile. The object cannot move while within a direct line of sight. Line of sight must not be broken at any time with SCP-173. Personnel assigned to enter container are instructed to alert one another before blinking. Object is reported to attack by snapping the neck at the base of the skull, or by strangulation. In the event of an attack, personnel are to observe Class 4 hazardous object containment procedures.

Personnel report sounds of scraping stone originating from within the container when no one is present inside. This is considered normal, and any change in this behaviour should be reported to the acting HMCL supervisor on duty.

The reddish brown substance on the floor is a combination of feces and blood. Origin of these materials is unknown. The enclosure must be cleaned on a bi-weekly basis.`;
  await page.goto("/create");
  await page.getByLabel("Story name").fill("SCP-173 slow auto regression");
  await page.getByLabel("Full story").fill(source);
  await page.getByRole("button", {name: "Save draft"}).click();
  await expect(page).toHaveURL(/\/create\?story=/);
  await page.getByLabel("Target scene length (seconds)").fill("60");
  const storyId = new URL(page.url()).searchParams.get("story");
  await page.getByRole("button", {name: "Auto-create podcast"}).click();
  expect(await startFixtureWorker({STORYVIDEOGEN_WORKER_FIXTURE: "slow_success"})).toBe(0);
  await expect.poll(async () => (await page.request.get(`/api/v1/stories/${storyId}/automation`)).json()).toMatchObject({state: "active", storyStatus: "generating_images", jobCount: 3});
  expect(await Promise.all([
    startFixtureWorker({STORYVIDEOGEN_WORKER_FIXTURE: "slow_success", STORYVIDEOGEN_WORKER_SILENCE_SECONDS: "3"}),
    startFixtureWorker({STORYVIDEOGEN_WORKER_FIXTURE: "slow_success", STORYVIDEOGEN_WORKER_SILENCE_SECONDS: "3"})
  ])).toEqual([0, 0]);
  await expect.poll(async () => (await page.request.get(`/api/v1/stories/${storyId}/automation`)).json(), {timeout: 20_000}).toMatchObject({state: "active", storyStatus: "rendering", jobCount: 4});
  expect(await startFixtureWorker()).toBe(0);
  await expect.poll(async () => (await page.request.get(`/api/v1/stories/${storyId}/automation`)).json(), {timeout: 90_000}).toMatchObject({state: "completed", storyStatus: "completed"});
  await page.goto(`/create?story=${storyId}`);
  await expect(page.getByRole("link", {name: "Play finished video"})).toBeVisible();
});

test("@m15 auto mode reports the quota failure that stopped planning", async ({page}) => {
  expect((await page.request.post("/api/v1/auth/register", {data: {username: "m15-quota-auto", password: "quota-auto-password"}})).status()).toBe(201);
  await page.request.get("/api/v1/billing");
  seedImageUsageNearQuota();
  await page.goto("/create");
  await page.getByLabel("Story name").fill("Quota diagnosis");
  await page.getByLabel("Full story").fill(Array.from({length: 145}, (_, index) => `containment${index + 1}`).join(" "));
  await page.getByRole("button", {name: "Save draft"}).click();
  await expect(page).toHaveURL(/\/create\?story=/);
  const storyId = new URL(page.url()).searchParams.get("story");
  await page.getByRole("button", {name: "Auto-create podcast"}).click();
  expect(await startFixtureWorker()).toBe(0);
  await expect.poll(async () => (await page.request.get(`/api/v1/stories/${storyId}/automation`)).json()).toMatchObject({state: "failed", errorCode: "QUOTA_EXCEEDED", errorMessage: "Your image assets quota is exhausted."});
  await expect(page.getByRole("status")).toContainText("image assets quota is exhausted");
});

function seedImageUsageNearQuota() {
  const database = openDatabase();
  try {
    const account = database.prepare("SELECT users.id AS user_id, subscriptions.id AS subscription_id FROM users JOIN subscriptions ON subscriptions.user_id = users.id WHERE users.username = ? AND subscriptions.state = 'active'").get("m15-quota-auto");
    const plan = database.prepare("SELECT quota_json FROM plans WHERE code = 'trial'").get();
    const quantity = JSON.parse(plan.quota_json).image_assets - 1;
    database.prepare("INSERT INTO usage_ledger (user_id, subscription_id, unit_type, quantity, created_at) VALUES (?, ?, 'image_assets', ?, ?)").run(account.user_id, account.subscription_id, quantity, new Date().toISOString());
  } finally { database.close(); }
}
