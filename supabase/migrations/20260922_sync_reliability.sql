-- =============================================================
-- Migration: Sync reliability — zero webhook loss + low server load
-- Run this in Supabase → SQL Editor (idempotent, safe to re-run).
-- =============================================================
-- 1. sync_queue.next_retry_at → NULLABLE
--    The queue code already uses NULL as the "exhausted / needs manual
--    review" marker, but the column was declared NOT NULL. Every
--    exhaustion update therefore failed silently and the row stayed
--    stuck in the queue forever, burning a worker slot on every cron tick.
-- 2. dedup_key unique index (already present from 20260910) — restated so
--    this migration is self-sufficient on databases missing it.
-- 3. Partial index for the "claim due rows" query. Keeps the index tiny
--    (only pending rows) which is what keeps the per-minute cron cheap.
-- 4. webhook_inbox — durable receipt written BEFORE any processing.
--    A webhook is acknowledged to the store only after this row commits,
--    so nothing is lost if enqueueing fails or the server restarts.
--    The cron re-drives anything still 'pending'.
-- 5. sync_queue_dead — dead-letter archive. Exhausted jobs are MOVED
--    here, never hard-deleted, so nothing is silently lost while the
--    table stays bounded.
-- =============================================================

-- ─── 1. nullable next_retry_at ───────────────────────────────────────────────
ALTER TABLE sync_queue ALTER COLUMN next_retry_at DROP NOT NULL;

-- ─── 2. dedup_key (race-safe idempotency for every platform) ─────────────────
ALTER TABLE sync_queue ADD COLUMN IF NOT EXISTS dedup_key TEXT;

CREATE UNIQUE INDEX IF NOT EXISTS uq_sync_queue_dedup_key
  ON sync_queue(dedup_key)
  WHERE dedup_key IS NOT NULL;

-- ─── 3. cheap "claim due rows" index (pending rows only) ─────────────────────
CREATE INDEX IF NOT EXISTS idx_sync_queue_due
  ON sync_queue(next_retry_at)
  WHERE next_retry_at IS NOT NULL;

-- ─── 4. durable webhook inbox ────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS webhook_inbox (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  platform      TEXT NOT NULL,
  store_id      TEXT NOT NULL,
  workspace_id  UUID REFERENCES workspaces(id) ON DELETE SET NULL,
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
  ON webhook_inbox(dedup_key)
  WHERE dedup_key IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_webhook_inbox_pending
  ON webhook_inbox(received_at)
  WHERE status = 'pending';

-- ─── 5. dead-letter archive ──────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS sync_queue_dead (
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

CREATE INDEX IF NOT EXISTS idx_sync_queue_dead_died ON sync_queue_dead(died_at);

-- أرشفة متكرّرة (cronان متداخلان) لا تُنتج صفوفاً مكرّرة: المفتاح الفريد
-- يجعل الإدراج الثاني ignored بدل تضخيم أرشيف الموتى.
CREATE UNIQUE INDEX IF NOT EXISTS uq_sync_queue_dead_original
  ON sync_queue_dead(original_id)
  WHERE original_id IS NOT NULL;

-- ─── 6. فهرس المطابقة المستأجر-آمن على sync_logs ────────────────────────────
-- Match lookup uses (workspace_id + zid_entity_id + odoo_model). Without this
-- index every product match scans the whole log table = real server load.
CREATE INDEX IF NOT EXISTS idx_sync_logs_match
  ON sync_logs(workspace_id, zid_entity_id, odoo_model)
  WHERE odoo_record_id IS NOT NULL;

-- ─── 7. حالة التسوية (reconciliation watermark) ──────────────────────────────
-- آخر نقطة زمنية اكتملت التسوية حتى عنها لكل مستأجر/مصدر. يسمح للأداة
-- باستعادة أي حدث أسقطته المنصة (Zid يتجاهل الأحداث عند "broken"،
-- Shopify/Salla لها إعادة إرسال محدودة).
CREATE TABLE IF NOT EXISTS sync_reconcile_state (
  scope         TEXT PRIMARY KEY,
  last_success  TIMESTAMPTZ,
  last_attempt  TIMESTAMPTZ,
  last_error    TEXT,
  items_seen    BIGINT NOT NULL DEFAULT 0,
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ─── 8. RLS على الجداول الجديدة (دفاع عميق) ─────────────────────────────────
-- التطبيق يقرأ/يكتب كل شيء بمفتاح service role (يتجاوز RLS)، لكن هذه الحمولات
-- تحتوي بيانات عملاء (طلبات، عناوين، هواتف). تفعيل RLS بلا سياسات يعني أن
-- لو تسريب مفتاح anon يوماً لن تكون قابلة للقراءة أو التعديل.
ALTER TABLE webhook_inbox     ENABLE ROW LEVEL SECURITY;
ALTER TABLE sync_queue_dead   ENABLE ROW LEVEL SECURITY;
ALTER TABLE sync_reconcile_state ENABLE ROW LEVEL SECURITY;
