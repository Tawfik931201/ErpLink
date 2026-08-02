-- Add Payment Term and Pricelist Mapping tables
-- These extend the static mapping system to support customer payment terms
-- and product pricelists.

-- 1. Payment Term Mapping
CREATE TABLE IF NOT EXISTS payment_term_mappings (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id      UUID NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  platform          TEXT NOT NULL DEFAULT 'zid',
  zid_payment_term  TEXT NOT NULL,  -- payment term name from Zid (e.g. 'immediate', 'net_15', 'net_30')
  odoo_payment_term_id INT NOT NULL, -- account.payment.term
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(workspace_id, platform, zid_payment_term)
);

-- 2. Pricelist Mapping
CREATE TABLE IF NOT EXISTS pricelist_mappings (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id      UUID NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  platform          TEXT NOT NULL DEFAULT 'zid',
  zid_pricelist     TEXT NOT NULL,  -- pricelist name from Zid
  odoo_pricelist_id INT NOT NULL,   -- product.pricelist
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(workspace_id, platform, zid_pricelist)
);

-- Indexes
CREATE INDEX IF NOT EXISTS idx_payment_term_mappings_workspace_platform ON payment_term_mappings(workspace_id, platform);
CREATE INDEX IF NOT EXISTS idx_pricelist_mappings_workspace_platform ON pricelist_mappings(workspace_id, platform);

-- RLS
ALTER TABLE payment_term_mappings ENABLE ROW LEVEL SECURITY;
ALTER TABLE pricelist_mappings ENABLE ROW LEVEL SECURITY;

-- SELECT policies
CREATE POLICY "Users can view their workspace payment_term_mappings"
  ON payment_term_mappings FOR SELECT
  USING (workspace_id IN (SELECT workspace_id FROM workspace_members WHERE user_id = auth.uid()::text));

CREATE POLICY "Users can view their workspace pricelist_mappings"
  ON pricelist_mappings FOR SELECT
  USING (workspace_id IN (SELECT workspace_id FROM workspace_members WHERE user_id = auth.uid()::text));

-- INSERT policies
CREATE POLICY "Users can insert their workspace payment_term_mappings"
  ON payment_term_mappings FOR INSERT
  WITH CHECK (workspace_id IN (SELECT workspace_id FROM workspace_members WHERE user_id = auth.uid()::text));

CREATE POLICY "Users can insert their workspace pricelist_mappings"
  ON pricelist_mappings FOR INSERT
  WITH CHECK (workspace_id IN (SELECT workspace_id FROM workspace_members WHERE user_id = auth.uid()::text));

-- UPDATE policies
CREATE POLICY "Users can update their workspace payment_term_mappings"
  ON payment_term_mappings FOR UPDATE
  USING (workspace_id IN (SELECT workspace_id FROM workspace_members WHERE user_id = auth.uid()::text));

CREATE POLICY "Users can update their workspace pricelist_mappings"
  ON pricelist_mappings FOR UPDATE
  USING (workspace_id IN (SELECT workspace_id FROM workspace_members WHERE user_id = auth.uid()::text));

-- DELETE policies
CREATE POLICY "Users can delete their workspace payment_term_mappings"
  ON payment_term_mappings FOR DELETE
  USING (workspace_id IN (SELECT workspace_id FROM workspace_members WHERE user_id = auth.uid()::text));

CREATE POLICY "Users can delete their workspace pricelist_mappings"
  ON pricelist_mappings FOR DELETE
  USING (workspace_id IN (SELECT workspace_id FROM workspace_members WHERE user_id = auth.uid()::text));
