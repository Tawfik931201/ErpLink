/**
 * Durable receipt storage and atomic receipt-to-job dispatch.
 * A permanent queue_id marker survives queue completion so dispatcher recovery
 * cannot recreate an already-dispatched event. Store receipts waiting for an
 * ERP are dispatched once an owned destination is available.
 */

import { isCommercePlatform, resolveExecutionTarget, type ExecutionTarget } from './erp-execution-target'
import { supabase } from './supabase'

/**
 * عدد المحاولات القصوى للصف.
 *
 * **نسخة من `SYNC_QUEUE_MAX_RETRIES` في `sync-queue.ts`** — لا نستورده من
 * هناك تفادياً لدورة استيراد (sync-queue يستورد هذا الملف ديناميكياً).
 * تطابق القيمتين مضمون باختبار (`tests/unit/ingress-durability.test.ts`).
 */
const SYNC_QUEUE_MAX_RETRIES = 5
const DISPATCH_RETRY_DELAY_MS = 60_000

export interface WebhookReceipt {
  platform: string
  storeId: string
  workspaceId?: string | null
  event: string
  dedupKey?: string | null
  payload: Record<string, unknown>
  erpConnectionId?: string
  connectionGeneration?: string
}

export interface ReceiptResult {
  ok: boolean
  id?: string
  duplicate?: boolean
  error?: string
}

/**
 * يسجّل استلام الويب هوك بشكل دائم.
 * `duplicate: true` يعني أن نفس التسليم سبق استلامه — وهذا طبيعي ومتوقع
 * (إعادة إرسال من المنصة) وليس خطأ.
 */
export async function recordWebhookReceipt(receipt: WebhookReceipt): Promise<ReceiptResult> {
  const row: Record<string, unknown> = {
    platform: receipt.platform,
    store_id: receipt.storeId,
    event: receipt.event,
    payload: receipt.payload ?? {},
    status: 'pending',
    erp_connection_id: receipt.erpConnectionId ?? null,
    connection_generation: receipt.connectionGeneration ?? null,
  }
  if (receipt.workspaceId) row.workspace_id = receipt.workspaceId
  if (receipt.dedupKey) row.dedup_key = receipt.dedupKey

  const { data, error } = await supabase
    .from('webhook_inbox')
    .insert(row)
    .select('id')
    .maybeSingle()

  if (!error && data) {
    // The receipt is already durable. Notification failures must never reject
    // the webhook or prevent its later Odoo dispatch.
    if (receipt.workspaceId) {
      try {
        const { recordAppNotification } = await import('./app-notifications')
        await recordAppNotification({
          workspaceId: receipt.workspaceId,
          platform: receipt.platform,
          event: receipt.event,
          eventKey: 'arrival:' + String((data as { id: string }).id),
          status: 'received',
          payload: receipt.payload,
        })
      } catch (notificationError) {
        console.warn('[Webhook Inbox] Notification enqueue unavailable')
      }
    }
    return { ok: true, id: (data as { id: string }).id }
  }

  const code = (error as { code?: string } | null)?.code
  if (code === '23505') {
    // نفس التسليم وصل مرتين — deduplication ربحها الفهرس الفريد الذرّي.
    return { ok: true, duplicate: true }
  }
  if (code === '42703' || code === '42P01') {
    // الجدول غير موجود بعد (ترحيل لم يُطبَّق) — لا نُسقط الاستلام.
    return { ok: false, error: 'webhook_inbox_missing' }
  }
  return { ok: false, error: error?.message?.slice(0, 200) ?? 'inbox_insert_failed' }
}

/**
 * حدث محفوظ لكن لا يمكن معالجته بعد: المتجر غير مرتبط بـworkspace.
 *
 * نعيد للمنصة 2xx حتى لا تعيد الإرسال بلا جدوى (إعادة الإرسال لن تُحلّ
 * المشكلة أصلاً)، لكننا نحتفظ بالحدث كاملاً في الصندوق بدل رميه. بمجرد ربط
 * المتجر يمكن إعادة دفعه، والتسوية الدورية تغطّي البيانات على أي حال.
 */
export async function recordOrphanReceipt(receipt: WebhookReceipt): Promise<ReceiptResult> {
  return recordWebhookReceipt({ ...receipt, workspaceId: null })
}

export interface InboxDrainResult {
  scanned: number
  enqueued: number
  duplicates: number
  failed: number
  /** أحداث محفوظة لكن لا يمكن معالجتها بعد (لا يوجد workspace مرتبط بالمتجر). */
  orphans: number
  inboxMissing: boolean
}

/** عدد الأحداث المحفوظة التي تنتظر ربط متجرها (للتنبيه والمراقبة). */
export async function countOrphanReceipts(): Promise<number> {
  const { count, error } = await supabase
    .from('webhook_inbox')
    .select('id', { count: 'exact', head: true })
    .eq('status', 'pending')
    .is('workspace_id', null)
  if (error) return 0
  return count ?? 0
}
function isPostgrestErrorWithCode(err: unknown, code: string): boolean {
  return (err as { code?: string } | null)?.code === code
}

/**
 * يعيد دفع أي ويب هوك لم يُسجَّل في الطابور بعد.
 * آمن للتشغيل المتكرر: الإدراج يتم عبر `dedup_key` الفريد الذرّي، فحتى لو
 * عملت نسختان من الـ cron في نفس اللحظة لن يتكرر التنفيذ.
 */
