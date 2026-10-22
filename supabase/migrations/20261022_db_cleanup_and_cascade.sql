-- 2026-10-22: DB cleanup + workspace cascade completion (paste-ready, BEGIN/COMMIT)
-- Review summary:
--   1. Legacy affiliate system (removed 2026-09-10): 7 tables, all 0 rows, 0 code references
--      + 7 unused columns on subscriptions/workspaces -> DROPPED (user-authorized, data is test data).
--   2. CASCADE gap: sync_logs / custom_odoo_fields / sync_queue_dead carry workspace_id but had
--      NO foreign key -> workspace deletion left orphan rows (logs included). webhook_inbox was
--      SET NULL by design for *unlinked store* receipts, but deleting a workspace orphaned its
--      own receipts. All four are now ON DELETE CASCADE to public.workspaces(id).
--   3. Security: custom_odoo_fields carried an RLS policy with qual = TRUE (open to anyone with
--      the anon key). anon/authenticated held full table privileges incl. TRUNCATE, which BYPASSES
--      RLS entirely. All revoked (the app talks to Supabase with service_role only).
-- Notes:
--   - audit_logs is a global admin trail (no workspace_id) -> intentionally kept.
--   - sync_reconcile_state uses varchar scopes, not FKs -> kept.
--   - webhook_legacy_counters + increment_legacy_delivery(text) kept until the legacy-delivery
--     counter reaches 0 (see AGENTS.md Ingress auth); EXECUTE is already restricted to service_role.
--   - users.active_workspace_id stays SET NULL (a user must survive workspace deletion).

BEGIN;

-- ── 0) Policies that depend on the legacy affiliate columns (dropped first) ──────────
-- (apply_migrations hit 2BP01 without this: policies depend on the dropped columns)
DROP POLICY IF EXISTS subscriptions_affiliate_read ON public.subscriptions;
DROP POLICY IF EXISTS workspaces_partner_read ON public.workspaces;

-- ── 1) Legacy affiliate columns (FKs to partner_* or partner bookkeeping) ─────────────
ALTER TABLE public.subscriptions DROP COLUMN IF EXISTS affiliate_id;

ALTER TABLE public.workspaces
  DROP COLUMN IF EXISTS partner_id,
  DROP COLUMN IF EXISTS partner_status,
  DROP COLUMN IF EXISTS partner_linked_at,
  DROP COLUMN IF EXISTS partner_link_requested_by,
  DROP COLUMN IF EXISTS partner_approved_by_admin,
  DROP COLUMN IF EXISTS partner_approved_admin_at;

-- ── 2) Legacy affiliate tables (all empty, zero code references) ──────────────────────
-- Order matters: children reference partner_profiles and payout_requests.
DROP TABLE IF EXISTS public.affiliate_client_invites;          -- FK -> partner_profiles
DROP TABLE IF EXISTS public.partner_tier_history;              -- FK -> partner_profiles
DROP TABLE IF EXISTS public.partner_agreements;                -- FK -> partner_profiles + workspaces
DROP TABLE IF EXISTS public.partner_commissions;               -- FK -> partner_profiles + workspaces + payout_requests
DROP TABLE IF EXISTS public.partner_onboarding_invitations;    -- FK -> partner_profiles + workspaces
DROP TABLE IF EXISTS public.payout_requests;                   -- FK -> partner_profiles
DROP TABLE IF EXISTS public.partner_profiles;                  -- root

-- ── 3) The missed FKs: workspace deletion must take logs with it ─────────────────────
-- No orphans existed at review time (verified 2026-10-22: 0 orphan rows each).
ALTER TABLE public.sync_logs
  ADD CONSTRAINT sync_logs_workspace_id_fkey
  FOREIGN KEY (workspace_id) REFERENCES public.workspaces(id) ON DELETE CASCADE;

ALTER TABLE public.custom_odoo_fields
  ADD CONSTRAINT custom_odoo_fields_workspace_id_fkey
  FOREIGN KEY (workspace_id) REFERENCES public.workspaces(id) ON DELETE CASCADE;

ALTER TABLE public.sync_queue_dead
  ADD CONSTRAINT sync_queue_dead_workspace_id_fkey
  FOREIGN KEY (workspace_id) REFERENCES public.workspaces(id) ON DELETE CASCADE;

-- webhook_inbox: workspace_id was SET NULL on workspace deletion (stale receipts would linger)
ALTER TABLE public.webhook_inbox DROP CONSTRAINT IF EXISTS webhook_inbox_workspace_id_fkey;
ALTER TABLE public.webhook_inbox
  ADD CONSTRAINT webhook_inbox_workspace_id_fkey
  FOREIGN KEY (workspace_id) REFERENCES public.workspaces(id) ON DELETE CASCADE;

