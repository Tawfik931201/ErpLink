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
 *   - Idempotency ذرّي: `dedup_key` + فهرس فريد جزئي، فالتسليمات المكرّرة
 *     تنهار إلى صف واحد حتى مع تزامن عمليّن (وليس فحصاً فقط).
 *   - الدمج: نفس الكيان المعلّق (platform+event+store+entity) يُدمج في صف
 *     واحد (coalescing) — يمتص الدفعات ويلغي الضغط على Odoo.
 *   - حد توازٍ وحجم دفعة محسوبان من البيئة (5/20 افتراضياً، 10/50 حالياً).
 *   - Backoff أسّي مع حد أقصى + jitter، و max_retries لكل صف (افتراضي 5).
 *   - لا فقدان صامت: أي تنفيذ بلا نتيجة يُعامل كـ«فشل» ويُعاد جدولته.
 *   - لا حذف نهائي: الصفوف المستنفدة تُنقل إلى `sync_queue_dead` (صندوق
 *     الموتى) وتبقى قابلة للتدقيق وإعادة التشغيل.
 *   - تنظيف دوري مخنوق (مرة/ساعة) حتى لا يستهلك cron موارد على idle.
 */

import { createHash } from 'crypto'

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
 * (أثرها محدود: الكتابة في أودوو idempotent، والصف يُعاد جدولته).
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
}

/**
 * Enqueue a failed sync for retry (first retry in 5 minutes — 1 in season mode).
 */
