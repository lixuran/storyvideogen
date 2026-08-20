import {createHash} from "node:crypto";
import {copyFileSync, existsSync, mkdirSync, readFileSync, readdirSync, statSync} from "node:fs";
import path from "node:path";

import Database from "better-sqlite3";

import type {SqliteDatabase} from "../db/database.js";
import {ProviderSecretRepository} from "../db/repositories/providerSecretRepository.js";
import {SecretCipher} from "../security/secretCipher.js";

type JsonObject = Record<string, unknown>;

export interface LegacyImportOptions {
  authDatabasePath: string;
  userRoot: string;
  storageRoot: string;
  dryRun: boolean;
  cipher?: SecretCipher | undefined;
}

export interface LegacyImportReport {
  dryRun: boolean;
  discovered: {users: number; stories: number; providerKeys: number; assets: number};
  imported: {users: number; stories: number; providerKeys: number; assets: number};
  skipped: {users: number; stories: number; providerKeys: number; assets: number};
  corrupt: Array<{source: string; reason: string}>;
}

interface LegacyUser {id: number; username: string; password_hash: string; created_at: string}
interface LegacyKey {user_id: number; name: string; value: string}
interface StoryCandidate {root: string; session: JsonObject; project: JsonObject | undefined}

const providerByLegacyName: Record<string, string> = {
  ZAI_API_KEY: "zhipu",
  ZHIPU_IMAGE_API_KEY: "zhipu",
  SILICONFLOW_API_KEY: "siliconflow",
  PIXABAY_API_KEY: "pixabay"
};

export function importLegacy(database: SqliteDatabase, options: LegacyImportOptions): LegacyImportReport {
  const report: LegacyImportReport = {
    dryRun: options.dryRun,
    discovered: {users: 0, stories: 0, providerKeys: 0, assets: 0},
    imported: {users: 0, stories: 0, providerKeys: 0, assets: 0},
    skipped: {users: 0, stories: 0, providerKeys: 0, assets: 0},
    corrupt: []
  };
  const source = new Database(options.authDatabasePath, {readonly: true, fileMustExist: true});
  try {
    const users = source.prepare("SELECT id, username, password_hash, created_at FROM users ORDER BY id").all() as LegacyUser[];
    const keys = source.prepare("SELECT user_id, name, value FROM user_api_keys ORDER BY user_id, name").all() as LegacyKey[];
    report.discovered.users = users.length;
    report.discovered.providerKeys = countEffectiveKeys(keys);
    for (const user of users) {
      const stories = discoverStories(path.join(options.userRoot, user.username, "stories"), report);
      report.discovered.stories += stories.length;
      for (const story of stories) report.discovered.assets += discoverMedia(story).length;
      if (options.dryRun) continue;
      importUser(database, user, report);
      importKeys(database, user, keys, options.cipher, report);
      for (const story of stories) importStory(database, user, story, options.storageRoot, report);
      database.prepare("UPDATE sessions SET revoked_at = COALESCE(revoked_at, ?) WHERE user_id = ?").run(new Date().toISOString(), legacyUserId(user.id));
    }
  } finally {
    source.close();
  }
  return report;
}

function importUser(database: SqliteDatabase, user: LegacyUser, report: LegacyImportReport): void {
  const now = validTimestamp(user.created_at) ?? new Date().toISOString();
  const result = database.prepare("INSERT OR IGNORE INTO users (id, legacy_user_id, username, password_hash, role, status, created_at, updated_at) VALUES (?, ?, ?, ?, 'user', 'active', ?, ?)").run(legacyUserId(user.id), user.id, user.username, user.password_hash, now, now);
  result.changes ? report.imported.users++ : report.skipped.users++;
}

function importKeys(database: SqliteDatabase, user: LegacyUser, keys: LegacyKey[], cipher: SecretCipher | undefined, report: LegacyImportReport): void {
  const effective = effectiveKeys(keys.filter((key) => key.user_id === user.id));
  if (effective.length && !cipher) throw new Error("STORYVIDEOGEN_SECRET_MASTER_KEY is required to import provider keys.");
  const repository = new ProviderSecretRepository(database);
  for (const {provider, value} of effective) {
    const existing = repository.findUserProvider(legacyUserId(user.id), provider);
    if (existing) { report.skipped.providerKeys++; continue; }
    repository.saveUserProvider(legacyUserId(user.id), provider, cipher!.encrypt(value), value.slice(-4), new Date().toISOString());
    report.imported.providerKeys++;
  }
}

