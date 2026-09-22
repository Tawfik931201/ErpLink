-- Migration: Remove `name` from ORDER preset field_rows (Odoo owns the SO... sequence)
-- Date: 2026-09-21
--
-- sale.order `name` must NEVER be sent (neither on create nor on update).
-- Odoo generates the SO... sequence itself; sending a value overrides the
-- sequence and breaks numbering. The sync engine also strips `name`
-- unconditionally for sale.order (belt and suspenders).
--
-- NOTE: fixed_mapping_preset_definitions is a dead catalog table (nothing reads
-- it — the engine reads fixed_mappings only) and may not exist. Each block is
-- guarded by an existence check so this migration never fails.

-- ────────────────────────────────────────────────────────────────────────────
-- 1) Update preset definitions to remove name for order presets (if table exists)
-- ────────────────────────────────────────────────────────────────────────────

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'fixed_mapping_preset_definitions') THEN
    UPDATE fixed_mapping_preset_definitions
    SET default_field_rows = (
      SELECT jsonb_agg(elem)
      FROM jsonb_array_elements(default_field_rows) AS elem
      WHERE elem->>'odoo_field' <> 'name'
    )
    WHERE preset_key IN ('zid_order_create', 'zid_order_update',
                         'salla_order_create', 'salla_order_update',
                         'shopify_order_create', 'shopify_order_update');
    RAISE NOTICE 'fixed_mapping_preset_definitions cleaned';
  ELSE
    RAISE NOTICE 'table fixed_mapping_preset_definitions does not exist - skipped';
  END IF;
END $$;

-- ────────────────────────────────────────────────────────────────────────────
-- 2) Update existing workspace preset rows to remove name for order presets (if table exists)
-- ────────────────────────────────────────────────────────────────────────────

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'fixed_mappings') THEN
    UPDATE fixed_mappings
    SET field_rows = COALESCE((
      SELECT jsonb_agg(elem)
      FROM jsonb_array_elements(field_rows) AS elem
      WHERE elem->>'odoo_field' <> 'name'
    ), '[]'::jsonb)
    WHERE preset_key IN ('zid_order_create', 'zid_order_update',
                         'salla_order_create', 'salla_order_update',
                         'shopify_order_create', 'shopify_order_update')
      AND field_rows IS NOT NULL;
    RAISE NOTICE 'fixed_mappings order presets cleaned';
  ELSE
    RAISE NOTICE 'table fixed_mappings does not exist - skipped';
  END IF;
END $$;
