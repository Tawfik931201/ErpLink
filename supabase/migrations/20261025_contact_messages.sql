-- supabase/migrations/20261025_contact_messages.sql
--
-- رسائل صفحة "اتصل بنا" — تُحفظ في السيستم بدل الاعتماد على البريد.
--
-- لماذا:
--   1. `submitContact` كان يرسل الرسالة إلى **أودوو** فقط (res.partner +
--      helpdesk.ticket). لو كان أودوو متوقفاً أو `ODOO_*` غير مضبوط، تُبتلع
--      الرسالة ويظهر للزائر "فشل الإرسال" — والزائر لا يعيد المحاولة غالباً.
--   2. البريد الإلكتروني بقي **غير مضبوط** (`SENDGRID_API_KEY` قيمة وهمية،
--      ولا SMTP_*). أي اعتماد عليه = صفر رسائل.
--
-- الحل: صف محفوظ في قاعدة البيانات يظهر في `/admin/messages`. البريد صار
-- اختيارياً (يُفعّل بـ `CONTACT_INBOX_EMAIL`) ولا يعتمد عليه الحفظ.
--
-- ملاحظات تصميم:
--   - **لا `workspace_id`**: من يرسل النموذج زائر غير مسجّل، وقد لا يكون له
--     حساب أصلاً. لذلك الجدول **غير** مرتبط بـ `workspaces` ولا يدخل في
--     cascade حذف المساحة (وإلا مُسحت رسائل العملاء الجدد مع أول حذف).
--   - `status` ثلاثي: `new` (لم تُقرأ) / `read` / `archived` (سبام أو منتهية).
--     الأرشفة بدل الحذف: عكسها ممكن، والحذف النهائي قرار يدوي في SQL.
--   - `odoo_ticket_id` و`is_new_customer` يُكتبان بعد محاولة أودوو، فوجودهما
--     فارغاً يعني "أودوو فشل" لا "لم يُحاول".
--
-- idempotent - paste-ready (public.-qualified, guarded, BEGIN/COMMIT).

BEGIN;

CREATE TABLE IF NOT EXISTS public.contact_messages (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  email TEXT NOT NULL,
  phone TEXT NOT NULL,
  company TEXT NOT NULL,
  message TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'new',
  is_new_customer BOOLEAN,
  odoo_ticket_id INT,
  email_delivered BOOLEAN NOT NULL DEFAULT false,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  read_at TIMESTAMPTZ,
  read_by TEXT
);

-- قائمة الأدمن: الأحدث أولاً.
CREATE INDEX IF NOT EXISTS idx_contact_messages_created
  ON public.contact_messages (created_at DESC);

-- تبويب "الجديدة" وعدّاد الشارة في شريط الأدمن.
CREATE INDEX IF NOT EXISTS idx_contact_messages_status
  ON public.contact_messages (status, created_at DESC);

ALTER TABLE public.contact_messages ENABLE ROW LEVEL SECURITY;

COMMIT;

-- تحقّق (اختياري، للقراءة فقط):
--   SELECT status, count(*) FROM public.contact_messages GROUP BY status;
