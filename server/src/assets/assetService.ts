import {createHash, randomUUID} from "node:crypto";
import {mkdir, readFile, rename, writeFile} from "node:fs/promises";
import path from "node:path";

import type {AssetRecord, AssetRepository} from "../db/repositories/assetRepository.js";
import type {StoryRepository} from "../db/repositories/storyRepository.js";
import {ApiError} from "../http/errors.js";

export interface PublicAsset {id: string; storyId: string | null; sceneId: string | null; kind: string; mimeType: string; byteSize: number; width: number | null; height: number | null; durationMs: number | null; checksumSha256: string; url: string; downloadUrl: string; createdAt: string}

export class AssetService {
  constructor(private readonly assets: AssetRepository, private readonly stories: StoryRepository, private readonly storageRoot: string) {}

  async saveImage(userId: string, storyId: string, buffer: Buffer, sceneId?: string): Promise<PublicAsset> {
    if (!this.stories.findOwned(userId, storyId)) throw new ApiError(404, "STORY_NOT_FOUND", "The story was not found.");
    if (sceneId && this.stories.findSceneOwned(userId, sceneId)?.storyId !== storyId) throw new ApiError(404, "SCENE_NOT_FOUND", "The scene was not found.");
    const image = inspectImage(buffer); const fileId = randomUUID(); const storageKey = `${fileId.slice(0, 2)}/${fileId}.${image.extension}`;
    const finalPath = this.absolutePath(storageKey); const temporaryPath = `${finalPath}.${randomUUID()}.tmp`;
    await mkdir(path.dirname(finalPath), {recursive: true});
    await writeFile(temporaryPath, buffer, {flag: "wx"});
    await rename(temporaryPath, finalPath);
    const record = this.assets.create(userId, storyId, {storageKey, mimeType: image.mimeType, byteSize: buffer.length, width: image.width, height: image.height, checksumSha256: createHash("sha256").update(buffer).digest("hex"), ...(sceneId ? {sceneId} : {})}, new Date().toISOString());
    return publicAsset(record);
  }

  async importWorkerImage(userId: string, storyId: string, sceneId: string, sourcePath: string): Promise<PublicAsset> {
    return this.saveImage(userId, storyId, await readFile(sourcePath), sceneId);
  }

  async saveMusic(userId: string, storyId: string, buffer: Buffer, mimeType: string, attested: boolean): Promise<{music: PublicAsset; attestation: PublicAsset}> {
    if (!attested) throw new ApiError(400, "MUSIC_RIGHTS_REQUIRED", "Confirm that you have permission to use this music.");
    const format = inspectMusic(buffer, mimeType); const music = await this.saveMedia(userId, storyId, "music", buffer, format.mimeType, format.extension, {});
    const statement = Buffer.from(JSON.stringify({musicAssetId: music.id, rightsAttested: true, attestedAt: new Date().toISOString()}), "utf8");
    const attestation = await this.saveMedia(userId, storyId, "manifest", statement, "application/json", "json", {});
    return {music, attestation};
  }

  async importWorkerMedia(userId: string, storyId: string, sourcePath: string, values: {kind: string; mimeType: string; extension: string; width?: number; height?: number; durationMs?: number}): Promise<PublicAsset> {
    const buffer = await readFile(sourcePath); validateWorkerMedia(buffer, values.kind, values.mimeType);
    return this.saveMedia(userId, storyId, values.kind, buffer, values.mimeType, values.extension, values);
  }

  listForStory(userId: string, storyId: string): PublicAsset[] {
    if (!this.stories.findOwned(userId, storyId)) throw new ApiError(404, "STORY_NOT_FOUND", "The story was not found.");
    return this.assets.listForStory(userId, storyId).map(publicAsset);
  }

  findOwned(userId: string, assetId: string): AssetRecord {
    const asset = this.assets.findOwned(userId, assetId);
    if (!asset) throw new ApiError(404, "ASSET_NOT_FOUND", "The asset was not found.");
    return asset;
  }

  absolutePath(storageKey: string): string {
    if (!/^[a-f0-9]{2}\/[a-f0-9-]+\.[a-z0-9]+$/.test(storageKey)) throw new Error("Invalid internal storage key.");
    const result = path.resolve(this.storageRoot, storageKey);
    const relative = path.relative(this.storageRoot, result);
    if (relative.startsWith("..") || path.isAbsolute(relative)) throw new Error("Asset path escaped the storage root.");
    return result;
  }

