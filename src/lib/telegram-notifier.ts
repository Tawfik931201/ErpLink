import { createHash } from 'crypto'

import { decrypt } from '@/lib/crypto'
import { supabase } from '@/lib/supabase'

export type SyncStatus = 'success' | 'failed' | 'skipped' | 'processing'

export interface SyncRecordSummary {
  status: SyncStatus
  event: string
  mappingName: string
  mappingId: string
  model: string
  odooRecordId?: number | string | null
  errorMessage?: string | null
  storeName?: string | null
  storeId?: string | null
  receivedAt?: string
  workspaceId?: string | null
}

// ─── Event labels (bilingual) ────────────────────────────────────────────────

const EVENT_LABELS: Record<string, { ar: string; en: string }> = {
  'product.create':     { ar: 'إنشاء منتج',        en: 'Product created' },
  'product.update':     { ar: 'تحديث منتج',        en: 'Product updated' },
  'product.delete':     { ar: 'حذف منتج',          en: 'Product deleted' },
  'product.publish':    { ar: 'نشر منتج',          en: 'Product published' },
  'order.create':       { ar: 'إنشاء طلب',         en: 'Order created' },
  'order.update':       { ar: 'تحديث طلب',         en: 'Order updated' },
  'order.cancel':       { ar: 'إلغاء طلب',         en: 'Order cancelled' },
  'order.deliver':      { ar: 'تسليم طلب',         en: 'Order delivered' },
  'order.created':      { ar: 'إنشاء طلب',         en: 'Order created' },
  'order.updated':      { ar: 'تحديث طلب',         en: 'Order updated' },
  'order.cancelled':    { ar: 'إلغاء طلب',         en: 'Order cancelled' },
  'order.delivered':    { ar: 'تسليم طلب',         en: 'Order delivered' },
  'customer.create':    { ar: 'إنشاء عميل',        en: 'Customer created' },
  'customer.update':    { ar: 'تحديث عميل',        en: 'Customer updated' },
  'customer.created':   { ar: 'إنشاء عميل',        en: 'Customer created' },
  'customer.updated':   { ar: 'تحديث عميل',        en: 'Customer updated' },
  'category.create':    { ar: 'إنشاء تصنيف',       en: 'Category created' },
  'category.update':    { ar: 'تحديث تصنيف',       en: 'Category updated' },
  'category.delete':    { ar: 'حذف تصنيف',         en: 'Category deleted' },
  'category.created':   { ar: 'إنشاء تصنيف',       en: 'Category created' },
  'category.updated':   { ar: 'تحديث تصنيف',       en: 'Category updated' },
  'category.deleted':   { ar: 'حذف تصنيف',         en: 'Category deleted' },
}

function labelFor(event: string, lang: 'ar' | 'en'): string {
  return EVENT_LABELS[event]?.[lang] ?? event
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
  const eventLabel = labelFor(record.event, lang)
  const date = formatDate(record.receivedAt, lang)

  const lines: string[] = []

  if (record.status === 'success') {
    lines.push(lang === 'ar' ? '✅ تمت المزامنة بنجاح' : '✅ Sync completed')
  } else if (record.status === 'failed') {
    lines.push(lang === 'ar' ? '❌ فشلت المزامنة' : '❌ Sync failed')
  } else if (record.status === 'skipped') {
    lines.push(lang === 'ar' ? '⏭️ تم تخطي المزامنة' : '⏭️ Sync skipped')
  } else {
    lines.push(lang === 'ar' ? '⏳ جارٍ المعالجة' : '⏳ In progress')
  }

  lines.push('')
  const mapL = lang === 'ar' ? 'القاعدة' : 'Mapping'
  const modelL = lang === 'ar' ? 'النموذج' : 'Model'
  const eventL = lang === 'ar' ? 'الحدث' : 'Event'
  const idLabel = lang === 'ar' ? 'المعرّف في ERP' : 'ERP id'
  const storeLabel = lang === 'ar' ? 'المتجر' : 'Store'
  const reasonLabel = lang === 'ar' ? 'السبب' : 'Reason'
  const dateLabel = lang === 'ar' ? 'التاريخ' : 'Time'

  lines.push(`${eventL}: ${eventLabel}`)
  lines.push(`${mapL}: ${clip(record.mappingName ?? '-', 80)}`)
  lines.push(`${modelL}: ${record.model ?? '-'}`)

  if (record.odooRecordId !== undefined && record.odooRecordId !== null) {
    lines.push(`${idLabel}: #${record.odooRecordId}`)
  }

  if (record.storeName) {
    lines.push(`${storeLabel}: ${clip(record.storeName, 60)}`)
  }

  if (record.status === 'failed' && record.errorMessage) {
    lines.push(`${reasonLabel}: ${clip(record.errorMessage, 220)}`)
  }

  if (date) {
    lines.push(`${dateLabel}: ${date}`)
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
}): Promise<void> {
  const { workspaceId, record } = args
  if (!workspaceId) return
  if (record.status === 'processing') return

  try {
    const chats = await getWorkspaceChats(workspaceId)
    if (chats.length === 0) return

    for (const chat of chats) {
      // Notify mode filter
      if (record.status === 'success' && chat.notify_mode === 'failure') continue
      if (record.status === 'failed' && chat.notify_mode === 'success') continue
      if (record.status === 'skipped') continue

      // Workspace filter
      const wsFilter = parseJsonFilter(chat.workspace_filter)
      if (wsFilter.length > 0 && record.workspaceId && !wsFilter.includes(record.workspaceId)) continue

      // Mapping filter
      const mapFilter = parseJsonFilter(chat.mapping_filter)
      if (mapFilter.length > 0 && record.mappingId && !mapFilter.includes(record.mappingId)) continue

      // Decrypt token
      let tokenPlain = ''
      try { tokenPlain = decrypt(chat.bot_token) } catch { continue }
      if (!tokenPlain) continue

      const text = buildSyncMessage(record, chat.language as 'ar' | 'en')
      void callTelegramApi(tokenPlain, 'sendMessage', {
        chat_id: chat.chat_id,
        text,
      }).catch((err) => {
        console.warn(`[TelegramNotifier] Send failed chat=${chat.chat_id}:`, err?.message ?? err)
      })
    }
  } catch (err: any) {
    console.warn('[TelegramNotifier] notifySyncResult error (swallowed):', err?.message ?? err)
  }
}

export function botTokenFingerprint(botToken: string): string {
  return createHash('sha256').update(botToken).digest('hex').slice(0, 16)
}
