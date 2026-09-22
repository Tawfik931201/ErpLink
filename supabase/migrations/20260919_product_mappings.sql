-- Product Mapping table (manual linking: store product ↔ Odoo product.template)
-- Mirrors the category_mappings system so the admin can hand-pick the
-- Odoo product that a store product must sync into.

CREATE TABLE IF NOT EXISTS product_mappings (
  id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id          UUID NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  platform              TEXT NOT NULL DEFAULT 'zid',
  source_product_id     TEXT,            -- product id from the store (Zid/Salla/Shopify)
  source_product_name   TEXT,            -- display name from the store
  source_sku            TEXT,            -- SKU from the store (helps matching at sync time)
  odoo_product_id       INT,             -- product.template (nullable for auto-create)
  created_at            TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at            TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(workspace_id, platform, source_product_id)
);

CREATE INDEX IF NOT EXISTS idx_product_mappings_workspace_platform
  ON product_mappings(workspace_id, platform);

CREATE INDEX IF NOT EXISTS idx_product_mappings_workspace_sku
  ON product_mappings(workspace_id, source_sku);

CREATE INDEX IF NOT EXISTS idx_product_mappings_workspace_name
  ON product_mappings(workspace_id, source_product_name);

ALTER TABLE product_mappings ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view their workspace product_mappings"
  ON product_mappings FOR SELECT
  USING (workspace_id IN (SELECT workspace_id FROM workspace_members WHERE user_id = auth.uid()::text));

CREATE POLICY "Users can insert their workspace product_mappings"
  ON product_mappings FOR INSERT
  WITH CHECK (workspace_id IN (SELECT workspace_id FROM workspace_members WHERE user_id = auth.uid()::text));

CREATE POLICY "Users can update their workspace product_mappings"
  ON product_mappings FOR UPDATE
  USING (workspace_id IN (SELECT workspace_id FROM workspace_members WHERE user_id = auth.uid()::text));

CREATE POLICY "Users can delete their workspace product_mappings"
  ON product_mappings FOR DELETE
  USING (workspace_id IN (SELECT workspace_id FROM workspace_members WHERE user_id = auth.uid()::text));