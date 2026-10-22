import { createHash } from 'crypto'

import { supabase } from '@/lib/supabase'

export type SyncStatus = 'success' | 'failed' | 'skipped' | 'processing'
export type SyncCategory = 'orders' | 'products' | 'categories' | 'customers' | 'stock'

export const DEFAULT_SYNC_CATEGORIES: SyncCategory[] = [
  'orders',
  'products',
  'categories',
  'customers',
  'stock',
]

export interface SyncRecordSummary {
  status: SyncStatus
  event: string
  mappingName?: string
  mappingId?: string
  model?: string
  odooRecordId?: number | string | null
  errorMessage?: string | null
  storeName?: string | null
  storeId?: string | null
  receivedAt?: string
  workspaceId?: string | null
  details?: {
    orderNumber?: string | number | null
    orderCode?: string | null
    customerName?: string | null
    customerPhone?: string | null
    totalAmount?: string | number | null
    currency?: string | null
    paymentMethod?: string | null
    shippingMethod?: string | null
    itemsCount?: number | null
    productName?: string | null
    productSku?: string | null
    categoryName?: string | null
    stockQuantity?: number | string | null
    locationName?: string | null
    stockOperation?: string | null
  }
}

// ─── Event category detector ──────────────────────────────────────────────────

export function getEventCategory(event: string): SyncCategory {
  const ev = (event || '').toLowerCase()
  if (ev.includes('order') || ev.includes('sale') || ev.includes('cart')) return 'orders'
  if (ev.includes('category')) return 'categories'
  if (ev.includes('customer') || ev.includes('contact') || ev.includes('partner')) return 'customers'
  if (ev.includes('stock') || ev.includes('inventory') || ev.includes('quant')) return 'stock'
  if (ev.includes('product') || ev.includes('item')) return 'products'
  return 'orders'
}

export function parseEventsFilter(val: unknown): SyncCategory[] {
  if (!val) return DEFAULT_SYNC_CATEGORIES
  if (Array.isArray(val)) {
    const valid = val.filter((x: unknown): x is SyncCategory =>
      typeof x === 'string' && DEFAULT_SYNC_CATEGORIES.includes(x as SyncCategory)
    )
    if (valid.length > 0) return valid
    return DEFAULT_SYNC_CATEGORIES
  }
  if (typeof val === 'object' && val !== null && 'events' in val) {
    const events = (val as { events: unknown }).events
    if (Array.isArray(events)) {
      return events.filter((x: unknown): x is SyncCategory =>
        typeof x === 'string' && DEFAULT_SYNC_CATEGORIES.includes(x as SyncCategory)
      )
    }
  }
  return DEFAULT_SYNC_CATEGORIES
}

export function parseMappingsFilter(val: unknown): string[] {
  if (!val) return []
  if (Array.isArray(val)) {
    return val.filter((x: unknown) => typeof x === 'string' && !DEFAULT_SYNC_CATEGORIES.includes(x as any)).map(String)
  }
  if (typeof val === 'object' && val !== null && 'mappings' in val) {
    const mappings = (val as { mappings: unknown }).mappings
    if (Array.isArray(mappings)) {
      return mappings.map(String)
    }
  }
  return []
}

function formatDate(date: Date | string | undefined, lang: 'ar' | 'en'): string {
  const d = date ? new Date(date) : new Date()
  if (isNaN(d.getTime())) return ''
  try {
    return d.toLocaleString(lang === 'ar' ? 'ar-SA' : 'en-US', {
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
    })
  } catch {
    return d.toISOString()
  }
}

function clip(text: string, max: number): string {
  if (!text) return ''
  if (text.length <= max) return text
  return text.slice(0, max - 1) + '…'
}