export async function enqueueFailedSync(params: EnqueueParams & { errorMessage: string }) {
  if (!params.workspaceId) return
  const backoffMinutes = seasonBaseMinutes()

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
  /** فشل التخزين الدائم — يجب أن يرد المتصل بـ 5xx حتى تُعيد المنصة الإرسال. */
  error?: string
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
  const entityId = extractEntityId(params.payload)
  const deliveryId = extractDeliveryId(params.payload)
  // مفتاح التكرار يميّز **التسليم** لا **السجل**:
  //   1) delivery id صريح من المنصة ⇒ تكرار حقيقي لنفس الرسالة ⇒ مكرّر.
  //   2) لا delivery id (زد) ⇒ بصمة المحتوى. التحديثان المختلفان لنفس الطلب
  //      يحملان `updated_at` مختلفاً ⇒ بصمتان مختلفتان ⇒ كلاهما يُعالَج.
  //      أما إعادة إرسال نفس الرسالة فيعطي البصمة نفسها ⇒ تُدمجان.
  const dedupKey =
    params.dedupKey ??
    (deliveryId
      ? `delivery:${params.platform}:${params.storeId}:${params.event}:${deliveryId}`
      : `fingerprint:${params.platform}:${params.storeId}:${params.event}:${fingerprintPayload(params.payload)}`)

  // ── 0) الاستلام الدائم أولاً ───────────────────────────────────────────────
  // نكتب الحدث في `webhook_inbox` قبل أي شيء آخر. إن فشل ذلك نُرجع error
  // فيردّ المتصل بـ 5xx فتعيد المنصة الإرسال — لا تضيع.
  //
  // ⚠️ مسار أودوو **لا يُجمَّع**: Automated Action في أودوو لا يعيد الإرسال
  // بعد خطأ، فنكتب فيه فوراً بلا انتظار. بقية المنصات تعيد الإرسال عند
  // 5xx،⇒ التجميع الآمن فيها.
  const useBatch = params.platform !== 'odoo'
  const { recordWebhookReceipt, completeWebhookReceipt } = await import('@/lib/webhook-inbox')

  let receipt: { ok: boolean; duplicate?: boolean; id?: string; error?: string }
  if (useBatch) {
    const { insertReceipts } = await import('@/lib/ingress-batch')
    const [outcome] = await insertReceipts([
      {
        dedupKey,
        platform: params.platform,
        storeId: params.storeId,
        workspaceId: params.workspaceId,
        event: params.event,
        payload: params.payload,
      },
    ])
    receipt = outcome ?? { ok: false, error: 'inbox_insert_failed' }
  } else {
    receipt = await recordWebhookReceipt({
      platform: params.platform,
      storeId: params.storeId,
      workspaceId: params.workspaceId,
      event: params.event,
      dedupKey,
      payload: params.payload,
    })
  }
  if (!receipt.ok) {
    metrics.lastError = `inbox write failed: ${receipt.error}`
    return { error: receipt.error ?? 'inbox_write_failed' }
  }
  // نفس التسليم وصل من قبل — لا نكرّر العمل.
  if (receipt.duplicate) {
    metrics.duplicates += 1
    return { duplicate: true }
  }
  const settleReceipt = () => {
    if (dedupKey) void completeWebhookReceipt(dedupKey).catch(() => {})
  }

  // ── 1) منع تكرار ذرّي إضافي داخل الطابور نفسه ─────────────────────────────
  // ⚠️ الفحص مقيّد بصفوف pending (next_retry_at ليس NULL): الصف المجمّد
  // (next_retry_at = NULL — كل المحاولات استُنفدت) يجب ألا يمنع إدراج حدث
  // جديد، وإلا عاد الفيتو الذي أزاله الفهرس الجزئي في 20260928 — الصف
  // المجمّد يعني «انتهى حظّه» لا «قيد المعالجة».
  if (dedupKey) {
    const { data: dup } = await supabase
      .from('sync_queue')
      .select('id')
      .eq('dedup_key', dedupKey)
      .not('next_retry_at', 'is', null)
      .limit(1)
      .maybeSingle()
    if (dup) {
      metrics.duplicates += 1
      settleReceipt()
      return { id: (dup as { id: string }).id, duplicate: true }
    }
  }

  // ── 2) دمج الأحداث المتكرّرة لنفس الكيان داخل صف معلّق واحد ────────────────
  // هذا يمتص الدفعات: تحديث واحد يصل إلى Odoo بدل N تحديثات.
  if (entityId) {
    try {
      const { data: pending } = await supabase
        .from('sync_queue')
        .select('id,payload,created_at,updated_at')
        .eq('workspace_id', params.workspaceId)
        .eq('store_id', params.storeId)
        .eq('event', params.event)
        .eq('platform', params.platform)
        .not('next_retry_at', 'is', null)
        .order('created_at', { ascending: false })
        .limit(5)

      let coalesceTarget: string | null = null
      // في مسار أودوو: الخريطتان المختلفتان على نفس السجل لا تدمجان. كل خريطة
      // تكتب بمنطقها الخاص (حقول مختلفة) ⇒ دمجهما يُسقط كتابة إحداهما بصمت.
      const mappingScoped = params.platform === 'odoo'
      const newMappingId = mappingScoped ? extractFieldMappingId(params.payload) : ''
      for (const row of (pending ?? []) as Array<{
        id: string
        payload: unknown
        created_at: string
        updated_at: string | null
      }>) {
        const rowPayload = (row.payload ?? {}) as Record<string, unknown>
        if (extractEntityId(rowPayload) !== entityId) continue
        if (mappingScoped && extractFieldMappingId(rowPayload) !== newMappingId) continue
        const oldTs = extractPayloadUpdatedAt(rowPayload)
        const newTs = extractPayloadUpdatedAt(params.payload)
        const merged = newTs >= oldTs ? params.payload : rowPayload
        // ⚠️ CAS: التحديث أشترط `updated_at` كما رأيناه للتو. بلا هذا
        // الشرط يُستبدل payload صف محجوز من عامل آخر بنسخة أقَدم إذا
        // وصل مدمِجان متتاليان (الأحدث يوسّع السجل ثم الأقدم يحمله عبره)،
        // وحتى لو حُذف الصف بين القراءة والتحديث عاد التحديث ليُنشئ
        // تحديثاً ذرياً على صف غير موجود (عدد 0) وتردد `coalesced:true`
        // بلا شيء محفوظ فعلاً. CAS يفشل في الحالتين ⇒ نجري للإدراج.
        const { data: updatedRows } = await supabase
          .from('sync_queue')
          .update({ payload: merged, updated_at: new Date().toISOString() })
          .eq('id', row.id)
          .eq('updated_at', row.updated_at ?? '')
          .select('id')
        if (updatedRows && updatedRows.length > 0) {
          coalesceTarget = row.id
          break
        }
        // CAS فشل (سباق) — جرب الصف التالي، وإلا الإدراج.
      }
      if (coalesceTarget) {
        metrics.coalesced += 1
        settleReceipt()
        return { id: coalesceTarget, coalesced: true }
      }
    } catch {
      // فشل فحص الدمج غير قاتل — تابع إلى الإدراج.
    }
  }

  const baseRow: Record<string, unknown> = {
    workspace_id: params.workspaceId,
    store_id: params.storeId,
    event: params.event,
    platform: params.platform,
    payload: params.payload,
    retry_count: 0,
    max_retries: SYNC_QUEUE_MAX_RETRIES,
    // نافذة الدمج: تأخير المعالجة قليلاً حتى تتكدّس تحديثات نفس الكيان
    // فتُدمج في صف واحد (يكتب أودوو مرة واحدة بدل مرات). صفر خارج الموسم.
    next_retry_at: new Date(Date.now() + coalesceWindowMs()).toISOString(),
  }
  if (dedupKey) baseRow.dedup_key = dedupKey

  if (useBatch) {
    // ── إدراج مجمَّع ───────────────────────────────────────────────────────
    // الكتابة التي تحمل الحمولة كاملة هي أثمن ما في المسار. تجميعها يحوّل
    // 50 كتابة ⇒ واحدة.
    const { insertQueueRows } = await import('@/lib/ingress-batch')
    const [outcome] = await insertQueueRows([baseRow as never])
    if (!outcome || !outcome.ok) {
      if (outcome?.duplicate) {
        metrics.duplicates += 1
        settleReceipt()
        return { duplicate: true }
      }
      metrics.lastError = `queue insert failed: ${outcome?.error ?? 'queue_insert_failed'}`
      return { error: outcome?.error ?? 'queue_insert_failed' }
    }
    metrics.enqueued += 1
    settleReceipt()
    return { id: outcome.id }
  }

  const { data, error } = await supabase
    .from('sync_queue')
    .insert(baseRow)
    .select('id')
    .maybeSingle()

  if (error) {
    const code = (error as { code?: string }).code
    // فائز بالسباق: تسليم مطابق أُدرج بالتوازي → duplicate لا خطأ.
    if (code === '23505') {
      metrics.duplicates += 1
      settleReceipt()
      return { duplicate: true }
    }
    // عمود dedup_key غير موجود (ترحيل غير مطبَّق) — أعد الإدراج بدونه.
    if (code === '42703' && dedupKey) {
      const withoutKey: Record<string, unknown> = { ...baseRow }
      delete withoutKey.dedup_key
      const { data: retryData, error: retryErr } = await supabase
        .from('sync_queue')
        .insert(withoutKey)
        .select('id')
        .maybeSingle()
      if (retryErr) {
        // السجل ما زال في صندوق الاستقبال pending → cron سيعيد دفعه.
        return { error: retryErr.message?.slice(0, 200) ?? 'queue_insert_failed' }
      }
      metrics.enqueued += 1
      settleReceipt()
      return { id: (retryData as { id?: string } | null)?.id }
    }
    // فشل الإدراج: نُبقي السجل في صندوق الاستقبال ونُبلغ المتصل بخطأ
    // فيعيد الإرسال. هذا هو الفرق بين «فقدت الطلب» و«تأخرت الطلب».
    metrics.lastError = `queue insert failed: ${error.message?.slice(0, 150)}`
    return { error: error.message?.slice(0, 200) ?? 'queue_insert_failed' }
  }

  const myId = (data as { id?: string } | null)?.id
  metrics.enqueued += 1
  settleReceipt()
  return { id: myId }
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
}

