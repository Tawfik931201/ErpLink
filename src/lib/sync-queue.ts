/**
 * Sync Retry Queue — الطابور المركزي لكل المنصات (zid / salla / shopify).
 *
 * الدور: استقبال أحداث الويب هوك بسرعة (enqueue فقط) ثم معالجتها في الخلفية
 * بحد توازٍ وحجم دفعة محدودين، مع idempotency ودمج الأحداث المتكررة.
 *
 * المعالجة الفعلية تتم خارج مسار الطلب عبر:
 *   - GET /api/cron/sync-queue (مجدول خارجي — Vercel Cron أو ما يشابهه)
 *   - أو startSyncQueueRunner() من عملية طويلة العمر فقط (لا تُستدعى داخل request)
 *
 * ضمانات:
 *   - Idempotency: نفس التسليم لا يُدرج مرتين (delivery id) ونفس الكيان
 *     (platform+event+store+entity) يُدمج في صف واحد معلّق (coalescing).
 *   - Debounce ~5s: الأحداث المتكررة لنفس الكيان خلال النافذة تُدمج.
 *   - حد توازٍ 5 + حجم دفعة افتراضي 20.
 *   - Backoff أسّي مع حد أقصى + jitter، و max_retries لكل صف (افتراضي 5).
 *   - تجاهل القديم: عند وجود عدة صفوف معلّقة لنفس الكيان يُحتفظ بالأحدث
 *     (حسب updated_at ثم created_at) وتُحذف البقية دون معالجة.
 *   - تنظيف دوري للصفوف المستنفدة (next_retry_at IS NULL) الأقدم من 30 يوماً.
 *   - عدّادات في الذاكرة عبر getSyncQueueMetrics() (بدل console لكل حدث).
 */

import { createClient } from '@supabase/supabase-js'

import { processWebhookEvent } from './sync-engine'

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
)

// ─── Tunables ────────────────────────────────────────────────────────────────

export const SYNC_QUEUE_CONCURRENCY = 5
export const SYNC_QUEUE_DEFAULT_BATCH = 20
export const SYNC_QUEUE_MAX_RETRIES = 5
const BASE_BACKOFF_MINUTES = 5
const MAX_BACKOFF_MINUTES = 360
export const COALESCE_WINDOW_MS = 5_000
const EXHAUSTED_RETENTION_DAYS = 30
const CLEANUP_THROTTLE_MS = 60 * 60 * 1000 // ساعة واحدة

// ─── Entity / timestamp / delivery extraction ────────────────────────────────

const ENTITY_KEYS = [
  'id',
  'product_id',
  'order_id',
  'customer_id',
  'category_id',
  'category_uuid',
  'uuid',
  'sku',
] as const

const UPDATED_AT_KEYS = [
  'updated_at',
  'updatedAt',
  'modified_at',
  'modifiedAt',
  'update_time',
] as const

const DELIVERY_KEYS = [
  'salla_webhook_id',
  'shopify_webhook_id',
  'zid_webhook_id',
  'webhook_id',
  'delivery_id',
  'event_id',
  'uuid',
] as const

export function extractEntityId(payload: Record<string, unknown>): string {
  const target =
    payload?.data && typeof payload.data === 'object'
      ? (payload.data as Record<string, unknown>)
      : payload
  for (const key of ENTITY_KEYS) {
    const v = (payload as Record<string, unknown>)[key] ?? target[key]
    if (v !== undefined && v !== null && String(v) !== '') return String(v)
  }
  return ''
}

export function extractPayloadUpdatedAt(payload: Record<string, unknown>): number {
  const target =
    payload?.data && typeof payload.data === 'object'
      ? (payload.data as Record<string, unknown>)
      : payload
  for (const key of UPDATED_AT_KEYS) {
    const v = (payload as Record<string, unknown>)[key] ?? target[key]
    if (typeof v === 'string' || typeof v === 'number') {
      const t = new Date(v).getTime()
      if (Number.isFinite(t) && t > 0) return t
    }
  }
  return 0
}

export function extractDeliveryId(payload: Record<string, unknown>): string {
  for (const key of DELIVERY_KEYS) {
    const v = (payload as Record<string, unknown>)[key]
    if (v !== undefined && v !== null && String(v) !== '') return String(v)
  }
  return ''
}

