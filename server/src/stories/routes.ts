import {createReadStream} from "node:fs";

import type {FastifyInstance, FastifyRequest} from "fastify";

import type {AuthService} from "../auth/authService.js";
import {requireMutationSession, requireSession} from "../auth/routes.js";
import type {AssetService} from "../assets/assetService.js";
import {ApiError} from "../http/errors.js";
import type {StoryService} from "./storyService.js";
import type {ImageCandidateService} from "../images/imageCandidateService.js";

export async function registerStoryRoutes(app: FastifyInstance, dependencies: {auth: AuthService; stories: StoryService; assets: AssetService; images: ImageCandidateService}): Promise<void> {
  app.post("/api/v1/stories", async (request, reply) => { const session = requireMutationSession(request, dependencies.auth); return reply.code(201).send({story: dependencies.stories.create(session.user.id, objectValue(request.body))}); });
  app.get("/api/v1/stories", async (request) => { const session = requireSession(request, dependencies.auth); return dependencies.stories.list(session.user.id, objectValue(request.query)); });
  app.get("/api/v1/stories/:storyId", async (request) => { const session = requireSession(request, dependencies.auth); return {story: dependencies.stories.read(session.user.id, parameter(request, "storyId"))}; });
  app.get("/api/v1/stories/:storyId/assets", async (request) => { const session = requireSession(request, dependencies.auth); return {assets: dependencies.assets.listForStory(session.user.id, parameter(request, "storyId"))}; });
  app.patch("/api/v1/stories/:storyId", async (request) => { const session = requireMutationSession(request, dependencies.auth); return {story: dependencies.stories.update(session.user.id, parameter(request, "storyId"), objectValue(request.body))}; });
  app.post("/api/v1/stories/:storyId/archive", async (request) => { const session = requireMutationSession(request, dependencies.auth); return {story: dependencies.stories.archive(session.user.id, parameter(request, "storyId"), objectValue(request.body).version)}; });
  app.patch("/api/v1/scenes/:sceneId", async (request) => { const session = requireMutationSession(request, dependencies.auth); return {scene: dependencies.stories.updateScene(session.user.id, parameter(request, "sceneId"), objectValue(request.body))}; });
  app.post("/api/v1/scenes/:sceneId/split", async (request) => { const session = requireMutationSession(request, dependencies.auth); return {scenes: dependencies.stories.splitScene(session.user.id, parameter(request, "sceneId"), objectValue(request.body))}; });
  app.post("/api/v1/scenes/:sceneId/merge-next", async (request) => { const session = requireMutationSession(request, dependencies.auth); return {scenes: dependencies.stories.mergeScene(session.user.id, parameter(request, "sceneId"), objectValue(request.body).version)}; });
  app.post("/api/v1/scenes/:sceneId/prompts", async (request, reply) => { const session = requireMutationSession(request, dependencies.auth); return reply.code(201).send({prompt: dependencies.stories.createPrompt(session.user.id, parameter(request, "sceneId"), objectValue(request.body).promptText)}); });
  app.patch("/api/v1/prompts/:promptId", async (request) => { const session = requireMutationSession(request, dependencies.auth); return {prompt: dependencies.stories.updatePrompt(session.user.id, parameter(request, "promptId"), objectValue(request.body))}; });
  app.delete("/api/v1/prompts/:promptId", async (request, reply) => { const session = requireMutationSession(request, dependencies.auth); dependencies.stories.deletePrompt(session.user.id, parameter(request, "promptId"), objectValue(request.body).version); return reply.code(204).send(); });
  app.get("/api/v1/stories/:storyId/image-candidates", async (request) => { const session = requireSession(request, dependencies.auth); return {candidates: dependencies.images.list(session.user.id, parameter(request, "storyId"))}; });
  app.post("/api/v1/image-candidates/:candidateId/select", async (request) => { const session = requireMutationSession(request, dependencies.auth); return {candidate: dependencies.images.select(session.user.id, parameter(request, "candidateId"))}; });
  app.post("/api/v1/scenes/:sceneId/assets/images", async (request, reply) => { const session = requireMutationSession(request, dependencies.auth); const upload = await request.file(); if (!upload) throw new ApiError(400, "UPLOAD_REQUIRED", "Choose an image to upload."); return reply.code(201).send({candidate: await dependencies.images.upload(session.user.id, parameter(request, "sceneId"), await upload.toBuffer())}); });

  app.post("/api/v1/stories/:storyId/assets/images", async (request, reply) => {
    const session = requireMutationSession(request, dependencies.auth); const upload = await request.file();
    if (!upload) throw new ApiError(400, "UPLOAD_REQUIRED", "Choose an image to upload.");
    const buffer = await upload.toBuffer();
    return reply.code(201).send({asset: await dependencies.assets.saveImage(session.user.id, parameter(request, "storyId"), buffer)});
  });
  app.post("/api/v1/stories/:storyId/assets/music", async (request, reply) => { const session = requireMutationSession(request, dependencies.auth); const upload = await request.file(); if (!upload) throw new ApiError(400, "UPLOAD_REQUIRED", "Choose a music file to upload."); const field = upload.fields.rightsAttested as {value?: unknown} | undefined; const result = await dependencies.assets.saveMusic(session.user.id, parameter(request, "storyId"), await upload.toBuffer(), upload.mimetype, field?.value === "true"); return reply.code(201).send(result); });

  for (const disposition of ["inline", "attachment"] as const) {
    const suffix = disposition === "inline" ? "" : "/download";
    app.get(`/api/v1/assets/:assetId${suffix}`, async (request, reply) => {
      const session = requireSession(request, dependencies.auth); const asset = dependencies.assets.findOwned(session.user.id, parameter(request, "assetId"));
      reply.type(asset.mimeType).header("content-length", String(asset.byteSize)).header("cache-control", "private, max-age=3600");
      if (disposition === "attachment") reply.header("content-disposition", `attachment; filename="asset-${asset.id}.${extensionFor(asset.mimeType)}"`);
      return reply.send(createReadStream(dependencies.assets.absolutePath(asset.storageKey)));
    });
  }
}

function objectValue(value: unknown): Record<string, unknown> { if (!value || typeof value !== "object" || Array.isArray(value)) throw new ApiError(400, "BODY_INVALID", "A JSON object is required."); return value as Record<string, unknown>; }
function parameter(request: FastifyRequest, name: string): string { const value = (request.params as Record<string, unknown>)[name]; if (typeof value !== "string" || !value) throw new ApiError(400, "PARAMETER_INVALID", "A route identifier is required."); return value; }
function extensionFor(mimeType: string): string { const normalized = mimeType.split(";", 1)[0]; return normalized === "image/jpeg" ? "jpg" : normalized === "image/gif" ? "gif" : normalized === "video/mp4" ? "mp4" : normalized === "audio/wav" ? "wav" : normalized === "audio/mpeg" ? "mp3" : normalized === "application/json" ? "json" : normalized === "text/plain" ? "txt" : "png"; }
