import {expect, test} from "@playwright/test";
import {startFixtureWorker} from "./helpers/worker-process.js";

test("@m5 durable job is idempotent, streams events, and completes in the private worker", async ({page}) => {
  expect((await page.request.post("/api/v1/auth/register", {data: {username: "m5-owner", password: "owner-password"}})).status()).toBe(201);
  await page.goto("/create");
  await page.getByLabel("Story name").fill("A durable job");
  await page.getByLabel("Full story").fill("The full story waits safely in SQLite while a private worker handles it.");
  await page.getByRole("button", {name: "Save draft"}).click();
  await expect(page).toHaveURL(/\/create\?story=/);
  const storyId = new URL(page.url()).searchParams.get("story");
  expect(storyId).toBeTruthy();

  await page.evaluate(() => {
    window.__m5Events = [];
    const source = new EventSource("/api/v1/events/stream");
    source.addEventListener("queued", (event) => window.__m5Events.push(JSON.parse(event.data)));
    window.__m5EventSource = source;
  });
  const csrf = await csrfToken(page);
  const headers = {"x-csrf-token": csrf, "idempotency-key": "m5-stable-operation"};
  const first = await page.request.post(`/api/v1/stories/${storyId}/actions/plan`, {headers});
  const second = await page.request.post(`/api/v1/stories/${storyId}/actions/plan`, {headers});
  expect(first.status()).toBe(202); expect(second.status()).toBe(200);
  const firstJob = (await first.json()).job; const secondJob = (await second.json()).job;
  expect(secondJob.id).toBe(firstJob.id);
  await expect.poll(() => page.evaluate(() => window.__m5Events.length)).toBeGreaterThan(0);

  const worker = startFixtureWorker();
  await expect.poll(async () => (await (await page.request.get(`/api/v1/jobs/${firstJob.id}`)).json()).job.state, {timeout: 20_000}).toBe("succeeded");
  expect(await worker).toBe(0);
  await page.reload();
  await expect(page.getByRole("heading", {name: "Review 1 scenes"})).toBeVisible();
  await page.evaluate(() => window.__m5EventSource?.close());

  const stranger = await page.context().browser().newContext({baseURL: page.url()});
  try {
    expect((await stranger.request.post("/api/v1/auth/register", {data: {username: "m5-stranger", password: "stranger-password"}})).status()).toBe(201);
    expect((await stranger.request.get(`/api/v1/jobs/${firstJob.id}`)).status()).toBe(404);
  } finally { await stranger.close(); }
});

test("@m5 a running worker job can be cancelled without losing the draft", async ({page}) => {
  expect((await page.request.post("/api/v1/auth/register", {data: {username: "m5-cancel", password: "cancel-password"}})).status()).toBe(201);
  await page.goto("/create");
  await page.getByLabel("Story name").fill("Cancellation keeps this draft");
  await page.getByLabel("Full story").fill("Nothing already saved should disappear when background work is cancelled.");
  await page.getByRole("button", {name: "Save draft"}).click();
  await expect(page).toHaveURL(/\/create\?story=/);
  const storyId = new URL(page.url()).searchParams.get("story"); const csrf = await csrfToken(page);
  const response = await page.request.post(`/api/v1/stories/${storyId}/actions/plan`, {headers: {"x-csrf-token": csrf, "idempotency-key": "m5-cancel-operation"}, data: {fixture: "timeout"}});
  const job = (await response.json()).job; const worker = startFixtureWorker({STORYVIDEOGEN_WORKER_TIMEOUT_SECONDS: "20", STORYVIDEOGEN_WORKER_SILENCE_SECONDS: "20"});
  await expect.poll(async () => (await (await page.request.get(`/api/v1/jobs/${job.id}`)).json()).job.state, {timeout: 15_000}).toBe("running");
  expect((await page.request.post(`/api/v1/jobs/${job.id}/cancel`, {headers: {"x-csrf-token": csrf}})).status()).toBe(200);
  await expect.poll(async () => (await (await page.request.get(`/api/v1/jobs/${job.id}`)).json()).job.state, {timeout: 15_000}).toBe("cancelled");
  expect(await worker).toBe(0);
  await page.goto("/library");
  await expect(page.getByRole("heading", {name: "Cancellation keeps this draft"})).toBeVisible();
});

test("@m5 malformed, crashing, duplicate, and path-escaping workers fail safely", async ({page}) => {
  expect((await page.request.post("/api/v1/auth/register", {data: {username: "m5-invalid", password: "invalid-password"}})).status()).toBe(201);
  await page.goto("/create");
  await page.getByLabel("Story name").fill("Unsafe worker fixtures");
  await page.getByLabel("Full story").fill("Every untrusted worker response must be rejected at the private boundary.");
  await page.getByRole("button", {name: "Save draft"}).click();
  await expect(page).toHaveURL(/\/create\?story=/);
  const storyId = new URL(page.url()).searchParams.get("story"); const csrf = await csrfToken(page);
  for (const fixture of ["invalid_json", "crash", "duplicate_completion", "malicious_path"]) {
    const response = await page.request.post(`/api/v1/stories/${storyId}/actions/plan`, {headers: {"x-csrf-token": csrf, "idempotency-key": `m5-${fixture}-operation`}, data: {fixture}});
    const job = (await response.json()).job; expect(await startFixtureWorker()).toBe(0);
    await expect.poll(async () => (await (await page.request.get(`/api/v1/jobs/${job.id}`)).json()).job, {timeout: 15_000}).toMatchObject({state: "queued", attempt: 1});
    const payload = await (await page.request.get(`/api/v1/jobs/${job.id}`)).json();
    expect(payload.job.errorCode).toMatch(/^WORKER_/);
    expect(JSON.stringify(payload)).not.toContain("synthetic-credential-must-be-redacted");
    expect(JSON.stringify(payload)).not.toContain("../../outside.txt");
    await page.request.post(`/api/v1/jobs/${job.id}/cancel`, {headers: {"x-csrf-token": csrf}});
  }
});

async function csrfToken(page) {
  const cookie = (await page.context().cookies()).find((item) => item.name === "storyvideogen_csrf");
  expect(cookie).toBeTruthy(); return cookie.value;
}