export function buildSyncMessage(
  record: SyncRecordSummary,
  lang: 'ar' | 'en'
): string {
  const isAr = lang === 'ar'
  const category = getEventCategory(record.event)
  const d = record.details || {}
  const date = formatDate(record.receivedAt, lang)

  const lines: string[] = []

  // Status Title Header
  if (record.status === 'success') {
    if (category === 'orders') {
      lines.push(isAr ? '📦 ✅ تم تسجيل طلب جديد في أودوو بنجاح' : '📦 ✅ New Order Synced to Odoo Successfully')
    } else if (category === 'products') {
      lines.push(isAr ? '🏷️ ✅ تم مزامنة المنتج مع أودوو بنجاح' : '🏷️ ✅ Product Synced to Odoo Successfully')
    } else if (category === 'categories') {
      lines.push(isAr ? '🗂️ ✅ تم مزامنة التصنيف مع أودوو بنجاح' : '🗂️ ✅ Category Synced to Odoo Successfully')
    } else if (category === 'customers') {
      lines.push(isAr ? '👥 ✅ تم مزامنة العميل مع أودوو بنجاح' : '👥 ✅ Customer Synced to Odoo Successfully')
    } else if (category === 'stock') {
      lines.push(isAr ? '🔄 ✅ تم تحديث المخزون في المتجر بنجاح' : '🔄 ✅ Stock Updated in Store Successfully')
    } else {
      lines.push(isAr ? '✅ تمت المزامنة بنجاح' : '✅ Sync Completed Successfully')
    }
  } else if (record.status === 'failed') {
    if (category === 'orders') {
      lines.push(isAr ? '📦 ❌ فشل تسجيل الطلب في أودوو' : '📦 ❌ Failed to Sync Order to Odoo')
    } else if (category === 'products') {
      lines.push(isAr ? '🏷️ ❌ فشلت مزامنة المنتج مع أودوو' : '🏷️ ❌ Failed to Sync Product to Odoo')
    } else if (category === 'categories') {
      lines.push(isAr ? '🗂️ ❌ فشلت مزامنة التصنيف مع أودوو' : '🗂️ ❌ Failed to Sync Category to Odoo')
    } else if (category === 'customers') {
      lines.push(isAr ? '👥 ❌ فشلت مزامنة العميل مع أودوو' : '👥 ❌ Failed to Sync Customer to Odoo')
    } else if (category === 'stock') {
      lines.push(isAr ? '🔄 ❌ فشل تحديث المخزون في المتجر' : '🔄 ❌ Failed to Update Stock in Store')
    } else {
      lines.push(isAr ? '❌ فشلت المزامنة' : '❌ Sync Failed')
    }
  } else if (record.status === 'skipped') {
    lines.push(isAr ? '⏭️ تم تخطي المزامنة' : '⏭️ Sync Skipped')
  } else {
    lines.push(isAr ? '⏳ جارٍ المعالجة' : '⏳ In Progress')
  }

  lines.push('─────────────────')

  // Detailed fields based on category
  if (category === 'orders') {
    if (d.orderNumber) {
      lines.push(isAr ? `🔢 رقم الطلب: #${d.orderNumber}` : `🔢 Order #: #${d.orderNumber}`)
    }
    if (d.customerName) {
      lines.push(isAr ? `👤 العميل: ${d.customerName}` : `👤 Customer: ${d.customerName}`)
    }
    if (d.customerPhone) {
      lines.push(isAr ? `📞 الهاتف: ${d.customerPhone}` : `📞 Phone: ${d.customerPhone}`)
    }
    if (d.totalAmount) {
      lines.push(isAr ? `💰 الإجمالي: ${d.totalAmount} ${d.currency || 'SAR'}` : `💰 Total: ${d.totalAmount} ${d.currency || 'SAR'}`)
    }
    if (d.paymentMethod) {
      lines.push(isAr ? `💳 طريقة الدفع: ${d.paymentMethod}` : `💳 Payment: ${d.paymentMethod}`)
    }
    if (d.shippingMethod) {
      lines.push(isAr ? `🚚 الشحن: ${d.shippingMethod}` : `🚚 Shipping: ${d.shippingMethod}`)
    }
    if (d.itemsCount) {
      lines.push(isAr ? `📦 عدد المنتجات: ${d.itemsCount}` : `📦 Items: ${d.itemsCount}`)
    }
  } else if (category === 'products') {
    if (d.productName) {
      lines.push(isAr ? `🏷️ المنتج: ${d.productName}` : `🏷️ Product: ${d.productName}`)
    }
    if (d.productSku) {
      lines.push(isAr ? `🔖 رمز (SKU): ${d.productSku}` : `🔖 SKU: ${d.productSku}`)
    }
  } else if (category === 'categories') {
    if (d.categoryName) {
      lines.push(isAr ? `🗂️ التصنيف: ${d.categoryName}` : `🗂️ Category: ${d.categoryName}`)
    }
  } else if (category === 'customers') {
    if (d.customerName) {
      lines.push(isAr ? `👤 العميل: ${d.customerName}` : `👤 Customer: ${d.customerName}`)
    }
    if (d.customerPhone) {
      lines.push(isAr ? `📞 الهاتف: ${d.customerPhone}` : `📞 Phone: ${d.customerPhone}`)
    }
  } else if (category === 'stock') {
    if (d.productSku || d.productName) {
      lines.push(isAr ? `🏷️ المنتج: ${d.productName || d.productSku}` : `🏷️ Product: ${d.productName || d.productSku}`)
    }
    if (d.stockQuantity !== undefined && d.stockQuantity !== null) {
      lines.push(isAr ? `📦 الكمية المحدثة: ${d.stockQuantity}` : `📦 Quantity: ${d.stockQuantity}`)
    }
  }

  // Odoo registration status
  if (record.odooRecordId !== undefined && record.odooRecordId !== null) {
    const modelText = record.model ? ` (${record.model})` : ''
    lines.push(isAr ? `⚙️ تم التسجيل في أودوو: #${record.odooRecordId}${modelText}` : `⚙️ Odoo Record: #${record.odooRecordId}${modelText}`)
  } else if (record.status === 'success' && category === 'stock') {
    lines.push(isAr ? `⚙️ تم التحديث في المتجر من أودوو` : `⚙️ Synced to Store from Odoo`)
  } else if (record.status === 'failed') {
    lines.push(isAr ? `⚙️ لم يتم التسجيل في أودوو` : `⚙️ Not registered in Odoo`)
  }

  if (record.storeName) {
    lines.push(isAr ? `🏪 المتجر: ${clip(record.storeName, 50)}` : `🏪 Store: ${clip(record.storeName, 50)}`)
  }

  if (record.status === 'failed' && record.errorMessage) {
    lines.push(isAr ? `⚠️ السبب: ${clip(record.errorMessage, 200)}` : `⚠️ Reason: ${clip(record.errorMessage, 200)}`)
  }

  if (date) {
    lines.push(isAr ? `🕒 الوقت: ${date}` : `🕒 Time: ${date}`)
  }

  return lines.join('\n')
}

