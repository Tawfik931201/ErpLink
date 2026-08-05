-- Client phone + subscription archiving (soft-hide old workspace subscriptions)
-- Run via the admin "Install schema" button or directly in the SQL editor.

ALTER TABLE users ADD COLUMN IF NOT EXISTS phone TEXT;

ALTER TABLE subscriptions ADD COLUMN IF NOT EXISTS archived_at TIMESTAMPTZ;
CREATE INDEX IF NOT EXISTS idx_subscriptions_archived_at ON subscriptions (archived_at);
