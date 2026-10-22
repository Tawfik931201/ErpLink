-- supabase/migrations/20261022_telegram_outbox.sql
--
-- صندوق صادر التليجرام — يحوّل "نداء تليجرام لكل حدث" إلى **صف محفوظ** يُرسل
-- بمُرسِل مستقل.
--
-- لماذا:
--   1. اليوم `notifySyncResult` / `notifyOrderArrival` يستدعيان api.telegram.org
--      مباشرة. فشل 429 من تليجرام كان **يُبتلع بلا إعادة محاولة** ⇒ الرسالة
--      تضيع. والمُرسَل `fetch` بلا مهلة ⇒ لو تليجرام علِق، احتُجز عامل
--      المزامنة (من أصل 10) **للأبد**، و10 تعليقات كانت تُوقف الطابور كله.
--   2. تضخيم الرسائل: حدث واحد ⇒ رسالة وصول + (1 + N) رسائل نتيجة (إعداد
--      افتراضي + كل خريطة مخصّصة) ⇒ عميل واحد يغرق محادثته.
--
-- الحل:
--   - كل رسالة تُحفظ هنا أولاً ⇒ لا رسالة تضيع (إعادة محاولة + صندوق موتى).
--   - المُرسِل منفصل عن عامل المزامنة ⇒ تليجرام لا يعطّل أودوو أبداً.
--   - `event_key` + الفهرس الجزئي يضمنان **رسالة واحدة لكل حدث**: النتيجة
--     ذات الأولوية الأعلى تستبدل رسالة الوصول المعلّقة، والنتيجة الثانية
--     لنفس الحدث تُهمَل.
--
-- idempotent — paste-ready (public.-qualified, guarded, BEGIN/COMMIT).

BEGIN;

CREATE TABLE IF NOT EXISTS public.telegram_outbox (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id UUID REFERENCES public.workspaces(id) ON DELETE CASCADE,
  bot_id UUID REFERENCES public.telegram_bots(id) ON DELETE CASCADE,
  chat_id TEXT NOT NULL,
  chat_label TEXT,
  language TEXT NOT NULL DEFAULT 'ar',
  kind TEXT NOT NULL DEFAULT 'result',
  priority INT NOT NULL DEFAULT 1,
  event_key TEXT,
  body TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending',
  attempts INT NOT NULL DEFAULT 0,
  available_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  next_attempt_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_error TEXT,
  sent_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- الصفوف المستحقة — الاستعلام الوحيد في مسار الإرسال.
CREATE INDEX IF NOT EXISTS idx_telegram_outbox_due
  ON public.telegram_outbox (next_attempt_at)
  WHERE status = 'pending';

CREATE INDEX IF NOT EXISTS idx_telegram_outbox_workspace
  ON public.telegram_outbox (workspace_id, created_at DESC);

-- رسالة واحدة معلّقة لكل حدث: النتيجة تستبدل رسالة الوصول، والرسالة الثانية
-- لنفس الحدث تُرفض أصلاً (23505) ⇒ عميل واحد = رسالة واحدة لكل طلب.
CREATE UNIQUE INDEX IF NOT EXISTS uq_telegram_outbox_pending_event
  ON public.telegram_outbox (event_key)
  WHERE event_key IS NOT NULL AND status = 'pending';

ALTER TABLE public.telegram_outbox ENABLE ROW LEVEL SECURITY;

COMMIT;
