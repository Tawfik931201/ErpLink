/**
 * Reconciliation — تسوية دورية.
 *
 * لماذا؟ المنصات لا تسلّم كل الأحداث دائماً:
 *   • Zid: عند تكرار الفشل يتحول الـendpoint إلى «broken» فتُهمَل الأحداث
 *     المعلّقة حتى تتم استعادة الـendpoint يدوياً.
 *   • Salla: 3 محاولات فقط ثم تتوقف.
 *   • Shopify: 8 محاولات خلال 4 ساعات ثم يحذف الاشتراك.
 *   • Odoo: Automated Action قد يفشل صامتاً أو يتوقف.
 *
 * الفكرة: كل فترة قصيرة نسحب «ما تغيّر» مباشرة من واجهة برمجة المتجر
 * (incrementally, لا نعيد كل السجلات) ونعيد دفعه إلى نفس الطابور. لأن
 * الطابور idempotent، إعادة الدفع آمنة: إن وصل الحدث أصلاً فلا يتكرر العمل.
 *
 * مصمّم للاستضافة المشتركة: عمل تسلسلي، دفعات صغيرة، نافذة زمنية قصيرة
 * (افتراضياً 20 دقيقة مع تداخل 10)، وceiling صارم على عدد الطلبات كي لا
 * نتجاوز سقف 60 طلب/دقيقة من زد.
 */

import { supabase } from './supabase'
import { enqueueWebhookEvent } from './sync-queue'
import { isWebhookEventEnabled } from './webhook-gate'
import { getAccessToken } from './zid/token'
import { ZidAPI, type ZidOrderListParams } from './zid-client'

/** نافذة التسوية الافتراضية: 20 دقيقة. */
const DEFAULT_WINDOW_MINUTES = 20
/** تداخل مع النافذة السابقة، يمتص فجوات التوقيت والتأخير. */
const OVERLAP_MINUTES = 10
/** حد صارم: طلبات المتجر لكل دورة (سقف زد 60/دقيقة). */
const MAX_API_CALLS_PER_RUN = 4
/** أقصى عدد عناصر مُعاد دفعها في الدورة الواحدة. */
const MAX_ENQUEUED_PER_RUN = 100

interface ReconcileState {
  lastSuccess: string | null
  lastError: string | null
}

async function readState(scope: string): Promise<ReconcileState> {
  const { data } = await supabase
    .from('sync_reconcile_state')
    .select('last_success, last_error')
    .eq('scope', scope)
    .maybeSingle()
  return {
    lastSuccess: (data as { last_success?: string } | null)?.last_success ?? null,
    lastError: (data as { last_error?: string } | null)?.last_error ?? null,
  }
}

async function writeState(
  scope: string,
  patch: { lastSuccess?: string | null; lastError?: string | null; itemsSeen?: number }
): Promise<void> {
  const now = new Date().toISOString()
  const row: Record<string, unknown> = {
    scope,
    last_attempt: now,
    updated_at: now,
  }
  if (patch.lastSuccess !== undefined) row.last_success = patch.lastSuccess
  if (patch.lastError !== undefined) row.last_error = patch.lastError
  if (patch.itemsSeen !== undefined) row.items_seen = patch.itemsSeen

  const { error } = await supabase.from('sync_reconcile_state').upsert(row, { onConflict: 'scope' })
  if (error) {
    // غير قاتل: التسوية تعمل بدون علامة مائية (ستعيد فحص نافذة أوسع).
    console.warn('[Reconcile] failed to persist state:', error.message)
  }
}

export interface ReconcileResult {
  scope: string
  windowFrom: string
  windowTo: string
  merchantsChecked: number
  merchantsSkipped: number
  apiCalls: number
  enqueued: number
  duplicates: number
  disabledBySettings: number
  errors: string[]
  stopped: 'ok' | 'rate_ceiling' | 'error'
}

/**
 * دورة تسوية واحدة لمتاجر زد.
 * `now` يُمرَّر للاستخدام في الاختبارات (deterministic).
 */
