import {expect, test} from "@playwright/test";

const storyText = "A sculpture stands in the chamber. The observer does not blink. The room feels warm, quiet, and wrong.";

test("@m0 account settings and password change persist across login", async ({page}) => {
  const user = uniqueUser("account");
  await register(page, user);

  await openTab(page, "Account");
  await page.getByLabel("ZAI API key").fill("zai-test-key");
  await page.getByLabel("Pexels API key").fill("pexels-test-key");
  await page.getByRole("button", {name: "Save API Settings"}).click();
  await expect(page.locator("#api-key-status")).toContainText("ZAI: configured");
  await expect(page.locator("#api-key-status")).toContainText("Pexels: configured");

  await page.getByLabel("Current password").fill(user.password);
  await page.getByLabel("New password").fill("changed-password123");
  await page.getByRole("button", {name: "Change Password"}).click();
  await expect(page.locator("#password-status")).toContainText("Password changed.");

  await page.getByRole("button", {name: "Logout"}).click();
  await login(page, {username: user.username, password: "changed-password123"});
  await openTab(page, "Account");
  await expect(page.locator("#api-key-status")).toContainText("ZAI: configured");
  await expect(page.locator("#api-key-status")).toContainText("Pexels: configured");
});

test("@m0 draft can be saved and restored after returning to the story", async ({page}) => {
  const user = uniqueUser("draft");
  await register(page, user);
  await createStory(page, "draft-story");

  await page.getByLabel("English title").fill("Saved Draft Title");
  await page.getByLabel("Story text").fill(storyText);
  await page.getByLabel("Target seconds").fill("42");
  await page.getByLabel("Translator").selectOption("mock");
  await page.getByLabel("Prompt provider").selectOption("heuristic");
  await page.getByLabel("Image provider").selectOption("fixture");
  await page.getByLabel("TTS provider").selectOption("silent");
  await page.getByRole("button", {name: "Save Draft"}).click();

  await expect(page.locator("#draft-status")).toContainText("Draft saved.");
  await openTab(page, "Stories");
  await page.getByRole("button", {name: /Saved Draft Title/}).click();
  await openTab(page, "Project");

  await expect(page.getByLabel("English title")).toHaveValue("Saved Draft Title");
  await expect(page.getByLabel("Story text")).toHaveValue(storyText);
  await expect(page.getByLabel("Target seconds")).toHaveValue("42");
  await expect(page.getByLabel("Image provider")).toHaveValue("fixture");
});

test("@m0 prepared story can be reopened with image choices available", async ({page}) => {
  const user = uniqueUser("prepared");
  await register(page, user);
  const outputDir = await createStory(page, "prepared-story");
  await seedStory(page, outputDir, "prepared");

  await page.reload();
  await openStory(page, "Seed Prepared Story");
  await openTab(page, "Images");

  await expect(page.getByText("Chunk 1")).toBeVisible();
  await expect(page.getByAltText("quiet test room")).toBeVisible();
  await expect(page.getByRole("radio")).toBeChecked();
});

test("@m0 composed story can be reopened with download links", async ({page}) => {
  const user = uniqueUser("composed");
  await register(page, user);
  const outputDir = await createStory(page, "composed-story");
  await seedStory(page, outputDir, "composed");

  await page.reload();
  await openStory(page, "Seed Prepared Story");
  await openTab(page, "Audio");

  await expect(page.getByRole("link", {name: "Download Video"})).toBeVisible();
  await expect(page.getByRole("link", {name: "Download SRT"})).toBeVisible();
});

test("@m0 left hand tab navigation keeps sections separated", async ({page}) => {
  const user = uniqueUser("tabs");
  await register(page, user);

  await openTab(page, "Project");
  await expect(page.getByLabel("Story text")).toBeVisible();
  await expect(page.getByText("New story tag")).not.toBeVisible();

  await openTab(page, "Stories");
  await expect(page.getByText("New story tag")).toBeVisible();
  await expect(page.getByLabel("Story text")).not.toBeVisible();

  await openTab(page, "Account");
  await expect(page.getByLabel("ZAI API key")).toBeVisible();
});

function uniqueUser(prefix) {
  const id = `${Date.now()}_${Math.random().toString(16).slice(2)}`;
  return {
    username: `${prefix}_${id}`.replace(/[^a-z0-9_.-]/g, "_").slice(0, 40),
    password: "password123"
  };
}

async function register(page, user) {
  await page.goto("/");
  await page.locator("#register-form").locator('input[name="username"]').fill(user.username);
  await page.locator("#register-form").locator('input[name="password"]').fill(user.password);
  await page.getByRole("button", {name: "Create Account"}).click();
  await expect(page.locator("#current-user")).toContainText(user.username);
}

async function login(page, user) {
  await page.goto("/");
  await page.locator("#login-form").locator('input[name="username"]').fill(user.username);
  await page.locator("#login-form").locator('input[name="password"]').fill(user.password);
  await page.getByRole("button", {name: "Login"}).click();
  await expect(page.locator("#current-user")).toContainText(user.username);
}

async function createStory(page, tag) {
  await openTab(page, "Stories");
  await page.locator("#new-story-tag").fill(`${tag}-${Date.now()}`);
  await page.getByRole("button", {name: "Create New Story"}).click();
  await expect(page.locator("#story-list-status")).toContainText("Created");
  await openTab(page, "Project");
  return page.getByLabel("Target output directory").inputValue();
}

async function openStory(page, title) {
  await openTab(page, "Stories");
  await page.getByRole("button", {name: new RegExp(title)}).click();
}

async function seedStory(page, outputDir, state) {
  const response = await page.request.get(`/api/test/seed-story?output_dir=${encodeURIComponent(outputDir)}&state=${state}`);
  expect(response.ok()).toBeTruthy();
}

async function openTab(page, name) {
  await page.locator(".tab-button", {hasText: new RegExp(`^${name}$`)}).click();
}
