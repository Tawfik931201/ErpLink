-- Migration: Drop stale unique constraint that blocks preset multi-row inserts.
-- Date: 2026-07-16
--
-- WHY:
--   The original fixed_mappings table had a unique constraint on
--   (workspace_id, platform, odoo_model, action) — only ONE row per
--   (workspace, platform, model, action) tuple. That constraint is fine
--   for the OLD design where each (workspace × platform × model × action)
--   mapping was represented by a single row.
--
--   The preset redesign in 20260716_fixed_mapping_presets.sql DROPS that
--   constraint (line 23) and replaces it with two partial unique indexes:
--     * uq_fixed_mappings_preset_key_field  (workspace, preset_key, odoo_field)
--       — allows many rows per preset (one per field), with different
--         platform/odoo_model/action combinations.
--     * uq_fixed_mappings_custom_field      (workspace, platform, odoo_model, action, odoo_field)
--       — protects non-preset (custom) rows from duplicates.
--
--   Some databases where the line-23 DROP CONSTRAINT did not run still have
--   the legacy `fixed_mappings_workspace_id_platform_odoo_model_action_key`
--   constraint in place. That constraint blocks any INSERT that adds more
--   than one preset row per (workspace × model × action), causing
--   duplicate-key errors during the reconcile backfill.
--
-- WHAT this migration does:
--   Idempotently drops the legacy constraint if it exists. After this
--   migration, the partial unique indexes added in
--   20260716_fixed_mapping_presets.sql are the only multi-row enforcers.

ALTER TABLE fixed_mappings
  DROP CONSTRAINT IF EXISTS fixed_mappings_workspace_id_platform_odoo_model_action_key;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_indexes
    WHERE schemaname = 'public'
      AND tablename  = 'fixed_mappings'
      AND indexname  = 'uq_fixed_mappings_preset_key_field'
  ) THEN
    CREATE UNIQUE INDEX uq_fixed_mappings_preset_key_field
      ON fixed_mappings (workspace_id, preset_key, odoo_field)
      WHERE preset_key IS NOT NULL;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_indexes
    WHERE schemaname = 'public'
      AND tablename  = 'fixed_mappings'
      AND indexname  = 'uq_fixed_mappings_custom_field'
  ) THEN
    CREATE UNIQUE INDEX uq_fixed_mappings_custom_field
      ON fixed_mappings (workspace_id, platform, odoo_model, action, odoo_field)
      WHERE preset_key IS NULL;
  END IF;
END;
$$;
