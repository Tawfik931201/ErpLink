-- Migration: Clean zid_product_create / zid_product_update mappings
-- Removes ALL custom _zid_* / x_* fields.
-- Keeps ONLY official Odoo product.template fields.
-- Date: 2026-07-16
--
-- Usage:
--   1) Copy this entire file.
--   2) Paste into Supabase SQL Editor.
--   3) Run.

-- ════════════════════════════════════════════════════════════════════════════
-- 1) Update preset definitions (source of truth for new workspaces)
-- ════════════════════════════════════════════════════════════════════════════

UPDATE fixed_mapping_preset_definitions
SET default_field_rows = '[
  {"odoo_field":"name","platform_field":"name.ar"},
  {"odoo_field":"default_code","platform_field":"sku"},
  {"odoo_field":"barcode","platform_field":"barcode"},
  {"odoo_field":"list_price","platform_field":"price"},
  {"odoo_field":"standard_price","platform_field":"cost"},
  {"odoo_field":"description_sale","platform_field":"description.ar"},
  {"odoo_field":"weight","platform_field":"weight.value"},
  {"odoo_field":"categ_id","platform_field":"categories"},
  {"odoo_field":"image_1920","platform_field":"images"}
]'::jsonb,
  default_label_ar   = 'إنشاء منتج (زد → أودوو)',
  default_label_en   = 'Create Product (Zid → Odoo)'
WHERE preset_key = 'zid_product_create';

UPDATE fixed_mapping_preset_definitions
SET default_field_rows = '[
  {"odoo_field":"name","platform_field":"name.ar"},
  {"odoo_field":"default_code","platform_field":"sku"},
  {"odoo_field":"barcode","platform_field":"barcode"},
  {"odoo_field":"list_price","platform_field":"price"},
  {"odoo_field":"standard_price","platform_field":"cost"},
  {"odoo_field":"description_sale","platform_field":"description.ar"},
  {"odoo_field":"weight","platform_field":"weight.value"},
  {"odoo_field":"categ_id","platform_field":"categories"},
  {"odoo_field":"image_1920","platform_field":"images"}
]'::jsonb,
  default_label_ar   = 'تحديث منتج (زد → أودوو)',
  default_label_en   = 'Update Product (Zid → Odoo)'
WHERE preset_key = 'zid_product_update';

-- ════════════════════════════════════════════════════════════════════════════
-- 2) Rewrite field_rows for every existing workspace preset.
--    Keeps only rows present in the new definition + inserts missing ones.
-- ════════════════════════════════════════════════════════════════════════════

DO $$
DECLARE
  v_preset   RECORD;
  v_ws_id    UUID;
  v_new_rows JSONB;
  v_count    INT := 0;
BEGIN
  FOR v_preset IN
    SELECT preset_key, default_field_rows
    FROM fixed_mapping_preset_definitions
    WHERE preset_key IN ('zid_product_create', 'zid_product_update')
  LOOP
    v_new_rows := v_preset.default_field_rows;

    FOR v_ws_id IN
      SELECT DISTINCT workspace_id
      FROM fixed_mappings
      WHERE preset_key = v_preset.preset_key
    LOOP
      -- Replace field_rows with only the clean definition
      UPDATE fixed_mappings
      SET field_rows  = v_new_rows,
          updated_at  = now()
      WHERE workspace_id = v_ws_id
        AND preset_key   = v_preset.preset_key;

      v_count := v_count + 1;
    END LOOP;
  END LOOP;

  RAISE NOTICE 'Cleaned field_rows for % preset groups (zid_product_create + zid_product_update)', v_count;
END;
$$;


