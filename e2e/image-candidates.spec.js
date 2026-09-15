import {expect, test} from "@playwright/test";

import {startFixtureWorker} from "./helpers/worker-process.js";

const tinyPng = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=", "base64");

test("@m7 generated and uploaded scene images can be selected durably", async ({page}) => {
  expect((await page.request.post("/api/v1/auth/register", {data: {username: "m7-images", password: "images-password"}})).status()).toBe(201);
  await page.goto("/create");
  await page.getByLabel("Story name").fill("The image candidate story");
  await page.getByLabel("Full story").fill("A lantern crossed the quiet harbor while the old lighthouse watched from the cliff.");
  await page.getByRole("button", {name: "Save draft"}).click();
  await page.getByRole("button", {name: "Plan full story"}).click();
  expect(await startFixtureWorker()).toBe(0);
  await expect(page.getByRole("heading", {name: "Review 1 scenes"})).toBeVisible({timeout: 20_000});

  await page.getByRole("button", {name: "Generate 2 images with Zhipu"}).click();
  expect(await startFixtureWorker()).toBe(0);
  const candidates = page.getByLabel("Scene 1 image candidates");
  await expect(candidates.locator("img")).toHaveCount(2, {timeout: 20_000});
  await candidates.getByRole("button", {name: "Choose image"}).first().click();
  await expect(candidates.getByRole("button", {name: "Selected"})).toBeVisible();

  await page.getByLabel("Image source").selectOption("pexels");
  await page.getByRole("button", {name: "Generate 2 images with Pexels"}).click();
  expect(await startFixtureWorker()).toBe(0);
  await expect(candidates.locator(".candidate-card").filter({hasText: "pexels"})).toHaveCount(2, {timeout: 20_000});

  await page.getByLabel("Upload an image for this scene").setInputFiles({name: "manual.png", mimeType: "image/png", buffer: tinyPng});
  await page.getByRole("button", {name: "Add candidate"}).click();
  await expect(candidates.locator("img")).toHaveCount(5);
  const manual = candidates.locator(".candidate-card").filter({hasText: "manual"});
  await manual.getByRole("button", {name: "Choose image"}).click();
  await expect(manual.getByRole("button", {name: "Selected"})).toBeVisible();
  await page.reload();
  await expect(page.getByLabel("Scene 1 image candidates").locator("img")).toHaveCount(5);
  await expect(page.getByLabel("Scene 1 image candidates").locator(".candidate-card.selected")).toHaveCount(1);
});
