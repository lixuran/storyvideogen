import type {AssetService, PublicAsset} from "../assets/assetService.js";
import type {ImageCandidateRecord, ImageCandidateRepository} from "../db/repositories/imageCandidateRepository.js";
import type {StoryRepository} from "../db/repositories/storyRepository.js";
import {ApiError} from "../http/errors.js";

export interface PublicImageCandidate extends ImageCandidateRecord {asset: PublicAsset | null}

export class ImageCandidateService {
  constructor(private readonly candidates: ImageCandidateRepository, private readonly stories: StoryRepository, private readonly assets: AssetService) {}

  list(userId: string, storyId: string): PublicImageCandidate[] {
    if (!this.stories.findOwned(userId, storyId)) throw new ApiError(404, "STORY_NOT_FOUND", "The story was not found.");
    return this.candidates.listForStory(userId, storyId).map((candidate) => this.publicCandidate(userId, candidate));
  }

  async upload(userId: string, sceneId: string, buffer: Buffer): Promise<PublicImageCandidate> {
    const scene = this.stories.findSceneOwned(userId, sceneId); if (!scene) throw new ApiError(404, "SCENE_NOT_FOUND", "The scene was not found.");
    const asset = await this.assets.saveImage(userId, scene.storyId, buffer, scene.id);
    return {...this.candidates.createManual(scene.id, asset.id, new Date().toISOString()), asset};
  }

  select(userId: string, candidateId: string): PublicImageCandidate {
    const candidate = this.candidates.selectOwned(userId, candidateId, new Date().toISOString());
    if (!candidate) throw new ApiError(409, "IMAGE_CANDIDATE_NOT_READY", "Choose a ready image candidate that belongs to your story.");
    return this.publicCandidate(userId, candidate);
  }

  private publicCandidate(userId: string, candidate: ImageCandidateRecord): PublicImageCandidate {
    const asset = candidate.assetId ? this.assets.findOwned(userId, candidate.assetId) : null;
    return {...candidate, asset: asset ? {id: asset.id, storyId: asset.storyId, sceneId: asset.sceneId, kind: asset.kind, mimeType: asset.mimeType, byteSize: asset.byteSize, width: asset.width, height: asset.height, durationMs: asset.durationMs, checksumSha256: asset.checksumSha256, url: `/api/v1/assets/${asset.id}`, downloadUrl: `/api/v1/assets/${asset.id}/download`, createdAt: asset.createdAt} : null};
  }
}