export async function drainWebhookInbox(limit = 25): Promise<InboxDrainResult> {
  const result: InboxDrainResult = {
    scanned: 0,
    enqueued: 0,
    duplicates: 0,
    failed: 0,
    orphans: 0,
    inboxMissing: false,
  }

  const { data, error } = await supabase
    .from('webhook_inbox')
    .select('id,platform,store_id,workspace_id,attempts,awaiting_erp')
    .eq('status', 'pending')
    .not('workspace_id', 'is', null)
    .lte('next_dispatch_at', new Date().toISOString())
    .order('next_dispatch_at', { ascending: true })
    .order('received_at', { ascending: true })
    .limit(Math.max(1, Math.min(limit, 100)))

  if (error) {
    if (isPostgrestErrorWithCode(error, '42P01')) result.inboxMissing = true
    return result
  }

  const rows = (data ?? []) as Array<{
    id: string
    platform: string
    store_id: string
    workspace_id: string | null
    attempts: number
    awaiting_erp: boolean
  }>

  result.scanned = rows.length

  for (const row of rows) {
    // حدث بلا workspace: لا يمكن إنشاء مهمة له الآن، ولا نُسقطه. يبقى
    // `pending` بلا معالجة (مستثنى من الاستعلام أعلاه)، فيُسترد فور ربط
    // المتجر، والتسوية الدورية تغطّي بياناته على أي حال. يُحتسب للعرض فقط.
    if (!row.workspace_id) {
      result.orphans += 1
      continue
    }

    let target
    if (row.awaiting_erp && isCommercePlatform(row.platform)) {
      try {
        target = await resolveExecutionTarget(row.workspace_id, row.platform, row.store_id)
      } catch {
        await postponeInboxDispatch(row.id, 'erp_execution_target_unavailable')
        continue
      }
    }
    const dispatched = await dispatchWebhookReceipt(row.id, {
      max_retries: SYNC_QUEUE_MAX_RETRIES,
      next_retry_at: new Date().toISOString(),
    }, target)
    if (dispatched.error) {
      result.failed += 1
      if (row.awaiting_erp) await postponeInboxDispatch(row.id, dispatched.error)
      else await markInboxFailed(row.id, dispatched.error, row.attempts)
    } else result.enqueued += 1
  }

  return result
}

/** Atomically insert one receipt-owned job and persist the dispatch marker. */
export async function dispatchWebhookReceipt(
  receiptId: string,
  queueOptions: { max_retries: number; next_retry_at: string },
  target?: ExecutionTarget
): Promise<{ id?: string; error?: string }> {
  try {
    const { data, error } = await supabase.rpc('dispatch_webhook_receipt', {
      p_receipt_id: receiptId,
      p_queue_row: target ? {
        ...queueOptions,
        erp_connection_id: target.erpConnectionId,
        connection_generation: target.connectionGeneration,
      } : queueOptions,
    })
    if (error || typeof data !== 'string') return { error: 'receipt_dispatch_unavailable' }
    return { id: data }
  } catch { return { error: 'receipt_dispatch_transport_failed' } }
}

async function postponeInboxDispatch(id: string, error: string): Promise<void> {
  await supabase.from('webhook_inbox')
    .update({ last_error: error, next_dispatch_at: new Date(Date.now() + DISPATCH_RETRY_DELAY_MS).toISOString() })
    .eq('id', id).eq('status', 'pending').eq('awaiting_erp', true)
}

/**
 * سقف المحاولات: كان `markInboxFailed` يعيد الحالة `pending` للأبد — رسالة
 * تفشل دائماً تُعاد في كل دورة drain وتُحرق الفهارس دون نتيجة. بعد
 * INBOX_DRAIN_MAX_ATTEMPTS تُعلَّم `failed` فتخرج من دورة الصريف
 * (الاستعلام يقرأ `pending` فقط)، وتبقى للمراجعة اليدوية.
 */
const INBOX_DRAIN_MAX_ATTEMPTS = 10

async function markInboxFailed(id: string, message: string, attempts: number): Promise<void> {
  const nextAttempts = (attempts ?? 0) + 1
  const status = nextAttempts >= INBOX_DRAIN_MAX_ATTEMPTS ? 'failed' : 'pending'
  await supabase
    .from('webhook_inbox')
    .update({
      last_error: message?.slice(0, 300) ?? 'enqueue failed',
      attempts: nextAttempts,
      ...(status === 'failed' ? { status: 'failed' as const } : {}),
    })
    .eq('id', id).eq('status', 'pending')
  if (status === 'failed') {
    console.error(`[Webhook Inbox] receipt ${id} marked failed after ${nextAttempts} drain attempts: ${message}`)
  }
}

/**
 * يعلّم سجل الاستلام بأنه تم تحويله إلى الطابور، فلا يعيد cron معالجته.
 */
export async function completeWebhookReceipt(dedupKey: string): Promise<void> {
  if (!dedupKey) return
  await supabase
    .from('webhook_inbox')
    .update({ status: 'done', processed_at: new Date().toISOString() })
    .eq('dedup_key', dedupKey)
    .eq('status', 'pending')
}

/**
 * Deletes legacy completed receipts only. New durable identities are retained.
 */
export async function pruneProcessedInbox(olderThanDays = 7): Promise<number> {
  const cutoff = new Date(Date.now() - olderThanDays * 24 * 60 * 60 * 1000).toISOString()
  const { data, error } = await supabase
    .from('webhook_inbox')
    .delete()
    .eq('status', 'done')
    .eq('durable_version', 1)
    .lt('processed_at', cutoff)
    .select('id')
  if (error) return 0
  return (data ?? []).length
}
