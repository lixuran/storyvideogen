import {expect, test} from "@playwright/test";

test("@m3 user registration, provider settings, password rotation, and logout", async ({page}) => {
  await page.goto("/settings/providers");
  await expect(page.getByRole("heading", {name: "Welcome back"})).toBeVisible();
  await page.getByRole("button", {name: "Need an account? Register"}).click();
  await page.getByLabel("Username").fill("m3-browser-user");
  await page.getByLabel("Password").fill("initial-password");
  await page.getByRole("button", {name: "Create account"}).click();

  await expect(page.getByRole("heading", {name: "Provider settings"})).toBeVisible();
  await expect(page.getByText("Baidu Images")).toBeVisible();
  await expect(page.getByText("Built in")).toBeVisible();

  const syntheticKey = "synthetic-zhipu-key-1234";
  await page.getByLabel("Zhipu AI API key").fill(syntheticKey);
  await page.getByRole("button", {name: "Save", exact: true}).first().click();
  await expect(page.getByText("Provider key saved securely.")).toBeVisible();
  await expect(page.getByText("Saved key ending 1234")).toBeVisible();
  await expect(page.locator("body")).not.toContainText(syntheticKey);
  await page.getByRole("button", {name: "Test"}).first().click();
  await expect(page.getByText("Provider capabilities verified.")).toBeVisible();
  await expect(page.getByText("Text: available · Image/search: available")).toBeVisible();

  const rejected = await page.request.post("/api/v1/auth/logout");
  expect(rejected.status()).toBe(403);
  await expect(rejected.json()).resolves.toMatchObject({error: {code: "CSRF_INVALID"}});

  await page.goto("/admin/users");
  await expect(page.getByRole("heading", {name: "Access denied"})).toBeVisible();
  await expect(page.getByRole("link", {name: "Users"})).toHaveCount(0);
  const denied = await page.request.get("/api/v1/admin/users");
  expect(denied.status()).toBe(403);

  await page.goto("/settings/account");
  await page.getByLabel("Current password").fill("initial-password");
  await page.getByLabel("New password").fill("rotated-password");
  await page.getByRole("button", {name: "Change password"}).click();
  await expect(page.getByRole("heading", {name: "Welcome back"})).toBeVisible();
  await page.getByLabel("Username").fill("m3-browser-user");
  await page.getByLabel("Password").fill("rotated-password");
  await page.getByRole("button", {name: "Sign in"}).click();
  await expect(page.getByRole("heading", {name: "Account settings"})).toBeVisible();
  await page.getByRole("button", {name: "Sign out"}).click();
  await expect(page.getByRole("heading", {name: "Welcome back"})).toBeVisible();
});

test("@m3 authentication errors do not reveal whether a username exists", async ({page}) => {
  await page.goto("/create");
  await page.getByLabel("Username").fill("definitely-missing");
  await page.getByLabel("Password").fill("incorrect-password");
  await page.getByRole("button", {name: "Sign in"}).click();
  await expect(page.getByRole("alert")).toHaveText("Invalid username or password.");
});
