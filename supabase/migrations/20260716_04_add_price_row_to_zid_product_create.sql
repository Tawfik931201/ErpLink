-- Migration: Backfill "list_price ↔ price" row for zid_product_create
-- Date: 2026-07-16
--
-- Why this migration exists:
--   The seed function `seed_fixed_mapping_presets()` skips an entire preset_key
--   for a workspace if ANY row with that preset_key already exists
--   (preserves user customizations). This means workspaces that have the
--   zid_product_create preset seeded by an earlier version (with only the
--   "name" row visible in the drawer's "Mapped Fields" section) will not
--   automatically pick up the new default_field_rows schema in
--   20260716_fixed_mapping_presets.sql.
--
-- What this migration does:
--   For every workspace that already has at least one row with
--     preset_key = 'zid_product_create'
--   AND does NOT yet have a row with
--     preset_key = 'zid_product_create' AND odoo_field = 'list_price',
--   insert a single price row derived from the existing row's workspace_id,
--   platform, odoo_model, action, category, and icon_name. This guarantees
--   the drawer's "Mapped Fields" section will show a price row alongside the
--   existing name row without disturbing any customization.

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
SELECT DISTINCT
  fm.workspace_id,
  fm.platform,
  fm.odoo_model,
  fm.action,
  'list_price'                                            AS odoo_field,
  'price'                                                  AS platform_field,
  TRUE                                                     AS is_preset,
  'zid_product_create'                                     AS preset_key,
  fm.category,
  fm.icon_name,
  20                                                       AS display_order,
  TRUE                                                     AS active,
  fm.label,
  now()                                                    AS created_at,
  now()                                                    AS updated_at
FROM fixed_mappings fm
WHERE fm.preset_key = 'zid_product_create'
  AND fm.is_preset   = TRUE
  AND NOT EXISTS (
    SELECT 1
    FROM fixed_mappings existing
    WHERE existing.workspace_id = fm.workspace_id
      AND existing.preset_key   = 'zid_product_create'
      AND existing.odoo_field   = 'list_price'
  );
