import {expect, test} from "@playwright/test";
import Database from "better-sqlite3";

test("@m13 maximum story and user authorization boundaries remain enforced", async ({page}) => {
  const registered = await page.request.post("/api/v1/auth/register", {data: {username: "m13-boundary", password: "boundary-password"}});
  expect(registered.status()).toBe(201);
  const csrf = (await page.context().cookies()).find((cookie) => cookie.name === "storyvideogen_csrf")?.value;
  const headers = {"x-csrf-token": csrf};
  const accepted = await page.request.post("/api/v1/stories", {data: {name: "Maximum fixture story", sourceText: Array(30_000).fill("word").join(" ")}, headers});
  expect(accepted.status()).toBe(201);
  expect((await accepted.json()).story.wordCount).toBe(30_000);
  const rejected = await page.request.post("/api/v1/stories", {data: {name: "Overflow fixture story", sourceText: Array(30_001).fill("word").join(" ")}, headers});
  expect(rejected.status()).toBe(413);
  expect((await rejected.json()).error.code).toBe("STORY_TOO_LONG");
  const adminDenied = await page.request.get("/api/v1/admin/user-list");
  expect(adminDenied.status()).toBe(403);
  const health = await page.request.get("/health/ready");
  expect(health.headers()["x-content-type-options"]).toBe("nosniff");
  expect(health.headers()["content-security-policy"]).toContain("frame-ancestors 'none'");

  const database = openDatabase();
  try { database.prepare("UPDATE users SET status = 'suspended' WHERE username = ?").run("m13-boundary"); } finally { database.close(); }
  expect((await page.request.get("/api/v1/auth/me")).status()).toBe(401);
  const login = await page.request.post("/api/v1/auth/login", {data: {username: "m13-boundary", password: "boundary-password"}});
  expect(login.status()).toBe(401);
});

function openDatabase() { const runId = process.env.STORYVIDEOGEN_E2E_RUN_ID; if (!runId) throw new Error("Missing E2E run ID."); return new Database(`output/e2e/${runId}/node.sqlite3`); }
