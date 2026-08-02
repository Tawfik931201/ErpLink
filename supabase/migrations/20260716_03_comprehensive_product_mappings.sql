-- Migration: Clean official-Odoo-field-only mapping for zid_product_create
-- Replaces bloated _zid_* custom fields with ONLY standard Odoo product.template fields.

-- ────────────────────────────────────────────────────────────────────────────
-- 1) Update the zid_product_create definition with official Odoo fields only
-- ────────────────────────────────────────────────────────────────────────────

INSERT INTO fixed_mapping_preset_definitions
  (preset_key, platform, odoo_model, action, category, icon_name, display_order,
   default_label_ar, default_label_en, default_field_rows)
VALUES
  ('zid_product_create', 'zid', 'product.template', 'product.create',
   'products', 'Package', 10,
   'إنشاء منتج (زد → أودوو)', 'Create Product (Zid → Odoo)',
   '[
      {"odoo_field":"name","platform_field":"name.ar"},
      {"odoo_field":"default_code","platform_field":"sku"},
      {"odoo_field":"barcode","platform_field":"barcode"},
      {"odoo_field":"list_price","platform_field":"price"},
      {"odoo_field":"standard_price","platform_field":"cost"},
      {"odoo_field":"description_sale","platform_field":"description.ar"},
      {"odoo_field":"weight","platform_field":"weight.value"},
      {"odoo_field":"categ_id","platform_field":"categories"},
      {"odoo_field":"image_1920","platform_field":"images"},
      {"odoo_field":"product_variant_ids","platform_field":"variants"},
      {"odoo_field":"attribute_line_ids","platform_field":"attributes"},
      {"odoo_field":"taxes_id","platform_field":"is_taxable"}
    ]'::jsonb)
ON CONFLICT (preset_key) DO UPDATE SET
  default_field_rows = EXCLUDED.default_field_rows,
  default_label_ar   = EXCLUDED.default_label_ar,
  default_label_en   = EXCLUDED.default_label_en;

-- ────────────────────────────────────────────────────────────────────────────
-- Also update zid_product_update with the clean mapping for consistency
-- ────────────────────────────────────────────────────────────────────────────

INSERT INTO fixed_mapping_preset_definitions
  (preset_key, platform, odoo_model, action, category, icon_name, display_order,
   default_label_ar, default_label_en, default_field_rows)
VALUES
  ('zid_product_update', 'zid', 'product.template', 'product.update',
   'products', 'RefreshCw', 20,
   'تحديث منتج (زد → أودوو)', 'Update Product (Zid → Odoo)',
   '[
      {"odoo_field":"name","platform_field":"name.ar"},
      {"odoo_field":"default_code","platform_field":"sku"},
      {"odoo_field":"barcode","platform_field":"barcode"},
      {"odoo_field":"list_price","platform_field":"price"},
      {"odoo_field":"standard_price","platform_field":"cost"},
      {"odoo_field":"description_sale","platform_field":"description.ar"},
      {"odoo_field":"weight","platform_field":"weight.value"},
      {"odoo_field":"categ_id","platform_field":"categories"},
      {"odoo_field":"image_1920","platform_field":"images"},
      {"odoo_field":"product_variant_ids","platform_field":"variants"},
      {"odoo_field":"attribute_line_ids","platform_field":"attributes"},
      {"odoo_field":"taxes_id","platform_field":"is_taxable"}
    ]'::jsonb)
ON CONFLICT (preset_key) DO UPDATE SET
  default_field_rows = EXCLUDED.default_field_rows;

-- ────────────────────────────────────────────────────────────────────────────
-- 2) Augment existing workspaces with the new field rows
-- ────────────────────────────────────────────────────────────────────────────

DO $$
DECLARE
  v_workspace RECORD;
  v_count INTEGER := 0;
BEGIN
  FOR v_workspace IN
    SELECT DISTINCT workspace_id FROM fixed_mappings
    WHERE preset_key IN ('zid_product_create', 'zid_product_update')
  LOOP
    v_count := v_count + augment_fixed_mapping_presets(v_workspace.workspace_id);
  END LOOP;
  RAISE NOTICE 'Augmented % new field rows across workspaces', v_count;
END;
$$;
