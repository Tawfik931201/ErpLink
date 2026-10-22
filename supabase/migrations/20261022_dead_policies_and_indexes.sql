-- 2026-10-22: dead-policy drop + index hygiene (paste-ready)
-- Companion to 20261022_db_cleanup_and_cascade.sql. Applied via MCP the same day.
--
-- Why: the app authenticates with Clerk and writes with the service_role key only,
-- so NO Supabase session exists and every auth.uid() / request.jwt.claims-based
-- RLS policy always evaluates false. Those ~75 policies were dead weight while
-- still costing the auth_rls_initplan (53 findings) and multiple_permissive_policies
-- (10 findings) lints. Policy-less RLS stays the intended posture: deny-all for
-- anon/authenticated (whose table privileges were fully revoked earlier), and
-- service_role bypasses RLS as before.

BEGIN;

DO $$
DECLARE r record;
BEGIN
  FOR r IN
    SELECT schemaname, tablename, policyname
    FROM pg_policies
    WHERE schemaname = 'public'
  LOOP
    EXECUTE format('DROP POLICY IF EXISTS %I ON public.%I', r.policyname, r.tablename);
  END LOOP;
END $$;

-- Redundant duplicate indexes (the real cause of most "unused index" findings)
DROP INDEX IF EXISTS public.idx_custom_odoo_fields_workspace_id;    -- dup of idx_custom_odoo_fields_workspace
DROP INDEX IF EXISTS public.idx_odoo_connections_workspace_id;     -- dup of UNIQUE odoo_connections_workspace_id_key
DROP INDEX IF EXISTS public.idx_standard_mapping_settings_ws_store;-- left-prefix of uq_standard_mapping_settings_ws_store_entity
DROP INDEX IF EXISTS public.idx_sync_logs_workspace_id;            -- left-prefix of idx_sync_logs_workspace_created
DROP INDEX IF EXISTS public.idx_shopify_tokens_workspace;          -- dup of shopify_tokens_workspace_id_idx (applied separately)

-- Covering indexes for foreign keys the perf linter flagged as unindexed
CREATE INDEX IF NOT EXISTS idx_data_transfers_ws_created        ON public.data_transfers(workspace_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_data_transfers_ws_status_created ON public.data_transfers(workspace_id, status, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_field_mappings_erp_connection    ON public.field_mappings(erp_connection_id);
CREATE INDEX IF NOT EXISTS idx_merchant_tokens_workspace        ON public.merchant_tokens(workspace_id);
CREATE INDEX IF NOT EXISTS idx_salla_tokens_workspace           ON public.salla_tokens(workspace_id);
CREATE INDEX IF NOT EXISTS idx_sync_logs_field_mapping          ON public.sync_logs(field_mapping_id);
CREATE INDEX IF NOT EXISTS idx_telegram_outbox_bot              ON public.telegram_outbox(bot_id);
CREATE INDEX IF NOT EXISTS idx_users_active_workspace           ON public.users(active_workspace_id);
CREATE INDEX IF NOT EXISTS idx_workspace_members_user           ON public.workspace_members(user_id);
CREATE INDEX IF NOT EXISTS idx_workspaces_user_created          ON public.workspaces(user_id, created_at DESC);

COMMIT;

-- Deliberately KEPT despite the unused-index lint (deliberate design, hot at real season):
--   idx_audit_logs_{actor,action,entity,created}   (admin audit page filters)
--   idx_telegram_bot_codes_expires                  (expired-code cleanup)
--   idx_workspace_invitations_email                 (invitation lookup by email)
--   idx_workspaces_archived_at                      (archiveExpiredWorkspaces pass)
-- The lint fires only because every table currently holds test-data volume.
