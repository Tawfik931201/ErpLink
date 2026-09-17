-- =============================================================
-- Migration: Salla webhook hardening (bulk-safe intake)
-- =============================================================
-- 1. sync_queue.dedup_key — real idempotency for webhook deliveries.
--    Format written by the Salla webhook route:
--      'salla:<merchant_id>:<event>:<webhook_delivery_id>'
--    The partial UNIQUE index makes double-deliveries collapse into one
--    row even under concurrent bursts (race-safe, unlike the old
--    read-then-insert payload-contains check).
-- 2. Composite index for event coalescing lookups (same store + event).
-- 3. webhook_metrics — tiny per (store, event, platform) counter
--    (count + last_at) so bursts are observable without reading logs.
-- =============================================================

-- 1. dedup key column + partial unique index
ALTER TABLE sync_queue
  ADD COLUMN IF NOT EXISTS dedup_key TEXT;

CREATE UNIQUE INDEX IF NOT EXISTS uq_sync_queue_dedup_key
  ON sync_queue(dedup_key)
  WHERE dedup_key IS NOT NULL;

-- 2. coalescing lookup index (pending jobs for the same store + event)
CREATE INDEX IF NOT EXISTS idx_sync_queue_store_event
  ON sync_queue(store_id, event);

-- Backfill dedup keys for rows that already carried a delivery id in the
-- payload (best-effort; ignores conflicts from very old duplicates).
UPDATE sync_queue
SET dedup_key = 'salla:' || store_id || ':' || event || ':' || (payload->>'salla_webhook_id')
WHERE dedup_key IS NULL
  AND platform = 'salla'
  AND (payload->>'salla_webhook_id') IS NOT NULL
  AND (payload->>'salla_webhook_id') <> '';

-- 3. lightweight webhook metrics (count + last_at per store/event/platform)
CREATE TABLE IF NOT EXISTS webhook_metrics (
  store_id   TEXT NOT NULL,
  event      TEXT NOT NULL,
  platform   TEXT NOT NULL DEFAULT 'salla',
  count      BIGINT NOT NULL DEFAULT 0,
  last_at    TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (store_id, event, platform)
);
