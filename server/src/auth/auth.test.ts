import assert from "node:assert/strict";
import path from "node:path";
import test from "node:test";

import {buildApp} from "../app.js";
import {AuthService} from "./authService.js";
import {loadConfig} from "../config.js";
import {openDatabase} from "../db/database.js";
import {migrateDatabase} from "../db/migrate.js";
import {IdentityRepository} from "../db/repositories/identityRepository.js";
import {ProviderSecretRepository} from "../db/repositories/providerSecretRepository.js";
import {ProviderService} from "../providers/providerService.js";
import {SecretCipher} from "../security/secretCipher.js";
import {hashPassword, verifyPassword} from "../security/passwords.js";
import {StoryRepository} from "../db/repositories/storyRepository.js";
import {AssetRepository} from "../db/repositories/assetRepository.js";
import {ImageCandidateRepository} from "../db/repositories/imageCandidateRepository.js";
import {ImageCandidateService} from "../images/imageCandidateService.js";
import {StoryService} from "../stories/storyService.js";
import {AssetService} from "../assets/assetService.js";
import {JobRepository} from "../db/repositories/jobRepository.js";
import {JobService} from "../jobs/jobService.js";
import {BillingRepository} from "../billing/billingRepository.js";
import {BillingService} from "../billing/billingService.js";
import {AdminRepository} from "../admin/adminRepository.js";

test("Node password hashes match the existing Python format", () => {
  const encoded = hashPassword("correct horse battery staple");
  assert.match(encoded, /^pbkdf2_sha256\$200000\$/);
  assert.equal(verifyPassword("correct horse battery staple", encoded), true);
  assert.equal(verifyPassword("wrong password", encoded), false);
  assert.equal(verifyPassword("anything", "invalid"), false);
});

test("authentication routes enforce CSRF, revocation, and admin roles", async (context) => {
  const database = openDatabase({filename: ":memory:", busyTimeoutMs: 5_000});
  migrateDatabase(database, path.resolve("server", "migrations"));
  const identities = new IdentityRepository(database);
  const auth = new AuthService(identities, 3_600);
  const providers = new ProviderService(new ProviderSecretRepository(database), new SecretCipher(Buffer.alloc(32, 7).toString("base64"), "test-v1"));
  const storyRepository = new StoryRepository(database);
  const stories = new StoryService(storyRepository);
  const assets = new AssetService(new AssetRepository(database), storyRepository, "unused-test-assets");
  const candidateRepository = new ImageCandidateRepository(database);
  const images = new ImageCandidateService(candidateRepository, storyRepository, assets);
  const billingRepository = new BillingRepository(database); billingRepository.seed(new Date().toISOString()); const billing = new BillingService(billingRepository, true);
  const jobs = new JobService(new JobRepository(database), storyRepository, candidateRepository, assets, billing, true, "success", "fixture-model", "fixture-image");
  const config = {...loadConfig({}), logLevel: "silent", webRoot: "unused", secretMasterKey: Buffer.alloc(32, 7).toString("base64")};
  const app = await buildApp(config, {serveStatic: false, fallbackHtml: "app", services: {auth, identities, providers, stories, assets, images, jobs, billing, admin: new AdminRepository(database)}});
  context.after(async () => { await app.close(); database.close(); });

  const registered = await app.inject({method: "POST", url: "/api/v1/auth/register", payload: {username: "alice", password: "passphrase-one"}});
  assert.equal(registered.statusCode, 201);
  assert.doesNotMatch(registered.body, /passphrase|storyvideogen_session/);
  const cookies = cookieValues(registered.headers["set-cookie"]);
  assert.ok(cookies.storyvideogen_session);
  assert.ok(cookies.storyvideogen_csrf);

  const cookieHeader = `storyvideogen_session=${cookies.storyvideogen_session}; storyvideogen_csrf=${cookies.storyvideogen_csrf}`;
  const rejected = await app.inject({method: "POST", url: "/api/v1/auth/logout", headers: {cookie: cookieHeader}});
  assert.equal(rejected.statusCode, 403);
  assert.equal(rejected.json().error.code, "CSRF_INVALID");

  const adminDenied = await app.inject({method: "GET", url: "/api/v1/admin/users", headers: {cookie: cookieHeader}});
  assert.equal(adminDenied.statusCode, 403);
  assert.equal(adminDenied.json().error.code, "FORBIDDEN");

  assert.equal(identities.promoteToAdmin("alice", new Date().toISOString()), "updated");
  assert.equal(identities.promoteToAdmin("ALICE", new Date().toISOString()), "already-admin");
  const adminAllowed = await app.inject({method: "GET", url: "/api/v1/admin/users", headers: {cookie: cookieHeader}});
  assert.equal(adminAllowed.statusCode, 200);
  assert.deepEqual(adminAllowed.json().users.map((user: {username: string}) => user.username), ["alice"]);

  const logout = await app.inject({method: "POST", url: "/api/v1/auth/logout", headers: {cookie: cookieHeader, "x-csrf-token": cookies.storyvideogen_csrf!}});
  assert.equal(logout.statusCode, 204);
  const revoked = await app.inject({method: "GET", url: "/api/v1/auth/me", headers: {cookie: cookieHeader}});
  assert.equal(revoked.statusCode, 401);

  const unknown = await app.inject({method: "POST", url: "/api/v1/auth/login", payload: {username: "missing", password: "passphrase-one"}});
  const incorrect = await app.inject({method: "POST", url: "/api/v1/auth/login", payload: {username: "alice", password: "passphrase-wrong"}});
  assert.equal(unknown.json().error.message, incorrect.json().error.message);
});

