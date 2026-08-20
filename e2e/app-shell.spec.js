import {expect, test} from "@playwright/test";

test.beforeEach(async ({page}, testInfo) => {
  const username = `m1-${testInfo.workerIndex}-${testInfo.repeatEachIndex}-${testInfo.retry}-${testInfo.title.replace(/\W/g, "").slice(-8).toLowerCase()}`;
  const response = await page.request.post("/api/v1/auth/register", {data: {username, password: "m1-test-password"}});
  expect(response.status()).toBe(201);
});

test("@m1 Node serves health endpoints and the React application shell", async ({page, request}) => {
  const live = await request.get("/health/live");
  expect(live.ok()).toBeTruthy();
  await expect(live.json()).resolves.toEqual({status: "ok"});

  const ready = await request.get("/health/ready");
  expect(ready.ok()).toBeTruthy();
  await expect(ready.json()).resolves.toEqual({status: "ready"});

  const missingAsset = await request.get("/assets/missing.js");
  expect(missingAsset.status()).toBe(404);
  expect(missingAsset.headers()["content-type"]).toMatch(/^application\/json/);

  await page.goto("/");
  await expect(page).toHaveURL(/\/create$/);
  await expect(page.getByRole("heading", {name: "Turn a long story into a visual podcast"})).toBeVisible();
  await expect(page.getByRole("navigation", {name: "Primary navigation"})).toBeVisible();
  await expect(page.locator("#primary-navigation")).toHaveCSS("width", "240px");
  await expect(page.getByRole("link", {name: "Users"})).toHaveCount(0);
  await expect(page.getByRole("link", {name: "All Stories"})).toHaveCount(0);
  await expect(page.getByRole("link", {name: "Service Keys"})).toHaveCount(0);
});

test("@m1 routes navigate with keyboard support and unknown paths are safe", async ({page}) => {
  await page.goto("/create");

  const libraryLink = page.getByRole("link", {name: "Library"});
  await libraryLink.focus();
  await page.keyboard.press("Enter");
  await expect(page).toHaveURL(/\/library$/);
  await expect(page.getByRole("heading", {name: "Stories and podcast episodes"})).toBeVisible();

  await page.getByRole("link", {name: "Subscription"}).click();
  await expect(page.getByRole("heading", {name: "Subscription"})).toBeVisible();

  await page.getByRole("link", {name: "Settings"}).click();
  await expect(page.getByRole("heading", {name: "Provider settings"})).toBeVisible();

  await page.goto("/not-a-route");
  await expect(page.getByRole("heading", {name: "Page not found"})).toBeVisible();
  await page.getByRole("link", {name: "Return to Create"}).click();
  await expect(page).toHaveURL(/\/create$/);
});

test("@m1 intermediate navigation collapses to an accessible icon rail", async ({page}) => {
  await page.setViewportSize({width: 1024, height: 768});
  await page.goto("/create");

  const sidebar = page.locator("#primary-navigation");
  await expect(sidebar).toBeVisible();
  await expect(sidebar).toHaveCSS("width", "72px");
  await expect(page.getByRole("link", {name: "Create"})).toBeVisible();
  await expect(page.getByRole("link", {name: "Create"}).locator(".nav-label")).toBeHidden();
});

test("@m1 mobile navigation opens, navigates, and closes with Escape", async ({page}) => {
  await page.setViewportSize({width: 390, height: 844});
  await page.goto("/create");

  const menuButton = page.getByRole("button", {name: "Open navigation"});
  await expect(menuButton).toBeVisible();
  await expect(page.locator("#primary-navigation")).toBeHidden();
  await menuButton.focus();
  await page.keyboard.press("Tab");
  expect(await page.evaluate(() => document.activeElement?.closest("#primary-navigation") !== null)).toBeFalsy();

  await menuButton.focus();
  await menuButton.click();
  await expect(page.locator("#primary-navigation")).toBeVisible();
  await expect(page.locator("#primary-navigation")).toHaveAttribute("data-open", "true");

  await page.getByRole("link", {name: "Create"}).focus();
  await page.keyboard.press("Escape");
  await expect(page.locator("#primary-navigation")).toHaveAttribute("data-open", "false");
  await expect(page.locator("#primary-navigation")).toBeHidden();
  await expect(menuButton).toBeFocused();

  await menuButton.click();
  await page.getByRole("link", {name: "Library"}).click();
  await expect(page).toHaveURL(/\/library$/);
  await expect(page.locator("#primary-navigation")).toHaveAttribute("data-open", "false");
});
