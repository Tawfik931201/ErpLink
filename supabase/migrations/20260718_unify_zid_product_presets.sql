-- Migration: Unify zid_product_create/update/delete into a single product preset
-- Merges create, update, and delete into one unified "Products (Zid → Odoo)" preset
-- Removes zid_product_update and zid_product_delete definitions and data
-- Date: 2026-07-18

-- ════════════════════════════════════════════════════════════════════════════
-- 1) Update zid_product_create → unified product preset
--    Renamed from "Create Product" → "Products" to cover all operations
--    Added identification fields (x_zid_id, default_code) needed for delete/update
-- ════════════════════════════════════════════════════════════════════════════

UPDATE fixed_mapping_preset_definitions
SET
  default_label_ar   = 'منتجات (زد → أودوو)',
  default_label_en   = 'Products (Zid → Odoo)',
  default_field_rows = '[
    {"odoo_field":"default_code","platform_field":"sku"},
    {"odoo_field":"barcode","platform_field":"barcode"},
    {"odoo_field":"list_price","platform_field":"price"},
    {"odoo_field":"standard_price","platform_field":"cost"},
    {"odoo_field":"weight","platform_field":"weight.value"},
    {"odoo_field":"categ_id","platform_field":"categories"},
    {"odoo_field":"image_1920","platform_field":"images"},
    {"odoo_field":"product_variant_ids","platform_field":"variants"},
    {"odoo_field":"attribute_line_ids","platform_field":"attributes"},
    {"odoo_field":"taxes_id","platform_field":"is_taxable"},
    {"odoo_field":"x_zid_id","platform_field":"id"},
    {"odoo_field":"name","platform_field":"name.ar"},
    {"odoo_field":"description_sale","platform_field":"description.ar"},
    {"odoo_field":"active","platform_field":"is_published"}
  ]'::jsonb
WHERE preset_key = 'zid_product_create';

-- ════════════════════════════════════════════════════════════════════════════
-- 2) Remove zid_product_update from definitions (merged into unified preset)
-- ════════════════════════════════════════════════════════════════════════════

DELETE FROM fixed_mapping_preset_definitions
WHERE preset_key = 'zid_product_update';

-- ════════════════════════════════════════════════════════════════════════════
-- 3) Remove zid_product_delete from definitions (merged into unified preset)
-- ════════════════════════════════════════════════════════════════════════════

DELETE FROM fixed_mapping_preset_definitions
WHERE preset_key = 'zid_product_delete';

-- ════════════════════════════════════════════════════════════════════════════
-- 4) Clean up existing workspace data
-- ════════════════════════════════════════════════════════════════════════════

-- 4a) Delete zid_product_update rows from workspaces
DELETE FROM fixed_mappings
WHERE preset_key = 'zid_product_update';

-- 4b) Delete zid_product_delete rows from workspaces
DELETE FROM fixed_mappings
WHERE preset_key = 'zid_product_delete';

-- 4c) Update existing zid_product_create workspaces with new label + field rows
UPDATE fixed_mappings
SET
  label      = 'Products (Zid → Odoo)',
  icon_name  = 'Package',
  field_rows = '[
    {"odoo_field":"default_code","platform_field":"sku"},
    {"odoo_field":"barcode","platform_field":"barcode"},
    {"odoo_field":"list_price","platform_field":"price"},
    {"odoo_field":"standard_price","platform_field":"cost"},
    {"odoo_field":"weight","platform_field":"weight.value"},
    {"odoo_field":"categ_id","platform_field":"categories"},
    {"odoo_field":"image_1920","platform_field":"images"},
    {"odoo_field":"product_variant_ids","platform_field":"variants"},
    {"odoo_field":"attribute_line_ids","platform_field":"attributes"},
    {"odoo_field":"taxes_id","platform_field":"is_taxable"},
    {"odoo_field":"x_zid_id","platform_field":"id"},
    {"odoo_field":"name","platform_field":"name.ar"},
    {"odoo_field":"description_sale","platform_field":"description.ar"},
    {"odoo_field":"active","platform_field":"is_published"}
  ]'::jsonb,
  updated_at = now()
WHERE preset_key = 'zid_product_create';

-- 4d) Remove orphaned settings for deleted presets
DELETE FROM fixed_mapping_settings
WHERE preset_key IN ('zid_product_update', 'zid_product_delete');

-- 4e) Remove orphaned rules for deleted presets
DELETE FROM fixed_mapping_rules
WHERE preset_key IN ('zid_product_update', 'zid_product_delete');
