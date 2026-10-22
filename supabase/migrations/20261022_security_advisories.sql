-- supabase/migrations/20261022_security_advisories.sql
--
-- إصلاح تنبيهات الأمان في Supabase Advisor (2026-10-22).
--
-- ❗ ملاحظة مهمة عن `rls_enabled_no_policy` (15 جدولاً):
--   هذا **ليس** عيباً في هذا المشروع — بل هو التصميم المقصود.
--   التطبيق يقرأ ويكتب عبر مفتاح service_role (الذي يتجاوز RLS)،
--   والجداول الخمسة عشر (sync_queue, webhook_inbox, field_mappings,
--   erp_connections, telegram_*, users …) جداول **الخادم وحده**: RLS
--   مُفعَّل بلا سياسات ⇒ دور anon وauthenticated محدود (تم التحقق:
--   كل قراءة بـanon key تردّ 404). إضافة سياسات هنا كانت ستكشف
--   بيانات العملاء لعامة الإنترنت. **لا تُضِف سياسات لهذه الجداول.**
--
-- ما يُصلحه هذا الملف:
--   1. `function_search_path_mutable` (3 دوال) — تثبيت search_path.
--   2. `anon_security_definer_function_executable` +
--      `authenticated_security_definer_function_executable`
--      — دالة `increment_legacy_delivery` كانت قابلة للاستدعاء من
--      **أي زائر** عبر `/rest/v1/rpc/increment_legacy_delivery` ⇒
--      أي شخص على الإنترنت كان يستطيع تضخيم عدّاد "التسليمات
--      غير المصادقة"، فيُفسد الإشارة التي يعتمد عليها تنبيه الأدمن
--      وفي قرار رفض legacy. التطبيق نفسه يستدعيها بمفتاح service_role،
--      فسحبEXECUTE من anon/authenticated لا يكسر شيئاً.
--
-- idempotent — paste-ready (public.-qualified, guarded, BEGIN/COMMIT).

BEGIN;

-- ─── 1) دوال الطقم المسبق: search_path ثابت + أسماء مؤهَّلة ───────────────
-- search_path = '' ⇒ لا تبحث الدالة في أي مخطط غير صريح. الأسماء
-- مؤهَّلة بـpublic.(المسميات العامة وpg_catalog تُبحث دائماً.)

CREATE OR REPLACE FUNCTION public.seed_fixed_mapping_presets(p_workspace_id uuid)
 RETURNS integer
 LANGUAGE plpgsql
 SET search_path = ''
AS $function$
DECLARE
  v_def          RECORD;
  v_inserted     INT := 0;
  v_existing_ct  INT;
BEGIN
  IF p_workspace_id IS NULL THEN
    RETURN 0;
  END IF;

  FOR v_def IN
    SELECT * FROM public.fixed_mapping_preset_definitions ORDER BY display_order ASC
  LOOP
    SELECT COUNT(*) INTO v_existing_ct
    FROM public.fixed_mappings fm
    WHERE fm.workspace_id = p_workspace_id
      AND fm.preset_key   = v_def.preset_key;

    IF v_existing_ct > 0 THEN
      CONTINUE;
    END IF;

    INSERT INTO public.fixed_mappings (
      workspace_id, platform, odoo_model, action, field_rows,
      is_preset, preset_key, category, icon_name, display_order, active, label,
      created_at, updated_at
    ) VALUES (
      p_workspace_id,
      v_def.platform,
      v_def.odoo_model,
      v_def.action,
      v_def.default_field_rows,
      TRUE,
      v_def.preset_key,
      v_def.category,
      v_def.icon_name,
      v_def.display_order,
      TRUE,
      v_def.default_label_en,
      now(),
      now()
    );

    v_inserted := v_inserted + 1;
  END LOOP;

  RETURN v_inserted;
END;
$function$;

CREATE OR REPLACE FUNCTION public.augment_fixed_mapping_presets(p_workspace_id uuid)
 RETURNS integer
 LANGUAGE plpgsql
 SET search_path = ''
