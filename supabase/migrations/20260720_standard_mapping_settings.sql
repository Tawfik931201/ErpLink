-- Standard Mapping Settings
-- تخزين إعدادات الربط الافتراضية لكل متجر ولكل كيان (كاتيجوري، منتجات، عملاء، اوردرات)
-- Date: 2026-07-20

CREATE TABLE IF NOT EXISTS standard_mapping_settings (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id      UUID NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  store_type        TEXT NOT NULL,   -- 'zid' | 'salla' | 'shopify' | 'woocommerce' | 'amazon' | 'noon' | 'jumia'
  entity_type       TEXT NOT NULL,   -- 'categories' | 'products' | 'customers' | 'orders'
  settings          JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (workspace_id, store_type, entity_type)
);

CREATE INDEX IF NOT EXISTS idx_standard_mapping_settings_ws_store
  ON standard_mapping_settings(workspace_id, store_type);

CREATE INDEX IF NOT EXISTS idx_standard_mapping_settings_ws_entity
  ON standard_mapping_settings(workspace_id, entity_type);

COMMENT ON TABLE  standard_mapping_settings IS 'Standard mapping default settings per store per entity';
COMMENT ON COLUMN standard_mapping_settings.settings IS 'JSON keys: costing_method, inventory_valuation, on_delete, match_zid_field, match_odoo_field';

-- Example settings JSON for categories:
-- {
--   "costing_method": "",
--   "inventory_valuation": "",
--   "on_delete": "nothing",
--   "match_zid_field": "id",
--   "match_odoo_field": "x_zid_id"
-- }

ALTER TABLE standard_mapping_settings ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view their workspace standard_mapping_settings"
  ON standard_mapping_settings FOR SELECT
  USING (workspace_id IN (SELECT workspace_id FROM workspace_members WHERE user_id = auth.uid()::text));

CREATE POLICY "Users can insert their workspace standard_mapping_settings"
  ON standard_mapping_settings FOR INSERT
  WITH CHECK (workspace_id IN (SELECT workspace_id FROM workspace_members WHERE user_id = auth.uid()::text));

CREATE POLICY "Users can update their workspace standard_mapping_settings"
  ON standard_mapping_settings FOR UPDATE
  USING (workspace_id IN (SELECT workspace_id FROM workspace_members WHERE user_id = auth.uid()::text));

CREATE POLICY "Users can delete their workspace standard_mapping_settings"
  ON standard_mapping_settings FOR DELETE
  USING (workspace_id IN (SELECT workspace_id FROM workspace_members WHERE user_id = auth.uid()::text));
