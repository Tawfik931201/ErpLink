-- ─── إصلاح بحث السجلات: عمود نصي موحد + فهرس (2026-11-03 v2) ─────────────────
-- المشكلة: PostgREST or() filter لا يدعم ilike مع % wildcard بشكل صحيح
-- الحل: عمود مولد (generated column) يدمج كل الحقول القابلة للبحث كنص واحد،
-- ثم فلترة واحدة بـ ilike على هذا العمود — لا or()، لا parsing errors.
-- يتطابق 100% مع سلوك PayloadViewer: JSON.stringify(payload).toLowerCase().includes(query)

BEGIN;

-- 1) عمود نصي مولد (مخزن، ليس ظاهريًا) — يُحدّث تلقائياً عند كل INSERT/UPDATE
ALTER TABLE sync_logs
  ADD COLUMN IF NOT EXISTS search_text text
  GENERATED ALWAYS AS (
    coalesce(event, '') || ' ' ||
    coalesce(zid_entity_id, '') || ' ' ||
    coalesce(odoo_model, '') || ' ' ||
    coalesce(store_id, '') || ' ' ||
    coalesce(error_message, '') || ' ' ||
    coalesce(odoo_record_id::text, '') || ' ' ||
    coalesce(field_mapping_id::text, '') || ' ' ||
    coalesce(payload::text, '')
  ) STORED;

-- 2) فهرس GIN للبحث السريع بالـ trigram (يدعم ilike مع % في البداية)
CREATE EXTENSION IF NOT EXISTS pg_trgm;

CREATE INDEX IF NOT EXISTS idx_sync_logs_search_text_trgm
  ON sync_logs USING gin (search_text gin_trgm_ops);

-- 3) ترحيل البيانات الموجودة (لصفوف ما قبل إضافة العمود)
UPDATE sync_logs
  SET search_text = (
    coalesce(event, '') || ' ' ||
    coalesce(zid_entity_id, '') || ' ' ||
    coalesce(odoo_model, '') || ' ' ||
    coalesce(store_id, '') || ' ' ||
    coalesce(error_message, '') || ' ' ||
    coalesce(odoo_record_id::text, '') || ' ' ||
    coalesce(field_mapping_id::text, '') || ' ' ||
    coalesce(payload::text, '')
  )
  WHERE search_text IS NULL;

COMMIT;