function importStory(database: SqliteDatabase, user: LegacyUser, candidate: StoryCandidate, storageRoot: string, report: LegacyImportReport): void {
  const storyId = stableId(`story:${user.id}:${path.resolve(candidate.root)}`);
  if (database.prepare("SELECT 1 FROM stories WHERE id = ?").get(storyId)) {
    report.skipped.stories++;
    report.skipped.assets += discoverMedia(candidate).length;
    return;
  }
  const projectStory = objectValue(candidate.project?.story);
  const name = stringValue(projectStory?.title) || stringValue(candidate.session.title) || path.basename(candidate.root);
  const sourceText = stringValue(projectStory?.text) || stringValue(candidate.session.story_text);
  const createdAt = validTimestamp(stringValue(candidate.session.created_at)) ?? new Date().toISOString();
  const updatedAt = validTimestamp(stringValue(candidate.session.updated_at)) ?? createdAt;
  const chunks = arrayValue(candidate.project?.chunks).map(objectValue).filter((value): value is JsonObject => Boolean(value));
  const media = discoverMedia(candidate);
  const completed = media.some((item) => item.kind === "video");
  const status = completed ? "completed" : chunks.length ? "planned" : "draft";
  const wordCount = sourceText.trim() ? sourceText.trim().split(/\s+/u).length : 0;
  const transaction = database.transaction(() => {
    database.prepare("INSERT INTO stories (id, user_id, name, source_text, status, word_count, created_at, updated_at, completed_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)").run(storyId, legacyUserId(user.id), name, sourceText, status, wordCount, createdAt, updatedAt, completed ? updatedAt : null);
    let cursor = 0;
    chunks.forEach((chunk, position) => {
      const text = stringValue(chunk.text) || stringValue(chunk.subtitle_text) || "Imported scene";
      const found = sourceText.indexOf(text, cursor);
      const start = found >= 0 ? found : cursor;
      const end = Math.max(start + 1, found >= 0 ? found + text.length : start + text.length);
      cursor = end;
      const sceneId = stableId(`scene:${storyId}:${position}`);
      const durationMs = Math.max(0, Math.round((numberValue(chunk.end_seconds) - numberValue(chunk.start_seconds)) * 1000));
      database.prepare("INSERT INTO scenes (id, story_id, position, source_start, source_end, source_text, narration_text, status, estimated_duration_ms, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, 'planned', ?, ?, ?)").run(sceneId, storyId, position, start, end, text, stringValue(chunk.subtitle_text) || text, durationMs, createdAt, updatedAt);
      arrayValue(chunk.prompt_candidates).forEach((prompt, promptPosition) => {
        const promptText = stringValue(prompt);
        if (promptText) database.prepare("INSERT INTO image_prompts (id, scene_id, position, prompt_text, provider, status, created_at, updated_at) VALUES (?, ?, ?, ?, 'legacy', 'ready', ?, ?)").run(stableId(`prompt:${sceneId}:${promptPosition}`), sceneId, promptPosition, promptText, createdAt, updatedAt);
      });
    });
    const importedAssets = new Map<string, string>();
    for (const item of media) {
      const assetId = importAsset(database, legacyUserId(user.id), storyId, candidate.root, item, storageRoot, createdAt, report);
      if (assetId) importedAssets.set(item.localPath, assetId);
    }
    const selectedPaths = selectedImagePaths(candidate.root);
    chunks.forEach((chunk, position) => {
      const sceneId = stableId(`scene:${storyId}:${position}`);
      const firstPromptId = database.prepare("SELECT id FROM image_prompts WHERE scene_id = ? ORDER BY position LIMIT 1").get(sceneId) as {id: string} | undefined;
      arrayValue(chunk.image_candidates).forEach((candidateValue, candidatePosition) => {
        const legacyCandidate = objectValue(candidateValue);
        const image = objectValue(legacyCandidate?.asset);
        const localPath = stringValue(image?.local_path);
        const assetId = importedAssets.get(localPath);
        if (!localPath || !assetId) return;
        const selected = selectedPaths.has(normalizedLegacyPath(localPath)) || (selectedPaths.size === 0 && arrayValue(chunk.image_candidates).length === 1);
        database.prepare("INSERT INTO image_candidates (id, scene_id, prompt_id, asset_id, provider, model, status, is_selected, attribution_text, license_code, source_url, created_at, updated_at) VALUES (?, ?, ?, ?, ?, NULL, 'ready', ?, ?, ?, ?, ?, ?)").run(stableId(`candidate:${sceneId}:${candidatePosition}`), sceneId, firstPromptId?.id ?? null, assetId, stringValue(image?.provider) || "legacy", selected ? 1 : 0, stringValue(image?.creator) || null, stringValue(image?.license_name) || null, stringValue(image?.source_url) || null, createdAt, createdAt);
      });
    });
  });
  try {
    transaction();
    report.imported.stories++;
  } catch (error) {
    report.corrupt.push({source: candidate.root, reason: safeReason(error)});
  }
}

