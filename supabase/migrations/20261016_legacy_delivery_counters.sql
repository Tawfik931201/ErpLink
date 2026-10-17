-- عدّادات التسليمات غير المصادقة (legacy) — دائمة في DB بدل عدّاد الذاكرة.
--
-- العدّاد داخل الذاكرة (global legacyCounts) يُصفَّر عند كل إعادة تشغيل،
-- فإشارة "وصل العدّاد إلى صفر" التي يعتمد عليها قرار إغلاق نافذة legacy
-- ورفع 401 كانت غير موثوقة. هذه الجداول هي المصدر للقرار؛ العدّاد
-- في الذاكرة يبقى فقط لخفض إغلاق السجل.
--
-- الإضافات تتم عبر دالة RPC ذرّية (فوق REST لا يوجد increment). كل استدعاء
-- fire-and-forget: فشل العدّاد لا يفشل تسليماً أبداً.

CREATE TABLE IF NOT EXISTS public.webhook_legacy_counters (
  platform   TEXT        NOT NULL PRIMARY KEY,
  count      BIGINT      NOT NULL DEFAULT 0,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE OR REPLACE FUNCTION public.increment_legacy_delivery(p_platform TEXT)
RETURNS BIGINT
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  new_count BIGINT;
BEGIN
  INSERT INTO public.webhook_legacy_counters (platform, count)
  VALUES (p_platform, 1)
  ON CONFLICT (platform)
  DO UPDATE SET
    count = public.webhook_legacy_counters.count + 1,
    updated_at = now();
  SELECT count INTO new_count
  FROM public.webhook_legacy_counters
  WHERE platform = p_platform;
  RETURN new_count;
END;
$$;
