import assert from "node:assert/strict";
import path from "node:path";
import test from "node:test";

import {buildApp} from "./app.js";
import {loadConfig, type AppConfig} from "./config.js";

const testConfig: AppConfig = {
  ...loadConfig({}),
  host: "127.0.0.1",
  port: 30_001,
  bodyLimit: 1_048_576,
  logLevel: "silent",
  webRoot: "unused-in-unit-tests",
  databasePath: "unused-in-unit-tests.sqlite3",
  databaseBusyTimeoutMs: 5_000,
  migrationsDir: path.resolve("server", "migrations")
};

test("configuration defaults to loopback and rejects invalid ports", () => {
  const config = loadConfig({});
  assert.equal(config.host, "127.0.0.1");
  assert.equal(config.port, 3000);
  assert.equal(path.basename(config.webRoot), "dist");
  assert.equal(path.basename(path.dirname(config.webRoot)), "web");
  assert.equal(path.basename(config.databasePath), "storyvideogen.sqlite3");
  assert.equal(config.databaseBusyTimeoutMs, 5_000);
  assert.equal(path.basename(config.migrationsDir), "migrations");
  assert.throws(() => loadConfig({STORYVIDEOGEN_NODE_PORT: "70000"}), /must be an integer/);
  assert.throws(() => loadConfig({STORYVIDEOGEN_SQLITE_BUSY_TIMEOUT_MS: "0"}), /must be an integer/);
});

test("health endpoints and SPA fallback are safe", async (context) => {
  const app = await buildApp(testConfig, {
    serveStatic: false,
    fallbackHtml: "<!doctype html><title>StoryVideoGen</title><div id=\"app\"></div>"
  });
  context.after(() => app.close());

  const live = await app.inject({method: "GET", url: "/health/live"});
  assert.equal(live.statusCode, 200);
  assert.deepEqual(live.json(), {status: "ok"});

  const ready = await app.inject({method: "GET", url: "/health/ready"});
  assert.equal(ready.statusCode, 200);
  assert.equal(ready.headers["x-content-type-options"], "nosniff");
  assert.equal(ready.headers["x-frame-options"], "DENY");
  assert.match(String(ready.headers["content-security-policy"]), /frame-ancestors 'none'/);
  assert.deepEqual(ready.json(), {status: "ready"});

  const route = await app.inject({method: "GET", url: "/library"});
  assert.equal(route.statusCode, 200);
  assert.match(route.headers["content-type"] || "", /^text\/html/);
  assert.match(route.body, /StoryVideoGen/);
});

test("static files do not shadow the React SPA at the root route", async (context) => {
  const app = await buildApp(
    {...testConfig, webRoot: path.resolve("web")},
    {fallbackHtml: "<!doctype html><div id=\"react-root\"></div>"}
  );
  context.after(() => app.close());

  const root = await app.inject({method: "GET", url: "/"});
  assert.equal(root.statusCode, 200);
  assert.match(root.body, /id=\"react-root\"/);

  const missingAsset = await app.inject({method: "GET", url: "/assets/missing.js"});
  assert.equal(missingAsset.statusCode, 404);
  assert.match(missingAsset.headers["content-type"] || "", /^application\/json/);
  assert.equal(missingAsset.json().error.code, "NOT_FOUND");
});

test("readiness reports an unavailable production bundle", async (context) => {
  const app = await buildApp({...testConfig, webRoot: path.resolve("web", "missing-bundle")});
  context.after(() => app.close());

  const ready = await app.inject({method: "GET", url: "/health/ready"});
  assert.equal(ready.statusCode, 503);
  assert.deepEqual(ready.json(), {status: "unavailable"});

  const route = await app.inject({method: "GET", url: "/create"});
  assert.equal(route.statusCode, 503);
  assert.match(route.body, /Service temporarily unavailable/);
});

test("database startup failures stay unavailable without exposing details", async (context) => {
  const app = await buildApp(
    {...testConfig, webRoot: path.resolve("web")},
    {databaseStatus: {status: "unavailable"}}
  );
  context.after(() => app.close());

  const ready = await app.inject({method: "GET", url: "/health/ready"});
  assert.equal(ready.statusCode, 503);

  const api = await app.inject({method: "GET", url: "/api/v1/stories"});
  assert.equal(api.statusCode, 503);
  assert.equal(api.json().error.code, "SERVICE_UNAVAILABLE");

  const route = await app.inject({method: "GET", url: "/create"});
  assert.equal(route.statusCode, 503);
  assert.match(route.body, /Service temporarily unavailable/);
  assert.doesNotMatch(route.body, /migration|sqlite|syntax/i);

  const directBundle = await app.inject({method: "GET", url: "/app.html"});
  assert.equal(directBundle.statusCode, 503);
  assert.doesNotMatch(directBundle.body, /id=\"root\"/);
});

test("API not-found and unexpected errors use normalized JSON", async (context) => {
  const app = await buildApp(testConfig, {serveStatic: false, fallbackHtml: "app"});
  app.get("/api/boom", async () => {
    throw new Error("private diagnostic");
  });
  context.after(() => app.close());

  const missing = await app.inject({method: "GET", url: "/api/missing"});
  assert.equal(missing.statusCode, 404);
  assert.equal(missing.json().error.code, "NOT_FOUND");
  assert.ok(missing.json().error.requestId);

  const failed = await app.inject({method: "GET", url: "/api/boom"});
  assert.equal(failed.statusCode, 500);
  assert.deepEqual(failed.json().error.message, "The request could not be completed.");
  assert.doesNotMatch(failed.body, /private diagnostic/);
});
