-- =============================================================
-- Migration: Subscriptions (manual billing / affiliate attribution)
-- =============================================================
-- Adds the `subscriptions` table used for the manual payment flow:
--   - Admin registers a subscription manually when the client pays
--     (start date = day of transfer, months paid, amount paid).
--   - end_date is computed at registration (calendar months, inclusive).
--   - Each subscription is attributed to the workspace owner (user_id)
--     and optionally to an affiliate (affiliate_id) so commissions can
--     be generated automatically.
--   - `status` only distinguishes cancelled rows; "expired" is derived
--     from end_date < today at read time.
-- All writes go through Server Actions with the service-role key.
-- =============================================================

-- 1. subscriptions
CREATE TABLE IF NOT EXISTS subscriptions (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id  UUID NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  user_id       TEXT NOT NULL,                       -- workspace owner (client)
  affiliate_id  UUID REFERENCES partner_profiles(id) ON DELETE SET NULL,
  start_date    DATE NOT NULL,                       -- day the client paid
  months_paid   INTEGER NOT NULL CHECK (months_paid >= 1),
  end_date      DATE NOT NULL,                       -- start_date + months - 1 day
  amount_paid   NUMERIC(12,2) NOT NULL DEFAULT 0,
  currency      TEXT NOT NULL DEFAULT 'USD',
  status        TEXT NOT NULL DEFAULT 'active'
                  CHECK (status IN ('active','cancelled')),
  notes         TEXT,
  created_by    TEXT,                                -- admin user id
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_subscriptions_workspace   ON subscriptions(workspace_id);
CREATE INDEX IF NOT EXISTS idx_subscriptions_user        ON subscriptions(user_id);
CREATE INDEX IF NOT EXISTS idx_subscriptions_affiliate   ON subscriptions(affiliate_id);
CREATE INDEX IF NOT EXISTS idx_subscriptions_status      ON subscriptions(status);
CREATE INDEX IF NOT EXISTS idx_subscriptions_end_date    ON subscriptions(end_date);

-- FK for user_id → users(id) (enables REST joins for admin listings)
ALTER TABLE subscriptions
  DROP CONSTRAINT IF EXISTS subscriptions_user_id_fkey;
ALTER TABLE subscriptions
  ADD CONSTRAINT subscriptions_user_id_fkey
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE;

-- 2. Row Level Security
ALTER TABLE subscriptions ENABLE ROW LEVEL SECURITY;

-- Owner (client) can read their own subscriptions
DROP POLICY IF EXISTS "subscriptions_owner_read" ON subscriptions;
CREATE POLICY "subscriptions_owner_read" ON subscriptions
  FOR SELECT USING (user_id = auth.uid()::text);

-- Affiliate can read subscriptions attributed to them
DROP POLICY IF EXISTS "subscriptions_affiliate_read" ON subscriptions;
CREATE POLICY "subscriptions_affiliate_read" ON subscriptions
  FOR SELECT USING (
    affiliate_id IN (SELECT id FROM partner_profiles WHERE user_id = auth.uid()::text)
  );

-- Admin gets full access
DROP POLICY IF EXISTS "subscriptions_admin_all" ON subscriptions;
CREATE POLICY "subscriptions_admin_all" ON subscriptions
  FOR ALL USING (
    coalesce(current_setting('request.jwt.claims', true)::json->>'app_role','') = 'admin'
  ) WITH CHECK (
    coalesce(current_setting('request.jwt.claims', true)::json->>'app_role','') = 'admin'
  );
