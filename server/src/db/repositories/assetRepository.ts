import {randomUUID} from "node:crypto";

import type {SqliteDatabase} from "../database.js";

export interface AssetRecord {id: string; userId: string; storyId: string | null; sceneId: string | null; kind: string; storageKey: string; mimeType: string; byteSize: number; width: number | null; height: number | null; durationMs: number | null; checksumSha256: string; status: string; createdAt: string}
interface AssetRow {id: string; user_id: string; story_id: string | null; scene_id: string | null; kind: string; storage_key: string; mime_type: string; byte_size: number; width: number | null; height: number | null; duration_ms: number | null; checksum_sha256: string; status: string; created_at: string}

export class AssetRepository {
  constructor(private readonly database: SqliteDatabase) {}

  create(userId: string, storyId: string, values: {storageKey: string; mimeType: string; byteSize: number; width: number; height: number; checksumSha256: string; sceneId?: string}, now: string): AssetRecord {
    const id = randomUUID();
    this.database.prepare("INSERT INTO assets (id, user_id, story_id, scene_id, kind, storage_key, mime_type, byte_size, width, height, checksum_sha256, status, created_at, updated_at) VALUES (?, ?, ?, ?, 'image', ?, ?, ?, ?, ?, ?, 'ready', ?, ?)").run(id, userId, storyId, values.sceneId ?? null, values.storageKey, values.mimeType, values.byteSize, values.width, values.height, values.checksumSha256, now, now);
    return this.findOwned(userId, id)!;
  }

  createMedia(userId: string, storyId: string, values: {kind: string; storageKey: string; mimeType: string; byteSize: number; width?: number; height?: number; durationMs?: number; checksumSha256: string; sceneId?: string}, now: string): AssetRecord {
    const id = randomUUID();
    this.database.prepare("INSERT INTO assets (id, user_id, story_id, scene_id, kind, storage_key, mime_type, byte_size, width, height, duration_ms, checksum_sha256, status, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'ready', ?, ?)").run(id, userId, storyId, values.sceneId ?? null, values.kind, values.storageKey, values.mimeType, values.byteSize, values.width ?? null, values.height ?? null, values.durationMs ?? null, values.checksumSha256, now, now);
    return this.findOwned(userId, id)!;
  }

  findOwned(userId: string, id: string): AssetRecord | undefined {
    const row = this.database.prepare("SELECT * FROM assets WHERE id = ? AND user_id = ? AND status = 'ready'").get(id, userId) as AssetRow | undefined;
    return row && mapAsset(row);
  }

  listForStory(userId: string, storyId: string): AssetRecord[] {
    return (this.database.prepare("SELECT * FROM assets WHERE user_id = ? AND story_id = ? AND status = 'ready' ORDER BY created_at").all(userId, storyId) as AssetRow[]).map(mapAsset);
  }
}

function mapAsset(row: AssetRow): AssetRecord { return {id: row.id, userId: row.user_id, storyId: row.story_id, sceneId: row.scene_id, kind: row.kind, storageKey: row.storage_key, mimeType: row.mime_type, byteSize: row.byte_size, width: row.width, height: row.height, durationMs: row.duration_ms, checksumSha256: row.checksum_sha256, status: row.status, createdAt: row.created_at}; }
