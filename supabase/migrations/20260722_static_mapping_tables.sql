-- Static Mapping Tables
-- These tables let users translate Zid values to Odoo values
-- for payment methods, order statuses, shipping, taxes, warehouses, and currencies.
-- Each table is per-workspace with a unique constraint on (workspace_id + source_value).

-- 1. Payment Method Mapping
CREATE TABLE IF NOT EXISTS payment_method_mappings (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id      UUID NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  zid_method        TEXT NOT NULL,  -- 'zid_cod', 'zid_bank_transfer', 'zid_credit_card', 'zid_cop'
  odoo_journal_id   INT,            -- account.journal
  odoo_payment_method_id INT,       -- account.payment.method
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(workspace_id, zid_method)
);

-- 2. Order Status Mapping
CREATE TABLE IF NOT EXISTS order_status_mappings (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id      UUID NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  zid_status        TEXT NOT NULL,  -- 'new', 'preparing', 'ready', 'indelivery', 'delivered', 'canceled', 'reversed', 'partially_reversed', 'reverse_in_progress'
  odoo_state        TEXT NOT NULL,  -- 'draft', 'sale', 'done', 'cancel'
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(workspace_id, zid_status)
);

-- 3. Shipping Method Mapping
CREATE TABLE IF NOT EXISTS shipping_method_mappings (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id      UUID NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  zid_method_name   TEXT NOT NULL,  -- shipping method title from Zid
  odoo_carrier_id   INT NOT NULL,   -- delivery.carrier
  odoo_product_id   INT,            -- delivery product (for shipping line)
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(workspace_id, zid_method_name)
);

-- 4. Tax Mapping
CREATE TABLE IF NOT EXISTS tax_mappings (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id      UUID NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  zid_tax_name      TEXT NOT NULL,  -- tax name or percentage from Zid
  odoo_tax_id       INT NOT NULL,   -- account.tax
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(workspace_id, zid_tax_name)
);

-- 5. Warehouse / Location Mapping
CREATE TABLE IF NOT EXISTS warehouse_mappings (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id      UUID NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  zid_location_id   TEXT,           -- Zid location UUID
  zid_location_name TEXT,           -- Zid location name
  odoo_warehouse_id INT NOT NULL,   -- stock.warehouse
  odoo_location_id  INT,            -- stock.location (for stock moves)
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(workspace_id, zid_location_id)
);

-- 6. Currency Mapping
CREATE TABLE IF NOT EXISTS currency_mappings (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id      UUID NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  zid_currency      TEXT NOT NULL,  -- 'SAR', 'AED', etc.
  odoo_currency_id  INT NOT NULL,   -- res.currency
  conversion_rate   DECIMAL(12,6), -- manual rate; null = use Odoo rate
  auto_update       BOOLEAN NOT NULL DEFAULT false,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(workspace_id, zid_currency)
);

-- Indexes for faster lookups
CREATE INDEX IF NOT EXISTS idx_payment_method_mappings_workspace ON payment_method_mappings(workspace_id);
CREATE INDEX IF NOT EXISTS idx_order_status_mappings_workspace ON order_status_mappings(workspace_id);
CREATE INDEX IF NOT EXISTS idx_shipping_method_mappings_workspace ON shipping_method_mappings(workspace_id);
CREATE INDEX IF NOT EXISTS idx_tax_mappings_workspace ON tax_mappings(workspace_id);
CREATE INDEX IF NOT EXISTS idx_warehouse_mappings_workspace ON warehouse_mappings(workspace_id);
CREATE INDEX IF NOT EXISTS idx_currency_mappings_workspace ON currency_mappings(workspace_id);

-- Enable RLS on all tables
ALTER TABLE payment_method_mappings ENABLE ROW LEVEL SECURITY;
ALTER TABLE order_status_mappings ENABLE ROW LEVEL SECURITY;
ALTER TABLE shipping_method_mappings ENABLE ROW LEVEL SECURITY;
ALTER TABLE tax_mappings ENABLE ROW LEVEL SECURITY;
ALTER TABLE warehouse_mappings ENABLE ROW LEVEL SECURITY;
ALTER TABLE currency_mappings ENABLE ROW LEVEL SECURITY;

-- RLS: users can only see their own workspace data (via workspace_members)
CREATE POLICY "Users can view their workspace payment_method_mappings"
  ON payment_method_mappings FOR SELECT
  USING (workspace_id IN (SELECT workspace_id FROM workspace_members WHERE user_id = auth.uid()::text));

CREATE POLICY "Users can view their workspace order_status_mappings"
  ON order_status_mappings FOR SELECT
  USING (workspace_id IN (SELECT workspace_id FROM workspace_members WHERE user_id = auth.uid()::text));

CREATE POLICY "Users can view their workspace shipping_method_mappings"
  ON shipping_method_mappings FOR SELECT
  USING (workspace_id IN (SELECT workspace_id FROM workspace_members WHERE user_id = auth.uid()::text));

CREATE POLICY "Users can view their workspace tax_mappings"
  ON tax_mappings FOR SELECT
  USING (workspace_id IN (SELECT workspace_id FROM workspace_members WHERE user_id = auth.uid()::text));

CREATE POLICY "Users can view their workspace warehouse_mappings"
  ON warehouse_mappings FOR SELECT
  USING (workspace_id IN (SELECT workspace_id FROM workspace_members WHERE user_id = auth.uid()::text));