export function buildDedupeKey(params: {
  platform: string
  event: string
  storeId: string
  entityId: string
}): string {
  return `${params.platform}:${params.event}:${params.storeId}:${params.entityId}`
}

// ─── Metrics (in-memory, per process) ────────────────────────────────────────

export interface SyncQueueMetrics {
  enqueued: number
  processed: number
  succeeded: number
  retried: number
  coalesced: number
  duplicates: number
  cleaned: number
  lastRunAt: string | null
  lastError: string | null
}

type MetricsGlobal = typeof globalThis & { __syncQueueMetrics?: SyncQueueMetrics }

function getMetricsStore(): SyncQueueMetrics {
  const g = globalThis as MetricsGlobal
  if (!g.__syncQueueMetrics) {
    g.__syncQueueMetrics = {
      enqueued: 0,
      processed: 0,
      succeeded: 0,
      retried: 0,
      coalesced: 0,
      duplicates: 0,
      cleaned: 0,
      lastRunAt: null,
      lastError: null,
    }
  }
  return g.__syncQueueMetrics
}

export function getSyncQueueMetrics(): SyncQueueMetrics {
  return { ...getMetricsStore() }
}

// ─── Enqueue ─────────────────────────────────────────────────────────────────

interface EnqueueParams {
  workspaceId: string
  storeId: string
  event: string
  platform: string
  payload: Record<string, unknown>
}

/**
 * Enqueue a failed sync for retry (first retry in 5 minutes).
 */
export async function enqueueFailedSync(params: EnqueueParams & { errorMessage: string }) {
  if (!params.workspaceId) return
  const backoffMinutes = BASE_BACKOFF_MINUTES

  await supabase.from('sync_queue').insert({
    workspace_id: params.workspaceId,
    store_id: params.storeId,
    event: params.event,
    platform: params.platform,
    payload: params.payload,
    error_message: params.errorMessage?.slice(0, 500),
    retry_count: 0,
    max_retries: SYNC_QUEUE_MAX_RETRIES,
    next_retry_at: new Date(Date.now() + backoffMinutes * 60 * 1000).toISOString(),
  })
}

export interface EnqueueResult {
  id?: string
  duplicate?: boolean
  coalesced?: boolean
  skipped?: boolean
}

/**
 * Enqueue a webhook event for background processing — idempotent.
 *
 *  - نفس delivery id المعلّق → يُتجاهل (duplicate).
 *  - نفس الكيان المعلّق (platform+event+store+entity) → يُدمج بأحدث payload
 *    (coalescing) بدل إدراج صف جديد — يمتص الدفعات الكبيرة والتكرار خلال ~5s.
 */
export async function enqueueWebhookEvent(params: EnqueueParams): Promise<EnqueueResult> {
  if (!params.workspaceId || !params.storeId || !params.event) {
    return { skipped: true }
  }
  const metrics = getMetricsStore()
  const entityId = extractEntityId(params.payload)
  const deliveryId = extractDeliveryId(params.payload)

  // ابحث عن صف معلّق مطابق لتطبيق idempotency/coalescing دون الحاجة لعمود جديد.
  try {
    const { data: pending } = await supabase
      .from('sync_queue')
      .select('id,payload,created_at')
      .eq('workspace_id', params.workspaceId)
      .eq('store_id', params.storeId)
      .eq('event', params.event)
      .eq('platform', params.platform)
      .not('next_retry_at', 'is', null)
      .order('created_at', { ascending: false })
      .limit(10)

    if (pending && pending.length > 0) {
      for (const row of pending as Array<{ id: string; payload: unknown; created_at: string }>) {
        const rowPayload = (row.payload ?? {}) as Record<string, unknown>
        // 1) نفس التسليم → تجاهل
        if (deliveryId && extractDeliveryId(rowPayload) === deliveryId) {
          metrics.duplicates += 1
          return { id: row.id, duplicate: true }
        }
        // 2) نفس الكيان → دمج (الأحدث يفوز)
        if (entityId && extractEntityId(rowPayload) === entityId) {
          const rowAgeMs = Date.now() - new Date(row.created_at).getTime()
          void rowAgeMs
          // ندمج أي صف معلّق لنفس الكيان (يمتص التكرار خلال ~5s والدفعات الأكبر).
          // الأحدث حسب updated_at يفوز؛ وإن غاب، الـpayload الجديد يفوز.
          const oldTs = extractPayloadUpdatedAt(rowPayload)
          const newTs = extractPayloadUpdatedAt(params.payload)
          const merged = newTs >= oldTs ? params.payload : rowPayload
          await supabase
            .from('sync_queue')
            .update({ payload: merged, updated_at: new Date().toISOString() })
            .eq('id', row.id)
          metrics.coalesced += 1
          return { id: row.id, coalesced: true }
        }
      }
    }
  } catch {
    // فشل فحص الدمج غير قاتل — تابع إلى الإدراج.
  }

  const { data, error } = await supabase
    .from('sync_queue')
    .insert({
      workspace_id: params.workspaceId,
      store_id: params.storeId,
      event: params.event,
      platform: params.platform,
      payload: params.payload,
      retry_count: 0,
      max_retries: SYNC_QUEUE_MAX_RETRIES,
      next_retry_at: new Date().toISOString(),
    })
    .select('id')
    .maybeSingle()

  if (error) return { skipped: true }
  metrics.enqueued += 1
  return { id: (data as { id?: string } | null)?.id }
}

