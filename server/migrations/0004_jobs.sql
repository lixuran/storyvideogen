CREATE TABLE jobs (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  story_id TEXT REFERENCES stories(id) ON DELETE CASCADE,
  type TEXT NOT NULL CHECK (type IN ('plan_story', 'generate_images', 'generate_audio', 'render_video', 'import_legacy')),
  state TEXT NOT NULL DEFAULT 'queued' CHECK (state IN ('queued', 'running', 'cancel_requested', 'succeeded', 'failed', 'cancelled')),
  progress INTEGER NOT NULL DEFAULT 0 CHECK (progress BETWEEN 0 AND 10000),
  attempt INTEGER NOT NULL DEFAULT 0 CHECK (attempt >= 0),
  max_attempts INTEGER NOT NULL DEFAULT 3 CHECK (max_attempts > 0),
  lease_owner TEXT,
  lease_expires_at TEXT,
  idempotency_key TEXT,
  payload_json TEXT NOT NULL DEFAULT '{}' CHECK (json_valid(payload_json)),
  result_json TEXT CHECK (result_json IS NULL OR json_valid(result_json)),
  error_code TEXT,
  error_message TEXT,
  run_after TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  started_at TEXT,
  completed_at TEXT
) STRICT;

CREATE UNIQUE INDEX jobs_user_idempotency_idx
  ON jobs (user_id, idempotency_key)
  WHERE idempotency_key IS NOT NULL;
CREATE INDEX jobs_claim_idx ON jobs (state, run_after, lease_expires_at, created_at);
CREATE INDEX jobs_story_created_idx ON jobs (story_id, created_at DESC);
CREATE INDEX jobs_user_state_idx ON jobs (user_id, state, updated_at DESC);

CREATE TABLE job_events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  job_id TEXT NOT NULL REFERENCES jobs(id) ON DELETE CASCADE,
  event_type TEXT NOT NULL,
  payload_json TEXT NOT NULL DEFAULT '{}' CHECK (json_valid(payload_json)),
  created_at TEXT NOT NULL
) STRICT;

CREATE INDEX job_events_job_id_idx ON job_events (job_id, id);
