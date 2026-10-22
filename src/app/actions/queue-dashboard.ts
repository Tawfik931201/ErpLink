'use server'

import { revalidatePath } from 'next/cache'

import { getActiveWorkspaceId } from '@/lib/auth'
import { supabase } from '@/lib/supabase'
import { extractEntityId, FROZEN_SENTINEL } from '@/lib/sync-queue'

/**
 * شاشة طابور الإرسال للتاجر (P2-1) + الأزرار اليدوية (P2-2).
 *
 * كل دالة مقيدة بمساحة العمل النشطة — التاجر يرى طلباته المعلقة فقط،
 * ويعيد إرسالها بزر دون انتظار الدورة التلقائية.
 */

function authError() {
  return { success: false, error: 'Unauthorized' }
}

async function countExact(table: string, build: (q: any) => any): Promise<number | null> {
  try {
    const { count, error } = await build(supabase.from(table).select('id', { count: 'exact', head: true }))
    if (error) return null
    return typeof count === 'number' ? count : null
  } catch {
    return null
  }
}

/** نظرة عامة: معلق / مجمد / يتيم خاص بمتاجري / أرشيف + عمر أقدم معلق. */
export async function getQueueOverview() {
  try {
    const workspaceId = await getActiveWorkspaceId()
    if (!workspaceId) return authError()

    const [pending, frozen, dead, skipped24h] = await Promise.all([
      countExact('sync_queue', (q: any) => q.eq('workspace_id', workspaceId).not('next_retry_at', 'is', null)),
      countExact('sync_queue', (q: any) =>
        q.eq('workspace_id', workspaceId).or(`next_retry_at.is.null,next_retry_at.eq.${FROZEN_SENTINEL}`)
      ),
      countExact('sync_queue_dead', (q: any) => q.eq('workspace_id', workspaceId)),
      countExact('sync_logs', (q: any) =>
        q
          .eq('workspace_id', workspaceId)
          .eq('status', 'skipped')
          .eq('trigger_type', 'webhook-ingress')
          .gte('created_at', new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString())
      ),
    ])

    let oldestPendingAgeSec: number | null = null
    try {
      const { data } = await supabase
        .from('sync_queue')
        .select('next_retry_at')
        .eq('workspace_id', workspaceId)
        .not('next_retry_at', 'is', null)
        .order('next_retry_at', { ascending: true })
        .limit(1)
        .maybeSingle()
      const ts = (data as { next_retry_at?: string } | null)?.next_retry_at
      if (ts) oldestPendingAgeSec = Math.max(0, Math.round((Date.now() - new Date(ts).getTime()) / 1000))
    } catch {
      oldestPendingAgeSec = null
    }

    const orphans = await getOrphanItems(1)

    return {
      success: true,
      overview: {
        pending,
        frozen,
        orphans: orphans.success ? orphans.totalCount : null,
        dead,
        ingressSkipped24h: skipped24h,
        oldestPendingAgeSec,
      },
    }
  } catch (err: any) {
    return { success: false, error: err?.message || 'Failed to load queue overview' }
  }
}

export interface QueueRow {
  id: string
  platform: string | null
  event: string | null
  store_id: string | null
  entity_id: string | null
  retry_count: number | null
  max_retries: number | null
  error_message: string | null
  next_retry_at: string | null
  created_at: string | null
}

function toQueueRow(r: any): QueueRow {
  let entityId: string | null = null
  try {
    entityId = extractEntityId((r.payload ?? {}) as Record<string, unknown>) || null
  } catch {
    entityId = null
  }
  return {
    id: r.id,
    platform: r.platform ?? null,
    event: r.event ?? null,
    store_id: r.store_id ?? null,
    entity_id: entityId,
    retry_count: r.retry_count ?? null,
    max_retries: r.max_retries ?? null,
    error_message: r.error_message ?? null,
    next_retry_at: r.next_retry_at ?? null,
    created_at: r.created_at ?? null,
  }
}