// ─── Processing ──────────────────────────────────────────────────────────────

interface QueueItem {
  id: string
  workspace_id: string
  store_id: string
  event: string
  platform: string
  payload: Record<string, unknown>
  retry_count: number
  max_retries: number
  next_retry_at: string
  created_at: string
}

/**
 * Process due queue items with concurrency SYNC_QUEUE_CONCURRENCY.
 * Groups by dedupe key and keeps only the newest per entity (stale ignored).
 */
export async function processSyncQueue(maxItems = SYNC_QUEUE_DEFAULT_BATCH) {
  const metrics = getMetricsStore()
  metrics.lastRunAt = new Date().toISOString()

  const nowIso = new Date().toISOString()
  let items: QueueItem[] = []
  try {
    const { data, error } = await supabase
      .from('sync_queue')
      .select('id,workspace_id,store_id,event,platform,payload,retry_count,max_retries,next_retry_at,created_at')
      .not('next_retry_at', 'is', null)
      .lte('next_retry_at', nowIso)
      .order('next_retry_at', { ascending: true })
      .limit(Math.max(maxItems * 2, SYNC_QUEUE_CONCURRENCY * 2))

    if (error) {
      metrics.lastError = error.message?.slice(0, 300) ?? 'queue fetch failed'
      return
    }
    const rows = (data ?? []) as QueueItem[]
    // احترم max_retries الخاص بكل صف (لا نفترض 3 ثابتة).
    items = rows.filter((r) => (r.retry_count ?? 0) < (r.max_retries ?? SYNC_QUEUE_MAX_RETRIES))
  } catch (err: unknown) {
    metrics.lastError = err instanceof Error ? err.message.slice(0, 300) : 'queue fetch failed'
    return
  }

  if (items.length === 0) {
    await maybeCleanup()
    return
  }

  // ── Coalesce داخل الدفعة: احتفظ بالأحدث لكل كيان ──
  const groups = new Map<string, QueueItem[]>()
  for (const item of items) {
    const entityId = extractEntityId(item.payload ?? {})
    const deliveryId = extractDeliveryId(item.payload ?? {})
    const key = entityId
      ? buildDedupeKey({ platform: item.platform, event: item.event, storeId: item.store_id, entityId })
      : deliveryId
        ? `delivery:${item.platform}:${item.event}:${item.store_id}:${deliveryId}`
        : `noid:${item.id}`
    const list = groups.get(key)
    if (list) list.push(item)
    else groups.set(key, [item])
  }

  const toProcess: QueueItem[] = []
  for (const [, group] of groups) {
    if (group.length === 1) {
      toProcess.push(group[0])
      continue
    }
    // الأحدث حسب updated_at ثم created_at يفوز؛ البقية تُحذف دون معالجة.
    const sorted = [...group].sort((a, b) => {
      const tsDiff = extractPayloadUpdatedAt(b.payload ?? {}) - extractPayloadUpdatedAt(a.payload ?? {})
      if (tsDiff !== 0) return tsDiff
      return new Date(b.created_at).getTime() - new Date(a.created_at).getTime()
    })
    toProcess.push(sorted[0])
    const staleIds = sorted.slice(1).map((r) => r.id)
    try {
      await supabase.from('sync_queue').delete().in('id', staleIds)
      metrics.coalesced += staleIds.length
    } catch {
      // غير قاتل — ستُعالج لاحقاً.
      toProcess.push(...sorted.slice(1))
    }
  }

  const batch = toProcess.slice(0, maxItems)

  // ── حد التوازي ──
  for (let i = 0; i < batch.length; i += SYNC_QUEUE_CONCURRENCY) {
    const chunk = batch.slice(i, i + SYNC_QUEUE_CONCURRENCY)
    await Promise.allSettled(chunk.map((item) => processOneItem(item)))
  }

  await maybeCleanup()
}