// ─── Cache layer ──────────────────────────────────────────────────────────────

interface ChatRow {
  id: string
  bot_id: string
  chat_id: string
  chat_label: string | null
  language: string
  notify_mode: string
  enabled: boolean
  workspace_filter: unknown
  mapping_filter: unknown
  /** اشتراك العميل في تنبيه "وصول طلب جديد" (P1-1) — يُخزَّن داخل mapping_filter JSON. */
  notify_on_arrival: boolean
  // from joined bot
  bot_token: string
}

interface CachedEntry {
  value: ChatRow[]
  cachedAt: number
}

const subscriptionCache = new Map<string, CachedEntry>()
const CACHE_TTL_MS = 30_000

function readCache(workspaceId: string): ChatRow[] | undefined {
  const entry = subscriptionCache.get(workspaceId)
  if (!entry) return undefined
  if (Date.now() - entry.cachedAt > CACHE_TTL_MS) {
    subscriptionCache.delete(workspaceId)
    return undefined
  }
  return entry.value
}

function writeCache(workspaceId: string, value: ChatRow[]) {
  subscriptionCache.set(workspaceId, { value, cachedAt: Date.now() })
}

export function clearTelegramCache(workspaceId?: string) {
  if (workspaceId) {
    subscriptionCache.delete(workspaceId)
  } else {
    subscriptionCache.clear()
  }
}

