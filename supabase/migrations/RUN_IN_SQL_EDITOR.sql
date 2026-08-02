-- ============================================================
-- تشغيل هذا الكود كاملاً في Supabase SQL Editor
-- يعالج إضافة عامود field_rows JSONB بدلاً من الأعمدة القديمة
-- ============================================================

-- ──────────────────────────────────────────────────────────────
-- 0) إضافة الأعمدة الأساسية وجدول التعريفات (إذا لم تكن موجودة)
-- ──────────────────────────────────────────────────────────────

ALTER TABLE fixed_mappings
  ADD COLUMN IF NOT EXISTS is_preset BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS preset_key TEXT,
  ADD COLUMN IF NOT EXISTS display_order INT NOT NULL DEFAULT 100,
  ADD COLUMN IF NOT EXISTS icon_name TEXT NOT NULL DEFAULT 'Package',
  ADD COLUMN IF NOT EXISTS category TEXT NOT NULL DEFAULT 'products',
  ADD COLUMN IF NOT EXISTS active BOOLEAN NOT NULL DEFAULT TRUE,
  ADD COLUMN IF NOT EXISTS label TEXT,
  ADD COLUMN IF NOT EXISTS field_rows JSONB NOT NULL DEFAULT '[]'::jsonb,
  ADD COLUMN IF NOT EXISTS settings JSONB NOT NULL DEFAULT '{}'::jsonb;

ALTER TABLE fixed_mappings
  DROP CONSTRAINT IF EXISTS fixed_mappings_workspace_id_platform_odoo_model_action_key;

DROP INDEX IF EXISTS uq_fixed_mappings_preset_key_field;
DROP INDEX IF EXISTS uq_fixed_mappings_custom_field;
DROP INDEX IF EXISTS uq_fixed_mappings_preset_key;

CREATE UNIQUE INDEX IF NOT EXISTS uq_fixed_mappings_preset_key
  ON fixed_mappings (workspace_id, preset_key)
  WHERE preset_key IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS uq_fixed_mappings_custom_field
  ON fixed_mappings (workspace_id, platform, odoo_model, action)
  WHERE preset_key IS NULL;

CREATE TABLE IF NOT EXISTS fixed_mapping_preset_definitions (
  preset_key        TEXT PRIMARY KEY,
  platform          TEXT NOT NULL,
  odoo_model        TEXT NOT NULL,
  action            TEXT NOT NULL,
  category          TEXT NOT NULL,
  icon_name         TEXT NOT NULL,
  display_order     INT  NOT NULL,
  default_label_ar  TEXT,
  default_label_en  TEXT,
  default_field_rows JSONB NOT NULL DEFAULT '[]'::jsonb,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ──────────────────────────────────────────────────────────────
-- 1) إنشاء دوال seed + augment (مُحدّثة لتعمل مع field_rows JSONB)
-- ──────────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION seed_fixed_mapping_presets(p_workspace_id UUID)
RETURNS INTEGER
LANGUAGE plpgsql AS $$
DECLARE
  v_def          RECORD;
  v_inserted     INT := 0;
  v_existing_ct  INT;
BEGIN
  IF p_workspace_id IS NULL THEN RETURN 0; END IF;

  FOR v_def IN SELECT * FROM fixed_mapping_preset_definitions ORDER BY display_order ASC
  LOOP
    SELECT COUNT(*) INTO v_existing_ct
    FROM fixed_mappings fm
    WHERE fm.workspace_id = p_workspace_id AND fm.preset_key = v_def.preset_key;

    IF v_existing_ct > 0 THEN CONTINUE; END IF;

    INSERT INTO fixed_mappings (
      workspace_id, platform, odoo_model, action, field_rows,
      is_preset, preset_key, category, icon_name, display_order, active, label,
      created_at, updated_at
    ) VALUES (
      p_workspace_id, v_def.platform, v_def.odoo_model, v_def.action,
      v_def.default_field_rows, TRUE, v_def.preset_key,
      v_def.category, v_def.icon_name, v_def.display_order, TRUE,
      v_def.default_label_en, now(), now()
    );

    v_inserted := v_inserted + 1;
  END LOOP;

  RETURN v_inserted;
END;
$$;

CREATE OR REPLACE FUNCTION augment_fixed_mapping_presets(p_workspace_id UUID)
RETURNS INTEGER
LANGUAGE plpgsql AS $$
DECLARE
  v_def          RECORD;
  v_current_rows JSONB;
  v_missing_rows JSONB;
  v_inserted     INT := 0;
  v_existing_ct  INT;
