/**
 * ميزانية السحب من المتجر + ذاكرة تفاصيل الطلب.
 *
 * المشكلة:
 *   إشعار زد لطلب جديد **لا يحمل بنود الطلب** — فالطلب يُسحب من زد
 *   (`ZidAPI.orders.get`) قبل أن يُكتب في أودوو. وسقف زد **60 قراءة/دقيقة**.
 *   ⇒ في ذروة 1000 طلب/دقيقة نحتاج 1000 قراءة/دقيقة = 16 ضعف السقف،
 *   وطلباتنا تبدأ بالفشل.
 *
 *   والأسوأ: رد 429 من زد كان يُبتلع داخل المحرك ⇒ كُتب في أودوو طلب
 *   **بلا بنود** (بلا منتجات) ويبدو ناجحاً. (أُصلح في المرحلة 4: صار
 *   يفشل ويُعادجدولته.)
 *
 * الحل (هنا):
 *   1. **ميزانية سحب** لكل (منصة، مساحة عمل): لا نتجاوز سقف المنصة أبداً،
 *      فننتظر بدل أن نُصدم بـ 429. الانتظار محدود؛ وما ينفد يُفشل الحدث
 *      ⇒ يُعاد جدولته ⇒ لا ضياع ولا طلب ناقص.
 *   2. **ذاكرة تفاصيل الطلب**: الطلب نفسه يُسحب مرة واحدة ثم يُستخدم من
 *      الذاكرة لمدة قصيرة. ذروة 1000 إشعار لـ 200 طلب ⇒ 200 سحب لا 1000.
 *
 * Zid scopes this cache by both workspace and store, and reuses snapshots
 * only for signed order-creation retries. Updates (including payment and
 * shipping changes) and legacy deliveries read the API afresh; the current
 * API snapshot takes precedence over older webhook fields.
 */

/** السقوف الافتراضية لكل منصة — أقل من سقف المنصة بهامش أمان. */
const DEFAULT_PULL_BUDGET: Record<string, number> = {
  zid: 50,      // زد يسمح 60/دقيقة
  salla: 50,
  shopify: 60,  // Shopify يسمح ~2/ثانية
}

interface Budget {
  tokens: number
  lastRefill: number
  perMinute: number
}

const budgets = new Map<string, Budget>()

/** ميزانية مخصّصة (للاختبار أو لباقة أعلى). */
export function configurePullBudget(platform: string, perMinute: number): void {
  const key = `global:${platform}`
  budgets.set(key, { tokens: Math.max(1, perMinute), lastRefill: Date.now(), perMinute: Math.max(1, perMinute) })
}

function getBudget(platform: string, workspaceId: string): Budget {
  const key = `${platform}:${workspaceId}`
  let budget = budgets.get(key)
  if (!budget) {
    const perMinute = DEFAULT_PULL_BUDGET[platform] ?? 50
    budget = { tokens: perMinute, lastRefill: Date.now(), perMinute }
    budgets.set(key, budget)
  }
  // تجاوز الميزانية العامّة (باقة أعلى) يسري على كل المساحات.
  const global = budgets.get(`global:${platform}`)
  if (global && global.perMinute !== budget.perMinute) {
    budget.perMinute = global.perMinute
    budget.tokens = Math.min(budget.tokens, global.perMinute)
  }
  return budget
}

function refill(budget: Budget, now: number): void {
  const elapsed = Math.max(0, now - budget.lastRefill)
  if (elapsed === 0) return
  budget.tokens = Math.min(budget.perMinute, budget.tokens + (elapsed * budget.perMinute) / 60_000)
  budget.lastRefill = now
}

/**
 * انتظار رمز من ميزانية السحب.
 *
 * `maxWaitMs` يحدّ الانتظار حتى لا يُحجز خانة عامل بلا حدّ. يُرجع false
 * عندما لا تتوفّر الرموز في الوقت المتاح — وعندها **يجب أن يفشل الحدث**
 * (فيُعاد جدولته) لا أن يُكمل ببيانات ناقصة.
 */
export async function acquirePullToken(
  platform: string,
  workspaceId: string,
  maxWaitMs = 20_000
): Promise<boolean> {
  const deadline = Date.now() + Math.max(0, maxWaitMs)
  for (;;) {
    const budget = getBudget(platform, workspaceId)
    refill(budget, Date.now())
    if (budget.tokens >= 1) {
      budget.tokens -= 1
      return true
    }
    if (Date.now() >= deadline) return false
    // Wait for roughly one token's worth of time.
    const waitMs = Math.min(1_000, Math.max(50, (60_000 / budget.perMinute) - (Date.now() % (60_000 / budget.perMinute))))
    await new Promise((resolve) => setTimeout(resolve, waitMs))
  }
}

/** يتجاوز الميزانية للاختبارات فقط. */
export function resetPullBudgets(): void {
  budgets.clear()
}

// ─── ذاكرة تفاصيل الطلب ─────────────────────────────────────────────────────

interface CachedOrder {
  data: Record<string, unknown>
  fetchedAt: number
}

/** عمر الذاكرة. قصير عمداً: الغرض بنود الطلب لا الحالة. */
const ORDER_CACHE_TTL_MS = Number(process.env.ZID_ORDER_CACHE_TTL_MS) || 3 * 60_000

/** حد الذاكرة لكل مساحة — الطلبات المعلّقة فقط. */
const MAX_CACHED_ORDERS_PER_WORKSPACE = 200

const orderCache = new Map<string, Map<string, CachedOrder>>()

export function getCachedOrderDetails(
  platform: string,
  workspaceId: string,
  entityId: string
): Record<string, unknown> | null {
  const bucket = orderCache.get(`${platform}:${workspaceId}`)
  if (!bucket) return null
  const hit = bucket.get(entityId)
  if (!hit) return null
  if (Date.now() - hit.fetchedAt > ORDER_CACHE_TTL_MS) {
    bucket.delete(entityId)
    return null
  }
  return hit.data
}

export function setCachedOrderDetails(
  platform: string,
  workspaceId: string,
  entityId: string,
  data: Record<string, unknown>
): void {
  const key = `${platform}:${workspaceId}`
  let bucket = orderCache.get(key)
  if (!bucket) {
    bucket = new Map()
    orderCache.set(key, bucket)
  }
  if (bucket.size >= MAX_CACHED_ORDERS_PER_WORKSPACE) {
    const oldest = bucket.keys().next()
    if (!oldest.done) bucket.delete(oldest.value)
  }
  bucket.set(entityId, { data, fetchedAt: Date.now() })
}

export function clearOrderDetailCache(): void {
  orderCache.clear()
}