/** صفوف معلقة (مستحقة مستقبلاً) أو مجمدة (استُنفدت — تحتاج تدخلاً). */
export async function getQueueItems(params: { kind: 'pending' | 'frozen'; limit?: number; offset?: number }) {
  try {
    const workspaceId = await getActiveWorkspaceId()
    if (!workspaceId) return authError()

    const limit = Math.min(100, Math.max(1, params.limit ?? 25))
    const offset = Math.max(0, params.offset ?? 0)

    let query = supabase
      .from('sync_queue')
      .select(
        'id,platform,event,store_id,payload,retry_count,max_retries,error_message,next_retry_at,created_at',
        { count: 'exact' }
      )
      .eq('workspace_id', workspaceId)
      .order('created_at', { ascending: false })
      .range(offset, offset + limit - 1)

    query =
      params.kind === 'frozen'
        ? query.or(`next_retry_at.is.null,next_retry_at.eq.${FROZEN_SENTINEL}`)
        : query.not('next_retry_at', 'is', null)

    const { data, count, error } = await query
    if (error) return { success: false, error: error.message }

    return { success: true, rows: ((data ?? []) as any[]).map(toQueueRow), totalCount: count ?? 0 }
  } catch (err: any) {
    return { success: false, error: err?.message || 'Failed to load queue items' }
  }
}

/** معرفات متاجر مساحة العمل من جداول التوكنات الثلاثة. */
async function getWorkspaceStoreIds(workspaceId: string): Promise<Set<string>> {
  const ids = new Set<string>()
  try {
    const [zid, salla, shopify] = await Promise.all([
      supabase.from('merchant_tokens').select('store_id,merchant_id').eq('workspace_id', workspaceId),
      supabase.from('salla_tokens').select('merchant_id').eq('workspace_id', workspaceId),
      supabase.from('shopify_tokens').select('shop_domain').eq('workspace_id', workspaceId),
    ])
    for (const r of ((zid.data ?? []) as any[])) {
      if (r.store_id) ids.add(String(r.store_id))
      if (r.merchant_id) ids.add(String(r.merchant_id))
    }
    for (const r of ((salla.data ?? []) as any[])) {
      if (r.merchant_id) ids.add(String(r.merchant_id))
    }
    for (const r of ((shopify.data ?? []) as any[])) {
      if (r.shop_domain) ids.add(String(r.shop_domain))
    }
  } catch {
    // best-effort — مجموعة فارغة تعني "لا يتيم معروف".
  }
  return ids
}

/**
 * إيصالات يتيمة تخص متاجر هذه المساحة (وصلت قبل الربط أو بعده بخلل).
 * قابلة للاسترداد اليدوي فور مراجعتها — لا تُصرف تلقائياً عمداً.
 */
export async function getOrphanItems(limit = 25) {
  try {
    const workspaceId = await getActiveWorkspaceId()
    if (!workspaceId) return authError()

    const storeIds = await getWorkspaceStoreIds(workspaceId)
    if (storeIds.size === 0) return { success: true, rows: [], totalCount: 0 }

    const lim = Math.min(100, Math.max(1, limit))
    const { data, count, error } = await supabase
      .from('webhook_inbox')
      .select('id,platform,store_id,event,dedup_key,received_at,attempts,payload', { count: 'exact' })
      .eq('status', 'pending')
      .is('workspace_id', null)
      .in('store_id', [...storeIds])
      .order('received_at', { ascending: false })
      .limit(lim)

    if (error) return { success: false, error: error.message }
    return { success: true, rows: data ?? [], totalCount: count ?? 0 }
  } catch (err: any) {
    return { success: false, error: err?.message || 'Failed to load orphans' }
  }
}

