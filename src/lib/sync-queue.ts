/**
 * Durable webhook processing backed by Supabase inbox receipts and queue jobs.
 * Store receipts can wait for the current ERP. Atomic dispatch pins that
 * connection generation and permanently links the receipt to one job.
 * RPC claims separate retry scheduling from fenced, renewable worker leases.
 * Unknown remote outcomes are quarantined for reconciliation, never replayed
 * automatically. This is not an exactly-once guarantee across ERP systems.
 */

import { createHash } from 'crypto'
import { productFamilyKey, selectQueueClaimWave } from './queue-claim-planner'

import { isCommercePlatform } from './erp-execution-target'
import { admitWorkspaceEvent, getActiveWorkspaceIds } from './ingress-admission'
import { processOdooStockEvent } from './stock-sync-engine'
import { supabase } from './supabase'
import { processWebhookEvent, cleanupExpiredLogs } from './sync-engine'

// ─── Tunables ────────────────────────────────────────────────────────────────

export const SYNC_QUEUE_CONCURRENCY = Number(process.env.SYNC_QUEUE_CONCURRENCY) || 10
export const SYNC_QUEUE_DEFAULT_BATCH = Number(process.env.SYNC_QUEUE_BATCH_SIZE) || 50
export const MAX_CONCURRENT_PER_WORKSPACE = Number(process.env.SYNC_QUEUE_MAX_PER_WORKSPACE) || 3
export const SYNC_QUEUE_MAX_RETRIES = 5
/**
 * الحد الأدنى لحصة مساحة عمل واحدة في دورة الجلب العادل.
 * يمنع أن تستهلك مساحة واحدة (مثلاً 3) كل نافذة الجلب بينما الباقون ينتظرون.
 */
const MIN_SHARE_PER_WORKSPACE = 5
/** أقصى عدد مساحات نعمل لها استعلاماً موجّهاً في دورة واحدة. */
const MAX_FAIR_WORKSPACES = 50
/**
 * مهلة الحدث الواحد (ملي ثانية).
 *
 * حدّ أعلى معقول: حدث = 6..15 نداء أودوو، ولكل نداء مهلة 10 ثوانٍ ⇒
 * أطول حالة سليمة ≈ 150 ثانية. المهلة تمنع حدثاً استثنائياً من حجز عامل
 * (من أصل 10) بلا حدّ.
 */
const SYNC_QUEUE_ITEM_TIMEOUT_MS = Number(process.env.SYNC_QUEUE_ITEM_TIMEOUT_MS) || 120_000

/**
 * يحيط عملاً بمهلة — **خالص**.
 * عند انتهاء المهلة يُرفض العمل، وتستمر المهمة الأصلية في الخلفية حتى تنتهي
 * لذلك يُحجز ناتجها كغير مؤكد ولا تُعاد كتابة ERP تلقائياً.
 */
export function withItemTimeout<T>(work: Promise<T>, timeoutMs: number): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => {
      reject(new Error(`sync item exceeded ${Math.round(timeoutMs / 1000)}s`))
    }, timeoutMs)
    work.then(
      (value) => {
        clearTimeout(timer)
        resolve(value)
      },
      (err) => {
        clearTimeout(timer)
        reject(err)
      }
    )
  })
}
const BASE_BACKOFF_MINUTES = 5
const MAX_BACKOFF_MINUTES = 360
/**
 * وضع الموسم (P3-1): `SYNC_SEASON_MODE=true` يقصّر أول إعادة من 5 دقائق إلى
 * دقيقة واحدة ويكبح السقف عند 15 دقيقة — تسلسل 1/2/4/8/15 يمنح الطلب فرصه
 * العادلة الخمس داخل نافذة ~30 دقيقة بدل أن تتجاوزها المحاولات الأولى.
 * الوضع العادي يبقى كما هو (5/10/20/... بحد 360) خارج الموسم.
 */
export function isSeasonMode(): boolean {
  return process.env.SYNC_SEASON_MODE === 'true'
}

/**
 * نافذة الدمج (milliseconds) — كم ننتظر قبل معالجة الحدث.
 *
 * في وضع الموسم: نأخّر معالجة الصف 45 ثانية. لماذا: بداخل هذه النافذة
 * تتكدّس تحديثات نفس الكيان (تغيّر حالة، دفعة، شحن…) فتُدمج في **صف واحد**
 * ⇒ كتابة واحدة في أودوو بدل N. في ذروة 1000 تحديث لنفس الطلب: 5-10
 * كتابة بدل 1000 — أي فرق هائل في ضغط أودوو ومنصة المتجر.
 *
 * التكلفة: تأخير 45 ثانية. وهو **مجاني** لأن هدف دفتر التشغيل هو "تسجيل
 * كل الطلبات خلال ~30 دقيقة".
 *
 * خارج الموسم: صفر ⇒ لا تأخير إطلاقاً (سلوك اليوم).
 */
export function coalesceWindowMs(): number {
  const explicit = Number(process.env.SYNC_COALESCE_WINDOW_MS)
  if (Number.isFinite(explicit) && explicit >= 0) return Math.trunc(explicit)
  return isSeasonMode() ? 45_000 : 0
}
function seasonBaseMinutes(): number {
  return isSeasonMode() ? 1 : BASE_BACKOFF_MINUTES
}

/**
 * Pure: يحسب دقائق الانتظار قبل المحاولة رقم newCount (1-based).
 * مصدَّر خالصاً ليُختبَر بلا قاعدة بيانات.
 */
export function computeBackoffMinutes(
  newCount: number,
  opts: { rateLimited?: boolean; connRefused?: boolean; season?: boolean } = {}
): number {
  const base = opts.season ? 1 : BASE_BACKOFF_MINUTES
  const cap = opts.season ? 15 : MAX_BACKOFF_MINUTES
  const floor =
    opts.rateLimited || opts.connRefused ? Math.max(base, opts.season ? 1 : 5) : base
  return Math.min(Math.pow(2, Math.max(1, newCount) - 1) * floor, cap)
}
const EXHAUSTED_RETENTION_DAYS = 30
const INBOX_RETENTION_DAYS = 7
const CLEANUP_THROTTLE_MS = 60 * 60 * 1000 // ساعة واحدة

/**
 * تاريخ بعيد يُستخدم كبديل لـ NULL عندما يكون عمود `next_retry_at` ما زال
 * NOT NULL (ترحيل قاعدة البيانات لم يُطبَّق بعد). يضمن ألّا يُلتقط الصف
 * مجدداً، مع بقائه محفوظاً في قاعدة البيانات.
 */
export const FROZEN_SENTINEL = '2999-12-31T23:59:59.000Z'

// ─── Entity / timestamp / delivery extraction ────────────────────────────────

const ENTITY_KEYS = [
  'id',
  'order_id',
  'customer_id',
  'category_id',
  'category_uuid',
  'uuid',
  'sku',
  // هوية الكيان عند التزامن العكسي من Odoo: بدونها لا يتم دمج تحديثات
  // السجل نفسه، فيذهب كل تحديث إلى Odoo على حدة (ضغط زائد بلا داعٍ).
  'odooRecordId',
  'odoo_record_id',
  // `product_id` ليس هنا عن قصد — انظر extractStockEntityId: أي حمولة تحمل
  //ه مع `location_id` تُعالَج هناك كوحدة مستقلة (منتج + موقع).
] as const