interface LegacyMedia {kind: string; localPath: string; mimeType: string; width?: number | undefined; height?: number | undefined; durationMs?: number | undefined}

function discoverMedia(candidate: StoryCandidate): LegacyMedia[] {
  const result: LegacyMedia[] = [];
  const video = readJson(path.join(candidate.root, "video_manifest.json"));
  const videoPath = stringValue(video?.local_path) || stringValue(candidate.session.video_path);
  if (videoPath) result.push({kind: "video", localPath: videoPath, mimeType: "video/mp4", width: numberValue(video?.width) || undefined, height: numberValue(video?.height) || undefined, durationMs: Math.round(numberValue(video?.duration_seconds) * 1000) || undefined});
  const fixed: Array<[string, string, string]> = [
    ["subtitles.zh-CN.srt", "subtitle", "application/x-subrip"],
    ["narration.zh-CN.txt", "manifest", "text/plain"],
    ["credits.txt", "credits", "text/plain"],
    ["license_manifest.json", "credits", "application/json"],
    ["audio_manifest.json", "manifest", "application/json"]
  ];
  for (const [filename, kind, mimeType] of fixed) if (existsSync(path.join(candidate.root, filename))) result.push({kind, localPath: filename, mimeType});
  for (const chunkValue of arrayValue(candidate.project?.chunks)) {
    const chunk = objectValue(chunkValue);
    if (!chunk) continue;
    for (const candidateValue of arrayValue(chunk.image_candidates)) {
      const image = objectValue(objectValue(candidateValue)?.asset);
      const localPath = stringValue(image?.local_path);
      if (localPath) result.push({kind: "image", localPath, mimeType: mimeFor(localPath), width: numberValue(image?.width) || undefined, height: numberValue(image?.height) || undefined});
    }
  }
  return uniqueByPath(result);
}

function importAsset(database: SqliteDatabase, userId: string, storyId: string, storyRoot: string, media: LegacyMedia, storageRoot: string, createdAt: string, report: LegacyImportReport): string | undefined {
  const sourcePath = resolveConfinedMedia(storyRoot, media.localPath);
  if (!sourcePath || !existsSync(sourcePath) || !statSync(sourcePath).isFile()) {
    report.corrupt.push({source: media.localPath, reason: "Referenced media is missing or outside its legacy story directory."});
    return undefined;
  }
  const bytes = readFileSync(sourcePath);
  const checksum = createHash("sha256").update(bytes).digest("hex");
  const extension = safeExtension(sourcePath, media.kind);
  const assetId = stableId(`asset:${storyId}:${path.relative(storyRoot, sourcePath)}:${checksum}`);
  const storageKey = `${assetId.slice(0, 2)}/${assetId}.${extension}`;
  const destination = path.resolve(storageRoot, storageKey);
  if (!destination.startsWith(`${path.resolve(storageRoot)}${path.sep}`)) throw new Error("Invalid imported asset storage key.");
  mkdirSync(path.dirname(destination), {recursive: true});
  if (!existsSync(destination)) copyFileSync(sourcePath, destination);
  const result = database.prepare("INSERT OR IGNORE INTO assets (id, user_id, story_id, kind, storage_key, mime_type, byte_size, width, height, duration_ms, checksum_sha256, status, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'ready', ?, ?)").run(assetId, userId, storyId, media.kind, storageKey, media.mimeType, bytes.length, media.width ?? null, media.height ?? null, media.durationMs ?? null, checksum, createdAt, createdAt);
  result.changes ? report.imported.assets++ : report.skipped.assets++;
  return assetId;
}