CREATE POLICY "Users can view their workspace currency_mappings"
  ON currency_mappings FOR SELECT
  USING (workspace_id IN (SELECT workspace_id FROM workspace_members WHERE user_id = auth.uid()::text));

-- Insert/Update/Delete policies (same condition)
CREATE POLICY "Users can insert their workspace payment_method_mappings"
  ON payment_method_mappings FOR INSERT
  WITH CHECK (workspace_id IN (SELECT workspace_id FROM workspace_members WHERE user_id = auth.uid()::text));

CREATE POLICY "Users can insert their workspace order_status_mappings"
  ON order_status_mappings FOR INSERT
  WITH CHECK (workspace_id IN (SELECT workspace_id FROM workspace_members WHERE user_id = auth.uid()::text));

CREATE POLICY "Users can insert their workspace shipping_method_mappings"
  ON shipping_method_mappings FOR INSERT
  WITH CHECK (workspace_id IN (SELECT workspace_id FROM workspace_members WHERE user_id = auth.uid()::text));

CREATE POLICY "Users can insert their workspace tax_mappings"
  ON tax_mappings FOR INSERT
  WITH CHECK (workspace_id IN (SELECT workspace_id FROM workspace_members WHERE user_id = auth.uid()::text));

CREATE POLICY "Users can insert their workspace warehouse_mappings"
  ON warehouse_mappings FOR INSERT
  WITH CHECK (workspace_id IN (SELECT workspace_id FROM workspace_members WHERE user_id = auth.uid()::text));

CREATE POLICY "Users can insert their workspace currency_mappings"
  ON currency_mappings FOR INSERT
  WITH CHECK (workspace_id IN (SELECT workspace_id FROM workspace_members WHERE user_id = auth.uid()::text));

CREATE POLICY "Users can update their workspace payment_method_mappings"
  ON payment_method_mappings FOR UPDATE
  USING (workspace_id IN (SELECT workspace_id FROM workspace_members WHERE user_id = auth.uid()::text));

CREATE POLICY "Users can update their workspace order_status_mappings"
  ON order_status_mappings FOR UPDATE
  USING (workspace_id IN (SELECT workspace_id FROM workspace_members WHERE user_id = auth.uid()::text));

CREATE POLICY "Users can update their workspace shipping_method_mappings"
  ON shipping_method_mappings FOR UPDATE
  USING (workspace_id IN (SELECT workspace_id FROM workspace_members WHERE user_id = auth.uid()::text));

CREATE POLICY "Users can update their workspace tax_mappings"
  ON tax_mappings FOR UPDATE
  USING (workspace_id IN (SELECT workspace_id FROM workspace_members WHERE user_id = auth.uid()::text));

CREATE POLICY "Users can update their workspace warehouse_mappings"
  ON warehouse_mappings FOR UPDATE
  USING (workspace_id IN (SELECT workspace_id FROM workspace_members WHERE user_id = auth.uid()::text));

CREATE POLICY "Users can update their workspace currency_mappings"
  ON currency_mappings FOR UPDATE
  USING (workspace_id IN (SELECT workspace_id FROM workspace_members WHERE user_id = auth.uid()::text));

CREATE POLICY "Users can delete their workspace payment_method_mappings"
  ON payment_method_mappings FOR DELETE
  USING (workspace_id IN (SELECT workspace_id FROM workspace_members WHERE user_id = auth.uid()::text));

CREATE POLICY "Users can delete their workspace order_status_mappings"
  ON order_status_mappings FOR DELETE
  USING (workspace_id IN (SELECT workspace_id FROM workspace_members WHERE user_id = auth.uid()::text));

CREATE POLICY "Users can delete their workspace shipping_method_mappings"
  ON shipping_method_mappings FOR DELETE
  USING (workspace_id IN (SELECT workspace_id FROM workspace_members WHERE user_id = auth.uid()::text));

CREATE POLICY "Users can delete their workspace tax_mappings"
  ON tax_mappings FOR DELETE
  USING (workspace_id IN (SELECT workspace_id FROM workspace_members WHERE user_id = auth.uid()::text));

CREATE POLICY "Users can delete their workspace warehouse_mappings"
  ON warehouse_mappings FOR DELETE
  USING (workspace_id IN (SELECT workspace_id FROM workspace_members WHERE user_id = auth.uid()::text));

CREATE POLICY "Users can delete their workspace currency_mappings"
  ON currency_mappings FOR DELETE
  USING (workspace_id IN (SELECT workspace_id FROM workspace_members WHERE user_id = auth.uid()::text));

-- ─── Sync Retry Queue ─────────────────────────────────────────────────────────
-- Stores failed sync operations for later retry.
CREATE TABLE IF NOT EXISTS sync_queue (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id      UUID NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  store_id          TEXT NOT NULL,
  event             TEXT NOT NULL,
  platform          TEXT NOT NULL DEFAULT 'zid',
  payload           JSONB NOT NULL DEFAULT '{}',
  error_message     TEXT,
  retry_count       INT NOT NULL DEFAULT 0,
  max_retries       INT NOT NULL DEFAULT 3,
  last_error_at     TIMESTAMPTZ,
  next_retry_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_sync_queue_next_retry ON sync_queue(next_retry_at);
CREATE INDEX IF NOT EXISTS idx_sync_queue_workspace ON sync_queue(workspace_id);