/** صندوق الموتى (أرشيف المستنفد) — للتدقيق وإعادة الإرسال اليدوي الحذر. */
export async function getDeadItems(params: { limit?: number; offset?: number }) {
  try {
    const workspaceId = await getActiveWorkspaceId()
    if (!workspaceId) return authError()

    const limit = Math.min(100, Math.max(1, params.limit ?? 25))
    const offset = Math.max(0, params.offset ?? 0)

    const { data, count, error } = await supabase
      .from('sync_queue_dead')
      .select('id,original_id,platform,event,store_id,error_message,retry_count,died_at', { count: 'exact' })
      .eq('workspace_id', workspaceId)
      .order('died_at', { ascending: false })
      .range(offset, offset + limit - 1)

    if (error) return { success: false, error: error.message }
    return { success: true, rows: data ?? [], totalCount: count ?? 0 }
  } catch (err: any) {
    return { success: false, error: err?.message || 'Failed to load dead letters' }
  }
}

// ─── الأزرار اليدوية (P2-2) ───────────────────────────────────────────────

/** "إرسال الآن": يصرف مستحقات هذه المساحة فوراً بنفس ضوابط الطابور. */
export async function sendNowWorkspace() {
  try {
    const workspaceId = await getActiveWorkspaceId()
    if (!workspaceId) return authError()

    const { processWorkspaceQueue } = await import('@/lib/sync-queue')
    const result = await processWorkspaceQueue(workspaceId, 25)
    revalidatePath('/app/queue')
    return { success: true, ...result }
  } catch (err: any) {
    return { success: false, error: err?.message || 'Manual send failed' }
  }
}

/**
 * إعادة تشغيل المجمد: يعيد الصفوف المستنفدة إلى مستحقة الآن مع تصفير
 * العداد (السبب محفوظ في error_message). لا يمس صفوف مساحات أخرى.
 */
export async function retryFrozenItems() {
  try {
    const workspaceId = await getActiveWorkspaceId()
    if (!workspaceId) return authError()

    const { data, error } = await supabase
      .from('sync_queue')
      .update({ retry_count: 0, next_retry_at: new Date().toISOString() })
      .eq('workspace_id', workspaceId)
      .or(`next_retry_at.is.null,next_retry_at.eq.${FROZEN_SENTINEL}`)
      .select('id')

    if (error) return { success: false, error: error.message }
    revalidatePath('/app/queue')
    return { success: true, revived: (data ?? []).length }
  } catch (err: any) {
    return { success: false, error: err?.message || 'Retry failed' }
  }
}

/**
 * إعادة تشغيل **جماعية** لأرشيف الموتى لمساحة العمل الحالية.
 *
 * لماذا: كان الاسترجاع صفاً صفاً ⇒ في ذروة (أو بعد انقطاع أودوو) عشرات
 * الصفوف الميتة = عشرات ضغطات على زر. الآن بضغطة واحدة.
 *
 * الأمان: نفس قواعد `replayDeadItem` — نطاق المساحة فقط، ومفتاح dedup
 * جديد لكل صف (`replay:<id>:<ts>`) حتى لا يصطدم الفهرس الجزئي.
 */
export async function replayAllDeadItems(limit = 100) {
  try {
    const workspaceId = await getActiveWorkspaceId()
    if (!workspaceId) return authError()
    const capped = Math.max(1, Math.min(Math.trunc(limit) || 100, 500))

    const { data: rows, error: readErr } = await supabase
      .from('sync_queue_dead')
      .select('id,store_id,event,platform,payload,error_message')
      .eq('workspace_id', workspaceId)
      .order('died_at', { ascending: true })
      .limit(capped)

    if (readErr) return { success: false, error: readErr.message }
    if (!rows || rows.length === 0) return { success: true, replayed: 0 }

    const now = Date.now()
    const inserts = (rows as Array<Record<string, any>>).map((row) => ({
      workspace_id: workspaceId,
      store_id: row.store_id,
      event: row.event,
      platform: row.platform,
      payload: (row.payload ?? {}) as Record<string, unknown>,
      retry_count: 0,
      max_retries: 5,
      next_retry_at: new Date().toISOString(),
      dedup_key: `replay:${row.id}:${now}`,
      error_message: `replayed from dead-letter: ${String(row.error_message ?? '').slice(0, 200)}`,
    }))

    const { error: insertErr } = await supabase.from('sync_queue').insert(inserts)
    if (insertErr) return { success: false, error: insertErr.message }

    revalidatePath('/app/queue')
    return { success: true, replayed: inserts.length }
  } catch (err: any) {
    return { success: false, error: err?.message || 'Replay failed' }
  }
}

