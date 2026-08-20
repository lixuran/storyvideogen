CREATE TABLE plans (
  code TEXT PRIMARY KEY,
  display_name TEXT NOT NULL,
  is_active INTEGER NOT NULL DEFAULT 1 CHECK (is_active IN (0, 1)),
  price_fen INTEGER NOT NULL CHECK (price_fen >= 0),
  period_days INTEGER NOT NULL CHECK (period_days > 0),
  quota_json TEXT NOT NULL CHECK (json_valid(quota_json)),
  sort_order INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
) STRICT;

CREATE INDEX plans_active_sort_idx ON plans (is_active, sort_order, code);

CREATE TABLE payment_orders (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  plan_code TEXT NOT NULL REFERENCES plans(code) ON DELETE RESTRICT,
  merchant_order_no TEXT NOT NULL UNIQUE,
  amount_fen INTEGER NOT NULL CHECK (amount_fen >= 0),
  state TEXT NOT NULL DEFAULT 'pending' CHECK (state IN ('pending', 'paid', 'failed', 'expired', 'closed', 'refunded')),
  code_url TEXT,
  code_url_expires_at TEXT,
  wechat_transaction_id TEXT UNIQUE,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  paid_at TEXT,
  closed_at TEXT
) STRICT;

CREATE INDEX payment_orders_user_created_idx ON payment_orders (user_id, created_at DESC);
CREATE INDEX payment_orders_state_expiry_idx ON payment_orders (state, code_url_expires_at);

CREATE TABLE payment_events (
  notification_id TEXT PRIMARY KEY,
  order_id TEXT NOT NULL REFERENCES payment_orders(id) ON DELETE CASCADE,
  event_type TEXT NOT NULL,
  processing_state TEXT NOT NULL DEFAULT 'received' CHECK (processing_state IN ('received', 'processed', 'ignored', 'failed')),
  safe_metadata_json TEXT NOT NULL DEFAULT '{}' CHECK (json_valid(safe_metadata_json)),
  received_at TEXT NOT NULL,
  processed_at TEXT,
  error_code TEXT
) STRICT;

CREATE INDEX payment_events_order_received_idx ON payment_events (order_id, received_at DESC);

CREATE TABLE subscriptions (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  plan_code TEXT NOT NULL REFERENCES plans(code) ON DELETE RESTRICT,
  state TEXT NOT NULL CHECK (state IN ('pending', 'active', 'expired', 'cancelled')),
  period_start TEXT NOT NULL,
  period_end TEXT NOT NULL,
  originating_order_id TEXT REFERENCES payment_orders(id) ON DELETE RESTRICT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  CHECK (period_end > period_start)
) STRICT;

CREATE UNIQUE INDEX subscriptions_active_user_idx
  ON subscriptions (user_id)
  WHERE state = 'active';
CREATE INDEX subscriptions_state_expiry_idx ON subscriptions (state, period_end);

CREATE TABLE usage_ledger (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  subscription_id TEXT REFERENCES subscriptions(id) ON DELETE SET NULL,
  unit_type TEXT NOT NULL,
  quantity INTEGER NOT NULL CHECK (quantity > 0),
  story_id TEXT REFERENCES stories(id) ON DELETE SET NULL,
  job_id TEXT REFERENCES jobs(id) ON DELETE SET NULL,
  created_at TEXT NOT NULL
) STRICT;

CREATE INDEX usage_ledger_user_unit_created_idx ON usage_ledger (user_id, unit_type, created_at DESC);
CREATE INDEX usage_ledger_subscription_created_idx ON usage_ledger (subscription_id, created_at DESC);
