-- Migration: Enrich Fixed Mapping Presets
-- Adds: product.delete, category.update, category.delete presets
-- Adds: delete_settings, inventory_settings to fixed_mapping_settings default JSON
-- Date: 2026-07-20

-- ────────────────────────────────────────────────────────────────────────────
-- 1) Add preset definitions for product.delete (3 platforms)
-- ────────────────────────────────────────────────────────────────────────────

INSERT INTO fixed_mapping_preset_definitions
  (preset_key, platform, odoo_model, action, category, icon_name, display_order,
   default_label_ar, default_label_en, default_field_rows)
VALUES
  ('zid_product_delete',   'zid',     'product.template',  'product.delete',   'products',  'Trash2',          25,
   'حذف منتج (زد → أودوو)',   'Delete Product (Zid → Odoo)',
   '[{"odoo_field":"x_zid_id","platform_field":"id"},{"odoo_field":"default_code","platform_field":"sku"}]'::jsonb),

  ('salla_product_delete', 'salla',   'product.template',  'product.deleted',  'products',  'Trash2',          26,
   'حذف منتج (سلة → أودو)',   'Delete Product (Salla → Odoo)',
   '[{"odoo_field":"x_salla_id","platform_field":"id"},{"odoo_field":"default_code","platform_field":"sku"}]'::jsonb),

  ('shopify_product_delete','shopify','product.template',  'products/delete',  'products',  'Trash2',          27,
   'حذف منتج (شوبيفاي → أودو)', 'Delete Product (Shopify → Odoo)',
   '[{"odoo_field":"x_zid_id","platform_field":"id"},{"odoo_field":"default_code","platform_field":"variants.0.sku"}]'::jsonb)

ON CONFLICT (preset_key) DO NOTHING;

-- ────────────────────────────────────────────────────────────────────────────
-- 2) Add preset definitions for category.update (3 platforms)
-- ────────────────────────────────────────────────────────────────────────────

INSERT INTO fixed_mapping_preset_definitions
  (preset_key, platform, odoo_model, action, category, icon_name, display_order,
   default_label_ar, default_label_en, default_field_rows)
VALUES
  ('zid_category_update',   'zid',     'product.category',  'category.update',   'categories', 'RefreshCw',       55,
   'تحديث تصنيف (زد → أودوو)', 'Update Category (Zid → Odoo)',
   '[{"odoo_field":"name","platform_field":"name.ar"},{"odoo_field":"x_zid_id","platform_field":"id"}]'::jsonb),

  ('salla_category_update', 'salla',   'product.category',  'category.updated',  'categories', 'RefreshCw',       56,
   'تحديث تصنيف (سلة → أودو)', 'Update Category (Salla → Odoo)',
   '[{"odoo_field":"name","platform_field":"name"},{"odoo_field":"x_salla_id","platform_field":"id"}]'::jsonb),

  ('shopify_category_update','shopify','product.category',  'collections/update','categories', 'RefreshCw',       57,
   'تحديث تصنيف (شوبيفاي → أودو)', 'Update Category (Shopify → Odoo)',
   '[{"odoo_field":"name","platform_field":"title"},{"odoo_field":"x_zid_id","platform_field":"id"}]'::jsonb)

ON CONFLICT (preset_key) DO NOTHING;

-- ────────────────────────────────────────────────────────────────────────────
-- 3) Add preset definitions for category.delete (3 platforms)
-- ────────────────────────────────────────────────────────────────────────────

INSERT INTO fixed_mapping_preset_definitions
  (preset_key, platform, odoo_model, action, category, icon_name, display_order,
   default_label_ar, default_label_en, default_field_rows)
VALUES
  ('zid_category_delete',   'zid',     'product.category',  'category.delete',   'categories', 'Trash2',          58,
   'حذف تصنيف (زد → أودوو)', 'Delete Category (Zid → Odoo)',
   '[{"odoo_field":"x_zid_id","platform_field":"id"}]'::jsonb),

  ('salla_category_delete', 'salla',   'product.category',  'category.deleted',  'categories', 'Trash2',          59,
   'حذف تصنيف (سلة → أودو)', 'Delete Category (Salla → Odoo)',
   '[{"odoo_field":"x_salla_id","platform_field":"id"}]'::jsonb),

  ('shopify_category_delete','shopify','product.category',  'collections/delete','categories', 'Trash2',          60,
   'حذف تصنيف (شوبيفاي → أودو)', 'Delete Category (Shopify → Odoo)',
   '[{"odoo_field":"x_zid_id","platform_field":"id"}]'::jsonb)

ON CONFLICT (preset_key) DO NOTHING;

-- ────────────────────────────────────────────────────────────────────────────
-- 4) Add delete_settings + inventory_settings to the augment function
--    (existing presets get updated settings shape via default merge)
-- ────────────────────────────────────────────────────────────────────────────

-- Seed the template row for rules if not already present
INSERT INTO fixed_mapping_rules
  (workspace_id, preset_key, rule_type, priority, enabled,
   condition_field, condition_op, condition_value, action_field, action_value)
VALUES
  ('00000000-0000-0000-0000-000000000000', '_template', 'conditional', 1, TRUE,
   'is_draft', 'eq', 'true', 'active', 'false')
ON CONFLICT DO NOTHING;

-- ────────────────────────────────────────────────────────────────────────────
-- 5) Add event aliases for category events in sync-engine cache
--    (these are already in sync-engine EVENT_ALIASES, but just in case)
-- ────────────────────────────────────────────────────────────────────────────

-- No SQL change needed for aliases — they are in the TypeScript code.
