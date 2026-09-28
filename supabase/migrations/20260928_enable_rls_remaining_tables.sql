-- =============================================================
-- Migration: Enable RLS on remaining public tables
-- Date: 2026-09-28
-- =============================================================
-- Fixes Supabase lint "RLS Disabled in Public" for tables that
-- were created without RLS (Prisma `db push` or a live-DB drift):
--   user_settings, salla_tokens, sync_logs, data_transfers,
--   plus the salla_tokens siblings merchant_tokens / shopify_tokens.
--
-- All application access goes through the service-role key (RLS
-- bypassed), so these policies only restrict anon/authenticated
-- (browser/PostgREST) access. They do NOT change app behaviour.
--
-- Idempotent: each statement uses IF EXISTS / re-CREATE, safe to re-run.
-- =============================================================

-- 1. user_settings — each user reads/writes only their own row.
ALTER TABLE public.user_settings ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "user_settings_owner_all" ON public.user_settings;
CREATE POLICY "user_settings_owner_all" ON public.user_settings
  FOR ALL
  USING (user_id = auth.uid()::text)
  WITH CHECK (user_id = auth.uid()::text);

-- 2. salla_tokens — admin-only read (same policy as 20260909).
ALTER TABLE public.salla_tokens ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "platform_tokens_admin_read" ON public.salla_tokens;
CREATE POLICY "platform_tokens_admin_read" ON public.salla_tokens
  FOR SELECT USING (
    coalesce(current_setting('request.jwt.claims', true)::json->>'app_role','') = 'admin'
  );

-- 3. sync_logs — workspace-scoped (workspace_members).
ALTER TABLE public.sync_logs ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users can view their workspace sync_logs"   ON public.sync_logs;
CREATE POLICY "Users can view their workspace sync_logs"           ON public.sync_logs
  FOR SELECT USING (workspace_id IN (SELECT workspace_id FROM workspace_members WHERE user_id = auth.uid()::text));

DROP POLICY IF EXISTS "Users can insert their workspace sync_logs" ON public.sync_logs;
CREATE POLICY "Users can insert their workspace sync_logs"         ON public.sync_logs
  FOR INSERT WITH CHECK (workspace_id IN (SELECT workspace_id FROM workspace_members WHERE user_id = auth.uid()::text));

DROP POLICY IF EXISTS "Users can update their workspace sync_logs" ON public.sync_logs;
CREATE POLICY "Users can update their workspace sync_logs"         ON public.sync_logs
  FOR UPDATE USING (workspace_id IN (SELECT workspace_id FROM workspace_members WHERE user_id = auth.uid()::text));

DROP POLICY IF EXISTS "Users can delete their workspace sync_logs" ON public.sync_logs;
CREATE POLICY "Users can delete their workspace sync_logs"         ON public.sync_logs
  FOR DELETE USING (workspace_id IN (SELECT workspace_id FROM workspace_members WHERE user_id = auth.uid()::text));

-- 4. data_transfers — workspace-scoped (workspace_members).
ALTER TABLE public.data_transfers ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users can view their workspace data_transfers"   ON public.data_transfers;
CREATE POLICY "Users can view their workspace data_transfers"           ON public.data_transfers
  FOR SELECT USING (workspace_id IN (SELECT workspace_id FROM workspace_members WHERE user_id = auth.uid()::text));

DROP POLICY IF EXISTS "Users can insert their workspace data_transfers" ON public.data_transfers;
CREATE POLICY "Users can insert their workspace data_transfers"         ON public.data_transfers
  FOR INSERT WITH CHECK (workspace_id IN (SELECT workspace_id FROM workspace_members WHERE user_id = auth.uid()::text));

DROP POLICY IF EXISTS "Users can update their workspace data_transfers" ON public.data_transfers;
CREATE POLICY "Users can update their workspace data_transfers"         ON public.data_transfers
  FOR UPDATE USING (workspace_id IN (SELECT workspace_id FROM workspace_members WHERE user_id = auth.uid()::text));

DROP POLICY IF EXISTS "Users can delete their workspace data_transfers" ON public.data_transfers;
CREATE POLICY "Users can delete their workspace data_transfers"         ON public.data_transfers
  FOR DELETE USING (workspace_id IN (SELECT workspace_id FROM workspace_members WHERE user_id = auth.uid()::text));

-- 5. merchant_tokens / shopify_tokens — same admin-read policy as salla_tokens.
--    No-ops if already enabled on this DB.
ALTER TABLE public.merchant_tokens ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "platform_tokens_admin_read" ON public.merchant_tokens;
CREATE POLICY "platform_tokens_admin_read" ON public.merchant_tokens
  FOR SELECT USING (
    coalesce(current_setting('request.jwt.claims', true)::json->>'app_role','') = 'admin'
  );

ALTER TABLE public.shopify_tokens ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "platform_tokens_admin_read" ON public.shopify_tokens;
CREATE POLICY "platform_tokens_admin_read" ON public.shopify_tokens
  FOR SELECT USING (
    coalesce(current_setting('request.jwt.claims', true)::json->>'app_role','') = 'admin'
  );