const UPDATED_AT_KEYS = [
  'updated_at',
  'updatedAt',
  'modified_at',
  'modifiedAt',
  'update_time',
] as const

/**
 * مفاتيح هوية **التسليم** (delivery) — لا هوية السجل.
 *
 * ⚠️ لا تضف `uuid` أو `id` هنا. في حمولة زد (وأغلب المتاجر) `uuid` هو
 * معرّف الكيان نفسه (الطلب/المنتج)، لا معرّف الرسالة. فائدة:
 * `dedupKey = delivery:<platform>:<store>:<event>:<uuid>` يبقى ثابتاً طوال
 * حياة السجل، فيتحوّل كل تحديث لاحق إلى «مكرر» ويُسقَط بصمت — وهو بالضبط
 * ما حذّر منه AGENTS.md. المنصات التي ترسل delivery id حقيقياً هي وحدها
 * (`webhook_id` / `*_webhook_id` / `delivery_id` / `event_id`).
 */
const DELIVERY_KEYS = [
  'salla_webhook_id',
  'shopify_webhook_id',
  'zid_webhook_id',
  'webhook_id',
  'delivery_id',
  'event_id',
] as const

export function extractEntityId(payload: Record<string, unknown>): string {
  const target =
    payload?.data && typeof payload.data === 'object'
      ? (payload.data as Record<string, unknown>)
      : payload

  const pick = (key: string): unknown => (payload as Record<string, unknown>)[key] ?? target[key]

  // ── المخزون أولاً: الوحدة الحقيقية هي الـquant (منتج + موقع + دفعة) ──
  // الدمج على `product_id` وحده كان يُسقط مواقع كاملة: عند قدوم حدثين لنفس
  // المنتج في مستودعين مختلفين يستبدل الثانيُ payloadَ الأول، فيضيع الحدث
  // الذي يخص الموقع المقترن فعلاً. هنا كل (منتج × موقع) صف مستقل.
  const stockId = extractStockEntityId(pick)
  if (stockId) return stockId

  for (const key of ENTITY_KEYS) {
    const v = pick(key)
    if (v !== undefined && v !== null && String(v) !== '') return String(v)
  }
  return ''
}

/**
 * هوية الدمج لحمولات المخزون: `quant:<id>` أو `p<product>:l<location>`.
 * تُرجع null لغير حمولات المخزون (طلبات/عملاء/فئات …) فيُستخدم ENTITY_KEYS.
 */
function extractStockEntityId(pick: (key: string) => unknown): string | null {
  const isStock =
    pick('quant_id') != null ||
    pick('quantId') != null ||
    (pick('id') == null && pick('product_id') != null && pick('location_id') != null)
  if (!isStock) return null

  const quant = pick('quant_id') ?? pick('quantId')
  if (quant != null && String(quant) !== '') return `quant:${quant}`

  const product = pick('product_id')
  const location = pick('location_id')
  if (product != null && String(product) !== '') {
    // بلا موقع لا يبقى إلا المنتج — أفضل من عدم الدمج إطلاقاً.
    return location != null && String(location) !== ''
      ? `p${product}:l${location}`
      : `p${product}`
  }
  return null
}

/**
 * بصمة قصيرة ومستقرة لمحتوى الحدث.
 *
 * تُستخدم عندما لا تعطي المنصة معرّف تسليم (حالة Odoo: الـAutomated Action
 * يرسل السجل فقط). الهدف دقيق ومهم:
 *   - إعادة إرسال نفس الحدث بنفس المحتوى ⇒ نفس البصمة ⇒ تُعتبر duplicate
 *     (لا عمل مكرر).
 *   - تغيّر حقيقي في نفس السجل ⇒ بصمة مختلفة ⇒ حدث جديد يُعالَج (لا إسقاط!).
 *
 * ⚠️ لا تستخدم هنا مفتاح هوية السجل وحده (مثل odoo:<model>:<id>): ذلك يجعل
 * كل تحديث لاحق للسجل يبدو duplicate ويُسقَط حتى نهاية نافذة الاحتفاظ.
 */
export function fingerprintPayload(payload: unknown): string {
  try {
    const canonical = JSON.stringify(sortKeys(payload))
    return createHash('sha1').update(canonical).digest('hex').slice(0, 16)
  } catch {
    return 'nohash'
  }
}

/** ترتيب المفاتيح حتى لا يغيّر ترتيب JSON البصمة. */
function sortKeys(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortKeys)
  if (value && typeof value === 'object') {
    const out: Record<string, unknown> = {}
    for (const key of Object.keys(value as Record<string, unknown>).sort()) {
      out[key] = sortKeys((value as Record<string, unknown>)[key])
    }
    return out
  }
  return value
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
  /**
   * معرّف الخريطة — **ل مسار أودوو فقط**.
   *
   * خريطتان مختلفتان قد تشيران إلى نفس سجل أودوو، ولكل منهما منطق كتابة
   * خاص (حقول مختلفة). بدون هذا التمييز تدمج الأُولى الثانية ⇒ **كتابة
   * إحداهما تُسقط بصمت**. في مسارات المتجر ← أودوو لا معنى للتمييز (الكيان
   * هو الكيان).
   */
  fieldMappingId?: string | null
}): string {
  const mappingScope =
    params.platform === 'odoo' && params.fieldMappingId
      ? `:${params.fieldMappingId}`
      : ''
  return `${params.platform}:${params.event}:${params.storeId}:${params.entityId}${mappingScope}`
}

/** معرّف الخريطة من الحمولة (مسار أودوو يحمله في body). */
export function extractFieldMappingId(payload: Record<string, unknown>): string {
  const v = (payload as Record<string, unknown>).field_mapping_id
  if (v === undefined || v === null || String(v) === '') return ''
  return String(v)
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
  /**
   * dedup key ذرّي للتسليمات المكرّرة (يُخزَّن في sync_queue.dedup_key).
   * اتركه فارغاً إذا لم توفّر المنصة delivery id.
   */
  dedupKey?: string | null
  nextRetryAt?: string
  executionTarget?: { erpConnectionId: string; connectionGeneration: string }
  acceptBeforeErp?: boolean
}

/**
 * Enqueue a failed sync for retry (first retry in 5 minutes — 1 in season mode).
 */
export async function enqueueFailedSync(params: EnqueueParams & { errorMessage: string }) {
  if (!params.workspaceId) return
  const { getErpExecutionScope } = await import('./erp-execution-target')
  const scope = getErpExecutionScope()
  const queued = await enqueueWebhookEvent({
    ...params,
    nextRetryAt: new Date(Date.now() + seasonBaseMinutes() * 60 * 1000).toISOString(),
    executionTarget: scope ? { erpConnectionId: scope.erpConnectionId, connectionGeneration: scope.connectionGeneration } : undefined,
  })
  if (queued.error) throw new Error(queued.error)
  if (queued.id && /unknown.outcome|outcome.unknown|uncertain|in.progress/i.test(params.errorMessage)) {
    await supabase.from('sync_queue').update({ outcome_unknown: true, next_retry_at: null,
      error_message: 'ERP_OUTCOME_UNKNOWN: manual failure requires reconciliation',
    }).eq('id', queued.id).is('lease_token', null)
  }
}

export interface EnqueueResult {
  id?: string
  deferred?: boolean
  duplicate?: boolean
  coalesced?: boolean
  skipped?: boolean
  /** فشل التخزين الدائم — يجب أن يرد المتصل بـ 5xx حتى تُعيد المنصة الإرسال. */
  error?: string
}

