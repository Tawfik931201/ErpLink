/**
 * بوابة الاستقبال — تحوّل "الحد" من **رفض** إلى **تأجيل**.
 *
 * المشكلة التي تحلها هذه الوحدة:
 *   كان كل مسار استقبال يطبّق `checkRateLimit(..., 120, 60_000)` ويردّ **429**
 *   قبل أي كتابة. والمنصات **لا تعيد الإرسال بعد 4xx** ⇒ الطلب كان يُفقد
 *   بصمت، بلا سجل وبلا عدّاد — فلم يكن أحد يعرف أن الخادم كان يرفض عملاءه.
 *
 * القاعدة الجديدة (قاعدة ذهبية):
 *   **لا يُرفض أي طلب موثّق.** ما فوق حصة المساحة يُحفظ ويُعالَج كغيره، مع
 *   قياس ظاهر. صمام الأمان الوحيد هو سقف عام عالٍ جداً يعيد **503**
 *   (قابل لإعادة الإرسال) لا 429 (فقد).
 *
 * ما الذي يبقى محمياً الآن؟
 *   - حماية العملية (DoS) من مجهولين: سقف 120/دقيقة لكل IP لمن لا يحمل
 *     أي اعتماد — وهو ما كان المطبَّق أصلاً، بلا تغيير.
 *   - حماية أودوو العميل ومنصة زد: **حصة عادلة لكل مساحة عمل** عند جلب
 *     الصفوف — انظر `src/lib/sync-queue.ts` (الجلب العادل).
 *
 * السقف الديناميكي:
 *   يبدأ عند `INGRESS_BASE_CEILING` (120/دقيقة) لكل مساحة عمل، ويرتفع تلقائياً
 *   حتى `INGRESS_MAX_CEILING` (2000/دقيقة) كلما فرغ الطابور، وينخفض تلقائياً
 *   عند امتلائه. الغرض: **ألا يبقى الرقم 2000 شغّالاً دائماً فيثقل السيرفر**،
 *   وألا يبقى 120 فيُرفض عملاء الموسم.
 */

import { checkRateLimit } from './rate-limit'

function envInt(name: string, fallback: number): number {
  const raw = Number(process.env[name])
  return Number.isFinite(raw) && raw > 0 ? Math.trunc(raw) : fallback
}

/** السقف الأساسي لكل مساحة عمل في الهدوء — طلبات/دقيقة. */
export const INGRESS_BASE_CEILING = envInt('INGRESS_BASE_CEILING', 120)

/** أقصى سقف تلقائي لكل مساحة عمل — طلبات/دقيقة (يُرفع إليه في الذروة). */
export const INGRESS_MAX_CEILING = envInt('INGRESS_MAX_CEILING', 2000)

/** عمق الطابور الذي يُعتبر عنده النظام "مشغولاً" (السقف = الأساس). */
export const INGRESS_TARGET_PENDING = envInt('INGRESS_TARGET_PENDING', 2000)

/**
 * صمام الأمان العام — طلبات/دقيقة للنظام كله. عند استنزافه يُردّ **503**
 * (المنصة تعيد الإرسال ⇒ لا ضياع) بدل 429 (فقد نهائي).
 * عملياً لا يُبلغ: 20 ألف طلب/دقيقة = 333/ثانية، أي أكثر من أي متجر حقيقي.
 */
export const INGRESS_GLOBAL_CAP_PER_MIN = envInt('INGRESS_GLOBAL_CAP_PER_MIN', 20000)

/** المسار الذي تعالجه الوحدة: سريع (ضمن الحصة) أو تجاوز (فوق الحصة). */
export type IngressLane = 'fast' | 'overflow'

export interface IngressDecision {
  /** `false` فقط لصمام الأمان العام. */
  admitted: boolean
  lane: IngressLane
  /** السقف المطبَّق على المساحة لحظة القرار. */
  ceiling: number
  reason?: 'global_cap_exhausted'
}

interface Bucket {
  tokens: number
  lastRefill: number
}

interface WorkspaceMeter {
  /**
   * 60 خانة (ثانية واحدة لكل خانة) = عدّاد نافذة متحركة دقيقة واحدة.
   * O(1) لكل حدث — العدّاد بأسلوب مصفوفة كان O(n²) ويبطئ عندousands
   * الأحداث في الدقيقة.
   */
  slots: number[]
  slotIndex: number
  lastSecond: number
  admitted: number
  overflow: number
  lastLane: IngressLane
}