export async function reconcileZidOrders(
  options: { windowMinutes?: number; now?: Date } = {}
): Promise<ReconcileResult> {
  const now = options.now ?? new Date()
  const windowMinutes = options.windowMinutes ?? DEFAULT_WINDOW_MINUTES

  const result: ReconcileResult = {
    scope: 'zid:orders',
    windowFrom: '',
    windowTo: now.toISOString(),
    merchantsChecked: 0,
    merchantsSkipped: 0,
    apiCalls: 0,
    enqueued: 0,
    duplicates: 0,
    disabledBySettings: 0,
    errors: [],
    stopped: 'ok',
  }

  const { data: merchants, error: merchantsErr } = await supabase
    .from('merchant_tokens')
    .select('merchant_id, store_id, workspace_id')
    .not('workspace_id', 'is', null)

  if (merchantsErr) {
    result.stopped = 'error'
    result.errors.push(merchantsErr.message)
    return result
  }

  const state = await readState(result.scope)
  // نبدأ من آخر نجاح، ونضيف تداخلاً generously حتى لا تفقدنا فجوة دقيقة واحدة.
  const from = state.lastSuccess
    ? new Date(new Date(state.lastSuccess).getTime() - OVERLAP_MINUTES * 60_000)
    : new Date(now.getTime() - windowMinutes * 60_000)
  const to = new Date(now.getTime() - 60_000) // استبعاد الدقيقة الأخيرة (قد تكون ناقصة)
  result.windowFrom = from.toISOString()

  for (const row of (merchants ?? []) as Array<{
    merchant_id?: string | number
    store_id?: string | number
    workspace_id: string
  }>) {
    if (result.apiCalls >= MAX_API_CALLS_PER_RUN) {
      result.stopped = 'rate_ceiling'
      break
    }

    const merchantKey = String(row.merchant_id || row.store_id || '')
    if (!merchantKey) {
      result.merchantsSkipped += 1
      continue
    }

    try {
      const token = await getAccessToken(merchantKey)
      if (!token) {
        result.merchantsSkipped += 1
        continue
      }
      const creds = {
        authorization: token.authorization || '',
        managerToken: token.accessToken,
        storeId: row.store_id ? String(row.store_id) : undefined,
      }

      // نحترم إعداد «تفعيل مزامنة الطلبات» من إعدادات الاستندر ماب.
      const gate = await isWebhookEventEnabled(row.workspace_id, 'zid', 'order.updated', merchantKey)
      if (!gate.allowed) {
        result.disabledBySettings += 1
        result.merchantsChecked += 1
        continue
      }

      result.apiCalls += 1
      const listParams: ZidOrderListParams = {
        page: 1,
        per_page: 50,
        // نرتّب حسب وقت آخر تعديل: هذا ما يجعل النافذة المتزايدة دقيقة.
        date_attribute: 'updated_at',
        date_from: from.toISOString(),
        date_to: to.toISOString(),
        sort_by: 'asc',
        order_by: 'created_at',
      }
      const res = await ZidAPI.orders.list(creds, listParams)

      const resData = res?.data as { orders?: unknown[]; results?: unknown[] } | undefined
      const orders = (Array.isArray(resData?.orders) ? resData?.orders : Array.isArray(resData?.results) ? resData?.results : []) ?? []
      result.merchantsChecked += 1

      for (const order of orders.slice(0, MAX_ENQUEUED_PER_RUN)) {
        const orderData = (order ?? {}) as Record<string, unknown>
        const orderId = String(orderData.id ?? orderData.order_number ?? '')
        if (!orderId) continue

        // dedup_key مبني على الطلب + وقت آخر تحديث: إعادة التسوية لا تُنتج
        // عملاً مكرراً، لكنها تضمن إعادة الدفع إن لم يصل الحدث أصلاً.
        const updatedAt = String(orderData.updated_at ?? orderData.created_at ?? to.toISOString())
        const queued = await enqueueWebhookEvent({
          workspaceId: row.workspace_id,
          storeId: String(row.store_id),
          event: 'order.updated',
          platform: 'zid',
          payload: orderData,
          dedupKey: `reconcile:zid:${row.store_id}:${orderId}:${updatedAt}`,
        })

        if (queued.error) result.errors.push(`${row.store_id}/${orderId}: ${queued.error}`)
        else if (queued.duplicate || queued.coalesced) result.duplicates += 1
        else result.enqueued += 1
      }
    } catch (err) {
      result.errors.push(
        `${row.store_id}: ${err instanceof Error ? err.message.slice(0, 150) : 'unknown error'}`
      )
    }
  }

  // العلامة المائية تتقدم فقط عند عدم وجود أخطاء — الخطأ يعيد الفحص.
  await writeState(result.scope, {
    lastSuccess: result.errors.length === 0 ? now.toISOString() : null,
    lastError: result.errors.length > 0 ? result.errors[0].slice(0, 300) : null,
    itemsSeen: result.enqueued + result.duplicates,
  })

  return result
}
