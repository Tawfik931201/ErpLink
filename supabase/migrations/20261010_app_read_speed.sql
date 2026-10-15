-- تسريع قراءات صفحات التطبيق (/app/dashboard, /app/logs, /app/queue,
-- /app/initial-transfer, /admin/clients): فهارس مركبة للاستعلامات الساخنة.
--
-- المشكلة: الداشبورد وحده يطلق ~20 استعلاماً مع كل فتح (10 عدّادات + رسوم +
-- توكنات)، وقوائم `data_transfers` و `field_mappings` و `subscriptions` كانت
-- بلا أي فهرس مركب يخدم `workspace_id + ORDER BY created_at`. مع 50 مستخدماً
-- متزامناً تتحول هذه المسحات إلى عنق الزجاجة قبل أي حد في الـ connections
-- (الاتصال REST عبر PostgREST لا يفتح TCP دائماً أصلاً).
--
-- مثل `20260922_sync_reliability_paste_ready.sql`: كل فهرس محروس بـ
-- `to_regclass` لأن بعض الجداول أُنشئت من لوحة Supabase خارج ملفات
-- الـ migrations، فغياب جدول يجب أن يتخطى فهرسه لا أن يُفشل الملف كله.
-- آمن لإعادة التطبيق (IF NOT EXISTS)، ويُطبق من Supabase SQL Editor.

DO $$
BEGIN
  -- 1) الداشبورد + قوائم النقل: مساحة العمل + الأحدث أولاً.
  IF to_regclass('public.data_transfers') IS NOT NULL THEN
    CREATE INDEX IF NOT EXISTS idx_data_transfers_workspace_created
      ON public.data_transfers(workspace_id, created_at DESC);
  END IF;

  -- 2) عدّاد النقل النشط (pending/running) في الداشبورد.
  IF to_regclass('public.data_transfers') IS NOT NULL THEN
    CREATE INDEX IF NOT EXISTS idx_data_transfers_workspace_status_created
      ON public.data_transfers(workspace_id, status, created_at DESC);
  END IF;

  -- 3) مركز الربط: كل قوائم field_mappings مفلترة بمساحة العمل.
  IF to_regclass('public.field_mappings') IS NOT NULL THEN
    CREATE INDEX IF NOT EXISTS idx_field_mappings_workspace
      ON public.field_mappings(workspace_id);
  END IF;

  -- 4) بطاقة الاشتراك (تُستدعى مع كل تحميل داشبورد): مساحة + حالة + الأبعد انتهاءً.
  IF to_regclass('public.subscriptions') IS NOT NULL THEN
    CREATE INDEX IF NOT EXISTS idx_subscriptions_workspace_status_end
      ON public.subscriptions(workspace_id, status, end_date DESC);
  END IF;

  -- 5) كشف حساب العميل (الأدمن): اشتراكات مساحات العميل + الأحدث أولاً.
  IF to_regclass('public.subscriptions') IS NOT NULL THEN
    CREATE INDEX IF NOT EXISTS idx_subscriptions_workspace_created
      ON public.subscriptions(workspace_id, created_at DESC);
  END IF;

  -- 6) صفحة الطابور: قائمة المعلق/المجمد + الأحدث أولاً.
  IF to_regclass('public.sync_queue') IS NOT NULL THEN
    CREATE INDEX IF NOT EXISTS idx_sync_queue_workspace_created
      ON public.sync_queue(workspace_id, created_at DESC);
  END IF;

  -- 7) أرشيف الموتى: مفلتر بمساحة العمل (كان مفهرساً على died_at فقط).
  IF to_regclass('public.sync_queue_dead') IS NOT NULL THEN
    CREATE INDEX IF NOT EXISTS idx_sync_queue_dead_workspace_died
      ON public.sync_queue_dead(workspace_id, died_at DESC);
  END IF;

  -- 8) العناصر اليتيمة: إيصالات بلا مساحة لمتاجر معروفة، الأحدث أولاً.
  --    فهرس جزئي — يغطي الصفوف القليلة المعنية فقط.
  IF to_regclass('public.webhook_inbox') IS NOT NULL THEN
    CREATE INDEX IF NOT EXISTS idx_webhook_inbox_orphans
      ON public.webhook_inbox(store_id, received_at DESC)
      WHERE status = 'pending' AND workspace_id IS NULL;
  END IF;

  -- 9) اتصال ERP: بحث مساحة العمل في كل عملية نقل ومزامنة.
  IF to_regclass('public.erp_connections') IS NOT NULL THEN
    CREATE INDEX IF NOT EXISTS idx_erp_connections_workspace
      ON public.erp_connections(workspace_id);
  END IF;

  -- 10) قائمة عملاء الأدمن بعد النطاق الجديد: workspaces مسكوبة بـ user_id.
  IF to_regclass('public.workspaces') IS NOT NULL THEN
    CREATE INDEX IF NOT EXISTS idx_workspaces_user_created
      ON public.workspaces(user_id, created_at DESC);
  END IF;

  -- 11) ترتيب المستخدمين بالأحدث في صفحة الأدمن.
  IF to_regclass('public.users') IS NOT NULL THEN
    CREATE INDEX IF NOT EXISTS idx_users_created
      ON public.users(created_at DESC);
  END IF;
END
$$;

-- ─── تحقق (read-only، للصق بعد التطبيق) ─────────────────────────────
-- SELECT indexname FROM pg_indexes
--  WHERE schemaname = 'public'
--    AND indexname IN (
--      'idx_data_transfers_workspace_created',
--      'idx_data_transfers_workspace_status_created',
--      'idx_field_mappings_workspace',
--      'idx_subscriptions_workspace_status_end',
--      'idx_subscriptions_workspace_created',
--      'idx_sync_queue_workspace_created',
--      'idx_sync_queue_dead_workspace_died',
--      'idx_webhook_inbox_orphans',
--      'idx_erp_connections_workspace',
--      'idx_workspaces_user_created',
--      'idx_users_created'
--    )
--  ORDER BY indexname;
