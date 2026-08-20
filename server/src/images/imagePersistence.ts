import {readFile} from "node:fs/promises";
import path from "node:path";

import type {AssetService} from "../assets/assetService.js";
import type {ImageCandidateRepository} from "../db/repositories/imageCandidateRepository.js";
import type {JobRecord} from "../db/repositories/jobRepository.js";

interface WorkerCandidate {candidateId: string; status: "ready" | "failed"; file?: string; sourceUrl?: string; creator?: string; licenseName?: string; licenseUrl?: string; error?: string}

export class ImagePersistence {
  constructor(private readonly candidates: ImageCandidateRepository, private readonly assets: AssetService, private readonly workerRoot: string) {}

  async apply(job: JobRecord, resultFile: string): Promise<Record<string, unknown>> {
    if (!job.storyId) throw new Error("Image job has no story.");
    const jobRoot = path.resolve(this.workerRoot, job.id); const resultPath = safeChild(jobRoot, resultFile);
    const parsed = JSON.parse(await readFile(resultPath, "utf8")) as unknown;
    if (!parsed || typeof parsed !== "object" || !Array.isArray((parsed as {candidates?: unknown}).candidates)) throw new Error("Image result is invalid.");
    const expected = stringArray(job.payload.candidateIds); const values = (parsed as {candidates: unknown[]}).candidates;
    if (values.length !== expected.length) throw new Error("Image result count does not match the request.");
    let ready = 0; let failed = 0;
    for (const [index, raw] of values.entries()) {
      const candidate = validateCandidate(raw, expected[index]!); const stored = this.candidates.findById(candidate.candidateId);
      if (!stored || stored.sceneId !== job.payload.sceneId || stored.provider !== job.payload.candidateProvider) throw new Error("Image candidate does not match the job.");
      const now = new Date().toISOString();
      if (candidate.status === "failed") { this.candidates.markFailed(candidate.candidateId, "IMAGE_PROVIDER_FAILED", candidate.error ?? "Image generation failed.", now); failed += 1; continue; }
      const sourcePath = safeChild(jobRoot, candidate.file!); const asset = await this.assets.importWorkerImage(job.userId, job.storyId, stored.sceneId, sourcePath);
      this.candidates.markReady(candidate.candidateId, asset.id, {sourceUrl: candidate.sourceUrl!, attributionText: candidate.creator ?? null, licenseCode: candidate.licenseName ?? null}, now); ready += 1;
    }
    return {provider: job.payload.candidateProvider, model: job.payload.model, readyCount: ready, failedCount: failed, candidateIds: expected};
  }
}

function validateCandidate(value: unknown, expectedId: string): WorkerCandidate {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("Image candidate result must be an object."); const item = value as Record<string, unknown>;
  if (item.candidateId !== expectedId || (item.status !== "ready" && item.status !== "failed")) throw new Error("Image candidate result is invalid.");
  if (item.status === "ready" && (typeof item.file !== "string" || typeof item.sourceUrl !== "string")) throw new Error("Ready image candidate is incomplete.");
  for (const key of ["creator", "licenseName", "licenseUrl", "error"] as const) if (item[key] !== undefined && typeof item[key] !== "string") throw new Error("Image candidate metadata is invalid.");
  return item as unknown as WorkerCandidate;
}
function stringArray(value: unknown): string[] { if (!Array.isArray(value) || value.length < 1 || value.length > 4 || value.some((item) => typeof item !== "string")) throw new Error("Image candidate identifiers are invalid."); return value as string[]; }
function safeChild(root: string, value: string): string { if (path.isAbsolute(value) || value.split(/[\\/]/).includes("..")) throw new Error("Image result path is unsafe."); const candidate = path.resolve(root, value); const relative = path.relative(root, candidate); if (relative.startsWith("..") || path.isAbsolute(relative)) throw new Error("Image result escaped its job root."); return candidate; }
