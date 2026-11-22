-- supabase/migrations/20261122_drop_search_vector.sql
--
-- إزالة عمود search_vector والـ trigger والـ GIN index المرتبط به من جدول sync_logs.
-- السبب:
--   - عمود search_text (STORED generated column) مع فهرس pg_trgm GIN index
--     يغطي بالكامل البحث الفعلي المستخدم في /app/logs و src/lib/sync-log-search.ts.
--   - trg_sync_logs_search_vector يستهلك موارد PostgreSQL عند كل عملية INSERT / UPDATE
--     على sync_logs ويولّد سجلات تنفيذ مستمرة تزيد من استهلاك Log Ingestion في Supabase.
--   - لا يوجد أي استعلام في التطبيق يعتمد على search_vector.

BEGIN;

-- 1) حذف التريجر المرتبط بالجدول
DROP TRIGGER IF EXISTS trg_sync_logs_search_vector ON public.sync_logs;

-- 2) حذف الدالة المرافقة للتريجر
DROP FUNCTION IF EXISTS public.sync_logs_search_vector_build();

-- 3) حذف فهرس GIN
DROP INDEX IF EXISTS public.idx_sync_logs_search_vector;

-- 4) حذف العمود من الجدول
ALTER TABLE public.sync_logs
  DROP COLUMN IF EXISTS search_vector;

COMMIT;