/**
 * Enqueue a webhook event for background processing — idempotent.
 *
 * Duplicate deliveries retain their existing receipt. Store ingress may save
 * the receipt for dispatch later, once the workspace has a usable ERP.
 */
export async function enqueueWebhookEvent(params: EnqueueParams): Promise<EnqueueResult> {
  if (!params.workspaceId || !params.storeId || !params.event) {
    return { skipped: true }
  }

  // ── بوابة الاستقبال (نقطة Admission الوحيدة) ───────────────────────────────
  // كل المنصات الخمس تمرّ من هنا ⇒ لا طريق لتسلّل طلب موثّق من دون البوابة.
  // القاعدة: **لا رفض** — ما فوق حصة المساحة يُقبَل ويُحفظ ويُعالَج، ويظهر
  // في لوحة الأدمن كـ«تجاوز». الرفض الوحيد هو صمام الأمان العام، ويعيد
  // المسار 503 (قابل لإعادة الإرسال) لا 429 (فقد).
  const admission = admitWorkspaceEvent(params.workspaceId)
  if (!admission.admitted) {
    return { error: 'ingress_overloaded' }
  }

  const metrics = getMetricsStore()
  const deliveryId = extractDeliveryId(params.payload)
  const dedupKey = params.dedupKey ?? (deliveryId
    ? `delivery:${params.platform}:${params.storeId}:${params.event}:${deliveryId}`
    : `fingerprint:${params.platform}:${params.storeId}:${params.event}:${fingerprintPayload(params.payload)}`)
  const { resolveExecutionTarget, validateExecutionTarget } = await import('./erp-execution-target')
  const acceptBeforeErp = params.acceptBeforeErp && isCommercePlatform(params.platform) && !params.executionTarget
  let target
  if (!acceptBeforeErp) {
    try {
      if (params.executionTarget) {
        await validateExecutionTarget(params.workspaceId, params.platform, params.storeId, params.executionTarget)
        target = params.executionTarget
      } else target = await resolveExecutionTarget(params.workspaceId, params.platform, params.storeId)
    } catch {
      return { error: 'erp_execution_target_unavailable' }
    }
  }
  const { recordWebhookReceipt, dispatchWebhookReceipt } = await import('./webhook-inbox')
  // Odoo remains unbatched. Every admitted delivery is preserved individually;
  // entity coalescing must not discard accepted business transitions.
  const useBatch = params.platform !== 'odoo'
  let receipt
  if (useBatch) {
    const { insertReceipts } = await import('./ingress-batch')
    ;[receipt] = await insertReceipts([{
      dedupKey, platform: params.platform, storeId: params.storeId,
      workspaceId: params.workspaceId, event: params.event, payload: params.payload,
      erpConnectionId: target?.erpConnectionId, connectionGeneration: target?.connectionGeneration,
      awaitingErp: acceptBeforeErp,
    }])
  } else {
    receipt = await recordWebhookReceipt({
      dedupKey, platform: params.platform, storeId: params.storeId,
      workspaceId: params.workspaceId, event: params.event, payload: params.payload,
      erpConnectionId: target?.erpConnectionId, connectionGeneration: target?.connectionGeneration,
    })
  }
  if (!receipt?.ok) return { error: receipt?.error ?? 'inbox_write_failed' }
  if (receipt.duplicate) {
    metrics.duplicates += 1
    return { duplicate: true }
  }
  if (!receipt.id) return { error: 'inbox_receipt_id_missing' }
  if (acceptBeforeErp) {
    try {
      target = await resolveExecutionTarget(params.workspaceId, params.platform, params.storeId)
    } catch {
      return { deferred: true }
    }
  }
  const dispatched = await dispatchWebhookReceipt(receipt.id, {
    max_retries: SYNC_QUEUE_MAX_RETRIES,
    next_retry_at: params.nextRetryAt ?? new Date(Date.now() + coalesceWindowMs()).toISOString(),
  }, acceptBeforeErp ? target : undefined)
  if (dispatched.error) return acceptBeforeErp ? { deferred: true } : { error: dispatched.error }
  metrics.enqueued += 1
  return { id: dispatched.id }
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
  updated_at: string | null
  lease_token: string | null
  lease_expires_at: string | null
  processing_started_at?: string | null
  outcome_unknown: boolean
  erp_connection_id: string | null
  connection_generation: string | null
}

/**
 * Process due queue items with fair-share scheduling and multi-tenant parallelism.
 * Returns the number of items successfully claimed and processed.
 */
