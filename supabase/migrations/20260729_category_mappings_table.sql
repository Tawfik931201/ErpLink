-- Category Mapping table with Odoo product.category settings
-- Extends the static mapping system to support category sync with
-- accounting properties and inventory valuation settings matching Odoo.

CREATE TABLE IF NOT EXISTS category_mappings (
  id                       UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id             UUID NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  platform                 TEXT NOT NULL DEFAULT 'zid',
  source_category_name     TEXT NOT NULL,  -- category name from platform
  odoo_category_id         INT,            -- product.category (nullable for auto-create)
  parent_id                INT,            -- parent category ID for hierarchy

  -- Accounting Properties
  income_account_id        INT,            -- account.account (income)
  expense_account_id       INT,            -- account.account (expense)

  -- Inventory Valuation
  property_cost_method     TEXT,            -- 'standard' | 'fifo' | 'average'
  property_valuation       TEXT,            -- 'manual_periodic' | 'real_time' (automated)

  -- Account Stock Properties (used when property_valuation = 'real_time')
  stock_valuation_account_id INT,          -- account.account (stock valuation)
  stock_journal_id           INT,          -- account.journal (stock journal)
  stock_input_account_id     INT,          -- account.account (stock input)
  stock_output_account_id    INT,          -- account.account (stock output)

  created_at               TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at               TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(workspace_id, platform, source_category_name)
);

CREATE INDEX IF NOT EXISTS idx_category_mappings_workspace_platform
  ON category_mappings(workspace_id, platform);

ALTER TABLE category_mappings ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view their workspace category_mappings"
  ON category_mappings FOR SELECT
  USING (workspace_id IN (SELECT workspace_id FROM workspace_members WHERE user_id = auth.uid()::text));

CREATE POLICY "Users can insert their workspace category_mappings"
  ON category_mappings FOR INSERT
  WITH CHECK (workspace_id IN (SELECT workspace_id FROM workspace_members WHERE user_id = auth.uid()::text));

CREATE POLICY "Users can update their workspace category_mappings"
  ON category_mappings FOR UPDATE
  USING (workspace_id IN (SELECT workspace_id FROM workspace_members WHERE user_id = auth.uid()::text));

CREATE POLICY "Users can delete their workspace category_mappings"
  ON category_mappings FOR DELETE
  USING (workspace_id IN (SELECT workspace_id FROM workspace_members WHERE user_id = auth.uid()::text));
