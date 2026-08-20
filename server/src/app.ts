import {randomUUID} from "node:crypto";
import {existsSync} from "node:fs";
import path from "node:path";
import fastifyStatic from "@fastify/static";
import fastifyCookie from "@fastify/cookie";
import fastifyMultipart from "@fastify/multipart";
import Fastify, {LogController, type FastifyInstance} from "fastify";

import type {AuthService} from "./auth/authService.js";
import {registerAuthRoutes} from "./auth/routes.js";
import type {AppConfig} from "./config.js";
import type {IdentityRepository} from "./db/repositories/identityRepository.js";
import {errorPayload, registerErrorHandling} from "./http/errors.js";
import type {ProviderService} from "./providers/providerService.js";
import {registerProviderRoutes} from "./providers/routes.js";
import type {AssetService} from "./assets/assetService.js";
import type {StoryService} from "./stories/storyService.js";
import {registerStoryRoutes} from "./stories/routes.js";
import type {JobService} from "./jobs/jobService.js";
import {registerJobRoutes} from "./jobs/routes.js";
import type {ImageCandidateService} from "./images/imageCandidateService.js";
import type {BillingService} from "./billing/billingService.js";
import {registerBillingRoutes} from "./billing/routes.js";
import type {AdminRepository} from "./admin/adminRepository.js";
import {registerAdminRoutes} from "./admin/routes.js";

export type DatabaseReadiness =
  | {status: "ready"}
  | {status: "unavailable"};

export interface BuildAppOptions {
  serveStatic?: boolean;
  fallbackHtml?: string;
  databaseStatus?: DatabaseReadiness;
  services?: {
    auth: AuthService;
    identities: IdentityRepository;
    providers: ProviderService;
    stories: StoryService;
    assets: AssetService;
    images: ImageCandidateService;
    jobs: JobService;
    billing: BillingService;
    admin: AdminRepository;
  };
}

export async function buildApp(config: AppConfig, options: BuildAppOptions = {}): Promise<FastifyInstance> {
  const webBundleReady = options.serveStatic === false || existsSync(path.join(config.webRoot, "app.html"));
  const databaseStatus = options.databaseStatus ?? {status: "ready"};
  const applicationReady = webBundleReady && databaseStatus.status === "ready";
  const app = Fastify({
    bodyLimit: config.bodyLimit,
    genReqId: () => randomUUID(),
    logger: config.logLevel === "silent" ? false : {level: config.logLevel},
    logController: new LogController({disableRequestLogging: config.logLevel === "silent"})
  });

  registerErrorHandling(app);
  app.addHook("onSend", async (request, reply, payload) => {
    reply.header("x-content-type-options", "nosniff");
    reply.header("x-frame-options", "DENY");
    reply.header("referrer-policy", "same-origin");
    reply.header("permissions-policy", "camera=(), microphone=(), geolocation=()");
    reply.header("content-security-policy", "default-src 'self'; img-src 'self' data: blob:; media-src 'self'; style-src 'self'; script-src 'self'; connect-src 'self'; object-src 'none'; frame-ancestors 'none'; base-uri 'self'; form-action 'self'");
    if (request.url === "/api" || request.url.startsWith("/api/")) reply.header("cache-control", "no-store");
    return payload;
  });
  await app.register(fastifyCookie);
  await app.register(fastifyMultipart, {limits: {files: 1, fileSize: config.maxUploadBytes, fields: 4}});

  app.get("/health/live", async () => ({status: "ok"}));
  app.get("/health/ready", async (_request, reply) => {
    if (!applicationReady) {
      return reply.code(503).send({status: "unavailable"});
    }
    return {status: "ready"};
  });

  if (applicationReady && options.services) {
    await registerAuthRoutes(app, {config, auth: options.services.auth, identities: options.services.identities});
    await registerProviderRoutes(app, {config, auth: options.services.auth, providers: options.services.providers});
    await registerStoryRoutes(app, {auth: options.services.auth, stories: options.services.stories, assets: options.services.assets, images: options.services.images});
    await registerJobRoutes(app, {auth: options.services.auth, jobs: options.services.jobs});
    await registerBillingRoutes(app, {auth: options.services.auth, billing: options.services.billing});
    await registerAdminRoutes(app, {auth: options.services.auth, admin: options.services.admin, providers: options.services.providers});
  }

  if (options.serveStatic !== false && applicationReady) {
    await app.register(fastifyStatic, {
      root: config.webRoot,
      index: false,
      wildcard: false
    });
  }

  app.setNotFoundHandler((request, reply) => {
    const pathname = request.url.split("?", 1)[0] || "/";
    const apiRequest = pathname === "/api" || pathname.startsWith("/api/");
    const assetRequest = pathname.startsWith("/assets/") || path.posix.extname(pathname) !== "";
    if (!applicationReady) {
      if (request.method === "GET" && !apiRequest && !assetRequest) {
        return reply.code(503).type("text/html; charset=utf-8").send(unavailablePage);
      }
      return reply.code(503).send(errorPayload("SERVICE_UNAVAILABLE", "The service is temporarily unavailable.", request.id));
    }
    if (request.method !== "GET" || apiRequest) {
      return reply.code(404).send(errorPayload("NOT_FOUND", "The requested resource was not found.", request.id));
    }
    if (assetRequest) {
      return reply.code(404).send(errorPayload("NOT_FOUND", "The requested resource was not found.", request.id));
    }
    if (options.fallbackHtml !== undefined) {
      return reply.type("text/html; charset=utf-8").send(options.fallbackHtml);
    }
    return reply.type("text/html; charset=utf-8").sendFile("app.html");
  });

  return app;
}

const unavailablePage = `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1">
    <title>StoryVideoGen unavailable</title>
  </head>
  <body>
    <main>
      <h1>Service temporarily unavailable</h1>
      <p>StoryVideoGen could not finish starting. Please try again later.</p>
    </main>
  </body>
</html>`;
