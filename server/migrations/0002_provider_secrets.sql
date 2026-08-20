CREATE TABLE provider_secrets (
  id TEXT PRIMARY KEY,
  scope TEXT NOT NULL CHECK (scope IN ('user', 'platform')),
  user_id TEXT REFERENCES users(id) ON DELETE CASCADE,
  provider TEXT NOT NULL,
  encrypted_value BLOB NOT NULL,
  nonce BLOB NOT NULL,
  auth_tag BLOB NOT NULL,
  encryption_key_id TEXT NOT NULL,
  last_four TEXT NOT NULL CHECK (length(last_four) <= 4),
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'disabled', 'error')),
  text_test_status TEXT NOT NULL DEFAULT 'untested' CHECK (text_test_status IN ('untested', 'testing', 'available', 'unavailable')),
  image_test_status TEXT NOT NULL DEFAULT 'untested' CHECK (image_test_status IN ('untested', 'testing', 'available', 'unavailable')),
  last_tested_at TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  CHECK (
    (scope = 'user' AND user_id IS NOT NULL)
    OR (scope = 'platform' AND user_id IS NULL)
  )
) STRICT;

CREATE UNIQUE INDEX provider_secrets_user_provider_idx
  ON provider_secrets (user_id, provider)
  WHERE scope = 'user';
CREATE UNIQUE INDEX provider_secrets_platform_provider_idx
  ON provider_secrets (provider)
  WHERE scope = 'platform';
CREATE INDEX provider_secrets_status_idx ON provider_secrets (status, updated_at DESC);
