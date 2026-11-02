-- ─── بحث شامل داخل سجلات المزامنة (2026-11-03) ────────────────────────────
-- مربعبحث في /app/logs كان يبحث فقط في الأعمدة النصية المكتوبة بالوضوح
-- (event / zid_entity_id / odoo_model / store_id). عدّ المُستخدم ي wanted يكتب
-- مثلاً اسم طلب ويظهر كل السجلات التي يحتوي هذا الاسم — والاسم دا ي leverage
-- جوا الـ payload (البيانات المستلمة من المتجر) أو في error_message.
-- --
-- حل: عمود tsvector يُحدَّث تلقائياً بـ trigger من كل الحقول النصية +
-- payload، وفهرس Gين يخدم بحث `.plfts` (plainto_tsquery) بسعة فهرس بدل
-- سكان كل صف. الـ trigger means مسارات/all write paths
-- (sync-runtime / sync-engine / odoo route) never need to know about it.
--
-- آمن لإعادة التطبيق (IF NOT EXISTS + to_regclass).

BEGIN;

-- 1) عمود بحث مُفهرس
ALTER TABLE sync_logs
  ADD COLUMN IF NOT EXISTS search_vector tsvector NOT NULL DEFAULT '';

-- 2) فهرس GIN — يخدم `search_vector.plfts.<needle>` في PostgREST
CREATE INDEX IF NOT EXISTS idx_sync_logs_search_vector
  ON sync_logs USING gin (search_vector);

-- 3) توليد القيمة تلقائياً عند الإضافة/التعديل
CREATE OR REPLACE FUNCTION sync_logs_search_vector_build()
RETURNS trigger AS $$
BEGIN
  NEW.search_vector := to_tsvector(
    coalesce(NEW.event, '') || ' ' ||
    coalesce(NEW.zid_entity_id, '') || ' ' ||
    coalesce(NEW.odoo_model, '') || ' ' ||
    coalesce(NEW.store_id, '') || ' ' ||
    coalesce(NEW.error_message, '') || ' ' ||
    coalesce(NEW.odoo_record_id::text, '') || ' ' ||
    coalesce(NEW.field_mapping_id::text, '') || ' ' ||
    coalesce(NEW.payload::text, '')
  );
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_sync_logs_search_vector ON sync_logs;
CREATE TRIGGER trg_sync_logs_search_vector
  BEFORE INSERT OR UPDATE ON sync_logs
  FOR EACH ROW EXECUTE FUNCTION sync_logs_search_vector_build();

-- 4) ترحيل الصفوف القديمة (مرة واحدة)
UPDATE sync_logs
  SET search_vector = to_tsvector(
    coalesce(event, '') || ' ' ||
    coalesce(zid_entity_id, '') || ' ' ||
    coalesce(odoo_model, '') || ' ' ||
    coalesce(store_id, '') || ' ' ||
    coalesce(error_message, '') || ' ' ||
    coalesce(odoo_record_id::text, '') || ' ' ||
    coalesce(field_mapping_id::text, '') || ' ' ||
    coalesce(payload::text, '')
  )
  WHERE search_vector = '' OR search_vector IS NULL;

COMMIT;