AS $function$
DECLARE
  v_def          RECORD;
  v_current_rows JSONB;
  v_missing_rows JSONB;
  v_inserted     INT := 0;
  v_existing_ct  INT;
BEGIN
  IF p_workspace_id IS NULL THEN
    RETURN 0;
  END IF;

  FOR v_def IN
    SELECT * FROM public.fixed_mapping_preset_definitions ORDER BY display_order ASC
  LOOP
    SELECT COUNT(*) INTO v_existing_ct
    FROM public.fixed_mappings
    WHERE workspace_id = p_workspace_id AND preset_key = v_def.preset_key;

    IF v_existing_ct = 0 THEN
      CONTINUE;
    END IF;

    SELECT field_rows INTO v_current_rows
    FROM public.fixed_mappings
    WHERE workspace_id = p_workspace_id AND preset_key = v_def.preset_key
    LIMIT 1;

    IF v_current_rows IS NULL OR v_current_rows = '[]'::jsonb THEN
      UPDATE public.fixed_mappings
      SET field_rows = v_def.default_field_rows,
          updated_at = now()
      WHERE workspace_id = p_workspace_id AND preset_key = v_def.preset_key;

      v_inserted := v_inserted + jsonb_array_length(v_def.default_field_rows);
      CONTINUE;
    END IF;

    SELECT jsonb_agg(elem) INTO v_missing_rows
    FROM jsonb_array_elements(v_def.default_field_rows) AS elem
    WHERE NOT EXISTS (
      SELECT 1
      FROM jsonb_array_elements(v_current_rows) AS cur
      WHERE cur->>'odoo_field' = elem->>'odoo_field'
    );

    IF v_missing_rows IS NOT NULL AND jsonb_array_length(v_missing_rows) > 0 THEN
      UPDATE public.fixed_mappings
      SET field_rows = v_current_rows || v_missing_rows,
          updated_at = now()
      WHERE workspace_id = p_workspace_id AND preset_key = v_def.preset_key;

      v_inserted := v_inserted + jsonb_array_length(v_missing_rows);
    END IF;
  END LOOP;

  RETURN v_inserted;
END;
$function$;

-- ⚠️ كان يشير إلى جدول غير موجود (`telegram_link_codes`) ⇒ الدالة كانت
-- معطوبة لو استُدعيت. الجدول الحقيقي هو `telegram_bot_codes`.
CREATE OR REPLACE FUNCTION public.telegram_cleanup_expired_codes()
 RETURNS void
 LANGUAGE plpgsql
 SET search_path = ''
AS $function$
BEGIN
  DELETE FROM public.telegram_bot_codes WHERE expires_at < now();
END;
$function$;

-- ─── 2) سحب EXECUTE من الأدوار العامة ──────────────────────────────────────
-- التنفيذ يبقى لمفتاح service_role وحده (هو من ينادي هذه الدوال).
DO $$
DECLARE
  fn text;
  sig text;
BEGIN
  FOREACH fn IN ARRAY ARRAY[
    'increment_legacy_delivery',
    'seed_fixed_mapping_presets',
    'augment_fixed_mapping_presets',
    'telegram_cleanup_expired_codes'
  ] LOOP
    FOR sig IN
      SELECT pg_get_function_identity_arguments(p.oid)
      FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
      WHERE n.nspname = 'public' AND p.proname = fn
    LOOP
      EXECUTE format('REVOKE ALL ON FUNCTION public.%I(%s) FROM PUBLIC', fn, sig);
      EXECUTE format('REVOKE ALL ON FUNCTION public.%I(%s) FROM anon', fn, sig);
      EXECUTE format('REVOKE ALL ON FUNCTION public.%I(%s) FROM authenticated', fn, sig);
      EXECUTE format('GRANT EXECUTE ON FUNCTION public.%I(%s) TO service_role', fn, sig);
    END LOOP;
  END LOOP;
END;
$$;

COMMIT;
