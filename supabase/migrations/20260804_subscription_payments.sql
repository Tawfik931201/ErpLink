-- =============================================================
-- Migration: Subscription payments (multiple payments per subscription)
-- =============================================================
-- A subscription can be paid in multiple installments (e.g. the client
-- pays for a smaller package, then upgrades and pays the difference).
-- `subscription_payments` stores each payment; `subscriptions.amount_paid`
-- remains the running total.
-- Backfills one payment row per existing subscription from amount_paid.
-- =============================================================

-- 1. subscription_payments
CREATE TABLE IF NOT EXISTS subscription_payments (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  subscription_id UUID NOT NULL REFERENCES subscriptions(id) ON DELETE CASCADE,
  amount          NUMERIC(12,2) NOT NULL CHECK (amount >= 0),
  currency        TEXT NOT NULL DEFAULT 'USD',
  paid_at         DATE NOT NULL DEFAULT CURRENT_DATE,
  notes           TEXT,
  created_by      TEXT,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_subscription_payments_subscription ON subscription_payments(subscription_id);

-- 2. Backfill: one payment row per existing subscription (idempotent)
INSERT INTO subscription_payments (subscription_id, amount, currency, paid_at, notes, created_by, created_at)
SELECT s.id, s.amount_paid, s.currency, s.start_date, 'دفعة تلقائية من إنشاء الاشتراك', s.created_by, s.created_at
FROM subscriptions s
WHERE s.amount_paid > 0
  AND NOT EXISTS (
    SELECT 1 FROM subscription_payments sp WHERE sp.subscription_id = s.id
  );

-- 3. Row Level Security
ALTER TABLE subscription_payments ENABLE ROW LEVEL SECURITY;

-- Admin gets full access
DROP POLICY IF EXISTS "subscription_payments_admin_all" ON subscription_payments;
CREATE POLICY "subscription_payments_admin_all" ON subscription_payments
  FOR ALL USING (
    coalesce(current_setting('request.jwt.claims', true)::json->>'app_role','') = 'admin'
  ) WITH CHECK (
    coalesce(current_setting('request.jwt.claims', true)::json->>'app_role','') = 'admin'
  );

-- Workspace owner can read payments of their subscriptions
DROP POLICY IF EXISTS "subscription_payments_owner_read" ON subscription_payments;
CREATE POLICY "subscription_payments_owner_read" ON subscription_payments
  FOR SELECT USING (
    subscription_id IN (
      SELECT id FROM subscriptions WHERE user_id = auth.uid()::text
    )
  );
