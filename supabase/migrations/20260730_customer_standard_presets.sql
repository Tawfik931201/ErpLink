-- Migration: Customer Standard Preset Definitions for Zid
-- Date: 2026-07-30

INSERT INTO fixed_mapping_preset_definitions
  (preset_key, platform, erp_model, action, category, icon_name, display_order, default_label_ar, default_label_en, default_field_rows)
VALUES
  ('zid_customer_create', 'zid', 'res.partner', 'customer.create', 'customers', 'User', 30,
   'إنشاء عميل (زد → أودوو)', 'Create Customer (Zid → Odoo)',
   '[
      {"odoo_field":"name","platform_field":"name"},
      {"odoo_field":"email","platform_field":"email"},
      {"odoo_field":"mobile","platform_field":"mobile"},
      {"odoo_field":"phone","platform_field":"telephone"},
      {"odoo_field":"vat","platform_field":"tax_number"},
      {"odoo_field":"company_name","platform_field":"business_name"},
      {"odoo_field":"street","platform_field":"default_address.address_street || addresses.0.address_street"},
      {"odoo_field":"street2","platform_field":"default_address.address_district || addresses.0.address_district"},
      {"odoo_field":"city","platform_field":"default_address.city.ar_name || addresses.0.city.ar_name || city.ar_name"},
      {"odoo_field":"country_id","platform_field":"default_address.country.ar_name || addresses.0.country.ar_name"},
      {"odoo_field":"x_zid_id","platform_field":"id"}
    ]'::jsonb),
  ('zid_customer_update', 'zid', 'res.partner', 'customer.update', 'customers', 'UserCheck', 35,
   'تحديث عميل (زد → أودوو)', 'Update Customer (Zid → Odoo)',
   '[
      {"odoo_field":"name","platform_field":"name"},
      {"odoo_field":"email","platform_field":"email"},
      {"odoo_field":"mobile","platform_field":"mobile"},
      {"odoo_field":"phone","platform_field":"telephone"},
      {"odoo_field":"vat","platform_field":"tax_number"},
      {"odoo_field":"company_name","platform_field":"business_name"},
      {"odoo_field":"street","platform_field":"default_address.address_street || addresses.0.address_street"},
      {"odoo_field":"street2","platform_field":"default_address.address_district || addresses.0.address_district"},
      {"odoo_field":"city","platform_field":"default_address.city.ar_name || addresses.0.city.ar_name || city.ar_name"},
      {"odoo_field":"country_id","platform_field":"default_address.country.ar_name || addresses.0.country.ar_name"},
      {"odoo_field":"x_zid_id","platform_field":"id"}
    ]'::jsonb)
ON CONFLICT (preset_key) DO UPDATE SET
  default_field_rows = EXCLUDED.default_field_rows,
  default_label_ar   = EXCLUDED.default_label_ar,
  default_label_en   = EXCLUDED.default_label_en;
