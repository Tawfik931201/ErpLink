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

import { resolveExecutionTarget } from './erp-execution-target'
import { supabase } from './supabase'
import { withSyncRequestContext } from './sync/request-context'
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
  lastAttempt: string | null
  cursor: { from: string; to: string; page: number } | null
}

async function readState(scope: string): Promise<ReconcileState> {
  const { data, error } = await supabase
    .from('sync_reconcile_state')
    .select('last_success, last_error, last_attempt, cursor')
    .eq('scope', scope)
    .maybeSingle()
  if (error) throw new Error('Reconciliation state unavailable')
  const row = data as { last_success?: string; last_error?: string; last_attempt?: string; cursor?: { from?: string; to?: string; page?: number } } | null
  const cursor = row?.cursor
  return {
    lastSuccess: (data as { last_success?: string } | null)?.last_success ?? null,
    lastError: (data as { last_error?: string } | null)?.last_error ?? null,
    lastAttempt: row?.last_attempt ?? null,
    cursor: cursor?.from && cursor.to && Number.isInteger(cursor.page) && Number(cursor.page) > 0 && Number.isFinite(Date.parse(cursor.from)) && Number.isFinite(Date.parse(cursor.to))
      ? { from: cursor.from, to: cursor.to, page: Number(cursor.page) } : null,
  }
}

async function writeState(
  scope: string,
  patch: { lastSuccess?: string | null; lastError?: string | null; itemsSeen?: number; cursor?: ReconcileState['cursor'] }
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
  if (patch.cursor !== undefined) row.cursor = patch.cursor ?? {}

  const { error } = await supabase.from('sync_reconcile_state').upsert(row, { onConflict: 'scope' })
  if (error) {
    throw new Error(`Reconciliation state persistence failed: ${error.code || 'storage_error'}`)
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

  type Merchant = { merchant_id?: string | number; store_id?: string | number; workspace_id: string }
  const candidates: Array<{ row: Merchant; merchantKey: string; storeId: string; scope: string; target: Awaited<ReturnType<typeof resolveExecutionTarget>>; state: ReconcileState }> = []
  for (const row of (merchants ?? []) as Merchant[]) {
    const merchantKey = String(row.merchant_id || row.store_id || '')
    const storeId = String(row.store_id || row.merchant_id || '')
    if (!merchantKey || !row.workspace_id) { result.merchantsSkipped++; continue }
    try {
      const target = await resolveExecutionTarget(row.workspace_id, 'zid', storeId)
      const scope = JSON.stringify(['zid', 'orders', row.workspace_id, storeId, target.erpConnectionId, target.connectionGeneration])
      candidates.push({ row, merchantKey, storeId, scope, target, state: await readState(scope) })
    } catch (error) {
      result.errors.push(`${storeId}: ${error instanceof Error ? error.message.slice(0, 150) : 'target unavailable'}`)
    }
  }
  candidates.sort((a, b) => (Date.parse(a.state.lastAttempt || '') || 0) - (Date.parse(b.state.lastAttempt || '') || 0))

  for (const { row, merchantKey, storeId, scope, target, state } of candidates) {
    if (result.apiCalls >= MAX_API_CALLS_PER_RUN || result.enqueued + result.duplicates >= MAX_ENQUEUED_PER_RUN) {
      result.stopped = 'rate_ceiling'
      break
    }
    const from = state.cursor?.from || (state.lastSuccess
      ? new Date(new Date(state.lastSuccess).getTime() - OVERLAP_MINUTES * 60_000).toISOString()
      : new Date(now.getTime() - windowMinutes * 60_000).toISOString())
    const to = state.cursor?.to || new Date(now.getTime() - 60_000).toISOString()
    const page = state.cursor?.page || 1
    const cursor = { from, to, page }
    if (!result.windowFrom || from < result.windowFrom) result.windowFrom = from
    await withSyncRequestContext({
      workspaceId: row.workspace_id,
      platform: 'zid',
      storeId,
      merchantId: merchantKey,
    }, async () => {
      try {
        // Persist the fixed window before its first API call if continuing a multi-page run.
        // A fresh single-page cycle avoids an eager write before knowing if orders exist.
        if (page > 1 || state.cursor) {
          await writeState(scope, { cursor, lastError: null })
        }
        const token = await getAccessToken(merchantKey, row.workspace_id)
        if (!token) {
          result.merchantsSkipped += 1
          return
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
          return
        }

        result.apiCalls += 1
        const listParams: ZidOrderListParams = {
          page,
          per_page: 50,
          // نرتّب حسب وقت آخر تعديل: هذا ما يجعل النافذة المتزايدة دقيقة.
          date_attribute: 'updated_at',
          date_from: from,
          date_to: to,
          sort_by: 'asc',
          order_by: 'created_at',
        }
        const res = await ZidAPI.orders.list(creds, listParams)

        const resData = res?.data as { orders?: unknown[]; results?: unknown[] } | undefined
        if (!Array.isArray(resData?.orders) && !Array.isArray(resData?.results)) throw new Error('Invalid reconciliation order list')
        const orders = (Array.isArray(resData?.orders) ? resData.orders : resData?.results) ?? []
        result.merchantsChecked += 1
        let pageComplete = true
        let seen = 0
        for (const order of orders) {
          if (result.enqueued + result.duplicates >= MAX_ENQUEUED_PER_RUN) { pageComplete = false; result.stopped = 'rate_ceiling'; break }
          const orderData = (order ?? {}) as Record<string, unknown>
          const orderId = String(orderData.id ?? orderData.order_number ?? '')
          if (!orderId) throw new Error('Reconciliation order is missing identity')

          // dedup_key مبني على الطلب + وقت آخر تحديث: إعادة التسوية لا تُنتج
          // عملاً مكرراً، لكنها تضمن إعادة الدفع إن لم يصل الحدث أصلاً.
          const updatedAt = String(orderData.updated_at ?? orderData.created_at ?? to)
          const queued = await enqueueWebhookEvent({
            workspaceId: row.workspace_id,
            storeId,
            event: 'order.updated',
            platform: 'zid',
            payload: orderData,
            executionTarget: target,
            dedupKey: `reconcile:zid:${scope}:${orderId}:${updatedAt}`,
          })
          if (queued.error || queued.skipped || (!queued.id && !queued.duplicate && !queued.coalesced)) throw new Error(`${orderId}: ${queued.error || 'dispatch not confirmed'}`)
          else if (queued.duplicate || queued.coalesced) result.duplicates += 1
          else result.enqueued += 1
          seen++
        }
        if (pageComplete && orders.length < 50) {
          const shouldUpdate = seen > 0 || !state.lastSuccess || (Date.now() - (Date.parse(state.lastSuccess) || 0) > 3_600_000)
          if (shouldUpdate) {
            await writeState(scope, { lastSuccess: to, cursor: null, lastError: null, itemsSeen: seen })
          }
        } else {
          await writeState(scope, { cursor: { from, to, page: pageComplete ? page + 1 : page }, lastError: null, itemsSeen: seen })
        }
      } catch (err) {
        const message = `${storeId}: ${err instanceof Error ? err.message.slice(0, 150) : 'unknown error'}`
        result.errors.push(message)
        try { await writeState(scope, { lastError: message, cursor }) } catch { /* Existing persisted cursor remains recoverable. */ }
      }
    })
  }
  if (result.errors.length) result.stopped = 'error'
  return result
}
