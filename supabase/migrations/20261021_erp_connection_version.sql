-- 20261021_erp_connection_version.sql
--
-- يضيف عمود `odoo_version` إلى جدول `erp_connections` ليُحفظ فيه إصدار خادم
-- أودو الذي يُكتشف تلقائياً عند نجاح الاتصال (مثال: `17.0+e` أو `saas~17.4`).
--
-- العمود **للعرض فقط** — لا تعتمد عليه أي عملية مزامنة، وغيابه لا يكسر شيئاً:
--   * `saveErpConnection` يكتبه في تحديث منفصل بعد نجاح الحفظ الأساسي، ويفشل
--     بصمت (warn فقط) إذا لم يكن العمود موجوداً.
--   * صفحة `/app/connect-odoo` تكشف الإصدار مباشرة من الخادم عند غيابه
--     (`detectOdooVersion`).
--
-- ⚠️ يُطبَّق على قاعدة بيانات Supabase مباشرة عبر محرر SQL.
-- الملف paste-ready: `public.`-qualified، ومحمي بـ `to_regclass` + `IF NOT EXISTS`،
-- لذا تكرار تنفيذه آمن.
--
-- ما يفعله:
--   1. ALTER TABLE: يضيف عمود `odoo_version` (TEXT) إلى `erp_connections`.

BEGIN;

-- ── 1. أضف العمود إذا لم يكن موجوداً ──
DO $$
BEGIN
  IF to_regclass('public.erp_connections') IS NOT NULL THEN
    EXECUTE 'ALTER TABLE public.erp_connections ADD COLUMN IF NOT EXISTS odoo_version TEXT';
  END IF;
END $$;

COMMIT;

-- ── للتحقق بعد التنفيذ ──
-- SELECT column_name, data_type FROM information_schema.columns
--   WHERE table_name = 'erp_connections' AND column_name = 'odoo_version';
-- المتوقع: odoo_version | text
--
-- الصفوف القديمة تبقى NULL حتى يفتح العميل صفحة ربط أودو (كشف تلقائي لمرة
-- واحدة) أو يُعيد الحفظ من زر "اختبار وحفظ".
