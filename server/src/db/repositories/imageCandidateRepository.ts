import {randomUUID} from "node:crypto";

import type {SqliteDatabase} from "../database.js";
import {runInTransaction} from "../transaction.js";

export interface ImageCandidateRecord {id: string; sceneId: string; promptId: string | null; assetId: string | null; provider: string; model: string | null; status: string; isSelected: boolean; attributionText: string | null; licenseCode: string | null; sourceUrl: string | null; errorCode: string | null; errorMessage: string | null; createdAt: string; updatedAt: string}
interface CandidateRow {id: string; scene_id: string; prompt_id: string | null; asset_id: string | null; provider: string; model: string | null; status: string; is_selected: number; attribution_text: string | null; license_code: string | null; source_url: string | null; error_code: string | null; error_message: string | null; created_at: string; updated_at: string}

export class ImageCandidateRepository {
  constructor(private readonly database: SqliteDatabase) {}

  createSlots(sceneId: string, promptId: string, provider: string, model: string | null, count: number, now: string): ImageCandidateRecord[] {
    return runInTransaction(this.database, () => Array.from({length: count}, () => {
      const id = randomUUID();
      this.database.prepare("INSERT INTO image_candidates (id, scene_id, prompt_id, provider, model, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)").run(id, sceneId, promptId, provider, model, now, now);
      return this.findById(id)!;
    }));
  }

  createManual(sceneId: string, assetId: string, now: string): ImageCandidateRecord {
    const id = randomUUID();
    this.database.prepare("INSERT INTO image_candidates (id, scene_id, asset_id, provider, status, created_at, updated_at) VALUES (?, ?, ?, 'manual', 'ready', ?, ?)").run(id, sceneId, assetId, now, now);
    return this.findById(id)!;
  }

  findById(id: string): ImageCandidateRecord | undefined { const row = this.database.prepare("SELECT * FROM image_candidates WHERE id = ?").get(id) as CandidateRow | undefined; return row && mapCandidate(row); }
  findOwned(userId: string, id: string): ImageCandidateRecord | undefined { const row = this.database.prepare("SELECT image_candidates.* FROM image_candidates JOIN scenes ON scenes.id = image_candidates.scene_id JOIN stories ON stories.id = scenes.story_id WHERE image_candidates.id = ? AND stories.user_id = ?").get(id, userId) as CandidateRow | undefined; return row && mapCandidate(row); }
  listForStory(userId: string, storyId: string): ImageCandidateRecord[] { return (this.database.prepare("SELECT image_candidates.* FROM image_candidates JOIN scenes ON scenes.id = image_candidates.scene_id JOIN stories ON stories.id = scenes.story_id WHERE stories.id = ? AND stories.user_id = ? ORDER BY scenes.position, image_candidates.created_at, image_candidates.id").all(storyId, userId) as CandidateRow[]).map(mapCandidate); }

  markReady(id: string, assetId: string, metadata: {sourceUrl: string; attributionText: string | null; licenseCode: string | null}, now: string): boolean {
    return this.database.prepare("UPDATE image_candidates SET asset_id = ?, status = 'ready', source_url = ?, attribution_text = ?, license_code = ?, error_code = NULL, error_message = NULL, updated_at = ? WHERE id = ? AND status IN ('queued', 'generating')").run(assetId, metadata.sourceUrl, metadata.attributionText, metadata.licenseCode, now, id).changes === 1;
  }

  markFailed(id: string, code: string, message: string, now: string): boolean { return this.database.prepare("UPDATE image_candidates SET status = 'failed', error_code = ?, error_message = ?, updated_at = ? WHERE id = ? AND status IN ('queued', 'generating')").run(code, message, now, id).changes === 1; }

  selectOwned(userId: string, id: string, now: string): ImageCandidateRecord | undefined {
    return runInTransaction(this.database, () => {
      const candidate = this.findOwned(userId, id); if (!candidate || candidate.status !== "ready" || !candidate.assetId) return undefined;
      this.database.prepare("UPDATE image_candidates SET is_selected = 0, updated_at = ? WHERE scene_id = ? AND is_selected = 1").run(now, candidate.sceneId);
      this.database.prepare("UPDATE image_candidates SET is_selected = 1, updated_at = ? WHERE id = ?").run(now, id);
      return this.findById(id);
    });
  }
}

function mapCandidate(row: CandidateRow): ImageCandidateRecord { return {id: row.id, sceneId: row.scene_id, promptId: row.prompt_id, assetId: row.asset_id, provider: row.provider, model: row.model, status: row.status, isSelected: row.is_selected === 1, attributionText: row.attribution_text, licenseCode: row.license_code, sourceUrl: row.source_url, errorCode: row.error_code, errorMessage: row.error_message, createdAt: row.created_at, updatedAt: row.updated_at}; }