const buckets = new Map<string, Bucket>()
const meters = new Map<string, WorkspaceMeter>()

/**
 * الساحات النشطة (مساحات عمل استقبلت أحداثاً). تُستخدم من الجلب العادل في
 * `sync-queue.ts` لاكتشاف المساحات التي لم تظهر في نافذة الجلب — لأن نافذة
 * الجلب الواحدة يملؤها متجر واحد مزدحم في starve الباقين.
 */
const activeWorkspaces = new Set<string>()
const MAX_TRACKED_WORKSPACES = 500

let globalBucket: Bucket = { tokens: INGRESS_GLOBAL_CAP_PER_MIN, lastRefill: Date.now() }

/** سقف الأمان العام القابل للضبط — يُقرأ من البيئة، وقابل للاختبار. */
let globalCapPerMin = INGRESS_GLOBAL_CAP_PER_MIN

const counters = {
  admitted: 0,
  overflow: 0,
  rejectedGlobal: 0,
  rejectedUnauthenticated: 0,
}

let pendingDepth = 0
let pendingDepthAt = 0

/**
 * ينشر عمق الطابور الحالي — يستدعيه عدّاد الطابور بعد كل دورة.
 * بدونه يبقى السقف على قيمته الأساسية (120) وهو الوضع الآمن.
 */
export function setIngressPendingDepth(depth: number): void {
  pendingDepth = Math.max(0, Math.trunc(depth) || 0)
  pendingDepthAt = Date.now()
}

/** هل معلومة عمق الطابور قديمة؟ (مضىت دقيقتان ⇒ نتجاهلها ونبقى محافظين) */
function healthIsStale(): boolean {
  return pendingDepthAt === 0 || Date.now() - pendingDepthAt > 120_000
}

/**
 * السقف المتغيّر لمساحة العمل حسب فراغ النظام — **خالصة وقابلة للاختبار**.
 *
 *   طابور فارسع  ⇒ 2000/دقيقة (الموسم يمتصه بسرعة)
 *   طابور نصفه   ⇒ ~1100/دقيقة
 *   طابور ممتلئ  ⇒ 120/دقيقة (الوضع العادي)
 *
 * معلومة العمق قديمة ⇒ نعتبرها 0 (أي أعلى سقف) لأن الخطر الحقيقي هو امتلاء
 * الطابور، لا انقطاع نشره.
 */
export function adaptiveCeiling(
  depth: number,
  base: number = INGRESS_BASE_CEILING,
  max: number = INGRESS_MAX_CEILING,
  target: number = INGRESS_TARGET_PENDING
): number {
  const b = Math.max(1, base)
  const m = Math.max(b, max)
  const t = Math.max(1, target)
  const ratio = Math.min(1, Math.max(0, depth) / t)
  const headroom = 1 - ratio
  return Math.round(b + (m - b) * headroom)
}

/** السقف المطبَّق الآن (يأخذ في الحسبان عمق الطابور المنشور). */
export function currentCeiling(): number {
  if (healthIsStale()) return INGRESS_MAX_CEILING
  return adaptiveCeiling(pendingDepth)
}

function refill(bucket: Bucket, ceilingPerMin: number, now: number): void {
  const elapsed = Math.max(0, now - bucket.lastRefill)
  if (elapsed === 0) return
  bucket.tokens = Math.min(ceilingPerMin, bucket.tokens + (elapsed * ceilingPerMin) / 60_000)
  bucket.lastRefill = now
}

function getWorkspaceBucket(workspaceId: string, ceiling: number, now: number): Bucket {
  let bucket = buckets.get(workspaceId)
  if (!bucket) {
    bucket = { tokens: ceiling, lastRefill: now }
    buckets.set(workspaceId, bucket)
  }
  refill(bucket, ceiling, now)
  return bucket
}

