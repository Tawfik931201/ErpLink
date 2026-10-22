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
  // ── مسار أودوو → المتجر (عامل المزامنة) ─────────────────────────────────
  // كانت هذه الفروع تُرجع SKIP **بلا أي سجل** ⇒ الصف يُحذف من الطابور
  // كـ«نجاح» والحدث يختفي بلا أثر. ومعظمها يعني أن **العميل لا يعرف**
  // أن منتجه حُذف في أودوو ولم يُحذف في متجره.
  | 'odoo_direction_disabled'
  | 'odoo_erp_type_unsupported'
  | 'odoo_no_field_mappings'
  | 'odoo_deletion_unauthenticated'
  | 'odoo_deletion_no_values'
  | 'odoo_deletion_no_match_value'
  | 'odoo_empty_match_field'

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
  odoo_direction_disabled: {
    ar: 'الخريطة لا تدعم اتجاه أودوو ← المتجر — فعّل "erp_to_store" لتصل التغييرات',
    en: 'The mapping does not include the ERP → Store direction — enable "erp_to_store"',
  },
  odoo_erp_type_unsupported: {
    ar: 'نوع النظام المحاسبي غير مدعوم في هذا الاتجاه بعد',
    en: 'The ERP type is not supported for this direction yet',
  },
  odoo_no_field_mappings: {
    ar: 'لا توجد حقول مرتبطة لهذا الموديل في الخريطة — لم يُحدَّث شيء في المتجر',
    en: 'The mapping has no fields for this model — nothing was pushed to the store',
  },
  odoo_deletion_unauthenticated: {
    ar: 'الحذف مرفوض: التسليم بلا مفتاح — أعد تسجيل الإجراء الآلي لتفعيل الحذف',
    en: 'Deletion refused: the delivery carried no credential — re-register the Automated Action',
  },
  odoo_deletion_no_values: {
    ar: 'السجل لم يعد موجوداً في أودوو والجسم بلا قيم — تعذّر تنفيذ الحذف',
    en: 'The record no longer exists in Odoo and the body carried no values — deletion could not run',
  },
  odoo_deletion_no_match_value: {
    ar: 'السجل لم يعد موجوداً في أودوو وبلا قيمة حقل مطابقة — تعذّر تحديد المنتج',
    en: 'The record no longer exists in Odoo and carries no match-field value — the product could not be identified',
  },
  odoo_empty_match_field: {
    ar: 'حقل المطابقة فارغ في سجل أودوو — تعذّر تحديد السجل في المتجر',
    en: 'The match field is empty on the Odoo record — the store record could not be identified',
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
  /**
   * الموديل في أودوو (لمسار أودوو ← المتجر). يُكتب مكان
   * `webhook-ingress` في `odoo_model` ليكون الصف قابلاً للفلترة بالموديل.
   */
  odooModel?: string | null
  /** معرّف الخريطة — يجعل الصف قابلاً للاسترجاع من شاشة السجلات. */
  fieldMappingId?: string | null
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
      field_mapping_id: params.fieldMappingId ?? '',
      event: params.event,
      store_id: params.storeId,
      zid_entity_id: entityId,
      odoo_model: params.odooModel ?? 'webhook-ingress',
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