  private async saveMedia(userId: string, storyId: string, kind: string, buffer: Buffer, mimeType: string, extension: string, metadata: {width?: number; height?: number; durationMs?: number; sceneId?: string}): Promise<PublicAsset> {
    if (!this.stories.findOwned(userId, storyId)) throw new ApiError(404, "STORY_NOT_FOUND", "The story was not found."); const fileId = randomUUID(); const storageKey = `${fileId.slice(0, 2)}/${fileId}.${extension}`; const finalPath = this.absolutePath(storageKey); const temporaryPath = `${finalPath}.${randomUUID()}.tmp`; await mkdir(path.dirname(finalPath), {recursive: true}); await writeFile(temporaryPath, buffer, {flag: "wx"}); await rename(temporaryPath, finalPath);
    return publicAsset(this.assets.createMedia(userId, storyId, {kind, storageKey, mimeType, byteSize: buffer.length, checksumSha256: createHash("sha256").update(buffer).digest("hex"), ...metadata}, new Date().toISOString()));
  }
}

export function publicAsset(asset: AssetRecord): PublicAsset { return {id: asset.id, storyId: asset.storyId, sceneId: asset.sceneId, kind: asset.kind, mimeType: asset.mimeType, byteSize: asset.byteSize, width: asset.width, height: asset.height, durationMs: asset.durationMs, checksumSha256: asset.checksumSha256, url: `/api/v1/assets/${asset.id}`, downloadUrl: `/api/v1/assets/${asset.id}/download`, createdAt: asset.createdAt}; }

function inspectImage(buffer: Buffer): {mimeType: string; extension: string; width: number; height: number} {
  if (buffer.length >= 45 && buffer.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])) && buffer.subarray(12, 16).toString("ascii") === "IHDR" && buffer.subarray(-8, -4).toString("ascii") === "IEND") return dimensions("image/png", "png", buffer.readUInt32BE(16), buffer.readUInt32BE(20));
  if (buffer.length >= 10 && (buffer.subarray(0, 6).toString("ascii") === "GIF87a" || buffer.subarray(0, 6).toString("ascii") === "GIF89a")) return dimensions("image/gif", "gif", buffer.readUInt16LE(6), buffer.readUInt16LE(8));
  if (buffer.length >= 4 && buffer[0] === 0xff && buffer[1] === 0xd8) {
    let offset = 2;
    while (offset + 9 < buffer.length) {
      if (buffer[offset] !== 0xff) { offset += 1; continue; }
      const marker = buffer[offset + 1]!; const length = buffer.readUInt16BE(offset + 2);
      if ([0xc0, 0xc1, 0xc2, 0xc3, 0xc5, 0xc6, 0xc7, 0xc9, 0xca, 0xcb, 0xcd, 0xce, 0xcf].includes(marker)) return dimensions("image/jpeg", "jpg", buffer.readUInt16BE(offset + 5), buffer.readUInt16BE(offset + 7));
      if (length < 2) break; offset += 2 + length;
    }
  }
  throw new ApiError(415, "IMAGE_FORMAT_INVALID", "Upload a valid PNG, JPEG, or GIF image.");
}

function dimensions(mimeType: string, extension: string, width: number, height: number) { if (width < 1 || height < 1 || width > 32_768 || height > 32_768) throw new ApiError(415, "IMAGE_DIMENSIONS_INVALID", "The image dimensions are invalid."); return {mimeType, extension, width, height}; }
function inspectMusic(buffer: Buffer, declared: string): {mimeType: string; extension: string} { if (buffer.length >= 12 && buffer.subarray(0, 4).toString("ascii") === "RIFF" && buffer.subarray(8, 12).toString("ascii") === "WAVE") return {mimeType: "audio/wav", extension: "wav"}; if (buffer.length >= 3 && (buffer.subarray(0, 3).toString("ascii") === "ID3" || (buffer[0] === 0xff && (buffer[1]! & 0xe0) === 0xe0))) return {mimeType: "audio/mpeg", extension: "mp3"}; throw new ApiError(415, "MUSIC_FORMAT_INVALID", `Upload a valid MP3 or WAV file${declared ? ` (${declared} was not valid)` : ""}.`); }
export function validateWorkerMedia(buffer: Buffer, kind: string, mimeType: string): void { if (buffer.length < 1) throw new Error("Worker media is empty."); if (kind === "video" && !(buffer.length > 12 && buffer.subarray(4, 8).toString("ascii") === "ftyp")) throw new Error("Worker video is invalid."); if (kind === "audio" && !isWorkerAudio(buffer)) throw new Error("Worker audio is invalid."); if (kind === "manifest") JSON.parse(buffer.toString("utf8")); if ((kind === "subtitle" || kind === "credits") && !mimeType.startsWith("text/")) throw new Error("Worker text media has an invalid MIME type."); }
function isWorkerAudio(buffer: Buffer): boolean { return (buffer.length >= 12 && buffer.subarray(0, 4).toString("ascii") === "RIFF" && buffer.subarray(8, 12).toString("ascii") === "WAVE") || (buffer.length >= 3 && (buffer.subarray(0, 3).toString("ascii") === "ID3" || (buffer[0] === 0xff && (buffer[1]! & 0xe0) === 0xe0))); }
