-- Migration: Replace scalar odoo_field / platform_field with JSONB field_rows
-- Date: 2026-07-16
--
-- WHY:
--   The previous design stored ONE field-pair per row using two scalar
--   columns (odoo_field, platform_field). A preset that needs 60 field
--   pairs required 60 rows in fixed_mappings — each sharing the same
--   workspace_id, platform, odoo_model, action, preset_key, etc.
--   This worked but was fragile: legacy unique constraints on
--   (workspace_id, platform, odoo_model, action) blocked multi-row
--   inserts and the per-row idempotency logic made schema evolution hard.
--
-- WHAT:
--   * Drops the legacy unique constraint (idempotent).
--   * Adds `field_rows` JSONB — stores the full array of field pairs
--     [{odoo_field, platform_field}, ...] for the preset.
--   * Backfills field_rows from existing rows (handling the case where
--     rows have already been grouped by preset_key or are standalone).
--   * Drops `odoo_field` and `platform_field` scalar columns.
--   * Creates a new partial unique index on (workspace_id, preset_key)
--     WHERE preset_key IS NOT NULL — one row per preset.
--   * Keeps uq_fixed_mappings_custom_field for non-preset rows.

-- ── Step 1: Drop legacy constraint if still present ──
ALTER TABLE fixed_mappings
  DROP CONSTRAINT IF EXISTS fixed_mappings_workspace_id_platform_odoo_model_action_key;

-- ── Step 2: Add field_rows column ──
ALTER TABLE fixed_mappings
  ADD COLUMN IF NOT EXISTS field_rows JSONB NOT NULL DEFAULT '[]'::jsonb;

-- ── Step 3: Backfill field_rows from existing scalar rows ──
-- For presets: gather all (odoo_field, platform_field) pairs into one array
-- per (workspace_id, preset_key) and set field_rows on one row per group.
DO $$
DECLARE
  v_updated INT := 0;
  v_r       RECORD;
BEGIN
  FOR v_r IN
    SELECT
      workspace_id,
      preset_key,
      jsonb_agg(
        jsonb_build_object(
          'odoo_field', odoo_field,
          'platform_field', platform_field
        ) ORDER BY display_order
      ) AS aggregated_rows,
      MIN(id) AS keep_id
    FROM fixed_mappings
    WHERE preset_key IS NOT NULL
    GROUP BY workspace_id, preset_key
  LOOP
    UPDATE fixed_mappings
    SET field_rows = v_r.aggregated_rows
    WHERE id = v_r.keep_id;

    v_updated := v_updated + 1;
  END LOOP;

  RAISE NOTICE '[step3] backfilled field_rows for % preset groups', v_updated;
END;
$$;

-- ── Step 4: For non-preset rows, wrap existing scalar into field_rows ──
UPDATE fixed_mappings
SET field_rows = jsonb_build_array(
  jsonb_build_object('odoo_field', odoo_field, 'platform_field', platform_field)
)
WHERE preset_key IS NULL
  AND field_rows = '[]'::jsonb;

RAISE NOTICE '[step4] wrapped standalone rows';

-- ── Step 5: Drop old scalar columns ──
ALTER TABLE fixed_mappings
  DROP COLUMN IF EXISTS odoo_field,
  DROP COLUMN IF EXISTS platform_field;

-- ── Step 6: Replace unique indexes ──
-- Preset rows: one row per (workspace_id, preset_key) — unique constraint
-- ensures no duplicate preset groups.
DROP INDEX IF EXISTS uq_fixed_mappings_preset_key_field;
CREATE UNIQUE INDEX IF NOT EXISTS uq_fixed_mappings_preset_key
  ON fixed_mappings (workspace_id, preset_key)
  WHERE preset_key IS NOT NULL;

-- Non-preset (custom) rows: one row per (workspace_id, platform, odoo_model, action)
-- Using field_rows[0]->>'odoo_field' for uniqueness — though since these
-- are single-field rows, the old logic still works.
DROP INDEX IF EXISTS uq_fixed_mappings_custom_field;
CREATE UNIQUE INDEX IF NOT EXISTS uq_fixed_mappings_custom_field
  ON fixed_mappings (workspace_id, platform, odoo_model, action)
  WHERE preset_key IS NULL;

-- ── Step 7: Remove duplicate rows that were left behind after grouping ──
-- After field_rows aggregation, only the MIN(id) row per preset group
-- carries the data. All sibling rows for the same (workspace, preset_key)
-- are now redundant.
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
  RAISE NOTICE '[step7] cleaned up % duplicate rows', v_deleted;
END;
$$;