// ─── DB lookup ────────────────────────────────────────────────────────────────

async function getWorkspaceChats(workspaceId: string): Promise<ChatRow[]> {
  const cached = readCache(workspaceId)
  if (cached !== undefined) return cached

  const { data, error } = await supabase
    .from('telegram_bot_chats')
    .select(`
      id,
      bot_id,
      chat_id,
      chat_label,
      language,
      notify_mode,
      enabled,
      workspace_filter,
      mapping_filter,
      bot:telegram_bots!inner (
        bot_token
      )
    `)
    .eq('workspace_id', workspaceId)
    .eq('enabled', true)

  if (error) {
    console.warn('[TelegramNotifier] Failed to load chats:', error.message)
    return []
  }

  const rows: ChatRow[] = (data || []).map((r: any) => ({
    id: r.id,
    bot_id: r.bot_id,
    chat_id: r.chat_id,
    chat_label: r.chat_label ?? null,
    language: r.language ?? 'ar',
    notify_mode: r.notify_mode ?? 'both',
    enabled: !!r.enabled,
    workspace_filter: r.workspace_filter ?? [],
    mapping_filter: r.mapping_filter ?? [],
    notify_on_arrival: parseArrivalFilter(r.mapping_filter),
    bot_token: r.bot?.bot_token ?? '',
  })).filter((r: ChatRow) => r.bot_token)

  writeCache(workspaceId, rows)
  return rows
}

function parseJsonFilter(val: unknown): string[] {
  if (!val) return []
  if (Array.isArray(val)) return val.map(String)
  if (typeof val === 'string') {
    try { return JSON.parse(val) } catch { return [] }
  }
  return []
}

// ─── Bot API Caller ───────────────────────────────────────────────────────────

export interface TelegramSendResult {
  ok: boolean
  statusCode?: number
  description?: string
  result?: unknown
}

export async function callTelegramApi(
  botToken: string,
  method: string,
  body: Record<string, unknown>
): Promise<TelegramSendResult> {
  const url = `https://api.telegram.org/bot${botToken}/${method}`
  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    })
    let json: Record<string, unknown> | undefined
    try {
      json = await res.json()
    } catch {
      // non-JSON response
    }
    return {
      ok: json?.ok === true,
      statusCode: res.status,
      description: (json?.description as string) ?? undefined,
      result: json?.result,
    }
  } catch (err: any) {
    return { ok: false, description: err?.message ?? 'fetch failed' }
  }
}

export async function sendTelegramWelcomeRaw(
  botTokenPlain: string,
  chatId: string,
  lang: 'ar' | 'en' = 'ar'
): Promise<TelegramSendResult> {
  const text = lang === 'en'
    ? [
        '🎉 Linked successfully',
        '',
        'This chat is now connected to ERP Link as a notification target.',
        "You'll receive sync notifications here according to your preferences.",
      ].join('\n')
    : [
        '🎉 تم الربط بنجاح',
        '',
        'هذه المحادثة مربوطة الآن بـ ERP Link كجهاز استقبال إشعارات.',
        'ستصلك هنا إشعارات المزامنة حسب تفضيلاتك.',
      ].join('\n')
  return callTelegramApi(botTokenPlain, 'sendMessage', {
    chat_id: chatId,
    text,
  })
}

// ─── Sync result dispatcher ──────────────────────────────────────────────────

