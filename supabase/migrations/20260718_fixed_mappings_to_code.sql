-- Migration: Move fixed mapping presets from DB to code
-- Preset definitions now live in src/lib/fixed-mapping-presets-config.ts
-- fixed_mappings table now only holds:
--   1) Custom preset field additions (is_preset=false, preset_key='{presetKey}')
--   2) Standalone custom fixed mappings (is_preset=false, preset_key=null)
-- fixed_mapping_settings stores per-workspace settings + active state

-- ── 1. Clean up seeded preset rows ──────────────────────────────────────────
DELETE FROM fixed_mappings WHERE is_preset = TRUE;

-- ── 2. Update constraints on fixed_mappings ─────────────────────────────────
DROP INDEX IF EXISTS uq_fixed_mappings_preset_key_field;
DROP INDEX IF EXISTS uq_fixed_mappings_preset_key;

-- For custom preset additions (is_preset=false, preset_key not null), allow multiple rows.
-- For standalone custom mappings (is_preset=false, preset_key null), keep the unique constraint.
DROP INDEX IF EXISTS uq_fixed_mappings_custom_field;
CREATE UNIQUE INDEX IF NOT EXISTS uq_fixed_mappings_custom_standalone
  ON fixed_mappings (workspace_id, platform, odoo_model, action)
  WHERE preset_key IS NULL;

-- ── 3. Drop preset definitions table ────────────────────────────────────────
DROP TABLE IF EXISTS fixed_mapping_preset_definitions;

-- ── 4. Drop seed functions ──────────────────────────────────────────────────
DROP FUNCTION IF EXISTS seed_fixed_mapping_presets;
DROP FUNCTION IF EXISTS augment_fixed_mapping_presets;

-- ── 5. Add active column to fixed_mapping_settings ──────────────────────────
ALTER TABLE fixed_mapping_settings
  ADD COLUMN IF NOT EXISTS active BOOLEAN NOT NULL DEFAULT TRUE;

COMMENT ON COLUMN fixed_mapping_settings.active IS 'Per-workspace toggle: when FALSE the preset is skipped during sync.';

-- ── 6. Update column comment on fixed_mappings.is_preset ────────────────────
COMMENT ON COLUMN fixed_mappings.is_preset IS 'FALSE for user-added custom rows. Presets are now defined in code (fixed-mapping-presets-config.ts).';
