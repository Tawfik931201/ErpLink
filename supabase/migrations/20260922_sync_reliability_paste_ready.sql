-- ============================================================================
-- Sync Reliability -- paste-ready for Supabase SQL Editor
-- Safe to run more than once. Wrapped in a transaction: either all of it
-- applies, or none of it does (no half-broken state).
--
-- ⚠️ DUPLICATE OF `20260922_sync_reliability.sql` — NOT THE SOURCE OF TRUTH.
-- The same statements in the same order. Three differences, all deliberate and
-- all verified: every identifier is `public.`-qualified (the SQL Editor's
-- search_path is not the app's), `idx_sync_logs_match` is wrapped in a
-- `to_regclass('public.sync_logs')` guard so it is skipped instead of erroring
-- on a project without that table, and the whole thing sits in BEGIN/COMMIT.
--
-- That last difference is the reason this file is NOT byte-for-byte identical
-- (162 lines vs 113) — it is statement-for-statement equivalent, not a copy.
-- `20260922_sync_reliability.sql` is the canonical file; AGENTS.md names it as
-- the required migration. This copy exists only because the SQL Editor cannot
-- open a path, so the statements are handy to paste by hand. Running both is
-- harmless (every statement is IF NOT EXISTS / DROP-guarded) but pointless.
-- ============================================================================

BEGIN;

-- --- 1. sync_queue.next_retry_at must be NULLABLE ---------------------------
-- The queue code uses NULL as the "exhausted / needs review" marker, but the
-- column was declared NOT NULL. Every exhaustion update therefore failed
-- silently and the row stayed stuck in the queue forever, burning a worker
-- slot on every cron tick.
ALTER TABLE public.sync_queue ALTER COLUMN next_retry_at DROP NOT NULL;

-- --- 2. dedup_key (atomic idempotency for every platform) -------------------
ALTER TABLE public.sync_queue ADD COLUMN IF NOT EXISTS dedup_key TEXT;

-- Race-safe dedup: two concurrent workers inserting the same delivery, only
-- one row survives. This is what makes "no duplicate work" true under load.
CREATE UNIQUE INDEX IF NOT EXISTS uq_sync_queue_dedup_key
  ON public.sync_queue(dedup_key)
  WHERE dedup_key IS NOT NULL;

-- --- 3. cheap "claim due rows" index (pending rows only) --------------------
-- Partial index, so it only contains rows that still need work. This is what
-- keeps the per-minute cron cheap even as the table grows.
CREATE INDEX IF NOT EXISTS idx_sync_queue_due
  ON public.sync_queue(next_retry_at)
  WHERE next_retry_at IS NOT NULL;

-- --- 4. webhook_inbox -- durable receipt written BEFORE any processing -------
-- A webhook is acknowledged to the store only after this row commits, so
-- nothing is lost if enqueueing fails or the server restarts. The cron
-- re-drives anything still 'pending'. workspace_id is nullable on purpose:
-- events for an unlinked store are kept as orphans, never discarded.
CREATE TABLE IF NOT EXISTS public.webhook_inbox (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  platform      TEXT NOT NULL,
  store_id      TEXT NOT NULL,
  workspace_id  UUID REFERENCES public.workspaces(id) ON DELETE SET NULL,
  event         TEXT NOT NULL,
  dedup_key     TEXT,
  payload       JSONB NOT NULL DEFAULT '{}'::jsonb,
  status        TEXT NOT NULL DEFAULT 'pending',
  attempts      INT NOT NULL DEFAULT 0,
  last_error    TEXT,
  received_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  processed_at  TIMESTAMPTZ,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_webhook_inbox_dedup
  ON public.webhook_inbox(dedup_key)
  WHERE dedup_key IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_webhook_inbox_pending
  ON public.webhook_inbox(received_at)
  WHERE status = 'pending';

-- --- 5. sync_queue_dead -- dead-letter archive -------------------------------
-- Exhausted jobs are MOVED here, never hard-deleted, so a failure is always
-- auditable and replayable while the live queue stays bounded.
CREATE TABLE IF NOT EXISTS public.sync_queue_dead (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  original_id   UUID,
  workspace_id  UUID,
  store_id      TEXT,
  event         TEXT NOT NULL,
  platform      TEXT NOT NULL,
  dedup_key     TEXT,
  payload       JSONB NOT NULL DEFAULT '{}'::jsonb,
  error_message TEXT,
  retry_count   INT,
  died_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_sync_queue_dead_died
  ON public.sync_queue_dead(died_at);

-- Overlapping cron runs must not duplicate the archive.
CREATE UNIQUE INDEX IF NOT EXISTS uq_sync_queue_dead_original
  ON public.sync_queue_dead(original_id)
  WHERE original_id IS NOT NULL;

-- --- 6. sync_reconcile_state -- reconciliation watermark ---------------------
-- How far each store has been reconciled. This is what heals webhooks the
-- platform dropped (Zid goes "broken" and skips events, Salla retries 3 times,
-- Shopify gives up after 4 hours, an Odoo automated action can fail silently).
CREATE TABLE IF NOT EXISTS public.sync_reconcile_state (
  scope         TEXT PRIMARY KEY,
  last_success  TIMESTAMPTZ,
  last_attempt  TIMESTAMPTZ,
  last_error    TEXT,
  items_seen    BIGINT NOT NULL DEFAULT 0,
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- --- 7. tenant-safe match lookup index on sync_logs ------------------------
-- Record matching filters on (workspace_id + zid_entity_id + odoo_model).
-- Without this index every product match scans the entire log table, which is
-- real, measurable server load. Guarded because this table predates the
-- migrations folder on some databases.
DO $$
BEGIN
  IF to_regclass('public.sync_logs') IS NOT NULL THEN
    EXECUTE 'CREATE INDEX IF NOT EXISTS idx_sync_logs_match
             ON public.sync_logs(workspace_id, zid_entity_id, odoo_model)
             WHERE odoo_record_id IS NOT NULL';
  ELSE
    RAISE NOTICE 'sync_logs table not found -- skipped idx_sync_logs_match (harmless)';
  END IF;
END $$;

-- --- 8. RLS on the new tables (defence in depth) ---------------------------
-- The app reads and writes everything with the service-role key, which bypasses
-- RLS. These payloads contain customer data (orders, addresses, phones). With
-- RLS enabled and no policies, a leaked anon key cannot read or modify them.
ALTER TABLE public.webhook_inbox       ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.sync_queue_dead     ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.sync_reconcile_state ENABLE ROW LEVEL SECURITY;

COMMIT;

-- ============================================================================
-- VERIFICATION -- you should get one row per table with exists = true
-- ============================================================================
SELECT 'sync_queue.dedup_key column'      AS check_name,
       EXISTS (SELECT 1 FROM information_schema.columns
               WHERE table_schema='public' AND table_name='sync_queue'
                 AND column_name='dedup_key') AS ok
UNION ALL
SELECT 'sync_queue.next_retry_at nullable',
       EXISTS (SELECT 1 FROM information_schema.columns
               WHERE table_schema='public' AND table_name='sync_queue'
                 AND column_name='next_retry_at' AND is_nullable='YES')
UNION ALL
SELECT 'uq_sync_queue_dedup_key index',
       EXISTS (SELECT 1 FROM pg_indexes
               WHERE schemaname='public' AND indexname='uq_sync_queue_dedup_key')
UNION ALL
SELECT 'webhook_inbox table',
       to_regclass('public.webhook_inbox') IS NOT NULL
UNION ALL
SELECT 'sync_queue_dead table',
       to_regclass('public.sync_queue_dead') IS NOT NULL
UNION ALL
SELECT 'sync_reconcile_state table',
       to_regclass('public.sync_reconcile_state') IS NOT NULL
ORDER BY check_name;