-- ── 4) Security fixes ────────────────────────────────────────────────────────────────
-- 4a. custom_odoo_fields granted EVERYONE everything (qual = true). The app only ever touches
--     this table with service_role, which bypasses RLS. Dropping the policy returns the table
--     to the same deny-all state as the other 15 policy-less tables.
DROP POLICY IF EXISTS workspace_access ON public.custom_odoo_fields;

-- 4b. anon/authenticated held full privileges on every public table INCLUDING truncate,
--     and TRUNCATE is not subject to RLS — a leaked anon key could wipe any table.
--     The app is service_role-only: revoke both principals wholesale.
REVOKE ALL ON ALL TABLES IN SCHEMA public FROM anon, authenticated;
REVOKE ALL ON ALL SEQUENCES IN SCHEMA public FROM anon, authenticated;
REVOKE ALL ON ALL FUNCTIONS IN SCHEMA public FROM anon, authenticated;

-- 4c. Future tables must not re-inherit the blanket grants (tables are created by the
--     `postgres` owner here, so the default-privileges ACL is re-tightened under it).
DO $$
DECLARE r record;
BEGIN
  FOR r IN SELECT DISTINCT defaclrole::regrole AS role_owner
           FROM pg_default_acl
           WHERE defaclnamespace = 'public'::regnamespace
             AND (pg_get_userbyid(defaclrole) = 'postgres') LOOP
    EXECUTE format('ALTER DEFAULT PRIVILEGES FOR ROLE %I IN SCHEMA public REVOKE ALL ON TABLES FROM anon, authenticated', r.role_owner);
    EXECUTE format('ALTER DEFAULT PRIVILEGES FOR ROLE %I IN SCHEMA public REVOKE ALL ON SEQUENCES FROM anon, authenticated', r.role_owner);
    EXECUTE format('ALTER DEFAULT PRIVILEGES FOR ROLE %I IN SCHEMA public REVOKE ALL ON FUNCTIONS FROM anon, authenticated', r.role_owner);
  END LOOP;
END $$;

COMMIT;

-- ── 5) Covering indexes for the new FKs (performance advisor) ───────────────────────
-- (applied as a second migration, recorded here for completeness)
-- CREATE INDEX IF NOT EXISTS idx_webhook_inbox_workspace_id ON public.webhook_inbox(workspace_id);
-- CREATE INDEX IF NOT EXISTS idx_sync_queue_dead_workspace_id ON public.sync_queue_dead(workspace_id);
-- CREATE INDEX IF NOT EXISTS idx_custom_odoo_fields_workspace_id ON public.custom_odoo_fields(workspace_id);

-- ── 6) 2026-10-22 (later pass): dead policies + index hygiene ───────────────────────
-- Full detail in supabase/migrations/20261022_dead_policies_and_indexes.sql.
-- Summary: every remaining auth.uid()-based RLS policy in public was dropped (dead --
-- the app is Clerk + service_role only), 4 redundant duplicate index were dropped
-- (two of them caused the "unused index" lint), and covering indexes were added for
-- 11 foreign keys the performance advisor flagged as unindexed.
-- Deliberately KEPT despite the unused-index lint (deliberate design, will be used at
-- first real season): idx_audit_logs_{actor,action,entity,created},
-- idx_telegram_bot_codes_expires, idx_workspace_invitations_email,
-- idx_workspaces_archived_at. The lint fires because tables hold only test-data rows.

-- ── Verification (run after apply) ───────────────────────────────────────────────────
-- SELECT conname, confdeltype FROM pg_constraint
--  WHERE connamespace='public'::regnamespace AND contype='f'
--    AND conrelid IN ('public.sync_logs'::regclass,'public.custom_odoo_fields'::regclass,
--                     'public.sync_queue_dead'::regclass,'public.webhook_inbox'::regclass)
--    AND confdeltype = 'c';  -- expect 4 rows
--
-- SELECT tablename, policyname FROM pg_policies WHERE schemaname='public' AND tablename='custom_odoo_fields';
--   -- expect: no rows
--
-- SELECT table_name, privilege_type, grantee FROM information_schema.role_table_grants
--  WHERE table_schema='public' AND grantee IN ('anon','authenticated');
--   -- expect: no rows
--
-- Full-cascade smoke test (safe on test data):
--   BEGIN;
--   DELETE FROM public.workspaces WHERE id = '<workspace_id>';
--   SELECT count(*) FROM public.sync_logs WHERE workspace_id = '<workspace_id>';      -- 0
--   SELECT count(*) FROM public.custom_odoo_fields WHERE workspace_id = '<workspace_id>'; -- 0
--   ROLLBACK;
