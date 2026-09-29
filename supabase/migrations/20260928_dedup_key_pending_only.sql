-- =============================================================
-- Migration: dedup_key must scope to PENDING rows only
-- Run this in Supabase SQL Editor (idempotent, safe to re-run).
--
-- WHY
--
-- `dedup_key` identifies a DELIVERY, not a record. Its unique index exists so
-- a redelivered webhook cannot run twice. But both indexes were UNIQUE over
-- ALL rows, which turned them into a permanent veto:
--
--   sync_queue     : a finished/frozen/archived row with key K blocks any
--                    future event with key K, forever.
--   webhook_inbox  : a 'done' receipt with key K makes every later insert with
--                    key K fail with 23505, which the ingress treats as
--                    "duplicate" -> the event is acknowledged and dropped.
--
-- The practical damage was on Zid. Zid sends no delivery id, so the key was
-- derived from the payload's `uuid` — which is the ORDER/PRODUCT uuid, i.e.
-- record-scoped. Key = delivery:zid:<store>:<event>:<uuid> stays constant for
-- the life of the record, so:
--
--   order.create          -> enqueued, processed  OK
--   order.status.update #1 -> enqueued, processed  OK
--   order.status.update #2 -> 23505 -> dropped    LOST
--   order.status.update #3 -> 23505 -> dropped    LOST
--
-- Reconciliation (every 10 min) masked this for ORDERS only. Product updates
-- have no reconciliation path at all, so a merchant's 2nd+ edit of a Zid
-- product price/name never reached Odoo.
--
-- The fix has two halves and BOTH are required:
--   1. This migration — the unique constraint applies only to rows that are
--      actually in flight, so a settled row stops blocking new work.
--   2. `src/lib/sync-queue.ts` — the key is now derived from a payload
--      fingerprint when the platform sends no delivery id, so two genuinely
--      different updates produce two different keys.
--
-- Apply this migration BEFORE deploying the code change.
-- =============================================================

-- ─── 1. sync_queue: unique only while the row is still claimable ─────────────
-- `next_retry_at IS NULL` means exhausted/frozen, i.e. already settled.
-- Those rows keep their dedup_key for auditing but no longer veto new work.
DROP INDEX IF EXISTS public.uq_sync_queue_dedup_key;

CREATE UNIQUE INDEX IF NOT EXISTS uq_sync_queue_dedup_key
  ON public.sync_queue(dedup_key)
  WHERE dedup_key IS NOT NULL
    AND next_retry_at IS NOT NULL;

-- ─── 2. webhook_inbox: unique only while the receipt is unprocessed ──────────
-- A 'done' receipt must stop blocking. 'pending' rows keep the guard, which is
-- what makes a redelivery arriving mid-flight collapse to a single insert.
DROP INDEX IF EXISTS public.uq_webhook_inbox_dedup;

CREATE UNIQUE INDEX IF NOT EXISTS uq_webhook_inbox_dedup
  ON public.webhook_inbox(dedup_key)
  WHERE dedup_key IS NOT NULL
    AND status = 'pending';

-- ─── 3. Support indexes for the two lookups the drain/claim paths run ───────
-- idx_sync_queue_due and idx_webhook_inbox_pending already exist from
-- 20260922. Recreated defensively so this file stands alone.
CREATE INDEX IF NOT EXISTS idx_sync_queue_due
  ON public.sync_queue(next_retry_at)
  WHERE next_retry_at IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_webhook_inbox_pending
  ON public.webhook_inbox(received_at)
  WHERE status = 'pending';

-- ═══ PRE-FLIGHT (read-only) — run this FIRST, in a separate query ══════════
-- If either count is > 0, CREATE UNIQUE INDEX below will FAIL. The old global
-- indexes make that impossible today, so both should read 0.
--
--   SELECT 'dup pending sync_queue' AS check, COUNT(*) AS rows_with_duplicates
--     FROM (SELECT dedup_key FROM public.sync_queue
--            WHERE dedup_key IS NOT NULL AND next_retry_at IS NOT NULL
--            GROUP BY dedup_key HAVING COUNT(*) > 1) d;
--
--   SELECT 'dup pending inbox' AS check, COUNT(*) AS rows_with_duplicates
--     FROM (SELECT dedup_key FROM public.webhook_inbox
--            WHERE dedup_key IS NOT NULL AND status = 'pending'
--            GROUP BY dedup_key HAVING COUNT(*) > 1) d;
--
-- ═══ Verification — all four must report 'OK' ══════════════════════════════
SELECT 'uq_sync_queue_dedup_key is pending-only' AS check,
       CASE WHEN indexdef LIKE '%next_retry_at IS NOT NULL%'
            THEN 'OK' ELSE 'FAIL' END AS result
  FROM pg_indexes
 WHERE schemaname = 'public' AND indexname = 'uq_sync_queue_dedup_key'
UNION ALL
SELECT 'uq_webhook_inbox_dedup is pending-only',
       CASE WHEN indexdef LIKE '%status = ''pending''%'
            THEN 'OK' ELSE 'FAIL' END
  FROM pg_indexes
 WHERE schemaname = 'public' AND indexname = 'uq_webhook_inbox_dedup'
UNION ALL
SELECT 'no duplicate keys among pending queue rows',
       CASE WHEN COUNT(*) = 0 THEN 'OK' ELSE 'FAIL: ' || COUNT(*)::text END
  FROM (SELECT dedup_key FROM public.sync_queue
         WHERE dedup_key IS NOT NULL AND next_retry_at IS NOT NULL
         GROUP BY dedup_key HAVING COUNT(*) > 1) d
UNION ALL
SELECT 'sync_queue.next_retry_at nullable',
       CASE WHEN is_nullable = 'YES' THEN 'OK' ELSE 'FAIL' END
  FROM information_schema.columns
 WHERE table_schema = 'public' AND table_name = 'sync_queue'
   AND column_name = 'next_retry_at';
