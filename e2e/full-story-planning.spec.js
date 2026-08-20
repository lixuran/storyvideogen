import {expect, test} from "@playwright/test";

import {startFixtureWorker} from "./helpers/worker-process.js";

test("@m6 complete story becomes editable persisted scenes without truncation", async ({page}) => {
  expect((await page.request.post("/api/v1/auth/register", {data: {username: "m6-planner", password: "planner-password"}})).status()).toBe(201);
  const words = Array.from({length: 225}, (_, index) => `word${index + 1}`);
  const source = `Opening sentence. ${words.join(" ")} Final unicode line：故事结束。`;
  await page.goto("/create");
  await page.getByLabel("Story name").fill("The complete planning story");
  await page.getByLabel("Full story").fill(source);
  await page.getByRole("button", {name: "Save draft"}).click();
  await expect(page).toHaveURL(/\/create\?story=/);
  await expect(page.getByLabel("Target scene length (seconds)")).toHaveValue("30");
  await page.getByLabel("Target scene length (seconds)").fill("60");
  await page.getByRole("button", {name: "Plan full story"}).click();
  const worker = startFixtureWorker();
  await expect(page.getByRole("heading", {name: "Review 2 scenes"})).toBeVisible({timeout: 20_000});
  expect(await worker).toBe(0);
  await expect(page.getByText("100% source coverage")).toBeVisible();
  const sourceParagraphs = await page.locator(".scene-card details p").allTextContents();
  expect(sourceParagraphs.join("")).toBe(source);

  const firstNarration = page.locator(".scene-card").first().getByLabel("Narration");
  await firstNarration.fill("Edited narration remains durable.");
  await firstNarration.blur();
  const firstPrompt = page.locator(".scene-card").first().getByLabel("Prompt 1");
  await firstPrompt.fill("Edited cinematic lighthouse description");
  await firstPrompt.blur();
  await page.reload();
  await expect(page.locator(".scene-card").first().getByLabel("Narration")).toHaveValue("Edited narration remains durable.");
  await expect(page.locator(".scene-card").first().getByLabel("Prompt 1")).toHaveValue("Edited cinematic lighthouse description");

  await page.locator(".scene-card").first().getByRole("button", {name: "Merge next"}).click();
  await expect(page.getByRole("heading", {name: "Review 1 scenes"})).toBeVisible();
  await page.locator(".scene-card").first().getByRole("button", {name: "Split"}).click();
  await expect(page.getByRole("heading", {name: "Review 2 scenes"})).toBeVisible();
  const afterEditSource = await page.locator(".scene-card details p").allTextContents();
  expect(afterEditSource.join("")).toBe(source);
});
