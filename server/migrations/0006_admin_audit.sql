CREATE TABLE admin_audit_log (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  actor_user_id TEXT NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  action TEXT NOT NULL,
  target_type TEXT NOT NULL,
  target_id TEXT NOT NULL,
  change_metadata_json TEXT NOT NULL DEFAULT '{}' CHECK (json_valid(change_metadata_json)),
  request_id TEXT NOT NULL,
  created_at TEXT NOT NULL
) STRICT;

CREATE INDEX admin_audit_actor_created_idx ON admin_audit_log (actor_user_id, created_at DESC);
CREATE INDEX admin_audit_target_created_idx ON admin_audit_log (target_type, target_id, created_at DESC);
CREATE INDEX admin_audit_created_idx ON admin_audit_log (created_at DESC);
