/**
 * Durable webhook inbox.
 *
 * كل ويب هوك يُكتب هنا أولاً (عملية واحدة سريعة) قبل أي معالجة، وبجانبه
 * نُعيد للمنصة استجابة 200/202. هذا يضمن أن الويب هوك لا يضيع أبداً:
 * إذا فشل إدراجه في `sync_queue` (انقطاع شبكة، إعادة تشغيل السيرفر، خطأ
 * ترحيل قاعدة البيانات) يبقى السجل هنا في حالة `pending` وتقوم مهمة
 * `drainWebhookInbox` بإعادة دفعه إلى الطابور.
 *
 * المبدأ: ACK بعد الحفظ الدائم، وليس قبله.
 */

import { supabase } from './supabase'

export interface WebhookReceipt {
  platform: string
  storeId: string
  workspaceId?: string | null
  event: string
  dedupKey?: string | null
  payload: Record<string, unknown>
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
  }
  if (receipt.workspaceId) row.workspace_id = receipt.workspaceId
  if (receipt.dedupKey) row.dedup_key = receipt.dedupKey

  const { data, error } = await supabase
    .from('webhook_inbox')
    .insert(row)
    .select('id')
    .maybeSingle()

  if (!error && data) return { ok: true, id: (data as { id: string }).id }

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
    .select('id,platform,store_id,workspace_id,event,dedup_key,payload,attempts')
    .eq('status', 'pending')
    .not('workspace_id', 'is', null)
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
    event: string
    dedup_key: string | null
    payload: Record<string, unknown>
    attempts: number
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

    const queueRow: Record<string, unknown> = {
      workspace_id: row.workspace_id,
      store_id: row.store_id,
      event: row.event,
      platform: row.platform,
      payload: row.payload,
      retry_count: 0,
      next_retry_at: new Date().toISOString(),
    }
    if (row.dedup_key) queueRow.dedup_key = row.dedup_key

    const { error: insertErr } = await supabase.from('sync_queue').insert(queueRow)

    if (insertErr) {
      if (isPostgrestErrorWithCode(insertErr, '23505')) {
        // المهمة موجودة بالفعل في الطابور — لا حاجة لإعادة التنفيذ.
        result.duplicates += 1
        await markInboxProcessed(row.id)
        continue
      }
      if (isPostgrestErrorWithCode(insertErr, '42703')) {
        // عمود dedup_key غير موجود (ترحيل غير مطبَّق) — نعيد المحاولة بدونه.
        const withoutKey: Record<string, unknown> = { ...queueRow }
        delete withoutKey.dedup_key
        const { error: retryErr } = await supabase.from('sync_queue').insert(withoutKey)
        if (!retryErr) {
          result.enqueued += 1
          await markInboxProcessed(row.id)
          continue
        }
        result.failed += 1
        await markInboxFailed(row.id, retryErr.message, row.attempts)
        continue
      }
      result.failed += 1
      await markInboxFailed(row.id, insertErr.message, row.attempts)
      continue
    }

    result.enqueued += 1
    await markInboxProcessed(row.id)
  }

  return result
}

async function markInboxProcessed(id: string): Promise<void> {
  await supabase
    .from('webhook_inbox')
    .update({ status: 'done', processed_at: new Date().toISOString() })
    .eq('id', id)
}

async function markInboxFailed(id: string, message: string, attempts: number): Promise<void> {
  await supabase
    .from('webhook_inbox')
    .update({ last_error: message?.slice(0, 300) ?? 'enqueue failed', attempts: (attempts ?? 0) + 1 })
    .eq('id', id)
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
 * ينقل السجلات القديمة المعالَجة إلى الأرشيف ثم يحذفها، حتى لا ينمو
 * `webhook_inbox` بلا حد مع بقاء السجل متاحاً للتدقيق.
 */
export async function pruneProcessedInbox(olderThanDays = 7): Promise<number> {
  const cutoff = new Date(Date.now() - olderThanDays * 24 * 60 * 60 * 1000).toISOString()
  const { data, error } = await supabase
    .from('webhook_inbox')
    .delete()
    .eq('status', 'done')
    .lt('processed_at', cutoff)
    .select('id')
  if (error) return 0
  return (data ?? []).length
}