export async function processSyncQueue(maxItems = SYNC_QUEUE_DEFAULT_BATCH): Promise<number> {
  const metrics = getMetricsStore()
  metrics.lastRunAt = new Date().toISOString()

  const nowIso = new Date().toISOString()
  const expired = await supabase.rpc('expire_sync_job_leases')
  if (expired.error) { metrics.lastError = 'lease recovery unavailable'; return 0 }
  let items: QueueItem[] = []
  try {
    const { data, error } = await supabase
      .from('sync_queue')
      .select('id,workspace_id,store_id,event,platform,payload,retry_count,max_retries,next_retry_at,created_at,updated_at')
      .not('next_retry_at', 'is', null)
      .is('lease_token', null)
      .eq('outcome_unknown', false)
      .lte('next_retry_at', nowIso)
      .order('next_retry_at', { ascending: true })
      .limit(Math.max(maxItems * 4, 100))

    if (error) {
      metrics.lastError = error.message?.slice(0, 300) ?? 'queue fetch failed'
      return 0
    }
    const rows = (data ?? []) as QueueItem[]
    // احترم max_retries الخاص بكل صف (لا نفترض 3 ثابتة).
    items = rows.filter((r) => (r.retry_count ?? 0) < (r.max_retries ?? SYNC_QUEUE_MAX_RETRIES))

    // ── الجلب العادل: لا Allows متجر واحد أن يملأ نافذة الجلب ──────────────
    // نافذة الجلب مرتّبة بـ`next_retry_at` ⇒ متجر واحد فيه 10 آلاف صف يملأ
    // الـ200 صف كلها، فلا يظهر أي متجر آخر ⇒ **يبقى محروماً حتى نهاية
    // الموسم** (التوزيع بالتناوب لا ينقذه: ما لم يُجلب لا يُوزَّع).
    //
    // الحل: نعرف المساحات النشطة من بوابة الاستقبال (كل مساحة استقبلت حدثاً
    // مسجّلاً)، فللمساحات التي غابت عن النافذة نعمل استعلاماً موجّهاً لكل
    // منها. الاستعلام الإضافي لا يقع إلا عند وجود ظلم فعلي.
    const present = new Set(items.map((r) => r.workspace_id))
    const starved = getActiveWorkspaceIds().filter((ws) => !present.has(ws))
    if (starved.length > 0) {
      const share = Math.max(
        MIN_SHARE_PER_WORKSPACE,
        Math.ceil(maxItems / Math.max(1, starved.length + present.size))
      )
      for (const ws of starved.slice(0, MAX_FAIR_WORKSPACES)) {
        try {
          const { data: wsRows } = await supabase
            .from('sync_queue')
            .select('id,workspace_id,store_id,event,platform,payload,retry_count,max_retries,next_retry_at,created_at,updated_at')
            .eq('workspace_id', ws)
            .not('next_retry_at', 'is', null)
      .is('lease_token', null)
      .eq('outcome_unknown', false)
            .lte('next_retry_at', nowIso)
            .order('next_retry_at', { ascending: true })
            .limit(share)
          for (const r of (wsRows ?? []) as QueueItem[]) {
            if ((r.retry_count ?? 0) < (r.max_retries ?? SYNC_QUEUE_MAX_RETRIES)) items.push(r)
          }
        } catch {
          // غير قاتل — المساحة تُخدم في الدورة التالية.
        }
      }
    }
  } catch (err: unknown) {
    metrics.lastError = err instanceof Error ? err.message.slice(0, 300) : 'queue fetch failed'
    return 0
  }

  if (items.length === 0) {
    await maybeCleanup()
    return 0
  }

  // Preserve all accepted deliveries; receipt identity is the dedup boundary.
  const toProcess = items

  // ── توزيع عادل (Fair-Share Round-Robin) بين مساحات العمل ──
  // يمنع أي متجر أو عميل واحد من احتكار الطابور وحرمان بقية العملاء
  const perWorkspace = new Map<string, QueueItem[]>()
  for (const item of toProcess) {
    const ws = item.workspace_id || 'unknown'
    const list = perWorkspace.get(ws)
    if (list) list.push(item)
    else perWorkspace.set(ws, [item])
  }

  // ── Dependency ordering within each workspace ─────────────────────────────
  // Orders: create must precede update.
  // Products: parent + child variants are one mutation family in Odoo. Running
  // them concurrently can create duplicate product.template.attribute.line
  // rows and duplicate variant combinations. Keep the parent before its
  // children and preserve source arrival order otherwise.
  const isOrderCreateEvent = (ev: string) =>
    ev === 'order.create' || ev === 'order.created' || ev === 'order_create' || ev === 'order_created'

  const productFamilyId = (item: QueueItem): string | null => {
    if (!/^(product[._]|product$)/i.test(item.event || '')) return null
    const payload: any = item.payload ?? {}
    const parentId = payload.parent_id
      ?? payload.parent?.id
      ?? payload.product?.parent_id
      ?? payload.product?.parent?.id
    const ownId = extractEntityId(payload)
    const family = parentId ?? ownId
    return family === undefined || family === null || family === '' ? null : String(family)
  }

  const productDependencyRank = (item: QueueItem): number => {
    const payload: any = item.payload ?? {}
    const isChild = Boolean(
      payload.parent_id ?? payload.parent?.id ?? payload.product?.parent_id ?? payload.product?.parent?.id
    )
    const event = String(item.event || '').toLowerCase()
    const isCreate = /(?:^|[._])create(?:d)?$/.test(event)
    const isDelete = /(?:^|[._])(?:delete|deleted|unpublish|unpublished)$/.test(event)
    const isPublishOrUpdate = /(?:^|[._])(?:publish|published|update|updated)$/.test(event)

    // Product-family dependency order:
    //  0 parent create
    //  1 child create(s)
    //  2 parent update/publish
    //  3 child update/publish
    //  4 child delete/unpublish
    //  5 parent delete/unpublish
    // This deliberately lets a later-arriving create overtake an earlier
    // publish/update for the same family, preventing "record not found" noise.
    if (isCreate) return isChild ? 1 : 0
    if (isPublishOrUpdate) return isChild ? 3 : 2
    if (isDelete) return isChild ? 4 : 5
    return isChild ? 3 : 2
  }

  for (const [, list] of perWorkspace) {
    if (list.length > 1) {
      list.sort((a, b) => {
        const entA = extractEntityId(a.payload ?? {})
        const entB = extractEntityId(b.payload ?? {})
        if (entA && entB && entA === entB) {
          const aIsCreate = isOrderCreateEvent(a.event)
          const bIsCreate = isOrderCreateEvent(b.event)
          if (aIsCreate && !bIsCreate) return -1
          if (!aIsCreate && bIsCreate) return 1
        }

        const familyA = productFamilyId(a)
        const familyB = productFamilyId(b)
        if (familyA && familyB && familyA === familyB) {
          const rank = productDependencyRank(a) - productDependencyRank(b)
          if (rank !== 0) return rank
          return Date.parse(a.created_at || '') - Date.parse(b.created_at || '')
        }
        return 0
      })
    }
  }

  const batch: QueueItem[] = []
  let hasMore = true
  while (batch.length < maxItems && hasMore) {
    hasMore = false
    for (const [, list] of perWorkspace) {
      if (list.length > 0 && batch.length < maxItems) {
        batch.push(list.shift()!)
        hasMore = true
      }
    }
  }

  // ── حجز ذري (claim): يمنع عاملين متداخلين من معالجة نفس الصف ─────────
  // runSyncQueueOnce يُستدعى بعد كل ويبهوك + cron، فتتداخل الدفعات. قبل
  // المعالجة نحجز كل صف بتحديث مشروط (ينجح فقط لو ما زال مستحقاً): الفائز
  // يتابَع، والخاسر يتخطى الصف. مدة الحجز 15 دقيقة — كافية لأبطأ حدث،
  // ولو تعطل العامل يُعاد الصف تلقائياً بعدها. الصف المحجوز يختفي أيضاً
  // من جلبات الدفعات الأخرى (next_retry_at مستقبلي).
  //
  // ⚠️ كان الحجز **متسلسلاً**: 50 تحديثاً واحداً تلو الآخر ⇒ 50 رحلة
  // ذهاب وإياب. عند BATCH=100 (وضع الموسم) صار ذلك 5..10 ثوانٍ من
  // انتظار قبل أن يبدأ أي عامل عمل — أي تأخير مباشر في الذروة.
  //
  // الحل: نفس التحديث المشروط (يبقى ذرّياً **لكل صف** — الشرط
  // `.lte('next_retry_at', now)` هو ما يمنع العاملين من التقاط الصف
  // نفسه)، لكن **بالتوازي** وبحدّ تزامن صغير. رحلة واحدة بدل 50.
  const CLAIM_CONCURRENCY = Math.max(1, Math.min(10, SYNC_QUEUE_CONCURRENCY))
  let claimedCount = 0

  // Claim only the next execution wave. Previously the whole batch was leased
  // up-front, so rows could sit leased for minutes without ever reaching ERP.
  // A deploy/restart during that wait left "ghost" leases. Wave claiming keeps
  // a lease tightly coupled to work that is about to start.
  let unclaimed = [...batch]
  while (unclaimed.length > 0) {
    // Claim only tasks that can actually execute immediately. Otherwise a
    // claimed item can expire while waiting behind the workspace/product lock.
    const wave = selectQueueClaimWave(unclaimed, CLAIM_CONCURRENCY, MAX_CONCURRENT_PER_WORKSPACE)
    unclaimed = wave.remaining
    const results = await Promise.all(wave.selected.map((item) => claimQueueItem(item.id, false)))
    const claimed = results.filter((item): item is QueueItem => Boolean(item))
    if (claimed.length === 0) continue
    claimedCount += claimed.length
    await processClaimedFairly(claimed)
  }

  if (claimedCount === 0) {
    await maybeCleanup()
    return 0
  }

  await maybeCleanup()
  return claimedCount
}

/**
 * "إرسال الآن" اليدوي لنطاق مساحة عمل واحدة (P2-2).
 *
 * يحجز حتى maxItems من الصفوف المستحقة لهذه المساحة فقط (نفس الحجز الذري
 * والحجز الزمني للدورة العامة) ثم يعالجها بنفس العامل — فيحترم سقف التوازي
 * لكل عميل فلا يضرب الزر اليدوي أودوو بعاصفة. يُستخدم من زر التاجر في شاشة
 * الطابور، لا من cron.
 *
 * سقف maxItems مقصود (1..50): الزر اليدوي دفعة تفاعلية لا تصريف موسم.
 */
