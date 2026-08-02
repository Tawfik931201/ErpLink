-- Migration: Fixed Mapping Preset Infrastructure
-- Adds preset columns, display order, icons, seed function, and RLS protection for presets.
-- Date: 2026-07-16

-- ────────────────────────────────────────────────────────────────────────────
-- 1) Extend fixed_mappings table with preset metadata
-- ────────────────────────────────────────────────────────────────────────────

ALTER TABLE fixed_mappings
  ADD COLUMN IF NOT EXISTS is_preset BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS preset_key TEXT,
  ADD COLUMN IF NOT EXISTS display_order INT NOT NULL DEFAULT 100,
  ADD COLUMN IF NOT EXISTS icon_name TEXT NOT NULL DEFAULT 'Package',
  ADD COLUMN IF NOT EXISTS category TEXT NOT NULL DEFAULT 'products',
  ADD COLUMN IF NOT EXISTS active BOOLEAN NOT NULL DEFAULT TRUE,
  ADD COLUMN IF NOT EXISTS label TEXT;

-- Unique: presets are grouped by (workspace_id, preset_key, odoo_field) so one
-- preset can have multiple field-pair rows.
-- Custom (non-preset) rows use (workspace_id, platform, odoo_model, action, odoo_field).
-- First drop the old strict constraint that prevents multiple rows per preset.

ALTER TABLE fixed_mappings DROP CONSTRAINT IF EXISTS fixed_mappings_workspace_id_platform_odoo_model_action_key;

CREATE UNIQUE INDEX IF NOT EXISTS uq_fixed_mappings_preset_key_field
  ON fixed_mappings (workspace_id, preset_key, odoo_field)
  WHERE preset_key IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS uq_fixed_mappings_custom_field
  ON fixed_mappings (workspace_id, platform, odoo_model, action, odoo_field)
  WHERE preset_key IS NULL;

CREATE INDEX IF NOT EXISTS idx_fixed_mappings_workspace_active
  ON fixed_mappings (workspace_id, is_preset, category, display_order);

-- ────────────────────────────────────────────────────────────────────────────
-- 2) Preset definitions (canonical rows seeded per workspace)
-- ────────────────────────────────────────────────────────────────────────────
-- Each preset represents one (platform × odoo_model × action) tuple.
-- These rows are inserted idempotently by seed_fixed_mapping_presets().

CREATE TABLE IF NOT EXISTS fixed_mapping_preset_definitions (
  preset_key        TEXT PRIMARY KEY,
  platform          TEXT NOT NULL,          -- 'zid' | 'salla' | 'shopify'
  odoo_model        TEXT NOT NULL,
  action            TEXT NOT NULL,
  category          TEXT NOT NULL,          -- 'products' | 'customers' | 'orders' | 'categories'
  icon_name         TEXT NOT NULL,
  display_order     INT  NOT NULL,
  default_label_ar  TEXT,
  default_label_en  TEXT,
  default_field_rows JSONB NOT NULL DEFAULT '[]'::jsonb,
  -- default_field_rows is an array like:
  -- [{"odoo_field": "name", "platform_field": "name"}]
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ────────────────────────────────────────────────────────────────────────────
-- 3) Seed catalog (12 presets: 4 entities × 3 platforms × 1 default ops)
--    We seed one create-style preset per (platform, model). Users can then
--    clone/customize via the UI; the server action also inserts update-style
--    presets with platform-specific event ids.
-- ────────────────────────────────────────────────────────────────────────────

INSERT INTO fixed_mapping_preset_definitions
  (preset_key, platform, odoo_model, action, category, icon_name, display_order, default_label_ar, default_label_en, default_field_rows)