/**
 * استرجاع **الأيتام** — إيصالات محفوظة بلا مساحة عمل (المتجر غير مربوط).
 *
 * كانت للقراءة فقط: `getOrphanItems` يعرضها وبلا زر. فالنتيجة أن حدثاً
 * حقيقياً لمتجر رُبط متأخراً ظلّ معطلاً حتى يدخل الأدمن يدوياً.
 *
 * الإجراء: نبحث عن متجر `store_id` غير مربوط، فإن وُجد نُعيد ربطه
 * بمساحته ونعيد دفع الإيصالات. (إن لم يوجد متجر مربوط ⇒ نُبقي الأيتام
 * كما هي — لا نُدرجها في طابور بلا مساحة عمل.)
 */
export async function replayOrphanItems() {
  try {
    const workspaceId = await getActiveWorkspaceId()
    if (!workspaceId) return authError()

    // اليتائم التي تعرضها getOrphanItems تخص متاجر **هذه المساحة** (الاستعلام
    // يفلتر على store_id الخاص بها) ⇒ نستطيع ردّها إلى مساحتها مباشرة.
    const orphans = await getOrphanItems(100)
    const rows = (orphans as { rows?: Array<Record<string, any>> }).rows ?? []
    if (rows.length === 0) return { success: true, replayed: 0 }

    const { enqueueWebhookEvent } = await import('@/lib/sync-queue')
    let replayed = 0
    for (const orphan of rows) {
      const queued = await enqueueWebhookEvent({
        workspaceId,
        storeId: String(orphan.store_id ?? ''),
        event: String(orphan.event ?? ''),
        platform: String(orphan.platform ?? 'zid'),
        payload: (orphan.payload ?? {}) as Record<string, unknown>,
      })
      if (queued.id) {
        replayed += 1
        await supabase
          .from('webhook_inbox')
          .update({ status: 'done', processed_at: new Date().toISOString() })
          .eq('id', orphan.id)
      }
    }
    revalidatePath('/app/queue')
    return { success: true, replayed }
  } catch (err: any) {
    return { success: false, error: err?.message || 'Orphan replay failed' }
  }
}

/**
 * إعادة إرسال صف من الأرشيف إلى الطابور بمفتاح dedup جديد.
 * تحذير: يُستخدم فقط لطلب غير مسجل في أودوو — المكرر الآمن يمنعه
 * findExistingOdooRecord (تحديث بدل إنشاء) لكن الزر يبقى حذراً.
 */
export async function replayDeadItem(deadId: string) {
  try {
    const workspaceId = await getActiveWorkspaceId()
    if (!workspaceId) return authError()
    if (!deadId) return { success: false, error: 'Missing id' }

    const { data: row, error: readErr } = await supabase
      .from('sync_queue_dead')
      .select('id,workspace_id,store_id,event,platform,payload,error_message,retry_count')
      .eq('id', deadId)
      .eq('workspace_id', workspaceId)
      .maybeSingle()

    if (readErr || !row) return { success: false, error: 'Not found' }

    const { error: insertErr } = await supabase.from('sync_queue').insert({
      workspace_id: workspaceId,
      store_id: (row as any).store_id,
      event: (row as any).event,
      platform: (row as any).platform,
      payload: ((row as any).payload ?? {}) as Record<string, unknown>,
      retry_count: 0,
      max_retries: 5,
      next_retry_at: new Date().toISOString(),
      dedup_key: `replay:${(row as any).id}:${Date.now()}`,
      error_message: `replayed from dead-letter: ${String((row as any).error_message ?? '').slice(0, 200)}`,
    })

    if (insertErr) return { success: false, error: insertErr.message }
    revalidatePath('/app/queue')
    return { success: true }
  } catch (err: any) {
    return { success: false, error: err?.message || 'Replay failed' }
  }
}
