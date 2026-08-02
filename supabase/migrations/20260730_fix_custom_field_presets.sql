-- Migration: Replace x_zid_id / x_salla_id custom fields with standard default_code
-- x_zid_id and x_salla_id require users to create custom fields in Odoo.
-- default_code (SKU) is a standard Odoo field that always exists.

UPDATE fixed_mapping_preset_definitions
SET default_field_rows = (
  SELECT jsonb_agg(
    CASE
      WHEN elem->>'odoo_field' IN ('x_zid_id', 'x_salla_id') THEN
        jsonb_set(elem, '{odoo_field}', '"default_code"')
      ELSE elem
    END
  )
  FROM jsonb_array_elements(default_field_rows) AS elem
)
WHERE preset_key IN ('salla_product_create', 'salla_product_update', 'shopify_product_create', 'shopify_product_update');

UPDATE fixed_mappings
SET field_rows = (
  SELECT jsonb_agg(
    CASE
      WHEN elem->>'odoo_field' IN ('x_zid_id', 'x_salla_id') THEN
        jsonb_set(elem, '{odoo_field}', '"default_code"')
      ELSE elem
    END
  )
  FROM jsonb_array_elements(field_rows) AS elem
)
WHERE preset_key IN ('salla_product_create', 'salla_product_update', 'shopify_product_create', 'shopify_product_update')
  AND field_rows IS NOT NULL;
