import type {FastifyInstance, FastifyRequest} from "fastify";

import type {AuthService} from "../auth/authService.js";
import {requireMutationSession, requireSession} from "../auth/routes.js";
import type {AppConfig} from "../config.js";
import {ApiError} from "../http/errors.js";
import type {ProviderService} from "./providerService.js";

export async function registerProviderRoutes(app: FastifyInstance, dependencies: {auth: AuthService; providers: ProviderService; config: AppConfig}): Promise<void> {
  app.get("/api/v1/settings/providers", async (request) => {
    const session = requireSession(request, dependencies.auth);
    return {providers: dependencies.providers.list(session.user.id), builtInSearch: [{id: "baidu", label: "Baidu Images"}]};
  });

  app.put("/api/v1/settings/providers/:provider", async (request) => {
    const session = requireMutationSession(request, dependencies.auth);
    const body = objectBody(request.body);
    return {provider: dependencies.providers.save(session.user.id, routeProvider(request), body.apiKey)};
  });

  app.delete("/api/v1/settings/providers/:provider", async (request, reply) => {
    const session = requireMutationSession(request, dependencies.auth);
    dependencies.providers.remove(session.user.id, routeProvider(request));
    return reply.code(204).send();
  });

  app.post("/api/v1/settings/providers/:provider/test", async (request) => {
    const session = requireMutationSession(request, dependencies.auth);
    return {provider: dependencies.providers.test(session.user.id, routeProvider(request), dependencies.config.providerTestMode)};
  });
}

function routeProvider(request: FastifyRequest): string {
  const value = (request.params as {provider?: unknown}).provider;
  if (typeof value !== "string") throw new ApiError(400, "PROVIDER_INVALID", "A provider is required.");
  return value;
}

function objectBody(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new ApiError(400, "BODY_INVALID", "A JSON object is required.");
  return value as Record<string, unknown>;
}
