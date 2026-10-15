-- =============================================================
-- Migration: per-item mappings scoped per store (multi-store)
-- =============================================================
-- Context: product_mappings / category_mappings were keyed per PLATFORM
-- (workspace, platform, source id/name). Two stores of one platform share
-- product ids and category names, so store B's rows overwrote store A's —
-- or the engine resolved one store's product into the other's Odoo record.
--
-- This adds store_id (merchant_id for zid/salla, shop_domain for shopify;
-- '' = legacy platform-wide rows) and extends the unique keys. Existing
-- rows keep store_id = '' and behave exactly as before (platform-wide
-- fallback) until re-saved per store.
--
-- Idempotent (IF NOT EXISTS / IF EXISTS throughout).
-- =============================================================

-- 1. product_mappings → + store_id
ALTER TABLE public.product_mappings
  ADD COLUMN IF NOT EXISTS store_id TEXT NOT NULL DEFAULT '';

ALTER TABLE public.product_mappings
  DROP CONSTRAINT IF EXISTS product_mappings_workspace_id_platform_source_product_id_key;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'uq_product_mappings_ws_platform_store_source'
  ) THEN
    ALTER TABLE public.product_mappings
      ADD CONSTRAINT uq_product_mappings_ws_platform_store_source
      UNIQUE (workspace_id, platform, store_id, source_product_id);
  END IF;
END
$$;

CREATE INDEX IF NOT EXISTS idx_product_mappings_ws_platform_store
  ON public.product_mappings (workspace_id, platform, store_id);

-- 2. category_mappings → + store_id
ALTER TABLE public.category_mappings
  ADD COLUMN IF NOT EXISTS store_id TEXT NOT NULL DEFAULT '';

-- NOTE: the migration-spelled 64-char name is truncated by Postgres to 63
-- chars (trailing 'y' dropped); dashboard-created tables may carry yet other
-- hand-truncated spellings. All IF EXISTS drops below are harmless no-ops
-- when the name is absent.
ALTER TABLE public.category_mappings
  DROP CONSTRAINT IF EXISTS category_mappings_workspace_id_platform_source_category_name_ke;

ALTER TABLE public.category_mappings
  DROP CONSTRAINT IF EXISTS category_mappings_workspace_id_platform_source_category_name_key;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'uq_category_mappings_ws_platform_store_name'
  ) THEN
    ALTER TABLE public.category_mappings
      ADD CONSTRAINT uq_category_mappings_ws_platform_store_name
      UNIQUE (workspace_id, platform, store_id, source_category_name);
  END IF;
END
$$;

CREATE INDEX IF NOT EXISTS idx_category_mappings_ws_platform_store
  ON public.category_mappings (workspace_id, platform, store_id);

-- Verification (read-only): the new columns exist.
-- SELECT column_name, data_type FROM information_schema.columns
--  WHERE table_name IN ('product_mappings', 'category_mappings')
--    AND column_name = 'store_id';