async function processOneItem(item: QueueItem) {
  const metrics = getMetricsStore()
  metrics.processed += 1
  try {
    // isQueueExecution=true لمنع إعادة الإدراج المكررة من داخل المحرك.
    const result = await processWebhookEvent(
      item.event,
      item.store_id,
      item.payload as Record<string, unknown>,
      item.platform as 'zid' | 'salla' | 'shopify',
      true
    )

    if (result.failed === 0) {
      await supabase.from('sync_queue').delete().eq('id', item.id)
      metrics.succeeded += 1
    } else {
      const errorRecord = result.records.find((r) => r.status === 'failed')
      metrics.retried += 1
      await incrementRetry(item, errorRecord?.message || 'Sync failed')
    }
  } catch (err: unknown) {
    metrics.retried += 1
    metrics.lastError = err instanceof Error ? err.message.slice(0, 300) : 'item failed'
    await incrementRetry(item, err instanceof Error ? err.message : 'Sync failed')
  }
}

async function incrementRetry(item: QueueItem, errorMessage?: string) {
  const newCount = (item.retry_count || 0) + 1
  const maxRetries = item.max_retries || SYNC_QUEUE_MAX_RETRIES

  if (newCount >= maxRetries) {
    // استُنفدت المحاولات — يُترك للمراجعة اليدوية (next_retry_at = null).
    await supabase
      .from('sync_queue')
      .update({
        retry_count: newCount,
        last_error_at: new Date().toISOString(),
        next_retry_at: null,
        error_message: (errorMessage || '').slice(0, 500),
      })
      .eq('id', item.id)
  } else {
    // Backoff أسّي محدود + jitter: 5, 10, 20, ... حتى 360 دقيقة.
    const backoffMinutes = Math.min(Math.pow(2, newCount - 1) * BASE_BACKOFF_MINUTES, MAX_BACKOFF_MINUTES)
    const jitterMs = Math.floor(Math.random() * 60_000)
    await supabase
      .from('sync_queue')
      .update({
        retry_count: newCount,
        last_error_at: new Date().toISOString(),
        next_retry_at: new Date(Date.now() + backoffMinutes * 60 * 1000 + jitterMs).toISOString(),
        error_message: (errorMessage || '').slice(0, 500),
      })
      .eq('id', item.id)
  }
}

// ─── Cleanup ─────────────────────────────────────────────────────────────────

let lastCleanupAt = 0

async function maybeCleanup() {
  if (Date.now() - lastCleanupAt < CLEANUP_THROTTLE_MS) return
  lastCleanupAt = Date.now()
  try {
    const cleaned = await cleanupSyncQueue(EXHAUSTED_RETENTION_DAYS)
    getMetricsStore().cleaned += cleaned
  } catch {
    // غير قاتل.
  }
}

/**
 * حذف الصفوف المستنفدة (next_retry_at IS NULL) الأقدم من N يوماً.
 * يُستدعى تلقائياً (مخنوق) من processSyncQueue، ويمكن جدولته عبر cron.
 */
export async function cleanupSyncQueue(olderThanDays = EXHAUSTED_RETENTION_DAYS): Promise<number> {
  const cutoff = new Date(Date.now() - olderThanDays * 24 * 60 * 60 * 1000).toISOString()
  const { data, error } = await supabase
    .from('sync_queue')
    .delete()
    .is('next_retry_at', null)
    .lt('last_error_at', cutoff)
    .select('id')
  if (error) return 0
  return Array.isArray(data) ? data.length : 0
}