export interface WorkspaceDrainResult {
  claimed: number
  processed: number
  succeeded: number
  retried: number
}

export async function processWorkspaceQueue(
  workspaceId: string,
  maxItems = 25,
  forceImmediate = false
): Promise<WorkspaceDrainResult> {
  const empty: WorkspaceDrainResult = { claimed: 0, processed: 0, succeeded: 0, retried: 0 }
  if (!workspaceId) return empty
  if (process.env.NEXT_PHASE === 'phase-production-build') return empty
  const limit = Math.min(50, Math.max(1, Math.trunc(maxItems) || 25))

  const metrics = getMetricsStore()
  const before = { succeeded: metrics.succeeded, retried: metrics.retried }
  const nowIso = new Date().toISOString()

  let items: QueueItem[] = []
  try {
    let query = supabase
      .from('sync_queue')
      .select('id,workspace_id,store_id,event,platform,payload,retry_count,max_retries,next_retry_at,created_at,updated_at')
      .eq('workspace_id', workspaceId)
      .not('next_retry_at', 'is', null)
      .is('lease_token', null)
      .eq('outcome_unknown', false)

    if (!forceImmediate) {
      query = query.lte('next_retry_at', nowIso)
    }

    const { data, error } = await query
      .order('next_retry_at', { ascending: true })
      .limit(limit)
    if (error) {
      metrics.lastError = error.message?.slice(0, 300) ?? 'workspace queue fetch failed'
      return empty
    }
    items = ((data ?? []) as QueueItem[]).filter(
      (r) => (r.retry_count ?? 0) < (r.max_retries ?? SYNC_QUEUE_MAX_RETRIES)
    )
  } catch (err: unknown) {
    metrics.lastError = err instanceof Error ? err.message.slice(0, 300) : 'workspace queue fetch failed'
    return empty
  }
  if (items.length === 0) return empty

  let claimedCount = 0
  let unclaimed = items
  while (unclaimed.length > 0) {
    const wave = selectQueueClaimWave(unclaimed, SYNC_QUEUE_CONCURRENCY, MAX_CONCURRENT_PER_WORKSPACE)
    unclaimed = wave.remaining
    const locked = await Promise.all(wave.selected.map((item) => claimQueueItem(item.id, forceImmediate)))
    const claimed = locked.filter((item): item is QueueItem => Boolean(item))
    claimedCount += claimed.length
    if (claimed.length) await processClaimedFairly(claimed)
  }
  if (claimedCount === 0) return empty

  const after = getMetricsStore()
  return {
    claimed: claimedCount,
    processed: claimedCount,
    succeeded: after.succeeded - before.succeeded,
    retried: after.retried - before.retried,
  }
}

/**
 * معالج متزامن ذكي:
 *  - سقف توازي كلي عبر جميع العملاء: SYNC_QUEUE_CONCURRENCY
 *  - سقف توازي لكل عميل / أودو منفرد: MAX_CONCURRENT_PER_WORKSPACE
 */
async function processClaimedFairly(claimed: QueueItem[]): Promise<void> {
  const pending = [...claimed]
  const runningPerWorkspace = new Map<string, number>()
  const runningProductFamilies = new Set<string>()
  let activeWorkers = 0

  return new Promise<void>((resolve) => {
    function scheduleNext() {
      if (pending.length === 0 && activeWorkers === 0) {
        resolve()
        return
      }

      while (activeWorkers < SYNC_QUEUE_CONCURRENCY && pending.length > 0) {
        const itemIdx = pending.findIndex((item) => {
          const ws = item.workspace_id || 'unknown'
          const currentRunning = runningPerWorkspace.get(ws) || 0
          const productKey = productFamilyKey(item)
          return currentRunning < MAX_CONCURRENT_PER_WORKSPACE
            && (!productKey || !runningProductFamilies.has(productKey))
        })

        if (itemIdx === -1) {
          // Remaining work is blocked by workspace concurrency or a currently
          // running product-family dependency. Resume when a worker settles.
          break
        }

        const [item] = pending.splice(itemIdx, 1)
        const ws = item.workspace_id || 'unknown'
        const productKey = productFamilyKey(item)
        runningPerWorkspace.set(ws, (runningPerWorkspace.get(ws) || 0) + 1)
        if (productKey) runningProductFamilies.add(productKey)
        activeWorkers++

        processOneItem(item)
          .catch(async (error: unknown) => {
            // Never silently discard a rejected worker promise: the remote
            // ERP write might already have happened, so quarantine by fence.
            getMetricsStore().lastError = error instanceof Error
              ? error.message.slice(0, 250) : 'uncaught queue worker error'
            console.error('[sync-queue] worker rejected; quarantining uncertain outcome')
            await parkUnknownOutcome(item)
          })
          .finally(() => {
            activeWorkers--
            if (productKey) runningProductFamilies.delete(productKey)
            const current = runningPerWorkspace.get(ws) || 1
            if (current <= 1) {
              runningPerWorkspace.delete(ws)
            } else {
              runningPerWorkspace.set(ws, current - 1)
            }
            scheduleNext()
          })
      }
    }

    scheduleNext()
  })
}

/** Claim tokens fence all settlement; a stale worker cannot settle another lease. */
async function claimQueueItem(id: string, forceImmediate: boolean): Promise<QueueItem | null> {
  try {
    const { data, error } = await supabase.rpc('claim_sync_job', {
      p_job_id: id, p_force: forceImmediate, p_lease_seconds: 60,
    })
    if (error) { getMetricsStore().lastError = 'queue claim unavailable'; return null }
    const item = (Array.isArray(data) ? data[0] : data) as QueueItem | undefined
    return item?.lease_token ? item : null
  } catch { getMetricsStore().lastError = 'queue claim transport failed'; return null }
}

async function settleSuccessfulItem(item: QueueItem): Promise<boolean> {
  const { data, error } = await supabase.from('sync_queue').delete()
    .eq('id', item.id).eq('lease_token', item.lease_token)
    .select('id')
  if (error) throw new Error('Queue success settlement failed')
  return (data?.length ?? 0) > 0
}

async function parkUnknownOutcome(item: QueueItem): Promise<void> {
  const { error } = await supabase.from('sync_queue').update({
    next_retry_at: null, outcome_unknown: true, lease_token: null,
    lease_expires_at: null, error_message: 'unknown outcome: reconciliation required',
    last_error_at: new Date().toISOString(),
  }).eq('id', item.id).eq('lease_token', item.lease_token)
  if (error) getMetricsStore().lastError = 'unknown outcome quarantine failed; lease expiry recovery required'
}

