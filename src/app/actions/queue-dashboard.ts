'use server'

import { revalidatePath } from 'next/cache'

import { getActiveWorkspaceId } from '@/lib/auth'
import {
  groupQueueSelection,
  normaliseQueueSelection,
  queueArchiveExpiresAt,
  queueSourceTable,
  QUEUE_ARCHIVE_BATCH_LIMIT,
  QUEUE_ARCHIVES_TABLE,
} from '@/lib/queue-archive'
import {
  queueItemKindFromNextRetry,
  queueItemLookupOrder,
  type QueueKind,
} from '@/lib/queue-item'
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

/** نظرة عامة: معلق / مجمد / يتيم خاص بمتاجري / إجمالي الأرشيف (موتى + مؤرشف يدوياً). */
export async function getQueueOverview() {
  try {
    const workspaceId = await getActiveWorkspaceId()
    if (!workspaceId) return authError()

    const [pending, frozen, dead, archived, orphans] = await Promise.all([
      countExact('sync_queue', (q: any) => q.eq('workspace_id', workspaceId).not('next_retry_at', 'is', null)),
      countExact('sync_queue', (q: any) =>
        q.eq('workspace_id', workspaceId).or(`next_retry_at.is.null,next_retry_at.eq.${FROZEN_SENTINEL}`)
      ),
      countExact('sync_queue_dead', (q: any) => q.eq('workspace_id', workspaceId)),
      // الأرشيف اليدوي (7 أيام) يُعرض داخل تبويب "الأرشيف" نفسه، فعدّاده يُضاف
      // إليه في الواجهة. يُقرأ منفصلاً حتى يبقى معنى `dead` (أرشيف الموتى) واضحاً.
      countExact(QUEUE_ARCHIVES_TABLE, (q: any) => q.eq('workspace_id', workspaceId)),
      getOrphanItems(1),
    ])

    return {
      success: true,
      overview: {
        pending,
        frozen,
        orphans: orphans.success ? orphans.totalCount : null,
        dead,
        archived,
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

/** Platform IDs are separate namespaces: a Zid ID never authorizes a Salla orphan. */
async function getWorkspaceStoreFilter(workspaceId: string): Promise<string> {
  const [zid, salla, shopify] = await Promise.all([
    supabase.from('merchant_tokens').select('store_id,merchant_id').eq('workspace_id', workspaceId),
    supabase.from('salla_tokens').select('merchant_id').eq('workspace_id', workspaceId),
    supabase.from('shopify_tokens').select('shop_domain').eq('workspace_id', workspaceId),
  ])
  if (zid.error || salla.error || shopify.error) throw new Error('Store authorization unavailable')
  const scopes = new Set<string>()
  const add = (platform: string, id: unknown) => {
    const value = String(id ?? '')
    if (/^[a-zA-Z0-9_.:-]+$/.test(value)) scopes.add(`and(platform.eq.${platform},store_id.eq.${value})`)
  }
  for (const row of zid.data ?? []) { add('zid', row.store_id); add('zid', row.merchant_id) }
  for (const row of salla.data ?? []) add('salla', row.merchant_id)
  for (const row of shopify.data ?? []) add('shopify', row.shop_domain)
  return [...scopes].join(',') || 'platform.eq.__no_authorized_store__'
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
      .or(await getWorkspaceStoreFilter(workspaceId))
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

// ─── سجلّ واحد (صفحة /app/queue/<id>) ─────────────────────────────────────

/**
 * صفّ واحد كامل **بحمولته** لصفحة السجل.
 *
 * لماذا إجراء منفصل: شاشة القائمة تقرأ 20 صفاً في المرة، وضمّ `payload` إلى
 * استعلامها يعني تحميل 20 حمولة JSON كاملة — بعضها طلبات ببنود كثيرة — لعرض
 * عمودين نصيين فقط. القائمة تبقى خفيفة (كما في `/app/logs`)، وهذه الدالة تقرأ
 * الصف المطلوب وحده كاملاً.
 *
 * الأمان: كل قراءة مقيدة بمساحة العمل النشطة؛ والأيتام مقيدون بمعرّفات متاجر
 * المساحة (`.in('store_id', …)`) لا بالرقم وحده، وإلا صار الرقم مفتاحاً لبيانات
 * تاجر آخر.
 */
export interface QueueItemDetail {
  kind: QueueKind
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
  received_at: string | null
  died_at: string | null
  original_id: string | null
  dedup_key: string | null
  attempts: number | null
  payload: Record<string, unknown> | null
}

function asText(value: unknown): string | null {
  if (value === null || value === undefined) return null
  return String(value)
}

function asCount(value: unknown): number | null {
  if (value === null || value === undefined || value === '') return null
  const n = typeof value === 'number' ? value : Number(value)
  return Number.isFinite(n) ? n : null
}

function toQueueItemDetail(r: Record<string, unknown>, kind: QueueKind): QueueItemDetail {
  const payload =
    r.payload && typeof r.payload === 'object' && !Array.isArray(r.payload)
      ? (r.payload as Record<string, unknown>)
      : null

  let entityId: string | null = null
  try {
    entityId = extractEntityId(payload ?? {}) || null
  } catch {
    entityId = null
  }

  return {
    kind,
    id: asText(r.id) ?? '',
    platform: asText(r.platform),
    event: asText(r.event),
    store_id: asText(r.store_id),
    entity_id: entityId,
    retry_count: asCount(r.retry_count),
    max_retries: asCount(r.max_retries),
    error_message: asText(r.error_message),
    next_retry_at: asText(r.next_retry_at),
    created_at: asText(r.created_at),
    received_at: asText(r.received_at),
    died_at: asText(r.died_at),
    original_id: asText(r.original_id),
    dedup_key: asText(r.dedup_key),
    attempts: asCount(r.attempts),
    payload,
  }
}

export async function getQueueItemById(id: string, hint?: string | null) {
  try {
    const workspaceId = await getActiveWorkspaceId()
    if (!workspaceId) return authError()
    if (!id) return { success: false, error: 'Missing id' }

    for (const source of queueItemLookupOrder(hint)) {
      if (source === 'queue') {
        const { data, error } = await supabase
          .from('sync_queue')
          .select(
            'id,platform,event,store_id,payload,retry_count,max_retries,error_message,next_retry_at,created_at'
          )
          .eq('workspace_id', workspaceId)
          .eq('id', id)
          .maybeSingle()
        if (error) return { success: false, error: error.message }
        if (data) {
          const row = data as Record<string, unknown>
          return {
            success: true,
            item: toQueueItemDetail(
              row,
              queueItemKindFromNextRetry(asText(row.next_retry_at), FROZEN_SENTINEL)
            ),
          }
        }
        continue
      }

      if (source === 'dead') {
        const { data, error } = await supabase
          .from('sync_queue_dead')
          .select(
            'id,original_id,platform,event,store_id,payload,error_message,retry_count,died_at'
          )
          .eq('workspace_id', workspaceId)
          .eq('id', id)
          .maybeSingle()
        if (error) return { success: false, error: error.message }
        if (data) {
          return { success: true, item: toQueueItemDetail(data as Record<string, unknown>, 'dead') }
        }
        continue
      }

      // الإيصال: لا `workspace_id` فيه (قد يكون وصل قبل الربط)، فالقيد الحقيقي
      // هو متاجر هذه المساحة.
      const storeIds = await getWorkspaceStoreIds(workspaceId)
      if (storeIds.size === 0) continue

      const { data, error } = await supabase
        .from('webhook_inbox')
        .select('id,platform,store_id,event,dedup_key,received_at,attempts,payload')
        .eq('id', id)
        .in('store_id', [...storeIds])
      .or(await getWorkspaceStoreFilter(workspaceId))
        .maybeSingle()
      if (error) return { success: false, error: error.message }
      if (data) {
        return { success: true, item: toQueueItemDetail(data as Record<string, unknown>, 'orphans') }
      }
    }

    return { success: false, error: 'Not found' }
  } catch (err: unknown) {
    return {
      success: false,
      error: err instanceof Error ? err.message : 'Failed to load queue item',
    }
  }
}

// ─── الأزرار اليدوية (P2-2) ───────────────────────────────────────────────


/** "إرسال الآن": يصرف مستحقات هذه المساحة فوراً بنفس ضوابط الطابور. */
export async function sendNowWorkspace() {
  try {
    const workspaceId = await getActiveWorkspaceId()
    if (!workspaceId) return authError()

    const { processWorkspaceQueue } = await import('@/lib/sync-queue')
    const result = await processWorkspaceQueue(workspaceId, 25, true)
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
      .eq('outcome_unknown', false)
      .is('lease_token', null)
      .not('erp_connection_id', 'is', null)
      .not('connection_generation', 'is', null)
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
      .select('id,original_id,store_id,event,platform,payload,error_message,receipt_id,erp_connection_id,connection_generation,execution_key')
      .eq('workspace_id', workspaceId)
      .order('died_at', { ascending: true })
      .limit(capped)

    if (readErr) return { success: false, error: readErr.message }
    if (!rows || rows.length === 0) return { success: true, replayed: 0 }

    let replayed = 0
    for (const row of rows as Array<Record<string, unknown>>) {
      const result = await restorePinnedJob(row, workspaceId)
      if (!result.success) return { success: false, error: result.error, replayed }
      replayed += 1
    }

    revalidatePath('/app/queue')
    return { success: true, replayed }
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
          .update({ status: 'done', queue_id: queued.id, processed_at: new Date().toISOString() })
          .eq('id', orphan.id)
          .is('workspace_id', null)
          .or(await getWorkspaceStoreFilter(workspaceId))
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
      .select('id,original_id,workspace_id,store_id,event,platform,payload,error_message,retry_count,receipt_id,erp_connection_id,connection_generation,execution_key')
      .eq('id', deadId)
      .eq('workspace_id', workspaceId)
      .maybeSingle()

    if (readErr || !row) return { success: false, error: 'Not found' }

    const result = await restorePinnedJob(row as Record<string, unknown>, workspaceId)
    if (!result.success) return result
    revalidatePath('/app/queue')
    return { success: true }
  } catch (err: any) {
    return { success: false, error: err?.message || 'Replay failed' }
  }
}

/** Restore only the original verified target and identity, never the current default. */
async function restorePinnedJob(row: Record<string, unknown>, workspaceId: string) {
  const originalId = asText(row.original_id ?? row.id)
  const erpConnectionId = asText(row.erp_connection_id)
  const generation = asText(row.connection_generation)
  if (!originalId || !erpConnectionId || !generation || !row.execution_key || row.outcome_unknown) {
    return { success: false, error: 'Unpinned or uncertain job requires controlled reconciliation' }
  }
  const { validateExecutionTarget } = await import('@/lib/erp-execution-target')
  try {
    await validateExecutionTarget(workspaceId, String(row.platform), String(row.store_id), {
      erpConnectionId, connectionGeneration: generation,
    })
  } catch { return { success: false, error: 'Original ERP destination is no longer valid' } }
  const { error } = await supabase.from('sync_queue').insert({
    id: originalId, workspace_id: workspaceId, store_id: row.store_id,
    event: row.event, platform: row.platform, payload: row.payload ?? {},
    receipt_id: row.receipt_id ?? null, erp_connection_id: erpConnectionId,
    connection_generation: generation, execution_key: row.execution_key,
    retry_count: 0, max_retries: 5, outcome_unknown: false,
    next_retry_at: new Date().toISOString(), dedup_key: row.dedup_key ?? null,
    lease_token: null, lease_expires_at: null,
  })
  if (error && (error as { code?: string }).code !== '23505') return { success: false, error: 'Pinned job restore failed' }
  return { success: true }
}

// ─── الأرشفة اليدوية: نسخٌ كامل ثم حذف، واستعادة خلال 7 أيام ─────────────

export interface QueueArchiveRow {
  id: string
  source_kind: string
  source_table: string
  source_id: string
  platform: string | null
  event: string | null
  store_id: string | null
  entity_id: string | null
  error_message: string | null
  retry_count: number | null
  original_id: string | null
  archived_at: string | null
  expires_at: string | null
}

function toQueueArchiveRow(r: Record<string, unknown>): QueueArchiveRow {
  let entityId: string | null = null
  try {
    const payload = r.payload
    entityId = extractEntityId(
      payload && typeof payload === 'object' && !Array.isArray(payload)
        ? (payload as Record<string, unknown>)
        : {}
    ) || null
  } catch {
    entityId = null
  }
  return {
    id: asText(r.id) ?? '',
    source_kind: asText(r.source_kind) ?? 'pending',
    source_table: asText(r.source_table) ?? '',
    source_id: asText(r.source_id) ?? '',
    platform: asText(r.platform),
    event: asText(r.event),
    store_id: asText(r.store_id),
    entity_id: entityId,
    error_message: asText(r.error_message),
    retry_count: asCount(r.retry_count),
    original_id: asText(r.original_id),
    archived_at: asText(r.archived_at),
    expires_at: asText(r.expires_at),
  }
}

/**
 * أرشفة عناصر الطابور: **نسخ الصف كاملاً ثم حذفه من مصدره**.
 *
 * لماذا بهذا الترتيب: لو حُذف أولاً ثم فشل الإدراج، اختفى الصف بلا أثر — وهو
 * بالضبط عكس الغرض من الأرشفة. الاختبار يُثبّت الترتيب
 * (`tests/unit/queue-archive.test.ts`).
 *
 * الأمان:
 *   - القراءة والحذف مقيدان بمساحة العمل النشطة؛
 *   - الإيصالات (`webhook_inbox`) لا `workspace_id` فيها، فقيدها معرّفات متاجر
 *     هذه المساحة (`.in('store_id', …)`) — وإلا صار رقم الصف مفتاحاً لبيانات
 *     تاجر آخر؛
 *   - تكرار (23505) على فهرس `(source_table, source_id)` يعني "أُرشف مسبقاً"،
 *     فنتابع إلى الحذف بدل اعتباره فشلاً — النسخة موجودة فعلاً.
 */
export async function archiveQueueItems(items: Array<{ id: string; kind: string }>) {
  try {
    const workspaceId = await getActiveWorkspaceId()
    if (!workspaceId) return authError()

    const selected = normaliseQueueSelection(Array.isArray(items) ? items : [])
    if (selected.length === 0) return { success: true, archived: 0, failed: 0, skipped: 0 }

    const batch = selected.slice(0, QUEUE_ARCHIVE_BATCH_LIMIT)
    const grouped = groupQueueSelection(batch)
    const archivedAt = new Date()
    const archivedAtIso = archivedAt.toISOString()
    const expiresAtIso = queueArchiveExpiresAt(archivedAt)

    const storeIds =
      grouped.webhook_inbox.length > 0 ? await getWorkspaceStoreIds(workspaceId) : new Set<string>()

    let archived = 0
    let failed = 0
    let skipped = 0

    /** يُدرج النسخة؛ `true` تعني «النسخة موجودة» (جديدة أو مسبقة). */
    async function snapshot(row: Record<string, unknown>, kind: QueueKind): Promise<boolean> {
      const sourceId = asText(row.id) ?? ''
      if (!sourceId) return false
      const { error } = await supabase.from(QUEUE_ARCHIVES_TABLE).insert({
        workspace_id: workspaceId,
        source_kind: kind,
        source_table: queueSourceTable(kind),
        source_id: sourceId,
        platform: asText(row.platform),
        event: asText(row.event),
        store_id: asText(row.store_id),
        dedup_key: asText(row.dedup_key),
        // `webhook_inbox` يسمّي العمود `last_error`، والطابور يسميه
        // `error_message` — النسخة المؤرشفة تحمل السبب في الحالتين.
        error_message: asText(row.error_message ?? row.last_error),
        retry_count: asCount(row.retry_count),
        max_retries: asCount(row.max_retries),
        next_retry_at: asText(row.next_retry_at),
        original_id: asText(row.original_id),
        payload:
          row.payload && typeof row.payload === 'object' && !Array.isArray(row.payload)
            ? (row.payload as Record<string, unknown>)
            : {},
        // الصف كاملاً كما قُرئ — أعمدة قد تُضاف لاحقاً لجدول المصدر تبقى محفوظة.
        row_data: row,
        archived_at: archivedAtIso,
        expires_at: expiresAtIso,
      })
      if (!error) return true
      // 23505 = unique_violation على `uq_queue_archives_source`.
      return (error as { code?: string }).code === '23505'
    }

    if (grouped.sync_queue.length > 0) {
      const ids = grouped.sync_queue.map((i) => i.id)
      const kindById = new Map(grouped.sync_queue.map((i) => [i.id, i.kind]))
      const { data, error } = await supabase
        .from('sync_queue')
        .select('*')
        .eq('workspace_id', workspaceId)
        .in('id', ids)
      if (error) {
        failed += ids.length
      } else {
        const found = new Set<string>()
        for (const raw of (data ?? []) as Array<Record<string, unknown>>) {
          const id = asText(raw.id) ?? ''
          if (!id) continue
          found.add(id)
          if (raw.lease_token || raw.outcome_unknown) { skipped += 1; continue }
          const kind =
            kindById.get(id) ??
            queueItemKindFromNextRetry(asText(raw.next_retry_at), FROZEN_SENTINEL)
          if (!(await snapshot(raw, kind))) {
            failed += 1
            continue
          }
          const { error: delErr } = await supabase
            .from('sync_queue')
            .delete()
            .eq('workspace_id', workspaceId)
            .eq('id', id)
            .is('lease_token', null)
            .eq('outcome_unknown', false)
            .eq('updated_at', raw.updated_at)
          if (delErr) failed += 1
          else archived += 1
        }
        skipped += ids.filter((id) => !found.has(id)).length
      }
    }

    if (grouped.sync_queue_dead.length > 0) {
      const ids = grouped.sync_queue_dead.map((i) => i.id)
      const { data, error } = await supabase
        .from('sync_queue_dead')
        .select('*')
        .eq('workspace_id', workspaceId)
        .in('id', ids)
      if (error) {
        failed += ids.length
      } else {
        const found = new Set<string>()
        for (const raw of (data ?? []) as Array<Record<string, unknown>>) {
          const id = asText(raw.id) ?? ''
          if (!id) continue
          found.add(id)
          if (!(await snapshot(raw, 'dead'))) {
            failed += 1
            continue
          }
          const { error: delErr } = await supabase
            .from('sync_queue_dead')
            .delete()
            .eq('workspace_id', workspaceId)
            .eq('id', id)
          if (delErr) failed += 1
          else archived += 1
        }
        skipped += ids.filter((id) => !found.has(id)).length
      }
    }

    if (grouped.webhook_inbox.length > 0) {
      // بلا متاجر معروفة لا يوجد إيصال يخص هذه المساحة ⇒ لا قراءة ولا حذف.
      if (storeIds.size === 0) {
        skipped += grouped.webhook_inbox.length
      } else {
        const ids = grouped.webhook_inbox.map((i) => i.id)
        const { data, error } = await supabase
          .from('webhook_inbox')
          .select('*')
          .eq('status', 'pending')
          .is('workspace_id', null)
          .in('store_id', [...storeIds])
      .or(await getWorkspaceStoreFilter(workspaceId))
          .in('id', ids)
        if (error) {
          failed += ids.length
        } else {
          const found = new Set<string>()
          for (const raw of (data ?? []) as Array<Record<string, unknown>>) {
            const id = asText(raw.id) ?? ''
            if (!id) continue
            found.add(id)
            if (raw.durable_version === 2) { skipped += 1; continue }
            if (!(await snapshot(raw, 'orphans'))) {
              failed += 1
              continue
            }
            const { error: delErr } = await supabase
              .from('webhook_inbox')
              .delete()
              .eq('id', id)
              .in('store_id', [...storeIds])
      .or(await getWorkspaceStoreFilter(workspaceId))
            if (delErr) failed += 1
            else archived += 1
          }
          skipped += ids.filter((id) => !found.has(id)).length
        }
      }
    }

    revalidatePath('/app/queue')
    return { success: failed === 0, archived, failed, skipped }
  } catch (err: unknown) {
    return {
      success: false,
      error: err instanceof Error ? err.message : 'Archive failed',
      archived: 0,
      failed: 0,
      skipped: 0,
    }
  }
}

/** الأرشيف اليدوي لمساحة العمل — يُعرض داخل تبويب "الأرشيف" (أحدث أولاً). */
export async function getQueueArchives(limit = 100) {
  try {
    const workspaceId = await getActiveWorkspaceId()
    if (!workspaceId) return authError()

    const cap = Math.min(200, Math.max(1, limit))
    const { data, error } = await supabase
      .from(QUEUE_ARCHIVES_TABLE)
      .select(
        'id,source_kind,source_table,source_id,platform,event,store_id,error_message,retry_count,original_id,archived_at,expires_at,payload'
      )
      .eq('workspace_id', workspaceId)
      .order('archived_at', { ascending: false })
      .limit(cap)

    if (error) return { success: false, error: error.message }
    return {
      success: true,
      rows: ((data ?? []) as Array<Record<string, unknown>>).map(toQueueArchiveRow),
    }
  } catch (err: any) {
    return { success: false, error: err?.message || 'Failed to load archives' }
  }
}

/**
 * استعادة صف مؤرشف إلى الطابور قبل انتهاء مدته.
 *
 * الاستعادة = إدخال في `sync_queue` بمفتاح `dedup_key` جديد (كما في الأزرار
 * اليدوية الأخرى) حتى لا يصطدم الفهرس الجزئي، ثم حذف صف الأرشيف. ماذا يُرسل
 * فعلاً يظل قرار محرّك المزامنة: `findExistingOdooRecord` يحدّث بدل أن يُنشئ
 * عند وجود السجل، فالمكرر الآمن محفوظ.
 */
export async function restoreQueueArchive(archiveId: string) {
  try {
    const workspaceId = await getActiveWorkspaceId()
    if (!workspaceId) return authError()
    if (!archiveId) return { success: false, error: 'Missing id' }

    const { data, error } = await supabase
      .from(QUEUE_ARCHIVES_TABLE)
      .select('id,source_kind,platform,event,store_id,payload,error_message,original_id,row_data')
      .eq('workspace_id', workspaceId)
      .eq('id', archiveId)
      .maybeSingle()

    if (error) return { success: false, error: error.message }
    if (!data) return { success: false, error: 'Not found' }

    const row = data as Record<string, unknown>
    const original = row.row_data as Record<string, unknown> | undefined
    if (!original) return { success: false, error: 'Legacy archive requires controlled reconciliation' }
    const restored = await restorePinnedJob(original, workspaceId)
    if (!restored.success) return restored

    const { error: delErr } = await supabase
      .from(QUEUE_ARCHIVES_TABLE)
      .delete()
      .eq('workspace_id', workspaceId)
      .eq('id', archiveId)
    if (delErr) return { success: false, error: delErr.message }

    revalidatePath('/app/queue')
    return { success: true }
  } catch (err: unknown) {
    return {
      success: false,
      error: err instanceof Error ? err.message : 'Restore failed',
    }
  }
}

