-- supabase/migrations/20261102_queue_archives.sql
--
-- أرشفة عناصر طابور الإرسال يدوياً (`/app/queue`) — أرشفة بدل حذف.
--
-- لماذا:
--   التاجر يرى في الطابور صفوفاً يظنها مكرّرة أو غير مهمة، ولا يوجد زر لإخراجها.
--   الحذف المباشر خطر: قد يكون الصف طلباً لم يصل أودوو بعد، أو يكون قد أُرسل
--   فعلاً وأصبح تكراره في الطابور ضجيجاً فقط. لذلك:
--     1. الصف **يُنسخ** إلى هذا الجدول كاملاً (بما فيه `payload`) أولاً،
--     2. ثم يُحذف من جدوله الأصلي (طابور/أرشيف الموتى/إيصالات)،
--     3. ويبقى قابلاً للاستعادة سبعة أيام، ثم يُحذف نهائياً.
--
-- لماذا جدول مستقل بدل عمود `archived_at` على الجداول الثلاثة:
--   العامل الخلفي (`processSyncQueue` / `drainWebhookInbox`) يستعلم هذه الجداول
--   مباشرة. عمود أرشفة يعني تعديل **كل** استعلام ليتجاهل المؤرشف، وأي استعلام
--   يُنسى يعني "أرشفة لم تؤرشف" — يعود العنصر للطابور بصمت. النسخ إلى جدول
--   منفصل يجعل الاستبعاد بنيوياً لا اجتهادياً.
--
-- ملاحظات:
--   - `workspace_id` **إلزامي** هنا (بخلاف `webhook_inbox` التي قد يكون
--     `workspace_id` فيها فارغاً): المؤرشف هو التاجر نفسه، والأرشفة بلا مالك
--     تجعل الصف غير مرئي لأحد ولا يُنظَّف مع حذف مساحته.
--   - `ON DELETE CASCADE` على `workspaces`: حذف المساحة يحذف أرشيفها، كبقية
--     جداول المساحة (20261022_db_cleanup_and_cascade).
--   - `source_id` TEXT لا UUID: الأرشيف يُخزّن معرّف الصف الأصلي كما هو، وأي
--     معرّف غير UUID مستقبلاً يجب ألا يفشل الإدراج.
--   - `expires_at` يُحسب خادمياً (`now() + 7 days`) أيضاً وليس من التطبيق فقط،
--     فحتى لو أخطأ العميل في الحساب يظل للصف تاريخ انتهاء.
--   - التنظيف يقع في `maybeCleanup()` داخل عامل الطابور كل ساعة
--     (`pruneExpiredQueueArchives`).
--
-- idempotent - paste-ready (public.-qualified, guarded, BEGIN/COMMIT).

BEGIN;

CREATE TABLE IF NOT EXISTS public.queue_archives (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id  UUID NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
  -- pending | frozen (كلاهما sync_queue) | dead (sync_queue_dead) | orphans (webhook_inbox)
  source_kind   TEXT NOT NULL,
  source_table  TEXT NOT NULL,
  source_id     TEXT NOT NULL,
  platform      TEXT,
  event         TEXT,
  store_id      TEXT,
  dedup_key     TEXT,
  error_message TEXT,
  retry_count   INT,
  max_retries   INT,
  next_retry_at TIMESTAMPTZ,
  original_id   TEXT,
  payload       JSONB NOT NULL DEFAULT '{}'::jsonb,
  -- الصف الأصلي كاملاً كما قُرئ، حتى لو أُضيف عمود لاحقاً إلى جدول المصدر.
  row_data      JSONB NOT NULL DEFAULT '{}'::jsonb,
  archived_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  expires_at    TIMESTAMPTZ NOT NULL DEFAULT (now() + INTERVAL '7 days')
);

-- أرشفة مزدوجة لنفس الصف (نقرتان سريعتان / سباق بين عميلين) تُصطدم بهذا
-- الفهرس ⇒ تُعامل كـ"أرشفت مسبقاً" بدل إدراج نسختين.
CREATE UNIQUE INDEX IF NOT EXISTS uq_queue_archives_source
  ON public.queue_archives (source_table, source_id);

-- قائمة "المؤرشف يدوياً" داخل تبويب الأرشيف: الأحدث أولاً لمساحة العمل.
CREATE INDEX IF NOT EXISTS idx_queue_archives_workspace
  ON public.queue_archives (workspace_id, archived_at DESC);

-- التنظيف الدوري: حذف ما انتهت مدته.
CREATE INDEX IF NOT EXISTS idx_queue_archives_expires
  ON public.queue_archives (expires_at);

ALTER TABLE public.queue_archives ENABLE ROW LEVEL SECURITY;

COMMIT;

-- تحقّق (اختياري، للقراءة فقط):
--   SELECT source_kind, count(*) FROM public.queue_archives GROUP BY source_kind;
--   SELECT count(*) FROM public.queue_archives WHERE expires_at < now();
