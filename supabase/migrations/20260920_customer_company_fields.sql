-- Migration: Persist Zid company fields in Odoo (vat + company_registry)
-- Goal: tax_number → res.partner.vat, commercial_registration → res.partner.company_registry
-- Steps:
--   1) Add company_registry ← commercial_registration to the preset definitions
--      (UI + future seeds pick it up; existing definitions already map vat/company_name).
--   2) Append the same row to every existing workspace's zid_customer_* field_rows,
--      idempotently (skips rows where company_registry is already mapped).
-- Runtime persistence is guaranteed by injectCustomerCompanyFields() in sync-engine.ts;
-- this migration only aligns the DB definitions/UI.
-- Date: 2026-09-20

-- 1) Preset definitions
UPDATE fixed_mapping_preset_definitions
SET default_field_rows = COALESCE(default_field_rows, '[]'::jsonb) || jsonb_build_array(
  '{"odoo_field":"company_registry","platform_field":"commercial_registration"}'::jsonb
)
WHERE preset_key IN ('zid_customer_create', 'zid_customer_update')
  AND NOT EXISTS (
    SELECT 1 FROM jsonb_array_elements(default_field_rows) elem
    WHERE elem->>'odoo_field' = 'company_registry'
  );

-- 2) Existing per-workspace fixed_mappings rows
DO $$
DECLARE
  v_mapping RECORD;
BEGIN
  FOR v_mapping IN
    SELECT id
    FROM fixed_mappings
    WHERE preset_key IN ('zid_customer_create', 'zid_customer_update')
  LOOP
    UPDATE fixed_mappings
    SET field_rows = COALESCE(field_rows, '[]'::jsonb) || jsonb_build_array(
      '{"odoo_field":"company_registry","platform_field":"commercial_registration"}'::jsonb
    )
    WHERE id = v_mapping.id
      AND NOT EXISTS (
        SELECT 1 FROM jsonb_array_elements(COALESCE(field_rows, '[]'::jsonb)) elem
        WHERE elem->>'odoo_field' = 'company_registry'
      );
  END LOOP;
END;
$$;

-- Verify
-- SELECT preset_key, jsonb_array_length(default_field_rows) AS field_count
-- FROM fixed_mapping_preset_definitions
-- WHERE preset_key IN ('zid_customer_create','zid_customer_update');