export async function notifySyncResult(args: {
  workspaceId: string | null | undefined
  record: SyncRecordSummary
  /**
   * هوية الحدث — تضمن **رسالة واحدة لكل طلب**: النتيجة الثانية لنفس
   * الحدث (من إعداد افتراضي + كل خريطة مخصّصة) تُهمَل.
   */
  eventKey?: string | null
}): Promise<void> {
  const { workspaceId, record, eventKey } = args
  if (!workspaceId) return
  if (record.status === 'processing') return

  try {
    const chats = await getWorkspaceChats(workspaceId)
    if (chats.length === 0) return

    const priority: 0 | 1 | 2 = record.status === 'failed' ? 2 : 1

    for (const chat of chats) {
      // Notify mode filter
      if (record.status === 'success' && chat.notify_mode === 'failure') continue
      if (record.status === 'failed' && chat.notify_mode === 'success') continue
      if (record.status === 'skipped') continue

      // Event category filter (orders, products, categories, customers, stock)
      const category = getEventCategory(record.event)
      const allowedCategories = parseEventsFilter(chat.mapping_filter)
      if (!allowedCategories.includes(category)) {
        continue
      }

      // Workspace filter
      const wsFilter = parseJsonFilter(chat.workspace_filter)
      if (wsFilter.length > 0 && record.workspaceId && !wsFilter.includes(record.workspaceId)) continue

      // Mapping filter
      const mapFilter = parseMappingsFilter(chat.mapping_filter)
      if (mapFilter.length > 0 && record.mappingId && !mapFilter.includes(record.mappingId)) continue

      const text = buildSyncMessage(record, chat.language as 'ar' | 'en')

      // ── الكتابة في الصندوق، لا الإرسال المباشر ──────────────────────────
      // الكتابة سريعة وثابتة (لا نداء خارجي)، والمُرسِل يتكفّل بالباقي.
      // ⇒ 429 من تليجرام ⇒ إعادة محاولة بدل ضياع الرسالة، وتليجرام لا
      //   يعطّل عامل المزامنة.
      const { enqueueTelegramMessage } = await import('@/lib/telegram-outbox')
      await enqueueTelegramMessage({
        workspaceId,
        botId: chat.bot_id,
        chatId: chat.chat_id,
        chatLabel: chat.chat_label,
        language: chat.language === 'en' ? 'en' : 'ar',
        kind: 'result',
        priority,
        eventKey: eventKey ?? null,
        body: text,
      })
    }
  } catch (err: any) {
    console.warn('[TelegramNotifier] notifySyncResult error (swallowed):', err?.message ?? err)
  }
}

export function botTokenFingerprint(botToken: string): string {
  return createHash('sha256').update(botToken).digest('hex').slice(0, 16)
}

// ─── Arrival notifications (P1-1: "order received, sending to Odoo") ─────────
// الفكرة: التاجر يعتمد على أودوو لتجهيز الطلبات، والطلب قد يتأخر في الطابور.
// رسالة الوصول تجعل تليجرام بديلاً مؤقتاً ينتبه به التاجر فور وصول الطلب من
// المتجر، ثم تصله رسالة النتيجة (نجاح/فشل) عند اكتمال التسجيل في أودوو.
//
// قواعد صارمة:
// - نارٍ وانسى: المتصل لا ينتظر أبداً (void + catch) فلا تلمس زمن الاستلام.
// - للطلبات فقط: فئات المنتجات/العملاء الجماعية ستغرق المحادثة.
// - الإدراج الطازج فقط: يُستدعى عند صف جديد (id موجود) لا عند duplicate —
//   إعادة التسليم لا تعني طلباً جديداً.
// - فشل الإرسال لا يفشل الطلب أبداً (يُبتلع مع console فقط).

const PLATFORM_LABEL: Record<string, { ar: string; en: string }> = {
  zid: { ar: 'زد', en: 'Zid' },
  salla: { ar: 'سلة', en: 'Salla' },
  shopify: { ar: 'شوبيفاي', en: 'Shopify' },
}

/**
 * Pure: يقرأ راية الاشتراك من mapping_filter JSON (كائن اختياري).
 * الافتراضي false — لا شيء يتغير للمشتركين الحاليين.
 * مصدَّر خالصاً ليُختبَر بلا قاعدة بيانات.
 */
export function parseArrivalFilter(val: unknown): boolean {
  if (val && typeof val === 'object' && !Array.isArray(val) && 'notify_on_arrival' in val) {
    return (val as { notify_on_arrival?: unknown }).notify_on_arrival === true
  }
  return false
}

