-- Migration: Add field_rows JSONB column + rewrite functions for JSONB array
-- Date: 2026-07-16
--
-- WHY:
--   The user manually dropped the scalar odoo_field / platform_field columns.
--   This migration adds the JSONB field_rows column (already in Prisma schema)
--   and updates all functions to work with the JSONB array instead of scalar columns.
--
-- WHAT:
--   1. Add field_rows JSONB column (if missing)
--   2. Drop old unique indexes referencing odoo_field
--   3. Create proper indexes for the JSONB structure
--   4. Rewrite augment_fixed_mapping_presets() to use field_rows JSONB
--   5. Rewrite seed_fixed_mapping_presets() (already uses field_rows, but ensure consistency)
--   6. Backfill field_rows from fixed_mapping_preset_definitions.default_field_rows
--   7. Clean up duplicate rows

-- ── Step 1: Add field_rows column ──
ALTER TABLE fixed_mappings
  ADD COLUMN IF NOT EXISTS field_rows JSONB NOT NULL DEFAULT '[]'::jsonb;

-- ── Step 2: Drop old unique indexes that reference odoo_field ──
DROP INDEX IF EXISTS uq_fixed_mappings_preset_key_field;
DROP INDEX IF EXISTS uq_fixed_mappings_custom_field;
DROP INDEX IF EXISTS uq_fixed_mappings_preset_key;
-- Keep the composite index for listing queries
-- idx_fixed_mappings_workspace_active already exists (no odoo_field ref)

-- ── Step 3: Create proper indexes for JSONB structure ──
CREATE UNIQUE INDEX IF NOT EXISTS uq_fixed_mappings_preset_key
  ON fixed_mappings (workspace_id, preset_key)
  WHERE preset_key IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS uq_fixed_mappings_custom_field
  ON fixed_mappings (workspace_id, platform, odoo_model, action)
  WHERE preset_key IS NULL;

-- ── Step 4: Rewrite seed_fixed_mapping_presets (idempotent preset seeder) ──
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
      v_def.default_field_rows,
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

-- ── Step 5: Rewrite augment_fixed_mapping_presets to work with field_rows JSONB ──
-- Instead of INSERT/DELETE scalar rows, it updates the JSONB array directly.
CREATE OR REPLACE FUNCTION augment_fixed_mapping_presets(p_workspace_id UUID)
RETURNS INTEGER
LANGUAGE plpgsql
AS $$
DECLARE
  v_def          RECORD;
  v_current_rows JSONB;
  v_missing_rows JSONB;
  v_inserted     INT := 0;
  v_existing_ct  INT;
BEGIN
  IF p_workspace_id IS NULL THEN
    RETURN 0;
  END IF;

  FOR v_def IN
    SELECT * FROM fixed_mapping_preset_definitions ORDER BY display_order ASC
  LOOP
    SELECT COUNT(*) INTO v_existing_ct
    FROM fixed_mappings
    WHERE workspace_id = p_workspace_id AND preset_key = v_def.preset_key;

    IF v_existing_ct = 0 THEN
      CONTINUE;
    END IF;

    -- Read current field_rows
    SELECT field_rows INTO v_current_rows
    FROM fixed_mappings
    WHERE workspace_id = p_workspace_id AND preset_key = v_def.preset_key
    LIMIT 1;

    -- If field_rows is empty, set it to default_field_rows entirely
    IF v_current_rows IS NULL OR v_current_rows = '[]'::jsonb THEN
      UPDATE fixed_mappings
      SET field_rows = v_def.default_field_rows,
          updated_at = now()
      WHERE workspace_id = p_workspace_id AND preset_key = v_def.preset_key;

      v_inserted := v_inserted + jsonb_array_length(v_def.default_field_rows);
      CONTINUE;
    END IF;

    -- Find rows in default_field_rows that are NOT in current field_rows
    -- matched by odoo_field
    SELECT jsonb_agg(elem) INTO v_missing_rows
    FROM jsonb_array_elements(v_def.default_field_rows) AS elem
    WHERE NOT EXISTS (
      SELECT 1
      FROM jsonb_array_elements(v_current_rows) AS cur
      WHERE cur->>'odoo_field' = elem->>'odoo_field'
    );

    IF v_missing_rows IS NOT NULL AND jsonb_array_length(v_missing_rows) > 0 THEN
      UPDATE fixed_mappings
      SET field_rows = v_current_rows || v_missing_rows,
          updated_at = now()
      WHERE workspace_id = p_workspace_id AND preset_key = v_def.preset_key;

      v_inserted := v_inserted + jsonb_array_length(v_missing_rows);
    END IF;
  END LOOP;

  RETURN v_inserted;
END;
$$;

-- ── Step 6: Backfill field_rows for existing workspace presets ──
-- For workspaces that already have preset rows but field_rows is empty,
-- set field_rows from the definitions.
DO $$
DECLARE
  v_ws RECORD;
  v_total INT := 0;
BEGIN
  FOR v_ws IN
    SELECT DISTINCT workspace_id
    FROM fixed_mappings
    WHERE preset_key IS NOT NULL
  LOOP
    v_total := v_total + augment_fixed_mapping_presets(v_ws.workspace_id);
  END LOOP;
  RAISE NOTICE 'Backfilled % field rows across all workspaces', v_total;
END;
$$;

-- ── Step 7: Wrap standalone non-preset rows (custom mappings) ──
UPDATE fixed_mappings
SET field_rows = jsonb_build_array(
  jsonb_build_object('odoo_field', '', 'platform_field', '')
)
WHERE preset_key IS NULL
  AND field_rows = '[]'::jsonb;

RAISE NOTICE 'Wrapped custom rows';

-- ── Step 8: Run seed for workspaces that have NO presets at all ──
DO $$
DECLARE
  v_ws RECORD;
  v_seeded INT := 0;
BEGIN
  FOR v_ws IN
    SELECT DISTINCT id AS workspace_id FROM workspaces
    WHERE id NOT IN (
      SELECT DISTINCT workspace_id FROM fixed_mappings WHERE is_preset = TRUE
    )
  LOOP
    v_seeded := v_seeded + seed_fixed_mapping_presets(v_ws.workspace_id);
  END LOOP;
  RAISE NOTICE 'Seeded % new presets for workspaces without any', v_seeded;
END;
$$;

-- ── Step 9: Remove any leftover duplicate preset rows ──
-- After backfilling, multiple rows per (workspace, preset_key) may exist.
-- Keep only one row per preset group.
DO $$
DECLARE
  v_deleted INT := 0;
BEGIN
  DELETE FROM fixed_mappings fm
  WHERE fm.preset_key IS NOT NULL
    AND fm.id NOT IN (
      SELECT MIN(fm2.id)
      FROM fixed_mappings fm2
      WHERE fm2.preset_key IS NOT NULL
      GROUP BY fm2.workspace_id, fm2.preset_key
    );

  GET DIAGNOSTICS v_deleted = ROW_COUNT;
  RAISE NOTICE 'Cleaned up % duplicate preset rows', v_deleted;
END;
$$;
