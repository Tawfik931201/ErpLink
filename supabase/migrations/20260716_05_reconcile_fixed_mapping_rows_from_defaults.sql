-- Migration: Reconcile fixed_mappings rows from default_field_rows for ALL presets.
-- Date: 2026-07-16
--
-- WHY this migration exists:
--   Some workspace presets were created by older versions of
--   `seed_fixed_mapping_presets()` which (a) only inserted a single row, or
--   (b) used an "any-row-exists" idempotency check that skipped the entire
--   preset if even one row was already present. Legacy workspaces only have
--   1 row per preset (often just `x_zid_id` or `name`) even though the
--   corresponding preset definition declares many more field rows in its
--   `default_field_rows` JSONB.
--
-- WHAT this migration does (idempotent):
--   Pick ONE template row per (workspace_id, preset_key) from fixed_mappings,
--   unnest the canonical field-row array from fixed_mapping_preset_definitions
--   with LATERAL, and INSERT every (workspace_id, preset_key, odoo_field)
--   tuple that doesn't already exist in fixed_mappings.
--
-- Implementation notes:
--   * Uses LATERAL JOIN to unnest default_field_rows so the set-returning
--     function `jsonb_array_elements()` is referenced only in the FROM clause
--     (where it's allowed). NOT EXISTS compares against the explicit
--     `row_data.odoo_field` column instead.
--   * A DISTINCT ON (workspace_id, preset_key) ensures the template is picked
--     exactly once — preventing the multiplication problem.
--   * Idempotent: re-running this migration inserts only the rows that are
--     still missing.

DO $$
DECLARE
  v_inserted INT := 0;
BEGIN
  INSERT INTO fixed_mappings (
    workspace_id,
    platform,
    odoo_model,
    action,
    odoo_field,
    platform_field,
    is_preset,
    preset_key,
    category,
    icon_name,
    display_order,
    active,
    label,
    created_at,
    updated_at
  )
  SELECT
    tpl.workspace_id,
    tpl.platform,
    tpl.odoo_model,
    tpl.action,
    row_data.odoo_field,
    row_data.platform_field,
    TRUE,
    tpl.preset_key,
    tpl.category,
    tpl.icon_name,
    pdef.display_order,
    TRUE,
    tpl.label,
    now(),
    now()
  FROM (
    -- Pick exactly one template row per (workspace_id, preset_key),
    -- preferring the earliest created_at row.
    SELECT DISTINCT ON (workspace_id, preset_key)
      id,
      workspace_id,
      platform,
      odoo_model,
      action,
      category,
      icon_name,
      label,
      preset_key
    FROM fixed_mappings
    WHERE is_preset = TRUE
      AND preset_key IS NOT NULL
    ORDER BY workspace_id, preset_key, created_at ASC, id ASC
  ) tpl
  JOIN fixed_mapping_preset_definitions pdef
    ON pdef.preset_key = tpl.preset_key
  -- LATERAL unnests each preset's default_field_rows array once per
  -- (workspace, preset) template row — exposing odoo_field / platform_field.
  CROSS JOIN LATERAL jsonb_array_elements(pdef.default_field_rows) AS je
  CROSS JOIN LATERAL (
    SELECT
      (je->>'odoo_field')     AS odoo_field,
      (je->>'platform_field') AS platform_field
  ) AS row_data
  WHERE NOT EXISTS (
    SELECT 1
    FROM fixed_mappings existing
    WHERE existing.workspace_id = tpl.workspace_id
      AND existing.preset_key   = tpl.preset_key
      AND existing.odoo_field   = row_data.odoo_field
  );

  GET DIAGNOSTICS v_inserted = ROW_COUNT;
  RAISE NOTICE '[reconcile_fixed_mapping_rows] inserted % rows', v_inserted;
END;
$$;