async function markQueueItemStarted(item: QueueItem): Promise<boolean> {
  const activeLeaseMs = Math.max(
    SYNC_QUEUE_ITEM_TIMEOUT_MS + 60_000,
    Number(process.env.SYNC_QUEUE_ACTIVE_LEASE_MS) || 180_000
  )
  const leaseSeconds = Math.ceil(activeLeaseMs / 1000)

  try {
    const { data, error } = await supabase.rpc('mark_sync_job_started', {
      p_job_id: item.id,
      p_lease_token: item.lease_token,
      p_lease_seconds: leaseSeconds,
    })
    if (!error) return Number(data ?? 0) > 0

    // Backward-compatible deploy window: if the migration has not reached the
    // database yet, preserve the fenced token and extend the active lease.
    const { data: fallbackRows, error: fallbackError } = await supabase
      .from('sync_queue')
      .update({ lease_expires_at: new Date(Date.now() + activeLeaseMs).toISOString() })
      .eq('id', item.id)
      .eq('lease_token', item.lease_token)
      .gt('lease_expires_at', new Date().toISOString())
      .select('id')
    if (fallbackError) return false
    return (fallbackRows?.length ?? 0) > 0
  } catch {
    return false
  }
}

async function processOneItem(item: QueueItem) {
  const metrics = getMetricsStore()
  metrics.processed += 1
  if (!item.erp_connection_id || !item.connection_generation || !item.lease_token) {
    await parkUnknownOutcome(item)
    return
  }
  if (!(await markQueueItemStarted(item))) {
    metrics.lastError = `queue start fence lost: ${item.platform}:${item.event}`
    return
  }
  const activeLeaseMs = Math.max(
    SYNC_QUEUE_ITEM_TIMEOUT_MS + 60_000,
    Number(process.env.SYNC_QUEUE_ACTIVE_LEASE_MS) || 180_000
  )
  const heartbeat = setInterval(() => {
    void (async () => {
      try {
        const { error } = await supabase.from('sync_queue').update({
          lease_expires_at: new Date(Date.now() + activeLeaseMs).toISOString(),
        }).eq('id', item.id).eq('lease_token', item.lease_token)
          .gt('lease_expires_at', new Date().toISOString())
        if (error) metrics.lastError = 'queue heartbeat failed'
      } catch { metrics.lastError = 'queue heartbeat transport failed' }
    })()
  }, 30_000)
  heartbeat.unref?.()
  try {
    const { validateExecutionTarget, withErpTarget } = await import('./erp-execution-target')
    await validateExecutionTarget(item.workspace_id, item.platform, item.store_id, {
      erpConnectionId: item.erp_connection_id, connectionGeneration: item.connection_generation,
    })
    // isQueueExecution=true لمنع إعادة الإدراج المكررة من داخل المحرك.
    // ── مهلة لكل حدث ───────────────────────────────────────────────────────
    // بلاها: حدث فيه 15 نداء متتالي وأحدها بطيء = 150 ثانية يحتجز عاملاً
    // من أصل 10. عشرة أحداث سيئة = الطابور كله يقف.
    const work = withErpTarget({
      workspaceId: item.workspace_id, platform: item.platform as 'zid' | 'salla' | 'shopify' | 'odoo',
      storeId: item.store_id, eventId: item.id,
      erpConnectionId: item.erp_connection_id, connectionGeneration: item.connection_generation,
    }, async () => {
      if (item.platform === 'odoo') {
        if (item.event === 'odoo.model.sync') {
          const { runBackgroundSync } = await import('@/app/api/webhooks/odoo/route')
          const p = (item.payload || {}) as Record<string, unknown>
          return runBackgroundSync(
            String(p.field_mapping_id || ''),
            String(p.model || ''),
            Number(p.odooRecordId || 0),
            p.payloadData as Record<string, unknown> | undefined,
            typeof p.auth_status === 'string' ? p.auth_status : undefined
          )
        }
        return processOdooStockEvent(item.payload as Record<string, unknown>)
      }      return processWebhookEvent(
        item.event,
        item.store_id,
        item.payload as Record<string, unknown>,
        item.platform as 'zid' | 'salla' | 'shopify',
        true,
        item.workspace_id,
        item.id,
        { erpConnectionId: item.erp_connection_id!, connectionGeneration: item.connection_generation! }
      )
    })

    const result = (await withItemTimeout(work, SYNC_QUEUE_ITEM_TIMEOUT_MS)) as
      | { ok: boolean; message?: string }
      | { success: number; failed: number; skipped?: number; records: Array<{ status: string; message?: string }> }
      | void

    if (result && typeof result === 'object' && 'ok' in result) {
      if (result.ok) {
        if (await settleSuccessfulItem(item)) {
          metrics.succeeded += 1
          noteWorkspaceSuccess(item.workspace_id)
        }
      } else {
        metrics.retried += 1
        await incrementRetry(item, result.message || 'Sync failed')
      }
    } else if (result && 'failed' in result && result.failed === 0) {
      if (await settleSuccessfulItem(item)) metrics.succeeded += 1
    } else if (result && typeof result === 'object' && 'records' in result) {
      const errorRecord = result.records.find((r: { status: string }) => r.status === 'failed')
      metrics.retried += 1
      await incrementRetry(item, errorRecord?.message || 'Sync failed')
    } else {
      // ── لا نتيجة على الإطلاق (undefined / early return) ──
      // كان الكود السابق يعتبر هذا «نجاحاً» ويحذف الصف، فتفقد المهمة بصمت.
      // No result cannot prove that remote effects did not happen; quarantine it.
      metrics.retried += 1
      metrics.lastError = `no result for ${item.platform}:${item.event}`
      await parkUnknownOutcome(item) // no result returned for this event
    }
  } catch (err: unknown) {
    metrics.retried += 1
    metrics.lastError = err instanceof Error ? err.message.slice(0, 300) : 'item failed'
    const message = err instanceof Error ? err.message : 'Sync failed'
    if (/exceeded|unknown.outcome|outcome.unknown|uncertain|in.progress|reconciliation required|execution.target|connection.generation/i.test(message)) {
      await parkUnknownOutcome(item)
    } else await incrementRetry(item, message)
  } finally {
    clearInterval(heartbeat)
  }
}

// ─── Circuit breaker لكل عميل (P3-1) ───────────────────────────────────────
// المشكلة: أودوو عميل واحد ساقط = كل طلباته تفشل 10 ثواني × 5 محاولات، فتحرق
// slots العامل العشرة وتُبطئ بقية العملاء رغم سقف التوازي. الحل: عدّاد إخفاقات
// متتالية لكل مساحة (في الذاكرة — الـ runner عملية واحدة)، وعند العتبة تُركن
// صفوفه المستحقة قريباً إلى ما بعد فترة التهدئة بدل حرق المحاولات. النجاح
// يصفّر العداد فوراً. الصفوف ذات الـ backoff البعيد (أبعد من التهدئة) لا تُمس.
const cbFailures = new Map<string, number>()
const cbParkedUntil = new Map<string, number>()

function cbThreshold(): number {
  const n = Number(process.env.SYNC_CB_THRESHOLD)
  return Number.isFinite(n) && n > 0 ? Math.trunc(n) : 10
}

function cbCooldownMs(): number {
  const m = Number(process.env.SYNC_CB_COOLDOWN_MIN)
  const mins = Number.isFinite(m) && m > 0 ? m : 15
  return mins * 60 * 1000
}

/** للمراقبة (P3-2): حالة القواطع الحالية. */
export function getCircuitBreakerState(): Array<{
  workspaceId: string
  parkedUntil: string
  consecutiveFailures: number
}> {
  const now = Date.now()
  const out: Array<{ workspaceId: string; parkedUntil: string; consecutiveFailures: number }> = []
  for (const [ws, until] of cbParkedUntil) {
    if (until > now) {
      out.push({
        workspaceId: ws,
        parkedUntil: new Date(until).toISOString(),
        consecutiveFailures: cbFailures.get(ws) ?? 0,
      })
    }
  }
  return out
}

