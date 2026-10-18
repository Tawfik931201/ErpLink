-- 20261018_workspace_archive.sql
--
-- يضيف عمود `archived_at` إلى جدول `workspaces` لدعم سياسة:
-- عندما ينتهي اشتراك مساحة العمل ( ولم يكن هناك اشتراك نشط آخر ) يتم
-- "أرشفتها" — أي جعلها غير مفعلة — وتُسترجع تلقائياً عند تسجيل أو تمديد
-- اشتراك جديد من قبل الإدارة.
--
-- ⚠️ يُطبَّق على قاعدة بيانات Supabase مباشرة عبر محرر SQL.
-- يستخدم `to_regclass` و `IF NOT EXISTS` ليكون آمناً حتى لو تم تنفيذه أكثر
-- من مرة أو لو كان الجدول غير موجود في بعض البيئات.
--
-- ما يفعله:
--   1. ALTER TABLE: يضيف عمود `archived_at` (TIMESTAMPTZ) إلى `workspaces`.
--   2. CREATE INDEX: فهرس جزئي على `archived_at` فقط عندما لا يكون NULL
--      (أي المساحات المؤرشفة فقط) — لتسريع البحث عنها في `archiveExpiredWorkspaces`.

BEGIN;

-- ── 1. أضف العمود إذا لم يكن موجوداً ──
DO $$
BEGIN
  IF to_regclass('public.workspaces') IS NOT NULL THEN
    EXECUTE 'ALTER TABLE public.workspaces ADD COLUMN IF NOT EXISTS archived_at TIMESTAMPTZ';
  END IF;
END $$;

-- ── 2. فهرس جزئي على المساحات المؤرشفة فقط ──
DO $$
BEGIN
  IF to_regclass('public.workspaces') IS NOT NULL THEN
    EXECUTE 'CREATE INDEX IF NOT EXISTS idx_workspaces_archived_at ON public.workspaces (archived_at) WHERE archived_at IS NOT NULL';
  END IF;
END $$;

COMMIT;

-- ── للتحقق بعد التنفيذ ──
-- SELECT column_name, data_type FROM information_schema.columns
--   WHERE table_name = 'workspaces' AND column_name = 'archived_at';
-- المتوقع: archived_at | timestamp with time zone