function getMeter(workspaceId: string): WorkspaceMeter {
  let meter = meters.get(workspaceId)
  if (!meter) {
    meter = {
      slots: new Array(60).fill(0),
      slotIndex: Math.floor(Date.now() / 1000) % 60,
      lastSecond: Math.floor(Date.now() / 1000),
      admitted: 0,
      overflow: 0,
      lastLane: 'fast',
    }
    meters.set(workspaceId, meter)
  }
  return meter
}

/** يقدّم العدّاد إلى الثانية الحالية ويمسح الخانات المنقضية. */
function tickMeter(meter: WorkspaceMeter, now: number): void {
  const second = Math.floor(now / 1000)
  const elapsed = second - meter.lastSecond
  if (elapsed <= 0) return
  if (elapsed >= 60) {
    meter.slots.fill(0)
    meter.slotIndex = second % 60
  } else {
    for (let i = 0; i < elapsed; i++) {
      meter.slotIndex = (meter.slotIndex + 1) % 60
      meter.slots[meter.slotIndex] = 0
    }
  }
  meter.lastSecond = second
}

function meterRate(meter: WorkspaceMeter): number {
  let total = 0
  for (const value of meter.slots) total += value
  return total
}

/**
 * تسجيل رفض على مستوى IP (طلب بلا اعتماد). مرئي دائماً — الرفض الصامت
 * كان العيب الأكبر في التصميم السابق — لكن بكثافة معقولة: أول ثلاثة ثم
 * كل خمسين، حتى لا يغرق السجل عند هجمة.
 */
export function noteIngressReject(scope: string, reason: string): void {
  counters.rejectedUnauthenticated += 1
  const count = counters.rejectedUnauthenticated
  if (count <= 3 || count % 50 === 0) {
    console.warn(
      `[Ingress] rejected (${reason}) scope=${scope} — anonymous-IP bucket exhausted. Certified deliveries are never rejected. Total rejections: ${count}`
    )
  }
}

/**
 * بوابة مساحة العمل — **نقطة Admission الوحيدة** في المسار كله.
 *
 * تُستدعى من `enqueueWebhookEvent` (المسار الوحيد الذي تمرّ به كل المنصات
 * الخمس) ⇒ لا يمكن أن يتسلّل طلب موثّق من دون مرور بالبوابة.
 *
 * القرار:
 *   - صمام الأمان العام مستنفد ⇒ `admitted: false` ⇒ المسار يردّ 503.
 *   - داخل الحصة ⇒ `lane: 'fast'`.
 *   - فوق الحصة ⇒ `lane: 'overflow'` — **يُقبل ويُحفظ ويُعالَج**؛ الفرق
 *     الوحيد أنه يُقاس ويظهر في لوحة الأدمن.
 */
export function admitWorkspaceEvent(workspaceId: string): IngressDecision {
  const now = Date.now()
  const ceiling = currentCeiling()

  refill(globalBucket, globalCapPerMin, now)
  if (globalBucket.tokens < 1) {
    counters.rejectedGlobal += 1
    console.error(
      `[Ingress] global cap exhausted (${INGRESS_GLOBAL_CAP_PER_MIN}/min) — replying 503 so the platform retries. No event is lost.`
    )
    return { admitted: false, lane: 'overflow', ceiling, reason: 'global_cap_exhausted' }
  }
  globalBucket.tokens -= 1

  const bucket = getWorkspaceBucket(workspaceId, ceiling, now)
  const meter = getMeter(workspaceId)
  tickMeter(meter, now)
  meter.slots[meter.slotIndex] = (meter.slots[meter.slotIndex] ?? 0) + 1

  if (!activeWorkspaces.has(workspaceId)) {
    activeWorkspaces.add(workspaceId)
    // Set يحفظ ترتيب الإدراج ⇒ نحذف الأقدم عند تجاوز السقف.
    while (activeWorkspaces.size > MAX_TRACKED_WORKSPACES) {
      const oldest = activeWorkspaces.values().next()
      if (oldest.done) break
      activeWorkspaces.delete(oldest.value)
    }
  }

  if (bucket.tokens >= 1) {
    bucket.tokens -= 1
    meter.admitted += 1
    meter.lastLane = 'fast'
    counters.admitted += 1
    return { admitted: true, lane: 'fast', ceiling }
  }

  meter.overflow += 1
  meter.lastLane = 'overflow'
  counters.overflow += 1
  return { admitted: true, lane: 'overflow', ceiling }
}

