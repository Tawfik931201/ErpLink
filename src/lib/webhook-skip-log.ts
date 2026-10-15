/**
 * Webhook skip visibility — كل قرار "تجاهل مقصود" في مسارات الويب هوك يُسجَّل
 * في `sync_logs` بحالة `skipped` بدل أن يمرّ بصمت (console فقط).
 *
 * لماذا: رد 200 "نجاح" لحدث لم يُحفظ في أي مكان يعني أن المنصة لن تعيد
 * إرساله أبداً — فإن كان التجاهل خطأً في الإعدادات (Mapping Center مقفول)
 * أو حدثاً جديداً غير معروف، لا يبقى أي أثر قابل للاستعلام. هذا الملف يجعل
 * كل `disabled_in_settings` / `unhandled_event` / `unknown_topic` /
 * `stale_event` / `no_entity_mapping` صفاً حقيقياً في `sync_logs` (trigger_type=webhook-ingress)
 * فيظهر في لوحات المتابعة بدل أن يكتشفه التاجر بطلب ناقص.
 *
 * قواعد صارمة (لا تُكسر):
 * - لا يغيّر أي رد HTTP — المنصات ترى نفس الأكواد السابقة تماماً.
 * - لا يرمي استثناءً أبداً — الفشل هنا يُبتلع (console فقط) لأن مسار
 *   الاستلام أهم من مسار التوثيق.
 * - حمولة صغيرة مقصودة (لا تُخزَّن كاملة) — هذا الصف للرؤية لا لإعادة
 *   المعالجة، فلا يجب أن يُربك أزرار الـ retry التي تعيد تشغيل `payload`.
 */

// لا استيرادات ثابتة هنا عمداً: هذا الملف يُستورد في مسارات الويب هوك
// الساخنة وفي الاختبارات، فيجب أن يكون تحميله خفيفاً بلا آثار جانبية
// (إنشاء عميل Supabase أو قراءة env وقت الاستيراد ممنوع).

export type WebhookSkipReason =
  | 'disabled_in_settings'
  | 'unhandled_event'
  | 'unknown_topic'
  | 'stale_event'
  | 'no_entity_mapping'

const REASON_TEXT: Record<WebhookSkipReason, { ar: string; en: string }> = {
  disabled_in_settings: {
    ar: 'معطّل من إعدادات Mapping Center — فعّل حدث الكيان ليُرسَل إلى أودوو',
    en: 'Disabled in Mapping Center settings — enable the entity event to sync to Odoo',
  },
  unhandled_event: {
    ar: 'حدث غير معروف للنظام — لم يُحفظ في الطابور ويحتاج دعماً برمجياً',
    en: 'Unknown event — not queued, needs engineering support',
  },
  unknown_topic: {
    ar: 'موضوع غير معروف — لم يُحفظ في الطابور ويحتاج دعماً برمجياً',
    en: 'Unknown topic — not queued, needs engineering support',
  },
  stale_event: {
    ar: 'نسخة أقدم من المعلَّق — تُجاهلت عمداً حتى لا ترجع حالة قديمة فوق الأحدث',
    en: 'Older than the pending version — deliberately ignored to avoid regressing newer state',
  },
  no_entity_mapping: {
    ar: 'الموضوع بلا كيان يُزامَن (لا preset ستاندرد ولا مدخل mapping) — لم يُحفظ في الطابور',
    en: 'Topic has no synced entity (no Standard preset or mapping entry) — not queued',
  },
}

/**
 * Pure: يبني نص السبب المخزّن في `sync_logs.error_message`.
 * مصدَّر خالصاً ليُختبَر بلا قاعدة بيانات.
 */
export function buildSkipMessage(reason: WebhookSkipReason, detail?: string | null): string {
  const text = REASON_TEXT[reason] ?? REASON_TEXT.unhandled_event
  const base = `[${reason}] ${text.ar}`
  const extra = (detail || '').trim().slice(0, 200)
  return extra ? `${base} — ${extra}` : base
}

export interface WebhookSkipParams {
  workspaceId: string
  platform: 'zid' | 'salla' | 'shopify' | 'odoo'
  event: string
  storeId: string
  reason: WebhookSkipReason
  detail?: string | null
  payload?: Record<string, unknown>
}

/**
 * يسجّل صف `skipped` في `sync_logs`. لا يرمي أبداً.
 */
export async function logWebhookSkip(params: WebhookSkipParams): Promise<void> {
  try {
    if (!params.workspaceId || !params.event) return
    const { logSync } = await import('./sync-runtime')
    let entityId: string | undefined
    try {
      const { extractEntityId } = await import('./sync-queue')
      entityId = extractEntityId((params.payload ?? {}) as Record<string, unknown>) || undefined
    } catch {
      // استخراج الكيان best-effort — غيابه لا يمنع التسجيل.
    }
    await logSync({
      workspace_id: params.workspaceId,
      field_mapping_id: '',
      event: params.event,
      store_id: params.storeId,
      zid_entity_id: entityId,
      odoo_model: 'webhook-ingress',
      status: 'skipped',
      error_message: buildSkipMessage(params.reason, params.detail).slice(0, 500),
      payload: {
        reason: params.reason,
        platform: params.platform,
        event: params.event,
        entity_id: entityId ?? null,
        detail: (params.detail || '').slice(0, 200),
      },
      trigger_type: 'webhook-ingress',
    })
  } catch {
    // التوثيق لا يكسر الاستلام أبداً.
  }
}
