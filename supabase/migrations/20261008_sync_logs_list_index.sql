-- فهارس صفحة سجلات المزامنة (/app/logs): ترشيح بالورك سبيس + ترتيب بالأحدث أولاً.
-- بدونها يقرأ Postgres كل صفوف الورك سبيس ويرتّبها في كل صفحة؛ معها يصبح
-- الاستعلام مسح فهرس مرتباً مباشرة (workspace = X ORDER BY created_at DESC LIMIT n).
-- idempotent: كل عبارة بـ IF NOT EXISTS، آمنة لإعادة التطبيق من SQL Editor.

-- القائمة العامة: workspace + الأحدث أولاً (يخدم التصفح والفلاتر كلها).
CREATE INDEX IF NOT EXISTS idx_sync_logs_workspace_created
  ON sync_logs(workspace_id, created_at DESC);

-- القائمة بعد فلتر الحالة: workspace + status + الأحدث أولاً.
CREATE INDEX IF NOT EXISTS idx_sync_logs_workspace_status_created
  ON sync_logs(workspace_id, status, created_at DESC);
