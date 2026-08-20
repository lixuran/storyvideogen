import type {FastifyInstance, FastifyRequest} from "fastify";

import type {AuthService} from "../auth/authService.js";
import {requireMutationSession, requireSession} from "../auth/routes.js";
import {ApiError} from "../http/errors.js";
import type {JobService} from "./jobService.js";

export async function registerJobRoutes(app: FastifyInstance, dependencies: {auth: AuthService; jobs: JobService}): Promise<void> {
  app.post("/api/v1/stories/:storyId/actions/plan", async (request, reply) => {
    const session = requireMutationSession(request, dependencies.auth); const body = optionalObject(request.body);
    const result = dependencies.jobs.enqueuePlan(session.user.id, parameter(request, "storyId"), request.headers["idempotency-key"] ?? body.idempotencyKey, body);
    return reply.code(result.created ? 202 : 200).send(result);
  });
  app.post("/api/v1/scenes/:sceneId/actions/images", async (request, reply) => {
    const session = requireMutationSession(request, dependencies.auth); const body = optionalObject(request.body);
    const result = dependencies.jobs.enqueueImages(session.user.id, parameter(request, "sceneId"), body, request.headers["idempotency-key"] ?? body.idempotencyKey);
    return reply.code(result.created ? 202 : 200).send(result);
  });
  app.post("/api/v1/stories/:storyId/actions/render", async (request, reply) => { const session = requireMutationSession(request, dependencies.auth); const body = optionalObject(request.body); const result = dependencies.jobs.enqueueRender(session.user.id, parameter(request, "storyId"), body, request.headers["idempotency-key"] ?? body.idempotencyKey); return reply.code(result.created ? 202 : 200).send(result); });
  app.post("/api/v1/stories/:storyId/actions/auto", async (request, reply) => { const session = requireMutationSession(request, dependencies.auth); const body = optionalObject(request.body); const result = dependencies.jobs.enqueueAuto(session.user.id, parameter(request, "storyId"), body, request.headers["idempotency-key"] ?? body.idempotencyKey); return reply.code(result.created ? 202 : 200).send(result); });
  app.get("/api/v1/stories/:storyId/automation", async (request) => { const session = requireSession(request, dependencies.auth); return dependencies.jobs.readAutomation(session.user.id, parameter(request, "storyId")); });
  app.post("/api/v1/stories/:storyId/automation/cancel", async (request) => { const session = requireMutationSession(request, dependencies.auth); return dependencies.jobs.cancelAutomation(session.user.id, parameter(request, "storyId")); });
  app.get("/api/v1/jobs/:jobId", async (request) => { const session = requireSession(request, dependencies.auth); return dependencies.jobs.read(session.user.id, parameter(request, "jobId")); });
  app.post("/api/v1/jobs/:jobId/cancel", async (request) => { const session = requireMutationSession(request, dependencies.auth); return {job: dependencies.jobs.cancel(session.user.id, parameter(request, "jobId"))}; });
  app.get("/api/v1/events", async (request) => { const session = requireSession(request, dependencies.auth); return {events: dependencies.jobs.events(session.user.id, (request.query as Record<string, unknown>).after)}; });
  app.get("/api/v1/events/stream", async (request, reply) => {
    const session = requireSession(request, dependencies.auth); const after = (request.query as Record<string, unknown>).after;
    reply.hijack(); reply.raw.writeHead(200, {"content-type": "text/event-stream", "cache-control": "no-cache, no-transform", connection: "keep-alive", "x-accel-buffering": "no"});
    let cursor = typeof after === "string" && /^\d+$/.test(after) ? Number(after) : 0;
    const send = () => { for (const event of dependencies.jobs.events(session.user.id, String(cursor))) { cursor = event.id; reply.raw.write(`id: ${event.id}\nevent: ${event.eventType}\ndata: ${JSON.stringify(event)}\n\n`); } };
    send(); const interval = setInterval(() => { send(); reply.raw.write(": heartbeat\n\n"); }, 1_000); interval.unref(); reply.raw.once("close", () => clearInterval(interval));
  });
}

function parameter(request: FastifyRequest, name: string): string { const value = (request.params as Record<string, unknown>)[name]; if (typeof value !== "string" || !value) throw new ApiError(400, "PARAMETER_INVALID", "A route identifier is required."); return value; }
function optionalObject(value: unknown): Record<string, unknown> { if (value === undefined || value === null) return {}; if (typeof value !== "object" || Array.isArray(value)) throw new ApiError(400, "BODY_INVALID", "A JSON object is required."); return value as Record<string, unknown>; }
