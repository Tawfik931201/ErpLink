-- =============================================================
-- Migration: Platform token tables (merchant_tokens / salla_tokens / shopify_tokens)
-- =============================================================
-- These tables were previously created only through Prisma `db push`,
-- which meant a fresh Supabase deployment was missing them. This migration
-- makes the schema reproducible from the SQL source of truth.
--
-- All writes go through the service-role key (RLS bypassed intentionally),
-- so RLS below only restricts *unauthenticated* browser reads to admins.
-- =============================================================

-- 1. merchant_tokens (Zid)
CREATE TABLE IF NOT EXISTS merchant_tokens (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  merchant_id         TEXT,
  access_token        TEXT,
  refresh_token       TEXT,
  expires_in          BIGINT,
  token_type          TEXT,
  authorization_token TEXT,
  store_id            TEXT,
  workspace_id        UUID REFERENCES workspaces(id) ON DELETE CASCADE,
  name                TEXT,
  email               TEXT,
  username            TEXT,
  uuid                TEXT,
  old_id              BIGINT,
  sync_settings       JSONB DEFAULT '{}'::jsonb,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_merchant_tokens_merchant_id ON merchant_tokens(merchant_id);
CREATE INDEX IF NOT EXISTS idx_merchant_tokens_workspace    ON merchant_tokens(workspace_id);
CREATE INDEX IF NOT EXISTS idx_merchant_tokens_store_id     ON merchant_tokens(store_id);

-- 2. salla_tokens
CREATE TABLE IF NOT EXISTS salla_tokens (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  merchant_id   TEXT,
  access_token  TEXT,
  refresh_token TEXT,
  expires_in    BIGINT,
  token_type    TEXT,
  scope         TEXT,
  workspace_id  UUID REFERENCES workspaces(id) ON DELETE CASCADE,
  name          TEXT,
  email         TEXT,
  username      TEXT,
  store_name    TEXT,
  mobile        TEXT,
  sync_settings JSONB DEFAULT '{}'::jsonb,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_salla_tokens_merchant_id ON salla_tokens(merchant_id);
CREATE INDEX IF NOT EXISTS idx_salla_tokens_workspace ON salla_tokens(workspace_id);

-- 3. shopify_tokens
CREATE TABLE IF NOT EXISTS shopify_tokens (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  shop_domain   TEXT,
  access_token  TEXT,
  scopes        TEXT,
  name          TEXT,
  email         TEXT,
  workspace_id  UUID REFERENCES workspaces(id) ON DELETE CASCADE,
  sync_settings JSONB DEFAULT '{}'::jsonb,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_shopify_tokens_shop_domain ON shopify_tokens(shop_domain);
CREATE INDEX IF NOT EXISTS idx_shopify_tokens_workspace ON shopify_tokens(workspace_id);

-- 4. Row Level Security (admin-only read; writes bypass RLS via service role)
ALTER TABLE merchant_tokens ENABLE ROW LEVEL SECURITY;
ALTER TABLE salla_tokens ENABLE ROW LEVEL SECURITY;
ALTER TABLE shopify_tokens ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "platform_tokens_admin_read" ON merchant_tokens;
CREATE POLICY "platform_tokens_admin_read" ON merchant_tokens
  FOR SELECT USING (
    coalesce(current_setting('request.jwt.claims', true)::json->>'app_role','') = 'admin'
  );

DROP POLICY IF EXISTS "platform_tokens_admin_read" ON salla_tokens;
CREATE POLICY "platform_tokens_admin_read" ON salla_tokens
  FOR SELECT USING (
    coalesce(current_setting('request.jwt.claims', true)::json->>'app_role','') = 'admin'
  );

DROP POLICY IF EXISTS "platform_tokens_admin_read" ON shopify_tokens;
CREATE POLICY "platform_tokens_admin_read" ON shopify_tokens
  FOR SELECT USING (
    coalesce(current_setting('request.jwt.claims', true)::json->>'app_role','') = 'admin'
  );