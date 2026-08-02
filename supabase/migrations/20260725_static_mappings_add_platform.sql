-- Add platform column to all static mapping tables (default 'zid')
-- This allows users to configure separate mappings per platform (zid/salla/shopify).

-- 1. Payment Method Mapping
ALTER TABLE payment_method_mappings ADD COLUMN IF NOT EXISTS platform TEXT NOT NULL DEFAULT 'zid';
DROP INDEX IF EXISTS idx_payment_method_mappings_workspace;
ALTER TABLE payment_method_mappings DROP CONSTRAINT IF EXISTS payment_method_mappings_workspace_id_zid_method_key;
ALTER TABLE payment_method_mappings ADD UNIQUE(workspace_id, platform, zid_method);

-- 2. Order Status Mapping
ALTER TABLE order_status_mappings ADD COLUMN IF NOT EXISTS platform TEXT NOT NULL DEFAULT 'zid';
DROP INDEX IF EXISTS idx_order_status_mappings_workspace;
ALTER TABLE order_status_mappings DROP CONSTRAINT IF EXISTS order_status_mappings_workspace_id_zid_status_key;
ALTER TABLE order_status_mappings ADD UNIQUE(workspace_id, platform, zid_status);

-- 3. Shipping Method Mapping
ALTER TABLE shipping_method_mappings ADD COLUMN IF NOT EXISTS platform TEXT NOT NULL DEFAULT 'zid';
DROP INDEX IF EXISTS idx_shipping_method_mappings_workspace;
ALTER TABLE shipping_method_mappings DROP CONSTRAINT IF EXISTS shipping_method_mappings_workspace_id_zid_method_name_key;
ALTER TABLE shipping_method_mappings ADD UNIQUE(workspace_id, platform, zid_method_name);

-- 4. Tax Mapping
ALTER TABLE tax_mappings ADD COLUMN IF NOT EXISTS platform TEXT NOT NULL DEFAULT 'zid';
DROP INDEX IF EXISTS idx_tax_mappings_workspace;
ALTER TABLE tax_mappings DROP CONSTRAINT IF EXISTS tax_mappings_workspace_id_zid_tax_name_key;
ALTER TABLE tax_mappings ADD UNIQUE(workspace_id, platform, zid_tax_name);

-- 5. Warehouse Mapping
ALTER TABLE warehouse_mappings ADD COLUMN IF NOT EXISTS platform TEXT NOT NULL DEFAULT 'zid';
DROP INDEX IF EXISTS idx_warehouse_mappings_workspace;
ALTER TABLE warehouse_mappings DROP CONSTRAINT IF EXISTS warehouse_mappings_workspace_id_zid_location_id_key;
ALTER TABLE warehouse_mappings ADD UNIQUE(workspace_id, platform, zid_location_id);

-- 6. Currency Mapping
ALTER TABLE currency_mappings ADD COLUMN IF NOT EXISTS platform TEXT NOT NULL DEFAULT 'zid';
DROP INDEX IF EXISTS idx_currency_mappings_workspace;
ALTER TABLE currency_mappings DROP CONSTRAINT IF EXISTS currency_mappings_workspace_id_zid_currency_key;
ALTER TABLE currency_mappings ADD UNIQUE(workspace_id, platform, zid_currency);

-- Recreate indexes with platform
CREATE INDEX IF NOT EXISTS idx_payment_method_mappings_workspace_platform ON payment_method_mappings(workspace_id, platform);
CREATE INDEX IF NOT EXISTS idx_order_status_mappings_workspace_platform ON order_status_mappings(workspace_id, platform);
CREATE INDEX IF NOT EXISTS idx_shipping_method_mappings_workspace_platform ON shipping_method_mappings(workspace_id, platform);
CREATE INDEX IF NOT EXISTS idx_tax_mappings_workspace_platform ON tax_mappings(workspace_id, platform);
CREATE INDEX IF NOT EXISTS idx_warehouse_mappings_workspace_platform ON warehouse_mappings(workspace_id, platform);
CREATE INDEX IF NOT EXISTS idx_currency_mappings_workspace_platform ON currency_mappings(workspace_id, platform);
