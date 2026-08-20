CREATE TABLE stories (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name TEXT NOT NULL CHECK (length(trim(name)) > 0),
  source_text TEXT NOT NULL,
  source_language TEXT NOT NULL DEFAULT 'auto',
  narration_language TEXT NOT NULL DEFAULT 'zh-CN',
  status TEXT NOT NULL DEFAULT 'draft' CHECK (
    status IN ('draft', 'planning', 'planned', 'generating_images', 'images_ready', 'generating_audio', 'rendering', 'completed', 'failed', 'archived')
  ),
  version INTEGER NOT NULL DEFAULT 1 CHECK (version > 0),
  word_count INTEGER NOT NULL DEFAULT 0 CHECK (word_count >= 0),
  estimated_duration_ms INTEGER NOT NULL DEFAULT 0 CHECK (estimated_duration_ms >= 0),
  last_error_code TEXT,
  last_error_message TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  completed_at TEXT,
  archived_at TEXT
) STRICT;

CREATE INDEX stories_user_status_updated_idx ON stories (user_id, status, updated_at DESC);
CREATE INDEX stories_user_updated_idx ON stories (user_id, updated_at DESC);

CREATE TABLE scenes (
  id TEXT PRIMARY KEY,
  story_id TEXT NOT NULL REFERENCES stories(id) ON DELETE CASCADE,
  position INTEGER NOT NULL CHECK (position >= 0),
  source_start INTEGER NOT NULL CHECK (source_start >= 0),
  source_end INTEGER NOT NULL CHECK (source_end > source_start),
  source_text TEXT NOT NULL,
  narration_text TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'planned', 'images_ready', 'audio_ready', 'rendered', 'failed')),
  version INTEGER NOT NULL DEFAULT 1 CHECK (version > 0),
  estimated_duration_ms INTEGER NOT NULL DEFAULT 0 CHECK (estimated_duration_ms >= 0),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE (story_id, position)
) STRICT;

CREATE INDEX scenes_story_position_idx ON scenes (story_id, position);

CREATE TABLE image_prompts (
  id TEXT PRIMARY KEY,
  scene_id TEXT NOT NULL REFERENCES scenes(id) ON DELETE CASCADE,
  position INTEGER NOT NULL CHECK (position >= 0),
  prompt_text TEXT NOT NULL CHECK (length(trim(prompt_text)) > 0),
  provider TEXT,
  model TEXT,
  status TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'ready', 'generating', 'completed', 'failed')),
  version INTEGER NOT NULL DEFAULT 1 CHECK (version > 0),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE (scene_id, position)
) STRICT;

CREATE TABLE assets (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  story_id TEXT REFERENCES stories(id) ON DELETE CASCADE,
  scene_id TEXT REFERENCES scenes(id) ON DELETE CASCADE,
  kind TEXT NOT NULL CHECK (kind IN ('image', 'audio', 'music', 'subtitle', 'video', 'credits', 'manifest')),
  storage_key TEXT NOT NULL UNIQUE CHECK (length(trim(storage_key)) > 0),
  mime_type TEXT NOT NULL,
  byte_size INTEGER NOT NULL CHECK (byte_size >= 0),
  width INTEGER CHECK (width IS NULL OR width > 0),
  height INTEGER CHECK (height IS NULL OR height > 0),
  duration_ms INTEGER CHECK (duration_ms IS NULL OR duration_ms >= 0),
  checksum_sha256 TEXT NOT NULL CHECK (length(checksum_sha256) = 64),
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'ready', 'failed', 'deleted')),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
) STRICT;

CREATE INDEX assets_user_story_kind_idx ON assets (user_id, story_id, kind);
CREATE INDEX assets_story_scene_idx ON assets (story_id, scene_id);

CREATE TABLE image_candidates (
  id TEXT PRIMARY KEY,
  scene_id TEXT NOT NULL REFERENCES scenes(id) ON DELETE CASCADE,
  prompt_id TEXT REFERENCES image_prompts(id) ON DELETE SET NULL,
  asset_id TEXT REFERENCES assets(id) ON DELETE SET NULL,
  provider TEXT NOT NULL,
  model TEXT,
  status TEXT NOT NULL DEFAULT 'queued' CHECK (status IN ('queued', 'generating', 'ready', 'failed', 'rejected')),
  is_selected INTEGER NOT NULL DEFAULT 0 CHECK (is_selected IN (0, 1)),
  attribution_text TEXT,
  license_code TEXT,
  source_url TEXT,
  error_code TEXT,
  error_message TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
) STRICT;

CREATE INDEX image_candidates_scene_created_idx ON image_candidates (scene_id, created_at);
CREATE UNIQUE INDEX image_candidates_selected_scene_idx
  ON image_candidates (scene_id)
  WHERE is_selected = 1;