function noteWorkspaceSuccess(workspaceId: string | null | undefined): void {
  if (!workspaceId) return
  cbFailures.delete(workspaceId)
}

/** تنظيف ذاكرة القاطع عند حذف مساحة عمل — لا تبقى حالة لعميل رحل. */
export function clearWorkspaceFailureState(workspaceId: string): void {
  if (!workspaceId) return
  cbFailures.delete(workspaceId)
  cbParkedUntil.delete(workspaceId)
}

async function noteWorkspaceFailure(
  workspaceId: string | null | undefined,
  errorMessage?: string
): Promise<void> {
  if (!workspaceId) return
  const count = (cbFailures.get(workspaceId) ?? 0) + 1
  cbFailures.set(workspaceId, count)
  if (count < cbThreshold()) return
  const now = Date.now()
  if ((cbParkedUntil.get(workspaceId) ?? 0) > now) return // مركون أصلاً
  const until = now + cbCooldownMs()
  const untilIso = new Date(until).toISOString()
  cbParkedUntil.set(workspaceId, until)
  cbFailures.set(workspaceId, 0)
  try {
    // فقط الصفوف المستحقة الآن (`next_retry_at <= الآن`) — الفصل حاسم:
    // كان الشرط `.lte(next_retry_at, untilIso)` يمس أيضاً صفوفاً محجوزة من
    // عامل آخر (lease = الآن + 15د) حين كانت التهدئة أقصر من مدة الحجز،
    // فيُستبدل استحقاقُها الزمني بموعد التهدئة وتُعالج التسليم الواحد مرتين.
    // الحجز يُثبته عمود `next_retry_at` المستقبلي، والركن يلمس المستحق فقط.
    await supabase
      .from('sync_queue')
      .update({
        next_retry_at: untilIso,
        error_message: `circuit-breaker parked after ${count} consecutive failures: ${(errorMessage || '').slice(0, 200)}`,
      })
      .eq('workspace_id', workspaceId)
      .is('lease_token', null)
      .eq('outcome_unknown', false)
      .not('next_retry_at', 'is', null)
      .lte('next_retry_at', new Date(now).toISOString())
    getMetricsStore().lastError = `circuit-breaker parked workspace ${workspaceId.slice(0, 8)}… for ${Math.round(cbCooldownMs() / 60000)}min`
  } catch {
    // الركن best-effort — الفشل هنا لا يوقف المحاولات العادية.
  }
}

function isCircuitBreakerFailure(errorMessage?: string): boolean {
  if (!errorMessage) return false
  // The breaker protects an unavailable ERP/network. Deterministic business
  // errors (validation, missing parent dependency, duplicate combination, etc.)
  // must retry/freeze only their own queue row; otherwise ten bad product
  // events can park stock/orders for the whole workspace.
  return /unknown xml-rpc tag|invalid xml-rpc|non-whitespace before first tag|unexpected token\s*</i.test(errorMessage)
    || /socket hang up|econnreset|epipe|etimedout|econnrefused|enotfound/i.test(errorMessage)
    || /\b(?:502|503|504)\b|bad gateway|service unavailable|gateway timeout/i.test(errorMessage)
    || /erp request timed out|network error|fetch failed/i.test(errorMessage)
}

/**
 * Business decisions that cannot improve through another identical webhook
 * must stay visible for manual review, not burn queue leases and retries.
 * These rows freeze immediately; independent later events still run.
 */
export function isTerminalReturnReview(errorMessage?: string): boolean {
  return /^(?:return_grouped_components_require_review|return_damaged_requires_financial_review|return_receipt_quantity_invalid|return_receipt_quantity_exceeds_original|return_request_unreadable|return_fallback_order_line_ambiguous|return_fallback_unit_price_unavailable|return_fallback_product_not_found|return_configured_product_not_found|return_configured_customer_not_found|return_order_match_missing_but_linked|return_order_match_conflicts_with_durable_link|return_mode_changed_existing_financial_effect_requires_review|return_stock_without_credit_note_requires_review|return_grouped_mixed_parent_component_requires_review|return_grouped_parent_quantity_invalid|return_grouped_stock_quantity_invalid|return_grouped_partial_inventory_effect_requires_review|order_cod_fee_product_not_configured_requires_review|order_cod_fee_missing_on_sale_order_requires_review|order_cod_fee_currency_rate_invalid_requires_review|order_cod_fee_amount_mismatch_requires_review|order_invoice_source_total_invalid_requires_review|order_invoice_conversion_rate_invalid_requires_review|order_invoice_total_unreadable_requires_review|order_invoice_currency_unreadable_requires_review|order_invoice_currency_mismatch_requires_review|order_invoice_total_mismatch_requires_review)(?::|$)/.test(String(errorMessage || ''))
}

async function incrementRetry(item: QueueItem, errorMessage?: string) {
  const metrics = getMetricsStore()
  if (/unknown.outcome|outcome.unknown|uncertain|in.progress|reconciliation required/i.test(errorMessage ?? '')) {
    await parkUnknownOutcome(item)
    return
  }
  const maxRetries = item.max_retries || SYNC_QUEUE_MAX_RETRIES
  const newCount = isTerminalReturnReview(errorMessage)
    ? maxRetries
    : (item.retry_count || 0) + 1

  if (isCircuitBreakerFailure(errorMessage)) {
    await noteWorkspaceFailure(item.workspace_id, errorMessage).catch(() => {})
  }

  if (newCount >= maxRetries) {
    // استُنفدت المحاولات — يُجمَّد الصف (next_retry_at = NULL) للمراجعة اليدوية.
    // نتحقق من نجاح التحديث: عمود NOT NULL كان يجعله يفشل بصمت فيبقى الصف
    // محبوساً في الطابور ويحرق فحصاً في كل دورة cron للأبد.
    // CAS على retry_count: الصف المحمل تعتمد العملية على نسخته عند الجلب —
    // حذف الصف (نجاح عنديما) أو تغيّر عدّاده (عاملان متداخلان) يجعل
    // التحديث يطابق 0 صف ولا يخترق سباقاً بأثر رجعي على عدد قديم.
    const { data: frozenRows, error: freezeErr } = await supabase
      .from('sync_queue')
      .update({
        retry_count: newCount,
        lease_token: null,
        lease_expires_at: null,
        last_error_at: new Date().toISOString(),
        next_retry_at: null,
        error_message: (errorMessage || '').slice(0, 500),
      })
      .eq('id', item.id)
      .eq('retry_count', item.retry_count || 0)
      .eq('lease_token', item.lease_token)
      .select('id')

    if (freezeErr) {
      // مخطط لم يُرحَّل بعد: نستخدم تاريخاً بعيداً بدَل null حتى لا يُلتقط
      // الصف مرة أخرى، مع تسجيل الفشل في المقاييس ليظهر التنبيه.
      metrics.lastError = `freeze failed (${freezeErr.code ?? ''}): run 20260922_sync_reliability.sql`
      await supabase
        .from('sync_queue')
        .update({
          retry_count: newCount,
        lease_token: null,
        lease_expires_at: null,
          last_error_at: new Date().toISOString(),
          next_retry_at: FROZEN_SENTINEL,
          error_message: (errorMessage || '').slice(0, 500),
        })
        .eq('id', item.id)
        .eq('retry_count', item.retry_count || 0)
      .eq('lease_token', item.lease_token)
    } else if (Array.isArray(frozenRows) && frozenRows.length === 0) {
      // سباق: الصف حُذف/تغيّر تحتنا — لا تكرار العد ولا العد مرتين.
      metrics.lastError = `freeze skipped (row changed): ${item.platform}:${item.event}`
    }
  } else {
    // Backoff أسّي مع jitter: يتعرّف على 429 و502/ECONNREFUSED فيمنح
    // السيرفر وقتاً للتعافي بدل إعادة الضرب فوراً. وضع الموسم
    // (SYNC_SEASON_MODE=true) يقصّر التسلسل ليناسب نافذة 30 دقيقة.
    const isRateLimited = typeof errorMessage === 'string' && (/429|rate\s*limit|too\s*many\s*requests/i).test(errorMessage)
    const isConnRefused = typeof errorMessage === 'string' && (/ECONNREFUSED|ETIMEDOUT|502|504/i).test(errorMessage)
    const isDependencyPending = typeof errorMessage === 'string' && (
      /not yet found in Odoo for status update/i.test(errorMessage)
      || /not yet found in Odoo for .*retry after product\.create/i.test(errorMessage)
    )
    const backoffMinutes = isDependencyPending ? 0.2 : computeBackoffMinutes(newCount, {
      rateLimited: isRateLimited,
      connRefused: isConnRefused,
      season: isSeasonMode(),
    })
    const jitterMs = isDependencyPending ? Math.floor(Math.random() * 3_000) : Math.floor(Math.random() * 60_000)
    // نفس CAS: الحذف/التغيّر السباقي يجعل المطابقة صفراً ولا تُكتب حالة
    // «لإعادة محاولة» على صف لم نمنحها منا محاولتها.
    await supabase
      .from('sync_queue')
      .update({
        retry_count: newCount,
        lease_token: null,
        lease_expires_at: null,
        last_error_at: new Date().toISOString(),
        next_retry_at: new Date(Date.now() + backoffMinutes * 60 * 1000 + jitterMs).toISOString(),
        error_message: (errorMessage || '').slice(0, 500),
      })
      .eq('id', item.id)
      .eq('retry_count', item.retry_count || 0)
      .eq('lease_token', item.lease_token)
  }
}