function discoverStories(storiesRoot: string, report: LegacyImportReport): StoryCandidate[] {
  if (!existsSync(storiesRoot)) return [];
  const result: StoryCandidate[] = [];
  for (const entry of readdirSync(storiesRoot, {withFileTypes: true})) {
    if (!entry.isDirectory()) continue;
    const root = path.join(storiesRoot, entry.name);
    try {
      const session = readJson(path.join(root, "story_session.json")) ?? {};
      const project = readJson(path.join(root, "interactive_project.json"));
      if (Object.keys(session).length || project) result.push({root, session, project});
    } catch (error) {
      report.corrupt.push({source: root, reason: safeReason(error)});
    }
  }
  return result;
}

function readJson(filename: string): JsonObject | undefined { if (!existsSync(filename)) return undefined; const value: unknown = JSON.parse(readFileSync(filename, "utf8")); return objectValue(value); }
function selectedImagePaths(storyRoot: string): Set<string> { const filename = path.join(storyRoot, "image_manifest.json"); if (!existsSync(filename)) return new Set(); const value: unknown = JSON.parse(readFileSync(filename, "utf8")); return new Set(arrayValue(value).map(objectValue).map((item) => normalizedLegacyPath(stringValue(item?.local_path))).filter(Boolean)); }
function objectValue(value: unknown): JsonObject | undefined { return value !== null && typeof value === "object" && !Array.isArray(value) ? value as JsonObject : undefined; }
function arrayValue(value: unknown): unknown[] { return Array.isArray(value) ? value : []; }
function stringValue(value: unknown): string { return typeof value === "string" ? value.trim() : ""; }
function numberValue(value: unknown): number { return typeof value === "number" && Number.isFinite(value) ? value : 0; }
function validTimestamp(value: string): string | undefined { return value && Number.isFinite(Date.parse(value)) ? new Date(value).toISOString() : undefined; }
function legacyUserId(id: number): string { return stableId(`legacy-user:${id}`); }
function stableId(value: string): string { const hex = createHash("sha256").update(value).digest("hex").slice(0, 32); return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-5${hex.slice(13, 16)}-a${hex.slice(17, 20)}-${hex.slice(20)}`; }
function effectiveKeys(keys: LegacyKey[]): Array<{provider: string; value: string}> { const byProvider = new Map<string, string>(); for (const key of keys) { const provider = providerByLegacyName[key.name]; const value = key.value.trim(); if (provider && value && (!byProvider.has(provider) || key.name === "ZAI_API_KEY")) byProvider.set(provider, value); } return [...byProvider].map(([provider, value]) => ({provider, value})); }
function countEffectiveKeys(keys: LegacyKey[]): number { return new Set(keys.filter((key) => providerByLegacyName[key.name] && key.value.trim()).map((key) => `${key.user_id}:${providerByLegacyName[key.name]}`)).size; }
function resolveConfinedMedia(storyRoot: string, value: string): string | undefined { const root = path.resolve(storyRoot); const candidates = [path.resolve(root, value), path.resolve(value)]; return candidates.find((candidate) => candidate === root || candidate.startsWith(`${root}${path.sep}`)); }
function normalizedLegacyPath(value: string): string { return value.replaceAll("\\", "/").toLowerCase(); }
function uniqueByPath(items: LegacyMedia[]): LegacyMedia[] { const seen = new Set<string>(); return items.filter((item) => { const key = `${item.kind}:${item.localPath}`; if (seen.has(key)) return false; seen.add(key); return true; }); }
function safeExtension(filename: string, kind: string): string { const ext = path.extname(filename).slice(1).toLowerCase(); return /^[a-z0-9]{1,8}$/.test(ext) ? ext : kind === "video" ? "mp4" : "bin"; }
function mimeFor(filename: string): string { const ext = path.extname(filename).toLowerCase(); return ext === ".png" ? "image/png" : ext === ".jpg" || ext === ".jpeg" ? "image/jpeg" : ext === ".webp" ? "image/webp" : ext === ".ppm" ? "image/x-portable-pixmap" : "application/octet-stream"; }
function safeReason(error: unknown): string { return error instanceof SyntaxError ? "Invalid JSON manifest." : error instanceof Error ? error.message.replace(/[A-Za-z]:\\[^\s]+/g, "[path]") : "Unknown import error."; }
