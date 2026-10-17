-- ═══════════════════════════════════════════════════════════════════════
-- Durable legacy-delivery counters — paste-ready for the Supabase SQL Editor
--
-- Canonical migration (the repo source of truth:
--   supabase/migrations/20261016_legacy_delivery_counters.sql
-- ). Both files behave identically; this one is the paste-ready variant for
-- the live Supabase project, in the same tradition as 20260922's paste-ready
-- file.
--
-- Why it exists: the in-process "Unauthenticated delivery #N" counter resets
-- on every server restart, so the signal that decides when the legacy window
-- can close (STRICT_WEBHOOK_AUTH=true, refusing unsigned deliveries forever)
-- needs a durable home. These counters live in DB per platform (odoo / zid /
-- salla) and are read by the admin via:
--   GET /api/admin/webhook-legacy-status
--
-- Idempotent: CREATE TABLE IF NOT EXISTS + CREATE OR REPLACE FUNCTION.
-- Safe to run again.
-- ═══════════════════════════════════════════════════════════════════════

BEGIN;

-- 1) One row per platform. `platform` is the primary key, so two concurrent
--    increments can never create a second row, and BIGINT cannot overflow.
CREATE TABLE IF NOT EXISTS public.webhook_legacy_counters (
  platform   TEXT        NOT NULL PRIMARY KEY,
  count      BIGINT      NOT NULL DEFAULT 0,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- 2) RLS enabled with no policies: anon/authenticated clients get nothing;
--    service_role (the only caller, from the app) bypasses RLS. The table is
--    server-side state and stays invisible to the public surface.
ALTER TABLE public.webhook_legacy_counters ENABLE ROW LEVEL SECURITY;

-- 3) Atomic increment. REST has no "increment" primitive, so the upsert
--    (INSERT ... ON CONFLICT DO UPDATE) is the whole point: the count is
--    always exact even with concurrent callers. SECURITY DEFINER because the
--    increment runs under service_role regardless of RLS, and search_path is
--    pinned so the function resolves only public.* objects.
CREATE OR REPLACE FUNCTION public.increment_legacy_delivery(p_platform TEXT)
RETURNS BIGINT
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  new_count BIGINT;
BEGIN
  INSERT INTO public.webhook_legacy_counters (platform, count)
  VALUES (p_platform, 1)
  ON CONFLICT (platform)
  DO UPDATE SET
    count = public.webhook_legacy_counters.count + 1,
    updated_at = now();
  SELECT count INTO new_count
  FROM public.webhook_legacy_counters
  WHERE platform = p_platform;
  RETURN new_count;
END;
$$;

-- 4) Execute privilege for service_role only — no other role can call it.
GRANT EXECUTE ON FUNCTION public.increment_legacy_delivery(TEXT) TO service_role;

COMMIT;

-- ═══════════════════════════════════════════════════════════════════════
-- Verification (optional — prints the counter state only)
-- ═══════════════════════════════════════════════════════════════════════
-- How to read the result:
--   * no rows, or count = 0        → no legacy deliveries have arrived.
--   * a live row for a platform    → that platform still has stores whose
--     webhooks were registered before the derived credential exists, so
--     unsigned deliveries keep arriving. Do NOT flip STRICT_WEBHOOK_AUTH
--     for that platform until you run its refresh route
--     (/api/admin/{zid,odoo,salla}-webhooks/refresh) and the counter
--     stops growing during a quiet observation period.
SELECT platform, count, updated_at
FROM public.webhook_legacy_counters
ORDER BY platform;