// ─── Cleanup ─────────────────────────────────────────────────────────────────

let lastCleanupAt = 0

/**
 * تنظيف دوري مخنوق (مرة/ساعة). يشمل أرشفة الصفوف المستنفدة، وحذف سجلات
 * `sync_logs` المنتهية، وتقليم `webhook_inbox` — بدون هذا الأخير ينمو جدول
 * الاستلام بلا حد لأن `pruneProcessedInbox` لا يُستدعى من أي مكان آخر.
 * ويشمل أيضاً حذف صفوف `queue_archives` التي انتهت مدتها (7 أيام).
 */
async function maybeCleanup() {
  if (Date.now() - lastCleanupAt < CLEANUP_THROTTLE_MS) return
  lastCleanupAt = Date.now()
  try {
    const cleaned = await cleanupSyncQueue(EXHAUSTED_RETENTION_DAYS)
    getMetricsStore().cleaned += cleaned
    await cleanupExpiredLogs().catch(() => {})
    const { pruneProcessedInbox } = await import('./webhook-inbox')
    await pruneProcessedInbox(INBOX_RETENTION_DAYS).catch(() => {})
    // صندوق التليجرام: الصفوف المُرسلة بعد 7 أيام والفاشلة بعد 30 يوماً.
    // بدون هذا ينمو الجدول بلا حد (رسالة لكل طلب).
    const { pruneTelegramOutbox } = await import('./telegram-outbox')
    await pruneTelegramOutbox().catch(() => {})
    // أرشيف الطابور اليدوي: الصف المؤرشف يُحذف نهائياً بعد 7 أيام
    // (`queue_archives.expires_at`). المدة المعلنة للتاجر يجب أن تُنفَّذ فعلاً،
    // وإلا صار "سيُحذف بعد 7 أيام" وعداً بلا مفعول.
    const { pruneExpiredQueueArchives } = await import('./queue-archive-prune')
    await pruneExpiredQueueArchives().catch(() => {})
  } catch {
    // غير قاتل.
  }
}

/**
 * أرشفة الصفوف المستنفدة (next_retry_at IS NULL) الأقدم من N يوماً.
 *
 * لا تُحذف هذه الصفوف أبداً — تُنقل إلى `sync_queue_dead` أولاً ثم تُحذف من
 * الطابور. النتيجة: لا شيء يضيع، الطابور يبقى صغيراً (حمل أقل على السيرفر)،
 * ويبقى هناك سجل كامل لما فشل ولماذا.
 */
export async function cleanupSyncQueue(olderThanDays = EXHAUSTED_RETENTION_DAYS): Promise<number> {
  return archiveExhaustedSyncJobs(olderThanDays)
}

/**
 * ينقل الصفوف المجمّدة إلى صندوق الموتى ثم يحذفها من الطابور.
 * الترحيل قبل الحذف هو ما يضمن عدم فقدان أي حدث.
 */
export async function archiveExhaustedSyncJobs(olderThanDays = EXHAUSTED_RETENTION_DAYS): Promise<number> {
  const cutoff = new Date(Date.now() - olderThanDays * 24 * 60 * 60 * 1000).toISOString()

  const { data, error } = await supabase
    .from('sync_queue')
    .select('id,workspace_id,store_id,event,platform,dedup_key,payload,error_message,retry_count,receipt_id,erp_connection_id,connection_generation,execution_key')
    .is('next_retry_at', null)
    .eq('outcome_unknown', false)
    .is('lease_token', null)
    .lt('last_error_at', cutoff)
    .limit(200)

  if (error || !data || data.length === 0) return 0

  const rows = data as Array<Record<string, unknown>>
  // `ignoreDuplicates` مهم: أرشفة متكرّرة (cronان متداخلان) تصطدم بالفهرس
  // الفريد على original_id. نتجاهل التعارض ولا نتوقّف — الصفوف موجودة أصلاً
  // في الأرشيف، فلا داعي لإفشال الدورة كاملة.
  const { error: archiveErr } = await supabase
    .from('sync_queue_dead')
    .upsert(
      rows.map((r) => ({
        original_id: r.id,
        receipt_id: r.receipt_id ?? null,
        erp_connection_id: r.erp_connection_id ?? null,
        connection_generation: r.connection_generation ?? null,
        execution_key: r.execution_key ?? null,
        workspace_id: r.workspace_id ?? null,
        store_id: r.store_id ?? null,
        event: r.event,
        platform: r.platform,
        dedup_key: r.dedup_key ?? null,
        payload: r.payload ?? {},
        error_message: r.error_message ?? null,
        retry_count: r.retry_count ?? null,
      })),
      { onConflict: 'original_id', ignoreDuplicates: true }
    )

  // فشل الأرشفة = لا حذف. الأولوية دائماً!)
  if (archiveErr) {
    getMetricsStore().lastError = `dead-letter archive failed: ${archiveErr.message?.slice(0, 150)}`
    return 0
  }

  const { data: deletedRows, error: deleteErr } = await supabase
    .from('sync_queue')
    .delete()
    .in('id', rows.map((r) => r.id as string))
    .is('next_retry_at', null)
    .eq('outcome_unknown', false)
    .is('lease_token', null)
    .lt('last_error_at', cutoff)
    .select('id')

  return deleteErr ? 0 : (deletedRows?.length ?? 0)
}
