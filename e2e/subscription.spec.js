import {expect, test} from "@playwright/test";
import Database from "better-sqlite3";

test("@m9 fake payment drives pending, failure, idempotent extension, and expiry gating", async ({page}) => {
  expect((await page.request.post("/api/v1/auth/register", {data: {username: "m9-billing", password: "billing-password"}})).status()).toBe(201); await page.goto("/subscription"); await expect(page.getByRole("heading", {name: "Trial"})).toBeVisible(); await expect(page.getByText(/0 \/ 5/)).toBeVisible();
  await page.getByRole("button", {name: "Pay with WeChat"}).click(); await expect(page.getByText("pending", {exact: true})).toBeVisible(); await page.getByRole("button", {name: "Simulate failed"}).click(); await expect(page.getByText("failed", {exact: true})).toBeVisible();
  await page.getByRole("button", {name: "Pay with WeChat"}).click(); await page.getByRole("button", {name: "Simulate paid"}).click(); await expect(page.getByRole("heading", {name: "Creator"})).toBeVisible(); const first = await (await page.request.get("/api/v1/billing")).json(); const firstEnd = Date.parse(first.subscription.periodEnd);
  await page.getByRole("button", {name: "Pay with WeChat"}).click(); await page.getByRole("button", {name: "Simulate paid"}).click(); const second = await (await page.request.get("/api/v1/billing")).json(); expect(Date.parse(second.subscription.periodEnd)).toBeGreaterThan(firstEnd + 29 * 86400000);
  expireSubscription(); await page.goto("/create"); await page.getByLabel("Story name").fill("Expired plan draft"); await page.getByLabel("Full story").fill("This draft remains editable after the prepaid period expires."); await page.getByRole("button", {name: "Save draft"}).click(); await page.getByRole("button", {name: "Plan full story"}).click(); await expect(page.getByRole("status")).toContainText("active plan"); await expect(page.getByLabel("Full story")).toHaveValue(/draft remains editable/);
});

function expireSubscription() { const runId = process.env.STORYVIDEOGEN_E2E_RUN_ID; if (!runId) throw new Error("Missing E2E run ID."); const database = new Database(`output/e2e/${runId}/node.sqlite3`); try { database.prepare("UPDATE subscriptions SET period_start = ?, period_end = ?, state = 'expired', updated_at = ? WHERE state = 'active'").run("2000-01-01T00:00:00.000Z", "2000-01-02T00:00:00.000Z", new Date().toISOString()); } finally { database.close(); } }