export interface ArrivalInfo {
  platform: string
  event: string
  entityId?: string | null
  storeId?: string | null
  receivedAt?: string
}

/**
 * Pure: يبني نص رسالة الوصول (ar/en). مصدَّر خالصاً ليُختبَر.
 */
export function buildArrivalMessage(info: ArrivalInfo, lang: 'ar' | 'en'): string {
  const isAr = lang === 'ar'
  const label = PLATFORM_LABEL[(info.platform || '').toLowerCase()] ?? {
    ar: info.platform,
    en: info.platform,
  }
  const lines: string[] = []
  lines.push(
    isAr
      ? `📥 طلب جديد من ${label.ar}`
      : `📥 New order from ${label.en}`
  )
  lines.push('─────────────────')
  if (info.entityId) {
    lines.push(isAr ? `🔢 رقم الطلب: #${info.entityId}` : `🔢 Order #: #${info.entityId}`)
  }
  if (info.storeId) {
    lines.push(isAr ? `🏪 المتجر: ${clip(String(info.storeId), 50)}` : `🏪 Store: ${clip(String(info.storeId), 50)}`)
  }
  lines.push(
    isAr
      ? '⏳ جاري الإرسال إلى أودوو… سيصلك تأكيد التسجيل فور اكتماله'
      : '⏳ Sending to Odoo… you will receive a confirmation once registered'
  )
  const date = formatDate(info.receivedAt, lang)
  if (date) {
    lines.push(isAr ? `🕒 وقت الوصول: ${date}` : `🕒 Received: ${date}`)
  }
  return lines.join('\n')
}

export async function notifyOrderArrival(args: {
  workspaceId: string | null | undefined
  platform: string
  event: string
  storeId?: string | null
  payload?: Record<string, unknown>
  /** هوية الحدث — نفس مفتاح رسالة النتيجة ⇒ رسالة واحدة لكل طلب. */
  eventKey?: string | null
}): Promise<void> {
  try {
    const { workspaceId, platform, event, storeId, eventKey } = args
    if (!workspaceId) return
    // الوصول يُعلن للطلبات فقط.
    if (getEventCategory(event) !== 'orders') return

    const chats = await getWorkspaceChats(workspaceId)
    if (chats.length === 0) return

    let entityId: string | null = null
    try {
      const { extractEntityId } = await import('@/lib/sync-queue')
      entityId = extractEntityId((args.payload ?? {}) as Record<string, unknown>) || null
    } catch {
      // استخراج الرقم best-effort — غيابه لا يمنع التنبيه.
    }

    // ── تأخير رسالة الوصول ────────────────────────────────────────────────
    // المزامنة تكتمل عادةً خلال ثوانٍ. بتأخير الرسالة هذه ننتظر، فإذا
    // وصلت رسالة النتيجة (أولوية أعلى) أُلغيت رسالة الوصول ⇒ **رسالة
    // واحدة لكل طلب**. إن تأخرت المزامنة، تخرج رسالة الوصول تنبيهاً فورياً.
    const { TELEGRAM_ARRIVAL_DELAY_MS, enqueueTelegramMessage } = await import('@/lib/telegram-outbox')

    for (const chat of chats) {
      if (!chat.notify_on_arrival) continue

      const text = buildArrivalMessage(
        { platform, event, entityId, storeId: storeId ?? null, receivedAt: new Date().toISOString() },
        chat.language === 'en' ? 'en' : 'ar'
      )
      await enqueueTelegramMessage({
        workspaceId,
        botId: chat.bot_id,
        chatId: chat.chat_id,
        chatLabel: chat.chat_label,
        language: chat.language === 'en' ? 'en' : 'ar',
        kind: 'arrival',
        priority: 0,
        eventKey: eventKey ?? null,
        body: text,
        availableAt: new Date(Date.now() + TELEGRAM_ARRIVAL_DELAY_MS),
      })
    }
  } catch {
    // تنبيه الوصول لا يكسر الاستلام أبداً.
  }
}
