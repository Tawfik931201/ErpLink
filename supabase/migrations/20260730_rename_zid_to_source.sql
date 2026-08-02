-- Rename zid_* columns to source_* across all mapping tables (idempotent)
-- This makes column names platform-agnostic (Zid, Salla, Shopify, etc.)
-- Each rename is wrapped in a DO block so it only runs if the old column exists.

DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='payment_method_mappings' AND column_name='zid_method') THEN
    ALTER TABLE payment_method_mappings RENAME COLUMN zid_method TO source_method;
    ALTER TABLE payment_method_mappings RENAME CONSTRAINT IF EXISTS payment_method_mappings_workspace_id_platform_zid_method_key TO payment_method_mappings_workspace_id_platform_source_method_key;
  END IF;
END $$;

DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='shipping_method_mappings' AND column_name='zid_method_name') THEN
    ALTER TABLE shipping_method_mappings RENAME COLUMN zid_method_name TO source_method_name;
    ALTER TABLE shipping_method_mappings RENAME CONSTRAINT IF EXISTS shipping_method_mappings_workspace_id_platform_zid_method_name_key TO shipping_method_mappings_workspace_id_platform_source_method_name_key;
  END IF;
END $$;

DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='tax_mappings' AND column_name='zid_tax_name') THEN
    ALTER TABLE tax_mappings RENAME COLUMN zid_tax_name TO source_tax_name;
    ALTER TABLE tax_mappings RENAME CONSTRAINT IF EXISTS tax_mappings_workspace_id_platform_zid_tax_name_key TO tax_mappings_workspace_id_platform_source_tax_name_key;
  END IF;
END $$;

DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='warehouse_mappings' AND column_name='zid_location_id') THEN
    ALTER TABLE warehouse_mappings RENAME COLUMN zid_location_id TO source_location_id;
    ALTER TABLE warehouse_mappings RENAME COLUMN zid_location_name TO source_location_name;
    ALTER TABLE warehouse_mappings RENAME CONSTRAINT IF EXISTS warehouse_mappings_workspace_id_platform_zid_location_id_key TO warehouse_mappings_workspace_id_platform_source_location_id_key;
  END IF;
END $$;

DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='currency_mappings' AND column_name='zid_currency') THEN
    ALTER TABLE currency_mappings RENAME COLUMN zid_currency TO source_currency;
    ALTER TABLE currency_mappings RENAME CONSTRAINT IF EXISTS currency_mappings_workspace_id_platform_zid_currency_key TO currency_mappings_workspace_id_platform_source_currency_key;
  END IF;
END $$;

DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='payment_term_mappings' AND column_name='zid_payment_term') THEN
    ALTER TABLE payment_term_mappings RENAME COLUMN zid_payment_term TO source_payment_term;
    ALTER TABLE payment_term_mappings RENAME CONSTRAINT IF EXISTS payment_term_mappings_workspace_id_platform_zid_payment_term_key TO payment_term_mappings_workspace_id_platform_source_payment_term_key;
  END IF;
END $$;

DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='pricelist_mappings' AND column_name='zid_pricelist') THEN
    ALTER TABLE pricelist_mappings RENAME COLUMN zid_pricelist TO source_pricelist;
    ALTER TABLE pricelist_mappings RENAME CONSTRAINT IF EXISTS pricelist_mappings_workspace_id_platform_zid_pricelist_key TO pricelist_mappings_workspace_id_platform_source_pricelist_key;
  END IF;
END $$;

DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='category_mappings' AND column_name='zid_category_name') THEN
    ALTER TABLE category_mappings RENAME COLUMN zid_category_name TO source_category_name;
    ALTER TABLE category_mappings RENAME CONSTRAINT IF EXISTS category_mappings_workspace_id_platform_zid_category_name_key TO category_mappings_workspace_id_platform_source_category_name_key;
  END IF;
END $$;
