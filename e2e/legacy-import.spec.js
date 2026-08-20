import {expect, test} from "@playwright/test";
import Database from "better-sqlite3";
import {execFileSync, spawn} from "node:child_process";
import {mkdirSync, writeFileSync, existsSync} from "node:fs";
import net from "node:net";
import path from "node:path";

import {hashPassword} from "../server/dist/security/passwords.js";

test("@m12 legacy import is dry-run safe, idempotent, and preserves login, key status, and media", async ({page}, testInfo) => {
  const root = testInfo.outputPath("legacy");
  const authDb = path.join(root, "ui_auth.sqlite3");
  const userRoot = path.join(root, "ui_users");
  const storyRoot = path.join(userRoot, "legacy-user", "stories", "imported-story");
  const targetDb = path.join(root, "target.sqlite3");
  const storageRoot = path.join(root, "assets");
  mkdirSync(storyRoot, {recursive: true});
  const legacy = new Database(authDb);
  legacy.exec("CREATE TABLE users (id INTEGER PRIMARY KEY, username TEXT, password_hash TEXT, created_at TEXT); CREATE TABLE sessions (token_hash TEXT PRIMARY KEY, user_id INTEGER, csrf_token TEXT, created_at TEXT, expires_at INTEGER); CREATE TABLE user_api_keys (user_id INTEGER, name TEXT, value TEXT, updated_at TEXT, PRIMARY KEY (user_id, name));");
  legacy.prepare("INSERT INTO users VALUES (1, ?, ?, ?)").run("legacy-user", hashPassword("legacy-password"), "2026-08-01T00:00:00Z");
  legacy.prepare("INSERT INTO sessions VALUES ('obsolete', 1, 'obsolete', ?, ?)").run("2026-08-01T00:00:00Z", 4102444800);
  legacy.prepare("INSERT INTO user_api_keys VALUES (1, 'ZAI_API_KEY', 'synthetic-legacy-zhipu-key', ?)").run("2026-08-01T00:00:00Z");
  legacy.close();
  writeFileSync(path.join(storyRoot, "story_session.json"), JSON.stringify({title: "Imported Story", story_text: "A complete legacy story.", status: "composed", video_path: "video.mp4", created_at: "2026-08-01T00:00:00Z", updated_at: "2026-08-02T00:00:00Z"}));
  writeFileSync(path.join(storyRoot, "video_manifest.json"), JSON.stringify({local_path: "video.mp4", duration_seconds: 4, width: 1920, height: 1080}));
  writeFileSync(path.join(storyRoot, "video.mp4"), Buffer.from("legacy-video-sample"));
  writeFileSync(path.join(storyRoot, "selected.png"), Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=", "base64"));
  writeFileSync(path.join(storyRoot, "interactive_project.json"), JSON.stringify({story: {title: "Imported Story", text: "A complete legacy story."}, chunks: [{text: "A complete legacy story.", subtitle_text: "A complete legacy story.", start_seconds: 0, end_seconds: 4, prompt_candidates: ["legacy visual"], image_candidates: [{asset: {local_path: "selected.png", provider: "fixture", creator: "Legacy creator", license_name: "CC0", source_url: "fixture://legacy", width: 1, height: 1}}]}]}));
  writeFileSync(path.join(storyRoot, "image_manifest.json"), JSON.stringify([{local_path: "selected.png"}]));

  const env = {...process.env, STORYVIDEOGEN_DATABASE_PATH: targetDb, STORYVIDEOGEN_STORAGE_ROOT: storageRoot, STORYVIDEOGEN_MIGRATIONS_DIR: path.resolve("server", "migrations"), STORYVIDEOGEN_SECRET_MASTER_KEY: "DAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAw=", STORYVIDEOGEN_NODE_LOG_LEVEL: "silent"};
  const runImport = (dryRun) => JSON.parse(execFileSync(process.execPath, ["server/dist/import-legacy.js", "--auth-db", authDb, "--user-root", userRoot, "--dry-run", String(dryRun)], {cwd: process.cwd(), env, encoding: "utf8"}));
  const dry = runImport(true);
  expect(dry.discovered).toMatchObject({users: 1, stories: 1, providerKeys: 1, assets: 2});
  expect(dry.imported.users).toBe(0);
  expect(existsSync(targetDb)).toBe(false);
  const first = runImport(false);
  expect(first.imported).toMatchObject({users: 1, stories: 1, providerKeys: 1, assets: 2});
  const second = runImport(false);
  expect(second.imported).toMatchObject({users: 0, stories: 0, providerKeys: 0, assets: 0});
  expect(second.skipped).toMatchObject({users: 1, stories: 1, providerKeys: 1, assets: 2});
  const target = new Database(targetDb, {readonly: true});
  expect(target.prepare("SELECT COUNT(*) AS count FROM sessions").get().count).toBe(0);
  expect(target.prepare("SELECT COUNT(*) AS count FROM image_candidates WHERE is_selected = 1").get().count).toBe(1);
  target.close();

  const port = await freePort();
  const child = spawn(process.execPath, ["server/dist/index.js"], {cwd: process.cwd(), windowsHide: true, env: {...env, STORYVIDEOGEN_NODE_HOST: "127.0.0.1", STORYVIDEOGEN_NODE_PORT: String(port), STORYVIDEOGEN_PAYMENT_MODE: "disabled"}, stdio: "ignore"});
  const baseURL = `http://127.0.0.1:${port}`;
  try {
    await ready(`${baseURL}/health/ready`);
    await page.goto(`${baseURL}/login`);
    await page.getByLabel("Username").fill("legacy-user");
    await page.getByLabel("Password").fill("legacy-password");
    await page.getByRole("button", {name: "Sign in"}).click();
    await expect(page).toHaveURL(/\/create$/);
    const providers = await (await page.request.get(`${baseURL}/api/v1/settings/providers`)).json();
    expect(providers.providers.find((item) => item.id === "zhipu")).toMatchObject({configured: true, lastFour: "-key"});
    const stories = await (await page.request.get(`${baseURL}/api/v1/stories`)).json();
    expect(stories.items).toHaveLength(1);
    expect(stories.items[0]).toMatchObject({name: "Imported Story", status: "completed"});
    const assets = await (await page.request.get(`${baseURL}/api/v1/stories/${stories.items[0].id}/assets`)).json();
    expect(assets.assets).toHaveLength(2);
    const videoAsset = assets.assets.find((asset) => asset.kind === "video");
    const download = await page.request.get(`${baseURL}${videoAsset.downloadUrl}`);
    expect(download.status()).toBe(200);
    expect((await download.body()).toString()).toBe("legacy-video-sample");
  } finally {
    child.kill("SIGTERM");
  }
});

async function freePort() { return new Promise((resolve, reject) => { const server = net.createServer(); server.unref(); server.on("error", reject); server.listen(0, "127.0.0.1", () => { const address = server.address(); const port = typeof address === "object" && address ? address.port : 0; server.close((error) => error ? reject(error) : resolve(port)); }); }); }
async function ready(url) { for (let attempt = 0; attempt < 80; attempt++) { try { const response = await fetch(url); if (response.ok) return; } catch {} await new Promise((resolve) => setTimeout(resolve, 100)); } throw new Error("server did not become ready"); }
