-- تسريع صفحة سجلات المزامنة (/app/logs): عمود منطقي + فهارس مركبة.
-- المشكلة: كشف "تم الحل يدوياً" كان بحثاً نصياً (ilike %...%) لا يخدمه أي
-- فهرس، والعدّ الدقيق والقائمة كانا يمسحان كل صفوف الورك سبيس بلا فهرس.
-- الحل: عمود boolean يُكتب مرة واحدة عند التعليم اليدوي، وكل القراءات
-- (فلاتر + عدّادات) تصبح مسح فهارس فقط.
-- طبّق هذا الملف من Supabase SQL Editor قبل نشر الكود (الكود الجديد يقرأ
-- العمود، وبدونه يفشل الاستعلام). آمن لإعادة التطبيق (IF NOT EXISTS).

-- 1) عمود "حُلّ يدوياً" (metadata-only، لا يعيد كتابة الجدول).
ALTER TABLE sync_logs
  ADD COLUMN IF NOT EXISTS resolved_manually boolean NOT NULL DEFAULT false;

-- 2) ترحيل الصفوف القديمة التي عُلّمت يدوياً بالنص قبل وجود العمود.
UPDATE sync_logs
  SET resolved_manually = true
  WHERE status = 'success'
    AND error_message ILIKE '%Resolved manually%'
    AND resolved_manually = false;

-- 3) القائمة العامة: ورك سبيس + الأحدث أولاً (ترقيم بلا فرز).
CREATE INDEX IF NOT EXISTS idx_sync_logs_workspace_created
  ON sync_logs(workspace_id, created_at DESC);

-- 4) فلتر الحالة + عدّادات (ناجح/فاشل/متخطى): كلها status دقيق.
CREATE INDEX IF NOT EXISTS idx_sync_logs_workspace_status_created
  ON sync_logs(workspace_id, status, created_at DESC);

-- 5) فلتر "تم الحل يدوياً" وعدّاده: فهرس جزئي (صفوف قليلة فقط).
CREATE INDEX IF NOT EXISTS idx_sync_logs_workspace_resolved_created
  ON sync_logs(workspace_id, created_at DESC)
  WHERE resolved_manually;

-- 6) فلتر المتجر/النوع (قوائم event الطويلة) + عدّها.
CREATE INDEX IF NOT EXISTS idx_sync_logs_workspace_event_created
  ON sync_logs(workspace_id, event, created_at DESC);