BEGIN
  IF p_workspace_id IS NULL THEN RETURN 0; END IF;

  FOR v_def IN SELECT * FROM fixed_mapping_preset_definitions ORDER BY display_order ASC
  LOOP
    SELECT COUNT(*) INTO v_existing_ct
    FROM fixed_mappings
    WHERE workspace_id = p_workspace_id AND preset_key = v_def.preset_key;

    IF v_existing_ct = 0 THEN CONTINUE; END IF;

    SELECT field_rows INTO v_current_rows
    FROM fixed_mappings
    WHERE workspace_id = p_workspace_id AND preset_key = v_def.preset_key
    LIMIT 1;

    IF v_current_rows IS NULL OR v_current_rows = '[]'::jsonb THEN
      UPDATE fixed_mappings
      SET field_rows = v_def.default_field_rows, updated_at = now()
      WHERE workspace_id = p_workspace_id AND preset_key = v_def.preset_key;
      v_inserted := v_inserted + jsonb_array_length(v_def.default_field_rows);
      CONTINUE;
    END IF;

    SELECT jsonb_agg(elem) INTO v_missing_rows
    FROM jsonb_array_elements(v_def.default_field_rows) AS elem
    WHERE NOT EXISTS (
      SELECT 1
      FROM jsonb_array_elements(v_current_rows) AS cur
      WHERE cur->>'odoo_field' = elem->>'odoo_field'
    );

    IF v_missing_rows IS NOT NULL AND jsonb_array_length(v_missing_rows) > 0 THEN
      UPDATE fixed_mappings
      SET field_rows = v_current_rows || v_missing_rows, updated_at = now()
      WHERE workspace_id = p_workspace_id AND preset_key = v_def.preset_key;
      v_inserted := v_inserted + jsonb_array_length(v_missing_rows);
    END IF;
  END LOOP;

  RETURN v_inserted;
END;
$$;

-- ──────────────────────────────────────────────────────────────
-- 2) تحديث/إدراج جميع تعريفات preset
-- ──────────────────────────────────────────────────────────────

INSERT INTO fixed_mapping_preset_definitions
  (preset_key, platform, odoo_model, action, category, icon_name, display_order,
   default_label_ar, default_label_en, default_field_rows)
VALUES
  ('zid_product_create', 'zid', 'product.template', 'product.create',
   'products', 'Package', 10,
   'إنشاء منتج (زد → أودوو)', 'Create Product (Zid → Odoo)',
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
      {"odoo_field":"taxes_id","platform_field":"is_taxable"},
      {"odoo_field":"x_zid_id","platform_field":"id"},
      {"odoo_field":"name","platform_field":"name.ar"},
      {"odoo_field":"description_sale","platform_field":"description.ar"},
      {"odoo_field":"active","platform_field":"is_published"}
    ]'::jsonb),
  ('zid_product_update', 'zid', 'product.template', 'product.update',
   'products', 'RefreshCw', 20,
   'تحديث منتج (زد → أودوو)', 'Update Product (Zid → Odoo)',
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
      {"odoo_field":"taxes_id","platform_field":"is_taxable"},
      {"odoo_field":"x_zid_id","platform_field":"id"},
      {"odoo_field":"name","platform_field":"name.ar"},
      {"odoo_field":"description_sale","platform_field":"description.ar"},
      {"odoo_field":"active","platform_field":"is_published"}
    ]'::jsonb)
ON CONFLICT (preset_key) DO UPDATE SET
  default_field_rows = EXCLUDED.default_field_rows,
  default_label_ar   = EXCLUDED.default_label_ar,
  default_label_en   = EXCLUDED.default_label_en;

-- ──────────────────────────────────────────────────────────────
-- 3) تطبيق augment على كل الـ workspaces الموجودة
-- ──────────────────────────────────────────────────────────────
DO $$
DECLARE
  v_ws RECORD;
  v_total INT := 0;
BEGIN
  FOR v_ws IN
    SELECT DISTINCT workspace_id FROM fixed_mappings WHERE preset_key IS NOT NULL
  LOOP
    v_total := v_total + augment_fixed_mapping_presets(v_ws.workspace_id);
  END LOOP;
  RAISE NOTICE 'Total field rows updated: %', v_total;
END;
$$;

-- ──────────────────────────────────────────────────────────────
-- 4) تثبيت presets للـ workspaces اللي ماعندها presets أصلاً
-- ──────────────────────────────────────────────────────────────
DO $$
DECLARE
  v_ws RECORD;
  v_seeded INT := 0;
BEGIN
  FOR v_ws IN
    SELECT DISTINCT id AS workspace_id FROM workspaces
    WHERE id NOT IN (SELECT DISTINCT workspace_id FROM fixed_mappings WHERE is_preset = TRUE)
  LOOP
    v_seeded := v_seeded + seed_fixed_mapping_presets(v_ws.workspace_id);
  END LOOP;
  RAISE NOTICE 'Seeded new presets: %', v_seeded;
END;
$$;

-- ──────────────────────────────────────────────────────────────
-- 5) حذف الصفوف المكررة (إن وجدت)
-- ──────────────────────────────────────────────────────────────
DELETE FROM fixed_mappings fm
WHERE fm.preset_key IS NOT NULL
  AND fm.id NOT IN (
    SELECT MIN(fm2.id)
    FROM fixed_mappings fm2
    WHERE fm2.preset_key IS NOT NULL
    GROUP BY fm2.workspace_id, fm2.preset_key
  );

-- ──────────────────────────────────────────────────────────────
-- 6) التحقق
-- ──────────────────────────────────────────────────────────────
-- SELECT preset_key, jsonb_array_length(field_rows) as field_count
-- FROM fixed_mappings
-- WHERE preset_key IS NOT NULL
-- ORDER BY preset_key;
