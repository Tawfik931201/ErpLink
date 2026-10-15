-- صفحة إضافة حقل (add-field): قائمة الحقول المخصصة كانت تفعل
-- SELECT ... WHERE workspace_id = ... ORDER BY created_at DESC
-- على جدول custom_odoo_fields بلا أي فهرس (الجدول أُنشئ من لوحة Supabase
-- خارج الـ migrations). مع نمو الصفوف يتحول لمسح كامل في كل فتح للصفحة.
--
-- مثل 20261010_app_read_speed.sql: محروس بـ to_regclass و IF NOT EXISTS،
-- آمن لإعادة التطبيق، ويُطبق من Supabase SQL Editor.

DO $$
BEGIN
  IF to_regclass('public.custom_odoo_fields') IS NOT NULL THEN
    CREATE INDEX IF NOT EXISTS idx_custom_odoo_fields_workspace_created
      ON public.custom_odoo_fields(workspace_id, created_at DESC);
  END IF;
END
$$;

-- ─── تحقق (read-only، للصق بعد التطبيق) ─────────────────────────────
-- SELECT indexname FROM pg_indexes
--  WHERE schemaname = 'public'
--    AND indexname = 'idx_custom_odoo_fields_workspace_created';