export interface IngressWorkspaceSnapshot {
  workspaceId: string
  /** طلبات/دقيقة تقريبية خلال آخر دقيقة. */
  ratePerMin: number
  admitted: number
  overflow: number
  lastLane: IngressLane
}

export interface IngressMetrics {
  admitted: number
  overflow: number
  rejectedGlobal: number
  rejectedUnauthenticated: number
  ceiling: number
  pendingDepth: number
  workspaces: IngressWorkspaceSnapshot[]
}

/** لقطة للوحة الأدمن — الأرقام التي تجعل الرفض والتأخير مرئيين. */
export function getIngressMetrics(limit = 20): IngressMetrics {
  const workspaces: IngressWorkspaceSnapshot[] = []
  for (const [workspaceId, meter] of meters) {
    workspaces.push({
      workspaceId,
      ratePerMin: meterRate(meter),
      admitted: meter.admitted,
      overflow: meter.overflow,
      lastLane: meter.lastLane,
    })
  }
  workspaces.sort((a, b) => b.ratePerMin - a.ratePerMin)
  return {
    admitted: counters.admitted,
    overflow: counters.overflow,
    rejectedGlobal: counters.rejectedGlobal,
    rejectedUnauthenticated: counters.rejectedUnauthenticated,
    ceiling: currentCeiling(),
    pendingDepth,
    workspaces: workspaces.slice(0, limit),
  }
}

/** المساحات التي استقبلت أحداثاً — تغذّي الجلب العادل في الطابور. */
export function getActiveWorkspaceIds(): string[] {
  return [...activeWorkspaces]
}

/**
 * سقف الاستقبال لمن **لا يحمل أي اعتماد** — 120 طلب/دقيقة لكل IP.
 *
 * هذا هو السلوك القديم * intact*: حد الأدنى الذي يحمي العملية من سكربت
 * عشوائي. ما تغيّر أن الطلب **الموثّق** لم يعد يخضع له — الاعتماد نفسه
 * (توقيع HMAC أو سر مشتق) هو ما يحمي المتجر، لا عنوان IP.
 *
 * Apply before parsing only when no credential is supplied; if a credential
 * is supplied, verify it first and apply the limit to INVALID credentials.
 * Only a genuinely verified request bypasses this limit. A bare Authorization
 * or HMAC header must not serve as an unlimited-request bypass.
 */
export const UNAUTHENTICATED_IP_LIMIT_PER_MIN = 120

export function checkUnauthenticatedIngressLimit(opts: {
  scope: string
  /** Verified cryptographically or by constant-time secret comparison. A header's presence is NEVER proof. */
  credentialVerified: boolean
  /** Key from a trusted proxy IP or a shared unidentified bucket. */
  bucketKey: string
}): { allowed: boolean } {
  if (opts.credentialVerified) return { allowed: true }
  const rl = checkRateLimit(opts.bucketKey, UNAUTHENTICATED_IP_LIMIT_PER_MIN, 60_000)
  if (!rl.allowed) {
    noteIngressReject(opts.scope, 'ip_rate_limit')
    return { allowed: false }
  }
  return { allowed: true }
}

/**
 * تبديل سقف الأمان العام — **للاختبارات فقط** (نمط `resetRateLimits` نفسه).
 * بدونه لا يمكن اختبار صمام الإغلاق: إعادة التعبئة أثناء الاختبار تُخفي
 * استنزاف السقف.
 */
export function setIngressGlobalCapForTest(capPerMin: number): void {
  globalCapPerMin = Math.max(1, Math.trunc(capPerMin))
  globalBucket = { tokens: globalCapPerMin, lastRefill: Date.now() }
}

/** تصفير الحالات — للاختبارات فقط. */
export function resetIngressAdmission(): void {
  buckets.clear()
  meters.clear()
  activeWorkspaces.clear()
  counters.admitted = 0
  counters.overflow = 0
  counters.rejectedGlobal = 0
  counters.rejectedUnauthenticated = 0
  globalCapPerMin = INGRESS_GLOBAL_CAP_PER_MIN
  globalBucket = { tokens: globalCapPerMin, lastRefill: Date.now() }
  pendingDepth = 0
  pendingDepthAt = 0
}