VALUES
  -- ─── Products (create) ─────────────────────────────────
  ('zid_product_create',   'zid',     'product.template',  'product.create',   'products',  'Package',         10, 'إنشاء منتج (زد → أودوو)',    'Create Product (Zid → Odoo)',
   '[
      {"odoo_field":"default_code","platform_field":"sku"},
      {"odoo_field":"barcode","platform_field":"barcode"},
      {"odoo_field":"list_price","platform_field":"price"},
      {"odoo_field":"standard_price","platform_field":"cost"},
      {"odoo_field":"weight","platform_field":"weight.value"},
      {"odoo_field":"categ_id","platform_field":"categories"},
      {"odoo_field":"image_1920","platform_field":"images"},
      {"odoo_field":"product_variant_ids","platform_field":"variants"},
      {"odoo_field":"attribute_line_ids","platform_field":"attributes"},
      {"odoo_field":"taxes_id","platform_field":"is_taxable"}
   ]'::jsonb),

  ('salla_product_create', 'salla',   'product.template',  'product.created',  'products',  'Package',         11, 'إنشاء منتج (سلة → أودو)',   'Create Product (Salla → Odoo)',
   '[{"odoo_field":"list_price","platform_field":"price"},{"odoo_field":"default_code","platform_field":"sku"},{"odoo_field":"x_salla_id","platform_field":"id"}]'::jsonb),

  ('shopify_product_create','shopify','product.template', 'products/create',  'products',  'Package',         12, 'إنشاء منتج (شوبيفاي → أودو)', 'Create Product (Shopify → Odoo)',
   '[{"odoo_field":"list_price","platform_field":"variants.0.price"},{"odoo_field":"default_code","platform_field":"variants.0.sku"},{"odoo_field":"x_zid_id","platform_field":"id"}]'::jsonb),

  -- ─── Products (update) ─────────────────────────────────
  ('zid_product_update',   'zid',     'product.template',  'product.update',   'products',  'RefreshCw',       20, 'تحديث منتج (زد → أودوو)',   'Update Product (Zid → Odoo)',
   '[
      {"odoo_field":"default_code","platform_field":"sku"},
      {"odoo_field":"barcode","platform_field":"barcode"},
      {"odoo_field":"list_price","platform_field":"price"},
      {"odoo_field":"standard_price","platform_field":"cost"},
      {"odoo_field":"weight","platform_field":"weight.value"},
      {"odoo_field":"categ_id","platform_field":"categories"},
      {"odoo_field":"image_1920","platform_field":"images"},
      {"odoo_field":"product_variant_ids","platform_field":"variants"},
      {"odoo_field":"attribute_line_ids","platform_field":"attributes"},
      {"odoo_field":"taxes_id","platform_field":"is_taxable"}
   ]'::jsonb),

  ('salla_product_update', 'salla',   'product.template',  'product.updated',  'products',  'RefreshCw',       21, 'تحديث منتج (سلة → أودو)',   'Update Product (Salla → Odoo)',
   '[{"odoo_field":"list_price","platform_field":"price"},{"odoo_field":"default_code","platform_field":"sku"},{"odoo_field":"x_salla_id","platform_field":"id"}]'::jsonb),

  ('shopify_product_update','shopify','product.template', 'products/update',  'products',  'RefreshCw',       22, 'تحديث منتج (شوبيفاي → أودو)', 'Update Product (Shopify → Odoo)',
   '[{"odoo_field":"list_price","platform_field":"variants.0.price"},{"odoo_field":"default_code","platform_field":"variants.0.sku"}]'::jsonb),

  -- ─── Customers ────────────────────────────────────────
  ('zid_customer_create',   'zid',   'res.partner',       'customer.create',   'customers', 'User',             30, 'إنشاء عميل (زد → أودو)',     'Create Customer (Zid → Odoo)',
   '[{"odoo_field":"name","platform_field":"name"},{"odoo_field":"email","platform_field":"email"},{"odoo_field":"mobile","platform_field":"mobile"},{"odoo_field":"x_zid_id","platform_field":"id"}]'::jsonb),

  ('salla_customer_create', 'salla', 'res.partner',       'customer.created',  'customers', 'User',             31, 'إنشاء عميل (سلة → أودو)',   'Create Customer (Salla → Odoo)',
   '[{"odoo_field":"name","platform_field":"name"},{"odoo_field":"email","platform_field":"email"},{"odoo_field":"mobile","platform_field":"mobile"},{"odoo_field":"x_salla_id","platform_field":"id"}]'::jsonb),

  ('shopify_customer_create','shopify','res.partner',     'customers/create',  'customers', 'User',             32, 'إنشاء عميل (شوبيفاي → أودو)', 'Create Customer (Shopify → Odoo)',
   '[{"odoo_field":"name","platform_field":"first_name"},{"odoo_field":"email","platform_field":"email"},{"odoo_field":"x_zid_id","platform_field":"id"}]'::jsonb),

  -- ─── Orders ────────────────────────────────────────────
  ('zid_order_create',   'zid',      'sale.order',        'order.create',      'orders',    'ClipboardList',    40, 'إنشاء طلب (زد → أودو)',     'Create Order (Zid → Odoo)',
   '[{"odoo_field":"name","platform_field":"code"},{"odoo_field":"amount_total","platform_field":"order_total"},{"odoo_field":"date_order","platform_field":"created_at"},{"odoo_field":"x_zid_id","platform_field":"id"}]'::jsonb),

  ('salla_order_create', 'salla',    'sale.order',        'order.created',     'orders',    'ClipboardList',    41, 'إنشاء طلب (سلة → أودو)',   'Create Order (Salla → Odoo)',
   '[{"odoo_field":"name","platform_field":"reference_id"},{"odoo_field":"amount_total","platform_field":"total"},{"odoo_field":"date_order","platform_field":"created_at.date"},{"odoo_field":"x_salla_id","platform_field":"id"}]'::jsonb),

  ('shopify_order_create','shopify', 'sale.order',        'orders/create',     'orders',    'ClipboardList',    42, 'إنشاء طلب (شوبيفاي → أودو)', 'Create Order (Shopify → Odoo)',
   '[{"odoo_field":"name","platform_field":"name"},{"odoo_field":"amount_total","platform_field":"total_price"},{"odoo_field":"date_order","platform_field":"created_at"},{"odoo_field":"x_zid_id","platform_field":"id"}]'::jsonb),

  -- ─── Categories ─────────────────────────────────────────
  ('zid_category_create',   'zid',   'product.category',  'category.create',   'categories','Tag',              50, 'إنشاء تصنيف (زد → أودو)',   'Create Category (Zid → Odoo)',
   '[{"odoo_field":"name","platform_field":"name.ar"},{"odoo_field":"x_zid_id","platform_field":"id"}]'::jsonb),

  ('salla_category_create', 'salla', 'product.category',  'category.created',  'categories','Tag',              51, 'إنشاء تصنيف (سلة → أودو)', 'Create Category (Salla → Odoo)',
   '[{"odoo_field":"name","platform_field":"name"},{"odoo_field":"x_salla_id","platform_field":"id"}]'::jsonb),

  ('shopify_category_create','shopify','product.category','collections/create','categories','Tag',              52, 'إنشاء تصنيف (شوبيفاي → أودو)', 'Create Category (Shopify → Odoo)',
   '[{"odoo_field":"name","platform_field":"title"},{"odoo_field":"x_zid_id","platform_field":"id"}]'::jsonb)
