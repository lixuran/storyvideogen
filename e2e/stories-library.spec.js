import {expect, test} from "@playwright/test";

const tinyPng = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=", "base64");

test("@m4 draft autosave conflicts, Library filters, assets, and owner isolation", async ({browser, page, baseURL}) => {
  const registered = await page.request.post("/api/v1/auth/register", {data: {username: "m4-owner", password: "owner-password"}});
  expect(registered.status()).toBe(201);
  await page.goto("/create");
  await page.getByLabel("Story name").fill("The Clockwork Lighthouse");
  await page.getByLabel("Full story").fill("The keeper climbed the spiral stairs. The sea below was completely still.");
  await page.getByRole("button", {name: "Save draft"}).click();
  await expect(page).toHaveURL(/\/create\?story=/);
  await expect(page.getByRole("status")).toHaveText("Saved");
  const storyId = new URL(page.url()).searchParams.get("story");
  expect(storyId).toBeTruthy();

  await page.getByLabel("Manual image").setInputFiles({name: "reference.png", mimeType: "image/png", buffer: tinyPng});
  await page.getByRole("button", {name: "Upload image"}).click();
  const assetLink = page.getByRole("link", {name: "Image 1×1"});
  await expect(assetLink).toBeVisible();
  const assetUrl = await assetLink.getAttribute("href");
  expect(assetUrl).toMatch(/^\/api\/v1\/assets\/[a-f0-9-]+$/);
  const assetResponse = await page.request.get(assetUrl);
  expect(assetResponse.status()).toBe(200);
  expect(assetResponse.headers()["content-type"]).toMatch(/^image\/png/);

  const secondTab = await page.context().newPage();
  await secondTab.goto(page.url());
  await expect(secondTab.getByLabel("Story name")).toHaveValue("The Clockwork Lighthouse");
  await page.getByLabel("Full story").fill("The keeper climbed the spiral stairs. The sea below was completely still. A bell rang once.");
  await expect(page.getByRole("status")).toHaveText("Saving…");
  await expect(page.getByRole("status")).toHaveText("Saved");
  await secondTab.getByLabel("Story name").fill("A stale title");
  await expect(secondTab.getByRole("status")).toContainText("another session");
  await expect(secondTab.getByRole("button", {name: "Reload latest version"})).toBeVisible();

  await page.goto("/library");
  await expect(page.getByRole("heading", {name: "The Clockwork Lighthouse"})).toBeVisible();
  await page.getByLabel("Search").fill("Clockwork");
  await page.getByRole("button", {name: "Apply filters"}).click();
  await expect(page.getByRole("heading", {name: "The Clockwork Lighthouse"})).toBeVisible();

  const strangerContext = await browser.newContext({baseURL});
  try {
    const strangerRegistration = await strangerContext.request.post("/api/v1/auth/register", {data: {username: "m4-stranger", password: "stranger-password"}});
    expect(strangerRegistration.status()).toBe(201);
    expect((await strangerContext.request.get(`/api/v1/stories/${storyId}`)).status()).toBe(404);
    expect((await strangerContext.request.get(assetUrl)).status()).toBe(404);
  } finally {
    await strangerContext.close();
  }

  await page.getByRole("button", {name: "Archive"}).click();
  await expect(page.getByRole("button", {name: "Archive"})).toHaveCount(0);
  await page.getByLabel("Status").selectOption("archived");
  await page.getByRole("button", {name: "Apply filters"}).click();
  await expect(page.getByText("archived", {exact: true})).toBeVisible();
});

test("@m4 Library renders an empty state and validates image content", async ({page}) => {
  expect((await page.request.post("/api/v1/auth/register", {data: {username: "m4-empty", password: "empty-password"}})).status()).toBe(201);
  await page.goto("/library");
  await expect(page.getByRole("heading", {name: "No stories found"})).toBeVisible();
  await page.goto("/create");
  await page.getByLabel("Story name").fill("Upload validation");
  await page.getByLabel("Full story").fill("A short but complete draft story.");
  await page.getByRole("button", {name: "Save draft"}).click();
  await page.getByLabel("Manual image").setInputFiles({name: "fake.png", mimeType: "image/png", buffer: Buffer.from("not an image")});
  await page.getByRole("button", {name: "Upload image"}).click();
  await expect(page.getByRole("status")).toContainText("valid PNG, JPEG, or GIF");
});
