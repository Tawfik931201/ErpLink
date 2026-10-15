-- =============================================================
-- Migration: per-store mapping settings (multi-store)
-- =============================================================
-- Context: a workspace may now link SEVERAL stores of the same platform.
-- standard_mapping_settings and order_status_mappings were keyed per
-- PLATFORM (workspace, store_type, entity) — every store of one platform
-- shared a single row, so per-store tabs in Mapping Center had nothing
-- distinct to read or write.
--
-- This adds store_id (merchant_id for zid/salla, shop_domain for shopify;
-- '' = the platform-wide default row) and extends the unique keys.
--
-- Semantics (fallback chain, implemented in code):
--   store row (ws, type, store, entity) → platform row (ws, type, '', entity)
--   → engine default. Existing rows keep store_id = '' and therefore stay
--   exactly what they are today: the shared platform defaults every store
--   inherits until its own row is saved.
--
-- Idempotent (IF NOT EXISTS / IF EXISTS throughout).
-- =============================================================

-- 1. standard_mapping_settings → + store_id
ALTER TABLE public.standard_mapping_settings
  ADD COLUMN IF NOT EXISTS store_id TEXT NOT NULL DEFAULT '';

-- Drop the old per-platform unique under EVERY spelling it may exist as
-- (IF EXISTS: misses are harmless no-ops):
--   * dashboard-created rows carry a hand-truncated
--     '..._entity_ty_key' (seen live 2026-10-11);
--   * migration-created rows carry Postgres' own 63-char truncation
--     '..._entity_type_k';
--   * the full 65-char spelling can never exist, listed for completeness.
ALTER TABLE public.standard_mapping_settings
  DROP CONSTRAINT IF EXISTS standard_mapping_settings_workspace_id_store_type_entity_ty_key;

ALTER TABLE public.standard_mapping_settings
  DROP CONSTRAINT IF EXISTS standard_mapping_settings_workspace_id_store_type_entity_type_k;

ALTER TABLE public.standard_mapping_settings
  DROP CONSTRAINT IF EXISTS standard_mapping_settings_workspace_id_store_type_entity_type_key;

ALTER TABLE public.standard_mapping_settings
  DROP CONSTRAINT IF EXISTS standard_mapping_settings_workspace_id_store_type_entity_key;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'uq_standard_mapping_settings_ws_store_entity'
  ) THEN
    ALTER TABLE public.standard_mapping_settings
      ADD CONSTRAINT uq_standard_mapping_settings_ws_store_entity
      UNIQUE (workspace_id, store_type, store_id, entity_type);
  END IF;
END
$$;

CREATE INDEX IF NOT EXISTS idx_standard_mapping_settings_ws_store_id
  ON public.standard_mapping_settings (workspace_id, store_type, store_id);

-- 2. order_status_mappings → + store_id
ALTER TABLE public.order_status_mappings
  ADD COLUMN IF NOT EXISTS store_id TEXT NOT NULL DEFAULT '';

ALTER TABLE public.order_status_mappings
  DROP CONSTRAINT IF EXISTS order_status_mappings_workspace_id_platform_zid_status_key;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'uq_order_status_mappings_ws_platform_store_status'
  ) THEN
    ALTER TABLE public.order_status_mappings
      ADD CONSTRAINT uq_order_status_mappings_ws_platform_store_status
      UNIQUE (workspace_id, platform, store_id, zid_status);
  END IF;
END
$$;

CREATE INDEX IF NOT EXISTS idx_order_status_mappings_ws_platform_store
  ON public.order_status_mappings (workspace_id, platform, store_id);

-- Verification (read-only): the new columns exist and old rows kept ''.
-- SELECT column_name, data_type FROM information_schema.columns
--  WHERE table_name IN ('standard_mapping_settings', 'order_status_mappings')
--    AND column_name = 'store_id';
-- SELECT store_type, store_id, count(*) FROM public.standard_mapping_settings
--  GROUP BY 1, 2 ORDER BY 1, 2;