test("expired sessions and cross-user provider access are denied", async () => {
  const database = openDatabase({filename: ":memory:", busyTimeoutMs: 5_000});
  migrateDatabase(database, path.resolve("server", "migrations"));
  try {
    const identities = new IdentityRepository(database);
    const expiredAuth = new AuthService(identities, -1);
    const issued = expiredAuth.register("expired-user", "expired-password");
    assert.throws(() => expiredAuth.authenticate(issued.sessionToken), /Sign in to continue/);

    const repository = new ProviderSecretRepository(database);
    const cipher = new SecretCipher(Buffer.alloc(32, 4).toString("base64"), "test-v1");
    const providers = new ProviderService(repository, cipher);
    const owner = new AuthService(identities, 3600).register("secret-owner", "owner-password").user;
    const stranger = new AuthService(identities, 3600).register("secret-stranger", "stranger-password").user;
    assert.deepEqual(providers.list(owner.id).find((provider) => provider.id === "pexels")?.capabilities, {text: false, image: false, search: true});
    providers.save(owner.id, "zhipu", "synthetic-private-key");
    assert.equal(providers.list(stranger.id).find((provider) => provider.id === "zhipu")?.configured, false);
    assert.throws(() => providers.resolve(stranger.id, "zhipu"), /Configure zhipu/);
    assert.deepEqual(providers.resolve(owner.id, "zhipu"), {value: "synthetic-private-key", source: "user"});

    const suspended = new AuthService(identities, 3600).register("suspended-user", "suspended-password");
    database.prepare("UPDATE users SET status = 'suspended' WHERE id = ?").run(suspended.user.id);
    assert.throws(() => new AuthService(identities, 3600).authenticate(suspended.sessionToken), /Sign in to continue/);
    assert.throws(() => new AuthService(identities, 3600).login("suspended-user", "suspended-password"), /Invalid username or password/);
    const revoked = database.prepare("SELECT revoked_at FROM sessions WHERE user_id = ?").get(suspended.user.id) as {revoked_at: string | null};
    assert.ok(revoked.revoked_at);
  } finally {
    database.close();
  }
});

function cookieValues(header: string | string[] | undefined): Record<string, string> {
  const headers = Array.isArray(header) ? header : header ? [header] : [];
  return Object.fromEntries(headers.map((value) => value.split(";", 1)[0]!.split("=", 2) as [string, string]));
}
