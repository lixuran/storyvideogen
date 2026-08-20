import {readFile} from "node:fs/promises";
import path from "node:path";

import type {AssetService, PublicAsset} from "../assets/assetService.js";
import type {JobRecord} from "../db/repositories/jobRepository.js";
import type {StoryRepository} from "../db/repositories/storyRepository.js";

interface RenderOutput {kind: string; file: string; mimeType: string; extension: string; width?: number; height?: number; durationMs?: number}

export class RenderPersistence {
  constructor(private readonly assets: AssetService, private readonly stories: StoryRepository, private readonly workerRoot: string) {}

  async apply(job: JobRecord, resultFile: string): Promise<Record<string, unknown>> {
    if (!job.storyId) throw new Error("Render job has no story."); const root = path.resolve(this.workerRoot, job.id); const parsed = JSON.parse(await readFile(safeChild(root, resultFile), "utf8")) as Record<string, unknown>;
    if (parsed.contractVersion !== 1 || parsed.width !== 1920 || parsed.height !== 1080 || parsed.subtitlesBurnedIn !== true || !Array.isArray(parsed.outputs)) throw new Error("Render result is invalid.");
    const outputs = parsed.outputs.map(validateOutput); const required = new Set(["video", "audio", "subtitle", "credits", "manifest"]); for (const output of outputs) required.delete(output.kind); if (required.size) throw new Error("Render outputs are incomplete.");
    const assets: PublicAsset[] = []; for (const output of outputs) assets.push(await this.assets.importWorkerMedia(job.userId, job.storyId, safeChild(root, output.file), output));
    this.stories.markCompleted(job.userId, job.storyId, new Date().toISOString());
    return {width: 1920, height: 1080, durationMs: parsed.durationMs, subtitlesBurnedIn: true, assetIds: assets.map((asset) => asset.id)};
  }
}

function validateOutput(value: unknown): RenderOutput { if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("Render output is invalid."); const output = value as Record<string, unknown>; if (typeof output.kind !== "string" || !["video", "audio", "subtitle", "credits", "manifest"].includes(output.kind) || typeof output.file !== "string" || typeof output.mimeType !== "string" || typeof output.extension !== "string" || !/^[a-z0-9]+$/.test(output.extension)) throw new Error("Render output metadata is invalid."); for (const name of ["width", "height", "durationMs"] as const) if (output[name] !== undefined && (!Number.isInteger(output[name]) || (output[name] as number) < 0)) throw new Error("Render output measurement is invalid."); return output as unknown as RenderOutput; }
function safeChild(root: string, value: string): string { if (path.isAbsolute(value) || value.split(/[\\/]/).includes("..")) throw new Error("Render path is unsafe."); const candidate = path.resolve(root, value); const relative = path.relative(root, candidate); if (relative.startsWith("..") || path.isAbsolute(relative)) throw new Error("Render path escaped its root."); return candidate; }
