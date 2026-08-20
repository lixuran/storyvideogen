import {spawn} from "node:child_process";
import {createServer} from "node:net";
import path from "node:path";

import {expect, test} from "@playwright/test";
import Database from "better-sqlite3";

test("@m2 @m4 fresh database startup and drafts persist across a server restart", async ({page}, testInfo) => {
  const port = await getFreePort();
  const databasePath = testInfo.outputPath("restart.sqlite3");
  const baseURL = `http://127.0.0.1:${port}`;
  let server;

  try {
    server = startServer({port, databasePath, migrationsDir: path.resolve("server", "migrations")});
    await waitForStatus(`${baseURL}/health/ready`, 200, server);

    await page.goto(`${baseURL}/create`);
    await expect(page.getByRole("heading", {name: "Welcome back"})).toBeVisible();
    await page.getByRole("button", {name: "Need an account? Register"}).click();
    await page.getByLabel("Username").fill("restart-user");
    await page.getByLabel("Password").fill("restart-password");
    await page.getByRole("button", {name: "Create account"}).click();
    await expect(page.getByRole("heading", {name: "Turn a long story into a visual podcast"})).toBeVisible();
    await page.getByLabel("Story name").fill("Restart-safe draft");
    await page.getByLabel("Full story").fill("This draft must remain available after the Node process restarts.");
    await page.getByRole("button", {name: "Save draft"}).click();
    await expect(page.getByRole("status")).toHaveText("Saved");

    await stopServer(server);
    server = undefined;
    expect(readMigrationStatus(databasePath)).toEqual({schemaVersion: 6, migrationCount: 6});

    server = startServer({port, databasePath, migrationsDir: path.resolve("server", "migrations")});
    await waitForStatus(`${baseURL}/health/ready`, 200, server);
    await page.goto(`${baseURL}/library`);
    await expect(page.getByRole("heading", {name: "Restart-safe draft"})).toBeVisible();
    await stopServer(server);
    server = undefined;
    expect(readMigrationStatus(databasePath)).toEqual({schemaVersion: 6, migrationCount: 6});
  } finally {
    await stopServer(server);
  }
});

test("@m2 a broken migration keeps readiness closed and renders a safe unavailable page", async ({page}, testInfo) => {
  const port = await getFreePort();
  const databasePath = testInfo.outputPath("broken.sqlite3");
  const baseURL = `http://127.0.0.1:${port}`;
  const server = startServer({
    port,
    databasePath,
    migrationsDir: path.resolve("e2e", "fixtures", "migrations-broken")
  });

  try {
    await waitForStatus(`${baseURL}/health/live`, 200, server);

    const ready = await fetch(`${baseURL}/health/ready`);
    expect(ready.status).toBe(503);
    await expect(ready.json()).resolves.toEqual({status: "unavailable"});

    const response = await page.goto(`${baseURL}/`);
    expect(response?.status()).toBe(503);
    await expect(page.getByRole("heading", {name: "Service temporarily unavailable"})).toBeVisible();
    await expect(page.locator("body")).not.toContainText(/migration|sqlite|syntax/i);
  } finally {
    await stopServer(server);
  }
});

function startServer({port, databasePath, migrationsDir}) {
  const output = [];
  const child = spawn(process.execPath, ["server/dist/index.js"], {
    cwd: process.cwd(),
    env: {
      ...process.env,
      STORYVIDEOGEN_NODE_HOST: "127.0.0.1",
      STORYVIDEOGEN_NODE_PORT: String(port),
      STORYVIDEOGEN_NODE_LOG_LEVEL: "silent",
      STORYVIDEOGEN_DATABASE_PATH: databasePath,
      STORYVIDEOGEN_MIGRATIONS_DIR: migrationsDir
    },
    stdio: ["ignore", "pipe", "pipe"],
    windowsHide: true
  });
  child.stdout.on("data", (chunk) => output.push(String(chunk)));
  child.stderr.on("data", (chunk) => output.push(String(chunk)));
  child.capturedOutput = output;
  return child;
}

async function waitForStatus(url, expectedStatus, child) {
  const deadline = Date.now() + 15_000;
  while (Date.now() < deadline) {
    if (child.exitCode !== null) {
      throw new Error(`Server exited before becoming available.\n${child.capturedOutput.join("")}`);
    }
    try {
      const response = await fetch(url);
      if (response.status === expectedStatus) {
        return;
      }
    } catch {
      // The listener may not be bound yet.
    }
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error(`Timed out waiting for ${url}.\n${child.capturedOutput.join("")}`);
}

async function stopServer(child) {
  if (!child || child.exitCode !== null) {
    return;
  }
  const exited = new Promise((resolve) => child.once("exit", resolve));
  child.kill();
  await Promise.race([
    exited,
    new Promise((resolve) => setTimeout(resolve, 5_000))
  ]);
  if (child.exitCode === null) {
    child.kill("SIGKILL");
    await exited;
  }
}

function getFreePort() {
  return new Promise((resolve, reject) => {
    const server = createServer();
    server.unref();
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      if (!address || typeof address === "string") {
        server.close();
        reject(new Error("Unable to allocate an E2E port."));
        return;
      }
      server.close((error) => error ? reject(error) : resolve(address.port));
    });
  });
}

function readMigrationStatus(databasePath) {
  const database = new Database(databasePath, {readonly: true, fileMustExist: true});
  try {
    return database.prepare(`
      SELECT COALESCE(MAX(version), 0) AS schemaVersion, COUNT(*) AS migrationCount
      FROM schema_migrations
    `).get();
  } finally {
    database.close();
  }
}
