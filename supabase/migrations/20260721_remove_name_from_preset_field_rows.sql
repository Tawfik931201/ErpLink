-- Migration: Remove `name` from preset field_rows (name is now controlled by Settings only)
-- Date: 2026-07-21
--
-- Both `name` and `description_sale` are now handled by the Name & Description settings
-- in the Settings tab, so they no longer need to be in the field_rows.

-- ────────────────────────────────────────────────────────────────────────────
-- 1) Update preset definitions to remove name and description_sale
-- ────────────────────────────────────────────────────────────────────────────

UPDATE fixed_mapping_preset_definitions
SET default_field_rows = (
  SELECT jsonb_agg(elem)
  FROM jsonb_array_elements(default_field_rows) AS elem
  WHERE elem->>'odoo_field' NOT IN ('name', 'description_sale')
),
    updated_at = now()
WHERE preset_key IN ('zid_product_create', 'zid_product_update',
                     'salla_product_create', 'salla_product_update',
                     'shopify_product_create', 'shopify_product_update');

-- ────────────────────────────────────────────────────────────────────────────
-- 2) Update existing workspace preset rows to remove name and description_sale
-- ────────────────────────────────────────────────────────────────────────────

UPDATE fixed_mappings
SET field_rows = (
  SELECT jsonb_agg(elem)
  FROM jsonb_array_elements(field_rows) AS elem
  WHERE elem->>'odoo_field' NOT IN ('name', 'description_sale')
),
    updated_at = now()
WHERE preset_key IN ('zid_product_create', 'zid_product_update',
                     'salla_product_create', 'salla_product_update',
                     'shopify_product_create', 'shopify_product_update');

