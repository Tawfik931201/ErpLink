-- ─── إصلاح بحث السجلات: عمود نصي موحد + فهرس Trigram ─────────────────
-- يحل مشكلة PostgREST or() parser مع % wildcards
-- يتطابق 100% مع سلوك PayloadViewer: JSON.stringify(payload).toLowerCase().includes(query)

BEGIN;

-- 1) عمود نصي مولد (مخزن، يُحدّث تلقائياً عند كل INSERT/UPDATE)
-- PostgreSQL يحسب القيمة لجميع الصفوف الموجودة تلقائياً عند ADD COLUMN
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

-- 2) تفعيل امتداد pg_trgm + فهرس GIN للبحث السريع بالـ trigram
CREATE EXTENSION IF NOT EXISTS pg_trgm;

CREATE INDEX IF NOT EXISTS idx_sync_logs_search_text_trgm
  ON sync_logs USING gin (search_text gin_trgm_ops);

-- ملاحظة: لا حاجة لـ UPDATE يدوي — العمود المولد يُحسب تلقائياً للصفوف الموجودة

COMMIT;