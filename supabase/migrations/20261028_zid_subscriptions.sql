-- =============================================================
-- Migration: Zid App Marketplace Subscriptions
-- =============================================================
-- Adds tracking columns to `subscriptions` table for app marketplace webhooks:
--   - zid_subscription_id: unique subscription ID from Zid App Market
--   - plan_name: plan tier name in Zid (e.g. النمو, الاحترافية)
--   - platform: source platform ('zid', 'salla', 'manual')
-- =============================================================

BEGIN;

ALTER TABLE public.subscriptions
  ADD COLUMN IF NOT EXISTS zid_subscription_id TEXT,
  ADD COLUMN IF NOT EXISTS plan_name TEXT,
  ADD COLUMN IF NOT EXISTS platform TEXT DEFAULT 'manual';

CREATE INDEX IF NOT EXISTS idx_subscriptions_zid_sub_id
  ON public.subscriptions (zid_subscription_id);

CREATE INDEX IF NOT EXISTS idx_subscriptions_platform
  ON public.subscriptions (platform);

COMMIT;
