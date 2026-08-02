-- Migration: Product Sync Settings + Rules + Enriched Presets
-- Phase 1-3: richer default fields, per-preset settings, conditional rules, currency conversion
-- Date: 2026-07-16

-- ────────────────────────────────────────────────────────────────────────────
-- 1) Enrich preset definitions with more product fields
-- ────────────────────────────────────────────────────────────────────────────

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
  {"odoo_field":"image_1920","platform_field":"images"},
  {"odoo_field":"product_variant_ids","platform_field":"variants"},
  {"odoo_field":"attribute_line_ids","platform_field":"attributes"},
  {"odoo_field":"taxes_id","platform_field":"is_taxable"}
]'::jsonb
WHERE preset_key = 'zid_product_create';

UPDATE fixed_mapping_preset_definitions
SET default_field_rows = '[
  {"odoo_field":"name","platform_field":"name"},
  {"odoo_field":"list_price","platform_field":"price"},
  {"odoo_field":"standard_price","platform_field":"cost"},
  {"odoo_field":"default_code","platform_field":"sku"},
  {"odoo_field":"barcode","platform_field":"barcode"},
  {"odoo_field":"description_sale","platform_field":"description"},
  {"odoo_field":"weight","platform_field":"weight.value"},
  {"odoo_field":"x_salla_id","platform_field":"id"}
]'::jsonb
WHERE preset_key = 'salla_product_create';

UPDATE fixed_mapping_preset_definitions
SET default_field_rows = '[
  {"odoo_field":"name","platform_field":"title"},
  {"odoo_field":"list_price","platform_field":"variants.0.price"},
  {"odoo_field":"standard_price","platform_field":"variants.0.cost"},
  {"odoo_field":"default_code","platform_field":"variants.0.sku"},
  {"odoo_field":"barcode","platform_field":"variants.0.barcode"},
  {"odoo_field":"description_sale","platform_field":"body_html"},
  {"odoo_field":"weight","platform_field":"variants.0.weight"},
  {"odoo_field":"x_zid_id","platform_field":"id"}
]'::jsonb
WHERE preset_key = 'shopify_product_create';

-- ────────────────────────────────────────────────────────────────────────────
-- 2) Add settings column to fixed_mappings
-- ────────────────────────────────────────────────────────────────────────────

ALTER TABLE fixed_mappings
  ADD COLUMN IF NOT EXISTS settings JSONB NOT NULL DEFAULT '{}'::jsonb;

COMMENT ON COLUMN fixed_mappings.settings IS 'Per-preset-group user settings: language, price, category, image, stock, tax, matching, etc.';

-- ────────────────────────────────────────────────────────────────────────────
-- 3) Settings storage (one row per preset_key per workspace)
-- ────────────────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS fixed_mapping_settings (
  workspace_id UUID NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  preset_key   TEXT NOT NULL,
  settings     JSONB NOT NULL DEFAULT '{}'::jsonb,
  updated_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (workspace_id, preset_key)
);

COMMENT ON TABLE  fixed_mapping_settings IS 'Stores per-preset settings overrides (language, price, category mode, image handling, etc.)';
COMMENT ON COLUMN fixed_mapping_settings.settings IS 'JSON with keys like: name_language, price_source, category_sync_mode, image_sync, stock_direction, match_strategy, etc.';

-- ────────────────────────────────────────────────────────────────────────────
-- 4) Conditional rules engine
-- ────────────────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS fixed_mapping_rules (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id  UUID NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  preset_key    TEXT NOT NULL,
  rule_type     TEXT NOT NULL DEFAULT 'conditional',  -- 'conditional' | 'currency'
  priority      INT NOT NULL DEFAULT 100,
  enabled       BOOLEAN NOT NULL DEFAULT TRUE,
  -- For conditional rules:
  condition_field    TEXT,     -- e.g. "is_draft"
  condition_op       TEXT,     -- "eq" | "neq" | "gt" | "lt" | "is_empty" | "is_not_empty"
  condition_value    TEXT,     -- e.g. "true"
  action_field       TEXT,     -- target Odoo field
  action_value       TEXT,     -- e.g. "false" or template like "${name}"
  -- For currency rules:
  from_currency      TEXT,     -- e.g. "SAR"
  to_currency        TEXT,     -- e.g. "USD"
  conversion_rate    DECIMAL(12,6),
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_fixed_mapping_rules_ws_preset
  ON fixed_mapping_rules (workspace_id, preset_key);

COMMENT ON TABLE  fixed_mapping_rules IS 'Conditional transformation rules + currency conversion per preset group';
COMMENT ON COLUMN fixed_mapping_rules.condition_op IS 'Operator: eq, neq, gt, lt, is_empty, is_not_empty';

INSERT INTO fixed_mapping_rules
  (workspace_id, preset_key, rule_type, priority, enabled,
   condition_field, condition_op, condition_value, action_field, action_value)
VALUES
  ('00000000-0000-0000-0000-000000000000', '_template', 'conditional', 1, TRUE,
   'is_draft', 'eq', 'true', 'active', 'false')
ON CONFLICT DO NOTHING;

-- ────────────────────────────────────────────────────────────────────────────
-- 5) Function to augment existing workspace presets with missing field rows
-- ────────────────────────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION augment_fixed_mapping_presets(p_workspace_id UUID)
RETURNS INTEGER
LANGUAGE plpgsql
AS $$
DECLARE
  v_def   RECORD;
  v_row   JSONB;
  v_inserted INT := 0;
  v_existing_count INT;
BEGIN
  IF p_workspace_id IS NULL THEN
    RETURN 0;
  END IF;

  FOR v_def IN
    SELECT * FROM fixed_mapping_preset_definitions ORDER BY display_order ASC
  LOOP
    -- Check if preset already exists for this workspace
    SELECT COUNT(*) INTO v_existing_count
    FROM fixed_mappings
    WHERE workspace_id = p_workspace_id AND preset_key = v_def.preset_key;

    IF v_existing_count = 0 THEN
      -- Preset doesn't exist yet: skip (seed should create it)
      CONTINUE;
    END IF;

    -- Preset exists but may have stale/old field rows.
    -- Delete old field rows that are NOT in the current definition,
    -- then insert any missing ones. This handles the case where the
    -- definition was updated with comprehensive fields.
    DELETE FROM fixed_mappings
    WHERE workspace_id = p_workspace_id
      AND preset_key = v_def.preset_key
      AND odoo_field NOT IN (
        SELECT elem->>'odoo_field'
        FROM jsonb_array_elements(v_def.default_field_rows) AS elem
      );

    -- Insert any field rows that are in the definition but not yet in fixed_mappings
    FOR v_row IN SELECT * FROM jsonb_array_elements(v_def.default_field_rows)
    LOOP
      INSERT INTO fixed_mappings (
        workspace_id, platform, odoo_model, action,
        odoo_field, platform_field, is_preset, preset_key,
        category, icon_name, display_order, active, label,
        created_at, updated_at
      ) VALUES (
        p_workspace_id, v_def.platform, v_def.odoo_model, v_def.action,
        v_row->>'odoo_field', v_row->>'platform_field',
        TRUE, v_def.preset_key, v_def.category, v_def.icon_name,
        v_def.display_order, TRUE, v_def.default_label_en,
        now(), now()
      )
      ON CONFLICT DO NOTHING;

      v_inserted := v_inserted + 1;
    END LOOP;
  END LOOP;

  RETURN v_inserted;
END;
$$;