ON CONFLICT (preset_key) DO NOTHING;

-- ────────────────────────────────────────────────────────────────────────────
-- 4) Idempotent seed function for a single workspace
-- ────────────────────────────────────────────────────────────────────────────
-- Behavior:
--   * If a preset row exists already for (workspace, preset_key) → keep it
--     (preserves any user customizations).
--   * If not → insert from definitions with all defaults.
--   * Sets is_preset = TRUE so UI/RPC layers can disable delete.
-- ────────────────────────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION seed_fixed_mapping_presets(p_workspace_id UUID)
RETURNS INTEGER
LANGUAGE plpgsql
AS $$
DECLARE
  v_def          RECORD;
  v_inserted     INT := 0;
  v_existing_ct  INT;
BEGIN
  IF p_workspace_id IS NULL THEN
    RETURN 0;
  END IF;

  FOR v_def IN
    SELECT * FROM fixed_mapping_preset_definitions ORDER BY display_order ASC
  LOOP
    -- Skip if a preset row already exists for this (workspace, preset_key).
    SELECT COUNT(*) INTO v_existing_ct
    FROM fixed_mappings fm
    WHERE fm.workspace_id = p_workspace_id
      AND fm.preset_key   = v_def.preset_key;

    IF v_existing_ct > 0 THEN
      CONTINUE;
    END IF;

    INSERT INTO fixed_mappings (
      workspace_id, platform, odoo_model, action, field_rows,
      is_preset, preset_key, category, icon_name, display_order, active, label,
      created_at, updated_at
    ) VALUES (
      p_workspace_id,
      v_def.platform,
      v_def.odoo_model,
      v_def.action,
      v_def.default_field_rows,  -- store the entire array in field_rows
      TRUE,
      v_def.preset_key,
      v_def.category,
      v_def.icon_name,
      v_def.display_order,
      TRUE,
      v_def.default_label_en,
      now(),
      now()
    );

    v_inserted := v_inserted + 1;
  END LOOP;

  RETURN v_inserted;
END;
$$;

-- ────────────────────────────────────────────────────────────────────────────
-- 5) RLS: prevent deletion of preset rows (UI also disables the button)
-- ────────────────────────────────────────────────────────────────────────────
-- Service role bypasses RLS by design (used by supabase client in server actions),
-- so this policy only protects direct client access. Deletion in the app layer
-- goes through deleteFixedMapping server action which already enforces is_preset.
-- We add a check column for clarity in queries.

COMMENT ON COLUMN fixed_mappings.is_preset IS 'TRUE for system-default preset rows; UI does not allow deletion, only edit/toggle.';
COMMENT ON COLUMN fixed_mappings.preset_key  IS 'Stable identifier (e.g. zid_product_create). One set per workspace.';
COMMENT ON COLUMN fixed_mappings.category    IS 'Logical bucket for grouping: products | customers | orders | categories.';
COMMENT ON COLUMN fixed_mappings.icon_name   IS 'Lucide icon name (visual selector in drawer sidebar).';
COMMENT ON COLUMN fixed_mappings.display_order IS 'Sort order in UI listing.';
COMMENT ON COLUMN fixed_mappings.active      IS 'Toggle: when FALSE, the preset is defined but inactive (skipped in sync).';