/**
 * Process due queue items with fair-share scheduling and multi-tenant parallelism.
 * Returns the number of items successfully claimed and processed.
 */
export async function processSyncQueue(maxItems = SYNC_QUEUE_DEFAULT_BATCH): Promise<number> {
  const metrics = getMetricsStore()
  metrics.lastRunAt = new Date().toISOString()

  const nowIso = new Date().toISOString()
  let items: QueueItem[] = []
  try {
    const { data, error } = await supabase
      .from('sync_queue')
      .select('id,workspace_id,store_id,event,platform,payload,retry_count,max_retries,next_retry_at,created_at,updated_at')
      .not('next_retry_at', 'is', null)
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

  // ── Coalesce داخل الدفعة: احتفظ بالأحدث لكل كيان ──
  const groups = new Map<string, QueueItem[]>()
  for (const item of items) {
    const entityId = extractEntityId(item.payload ?? {})
    const deliveryId = extractDeliveryId(item.payload ?? {})
    const key = entityId
      ? buildDedupeKey({
          platform: item.platform,
          event: item.event,
          storeId: item.store_id,
          entityId,
          fieldMappingId: extractFieldMappingId(item.payload ?? {}),
        })
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

  // ── توزيع عادل (Fair-Share Round-Robin) بين مساحات العمل ──
  // يمنع أي متجر أو عميل واحد من احتكار الطابور وحرمان بقية العملاء
  const perWorkspace = new Map<string, QueueItem[]>()
  for (const item of toProcess) {
    const ws = item.workspace_id || 'unknown'
    const list = perWorkspace.get(ws)
    if (list) list.push(item)
    else perWorkspace.set(ws, [item])
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
  const CLAIM_LEASE_MS = 15 * 60 * 1000
  const CLAIM_CONCURRENCY = 10
  const claimed: QueueItem[] = []
  const claimOne = async (item: QueueItem) => {
    try {
      const leaseUntil = new Date(Date.now() + CLAIM_LEASE_MS).toISOString()
      const { data: locked } = await supabase
        .from('sync_queue')
        .update({ next_retry_at: leaseUntil })
        .eq('id', item.id)
        .not('next_retry_at', 'is', null)
        .lte('next_retry_at', new Date().toISOString())
        .select('id')
      return locked && locked.length > 0 ? item : null
    } catch {
      // فشل الحجز غير قاتل — تخطَّ هذا الصف في هذه الدفعة.
      return null
    }
  }
  for (let offset = 0; offset < batch.length; offset += CLAIM_CONCURRENCY) {
    const slice = batch.slice(offset, offset + CLAIM_CONCURRENCY)
    const results = await Promise.all(slice.map(claimOne))
    for (const result of results) {
      if (result) claimed.push(result)
    }
  }

  if (claimed.length === 0) {
    await maybeCleanup()
    return 0
  }

  // ── توازي متعدد العملاء مع كبح التنافس لكل أودو منفرد ──
  // يمنع إغراق أي قاعدة أودو واحدة بطلبات متزامنة تتسبب في أقفال (ir.sequence locks)
  await processClaimedFairly(claimed)

  await maybeCleanup()
  return claimed.length
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

  const CLAIM_LEASE_MS = 15 * 60 * 1000
  const claimed: QueueItem[] = []
  for (const item of items) {
    try {
      const leaseUntil = new Date(Date.now() + CLAIM_LEASE_MS).toISOString()
      let lockQuery = supabase
        .from('sync_queue')
        .update({ next_retry_at: leaseUntil })
        .eq('id', item.id)
        .not('next_retry_at', 'is', null)

      if (!forceImmediate) {
        lockQuery = lockQuery.lte('next_retry_at', new Date().toISOString())
      }

      const { data: locked } = await lockQuery.select('id')
      if (locked && locked.length > 0) claimed.push(item)
    } catch {
      // فشل الحجز غير قاتل — تخطَّ هذا الصف.
    }
  }
  if (claimed.length === 0) return empty

  await processClaimedFairly(claimed)

  const after = getMetricsStore()
  return {
    claimed: claimed.length,
    processed: claimed.length,
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
          return currentRunning < MAX_CONCURRENT_PER_WORKSPACE
        })

        if (itemIdx === -1) {
          // جميع العناصر المعلقة المتبقية في هذه الدفعة تخص مساحات عمل وصلت لحدها الأقصى المتزامن حالياً.
          // ننتظر حتى ينتهي أحد العمال النشطين ثم نتابع.
          break
        }

        const [item] = pending.splice(itemIdx, 1)
        const ws = item.workspace_id || 'unknown'
        runningPerWorkspace.set(ws, (runningPerWorkspace.get(ws) || 0) + 1)
        activeWorkers++

        processOneItem(item)
          .catch(() => {})
          .finally(() => {
            activeWorkers--
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

/**
 * تسوية صف ناجح بأمان — إغلاق سباق الدمج مع المعالجة:
 * أثناء الحجز (lease) قد يُدمج payload أحدث في الصف ذاته عبر coalescing.
 * الحذف غير المشروط كان يطمس ذلك payload الأحدث ويُرجع 2xx لمصدره — فقدان
 * صامت. الحل: نَقرأ الصف ونقارن `updated_at` بما رأيناه عند الجلب:
 *  - الصف حُذف (لا نتيجة) → لا شيء.
 *  - `updated_at` كما كان → قيمة الحدث نُفّذت بنجاح الآن، يُحذف (لا تحديث أحدث
 *    في الصف، فلا شيء يضيع).
 *  - `updated_at` تغيّر أثناء معالجتنا (coalescing بقيمة أحدث) → لا حذف:
 *    يُعاد الصف استحقاقاً فوراً ليعالَج بالقيمة الأحدث.
 */
async function settleSuccessfulItem(item: QueueItem): Promise<void> {
  const { data: row } = await supabase
    .from('sync_queue')
    .select('id,updated_at')
    .eq('id', item.id)
    .maybeSingle()
  if (!row) return
  const rowUpdatedAt = (row as { updated_at?: string | null }).updated_at ?? null
  if (rowUpdatedAt !== null && item.updated_at !== null && rowUpdatedAt !== item.updated_at) {
    // دُمج payload أحدث أثناء المعالجة — نُعيد برمجته فوراً بدل الحذف.
    await supabase
      .from('sync_queue')
      .update({ next_retry_at: new Date().toISOString() })
      .eq('id', item.id)
    return
  }
  await supabase.from('sync_queue').delete().eq('id', item.id)
}

async function processOneItem(item: QueueItem) {
  const metrics = getMetricsStore()
  metrics.processed += 1
  try {
    // isQueueExecution=true لمنع إعادة الإدراج المكررة من داخل المحرك.
    // ── مهلة لكل حدث ───────────────────────────────────────────────────────
    // بلاها: حدث فيه 15 نداء متتالي وأحدها بطيء = 150 ثانية يحتجز عاملاً
    // من أصل 10. عشرة أحداث سيئة = الطابور كله يقف.
    const work = (async () => {
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
        item.id
      )
    })()

    const result = (await withItemTimeout(work, SYNC_QUEUE_ITEM_TIMEOUT_MS)) as
      | { ok: boolean; message?: string }
      | { success: number; failed: number; skipped?: number; records: Array<{ status: string; message?: string }> }
      | void

    if (result && typeof result === 'object' && 'ok' in result) {
      if (result.ok) {
        await settleSuccessfulItem(item)
        metrics.succeeded += 1
        noteWorkspaceSuccess(item.workspace_id)
      } else {
        metrics.retried += 1
        await incrementRetry(item, result.message || 'Sync failed')
      }
    } else if (result && 'failed' in result && result.failed === 0) {
      await settleSuccessfulItem(item)
      metrics.succeeded += 1
    } else if (result && typeof result === 'object' && 'records' in result) {
      const errorRecord = result.records.find((r: { status: string }) => r.status === 'failed')
      metrics.retried += 1
      await incrementRetry(item, errorRecord?.message || 'Sync failed')
    } else {
      // ── لا نتيجة على الإطلاق (undefined / early return) ──
      // كان الكود السابق يعتبر هذا «نجاحاً» ويحذف الصف، فتفقد المهمة بصمت.
      // الآن يُعاد جدولتها لإعادة المحاولة؛ بعد استنفاد المحاولات تنتقل
      // إلى صندوق الموتى (sync_queue_dead) ولا تُحذف أبداً.
      metrics.retried += 1
      metrics.lastError = `no result for ${item.platform}:${item.event}`
      await incrementRetry(item, `no result returned for ${item.platform}:${item.event}`)
    }
  } catch (err: unknown) {
    metrics.retried += 1
    metrics.lastError = err instanceof Error ? err.message.slice(0, 300) : 'item failed'
    await incrementRetry(item, err instanceof Error ? err.message : 'Sync failed')
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
      .not('next_retry_at', 'is', null)
      .lte('next_retry_at', new Date(now).toISOString())
    getMetricsStore().lastError = `circuit-breaker parked workspace ${workspaceId.slice(0, 8)}… for ${Math.round(cbCooldownMs() / 60000)}min`
  } catch {
    // الركن best-effort — الفشل هنا لا يوقف المحاولات العادية.
  }
}

async function incrementRetry(item: QueueItem, errorMessage?: string) {
  const metrics = getMetricsStore()
  const newCount = (item.retry_count || 0) + 1
  const maxRetries = item.max_retries || SYNC_QUEUE_MAX_RETRIES

  // كل فشل يمر من هنا — نقطة الربط الوحيدة لقاطع الدائرة لكل عميل.
  await noteWorkspaceFailure(item.workspace_id, errorMessage).catch(() => {})

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
        last_error_at: new Date().toISOString(),
        next_retry_at: null,
        error_message: (errorMessage || '').slice(0, 500),
      })
      .eq('id', item.id)
      .eq('retry_count', item.retry_count || 0)
      .select('id')

    if (freezeErr) {
      // مخطط لم يُرحَّل بعد: نستخدم تاريخاً بعيداً بدَل null حتى لا يُلتقط
      // الصف مرة أخرى، مع تسجيل الفشل في المقاييس ليظهر التنبيه.
      metrics.lastError = `freeze failed (${freezeErr.code ?? ''}): run 20260922_sync_reliability.sql`
      await supabase
        .from('sync_queue')
        .update({
          retry_count: newCount,
          last_error_at: new Date().toISOString(),
          next_retry_at: FROZEN_SENTINEL,
          error_message: (errorMessage || '').slice(0, 500),
        })
        .eq('id', item.id)
        .eq('retry_count', item.retry_count || 0)
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
    const backoffMinutes = computeBackoffMinutes(newCount, {
      rateLimited: isRateLimited,
      connRefused: isConnRefused,
      season: isSeasonMode(),
    })
    const jitterMs = Math.floor(Math.random() * 60_000)
    // نفس CAS: الحذف/التغيّر السباقي يجعل المطابقة صفراً ولا تُكتب حالة
    // «لإعادة محاولة» على صف لم نمنحها منا محاولتها.
    await supabase
      .from('sync_queue')
      .update({
        retry_count: newCount,
        last_error_at: new Date().toISOString(),
        next_retry_at: new Date(Date.now() + backoffMinutes * 60 * 1000 + jitterMs).toISOString(),
        error_message: (errorMessage || '').slice(0, 500),
      })
      .eq('id', item.id)
      .eq('retry_count', item.retry_count || 0)
  }
}

// ─── Cleanup ─────────────────────────────────────────────────────────────────

let lastCleanupAt = 0

/**
 * تنظيف دوري مخنوق (مرة/ساعة). يشمل أرشفة الصفوف المستنفدة، وحذف سجلات
 * `sync_logs` المنتهية، وتقليم `webhook_inbox` — بدون هذا الأخير ينمو جدول
 * الاستلام بلا حد لأن `pruneProcessedInbox` لا يُستدعى من أي مكان آخر.
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
    .select('id,workspace_id,store_id,event,platform,dedup_key,payload,error_message,retry_count')
    .is('next_retry_at', null)
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

  const { error: deleteErr } = await supabase
    .from('sync_queue')
    .delete()
    .in('id', rows.map((r) => r.id as string))

  return deleteErr ? 0 : rows.length
}
