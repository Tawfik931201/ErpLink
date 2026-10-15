-- =============================================================
-- Migration: one row per (workspace, store) — exact-dupe cleanup + unique index
-- =============================================================
-- Context: a workspace may now link SEVERAL stores of the same platform
-- (multi-store). What must never exist is the SAME store twice for one
-- workspace (race double-callback). The tables are unique on merchant_id /
-- shop_domain globally, but not on (workspace_id, store) — this adds that.
--
-- Step 1 deletes exact duplicates (same workspace + same merchant/shop),
-- keeping the most recently updated row. Step 2 adds the unique indexes.
-- Different stores of one workspace are NOT touched.
--
-- Idempotent (IF NOT EXISTS + keep-newest delete). NULL-workspace (orphan)
-- rows are never matched to each other by either step.
-- =============================================================

-- 1a. Exact dupes: merchant_tokens (workspace_id, merchant_id)
DELETE FROM public.merchant_tokens a
USING public.merchant_tokens b
WHERE a.workspace_id IS NOT NULL
  AND a.workspace_id = b.workspace_id
  AND a.merchant_id IS NOT DISTINCT FROM b.merchant_id
  AND (a.updated_at, a.ctid) < (b.updated_at, b.ctid);

-- 1b. Exact dupes: salla_tokens (workspace_id, merchant_id)
DELETE FROM public.salla_tokens a
USING public.salla_tokens b
WHERE a.workspace_id IS NOT NULL
  AND a.workspace_id = b.workspace_id
  AND a.merchant_id IS NOT DISTINCT FROM b.merchant_id
  AND (a.updated_at, a.ctid) < (b.updated_at, b.ctid);

-- 1c. Exact dupes: shopify_tokens (workspace_id, shop_domain)
DELETE FROM public.shopify_tokens a
USING public.shopify_tokens b
WHERE a.workspace_id IS NOT NULL
  AND a.workspace_id = b.workspace_id
  AND a.shop_domain IS NOT DISTINCT FROM b.shop_domain
  AND (a.updated_at, a.ctid) < (b.updated_at, b.ctid);

-- 2. Unique indexes (Postgres treats NULLs as distinct, so orphans are safe)
CREATE UNIQUE INDEX IF NOT EXISTS uq_merchant_tokens_workspace_merchant
  ON public.merchant_tokens (workspace_id, merchant_id);
CREATE UNIQUE INDEX IF NOT EXISTS uq_salla_tokens_workspace_merchant
  ON public.salla_tokens (workspace_id, merchant_id);
CREATE UNIQUE INDEX IF NOT EXISTS uq_shopify_tokens_workspace_shop
  ON public.shopify_tokens (workspace_id, shop_domain);

-- Verification (read-only): all three must return zero rows after apply.
-- SELECT workspace_id, merchant_id, count(*) FROM public.merchant_tokens
--  WHERE workspace_id IS NOT NULL GROUP BY 1, 2 HAVING count(*) > 1;
-- SELECT workspace_id, merchant_id, count(*) FROM public.salla_tokens
--  WHERE workspace_id IS NOT NULL GROUP BY 1, 2 HAVING count(*) > 1;
-- SELECT workspace_id, shop_domain, count(*) FROM public.shopify_tokens
--  WHERE workspace_id IS NOT NULL GROUP BY 1, 2 HAVING count(*) > 1;
