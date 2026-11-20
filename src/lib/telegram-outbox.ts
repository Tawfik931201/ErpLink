/**
 * صندوق صادر التليجرام — طابور الإرسال الدائم.
 *
 * المشكلة التي تحلها هذه الوحدة:
 *   - `notifySyncResult` / `notifyOrderArrival` كانا يستدعيان api.telegram.org
 *     **مباشرة**. فشل 429 كان يُبتلع بلا إعادة محاولة ⇒ **الرسالة تضيع**،
 *     و`fetch` بلا مهلة ⇒ لو تليجرام علِق احتُجز عامل المزامنة **للأبد**
 *     (10 تعليقات كانت تُوقف الطابور كله).
 *   - تضخيم الرسائل: حدث واحد ⇒ رسالة وصول + (1 + N) رسالة نتيجة.
 *
 * الحل:
 *   1. كل رسالة تُحفظ هنا **قبل** أي نداء ⇒ لا ضياع. الفشل يُعاد جدولته، وبعد
 *      5 محاولات تنتقل إلى `status='failed'` (مرئية وقابلة للإعادة).
 *   2. المُرسِل **منفصل** عن عامل المزامنة ⇒ تليجرام لا يعطّل أودوو أبداً.
 *   3. `event_key` يضمن **رسالة واحدة لكل طلب**: النتيجة (أولوية أعلى)
 *      تستبدل رسالة الوصول المعلّقة، والرسالة الثانية لنفس الحدث تُهمَل.
 *
 * ملاحظة: رسالة ترحيب ربط البوت وزر "رسالة تجريبية" تبقى إرسالاً مباشراً —
 *      هما ردّان فوريان لعملية يطلبها المستخدم الآن، لا إشعارات اختلاق.
 */

import { decrypt } from '@/lib/crypto'
import { supabase } from '@/lib/supabase'

export type OutboxKind = 'arrival' | 'result'

/** الأولوية: 0 = وصول، 1 = نجاح، 2 = فشل. الأعلى يفوز عند التعارض. */
export type OutboxPriority = 0 | 1 | 2

export interface EnqueueTelegramArgs {
  workspaceId: string
  botId: string
  chatId: string
  chatLabel?: string | null
  language: 'ar' | 'en'
  kind: OutboxKind
  priority: OutboxPriority
  /** هوية الحدث — تضمن رسالة واحدة لكل طلب. */
  eventKey?: string | null
  body: string
  /** لا تُرسل قبل هذا الوقت (تأخير رسالة الوصول حتى تلحق رسالة النتيجة). */
  availableAt?: Date | null
}

export interface EnqueueResult {
  queued: boolean
  /** سبب عدم الإدراج — للقياس فقط. */
  reason?: 'duplicate_event' | 'lower_priority' | 'insert_failed' | 'invalid'
}

const OUTBOX_MAX_ATTEMPTS = 5

/**
 * هل هذا الخطأ يعني "الجدول/العمود غير موجود"؟
 *
 * ⚠️ PostgREST **لا يمرّر** كود Postgres (42P01) بل كوده هو:
 *   - PGRST205 = الجدول غير موجود في مخطط البحث
 *   - PGRST204 = العمود غير موجود
 * وهذا خطأ متنكّر: الفحص على 42P01 وحده ترك المُرسّل يصرخ كل ثانيتين
 * (نُشر 2026-10-22 ورُصد في سجلّات الإنتاج قبل تطبيق الترحيل).
 */
function isMissingRelationError(code: string | undefined): boolean {
  if (!code) return false
  return code === 'PGRST205' || code === 'PGRST204' || code === '42P01' || code === '42703'
}

/**
 * حارس "الجدول غير موجود": قبل تطبيق الترحيل
 * `20261022_telegram_outbox.sql` كل إدراج وكل جلب يفشل. بلا هذا الحارس
 * we'd have one failing insert per event plus a failing poll every 2s.
 * نوقف المحاولات لـ10 دقائق ونُعلن مرة واحدة بصوت عالٍ.
 */
let outboxUnavailableUntil = 0
let outboxMissingLogged = false

function outboxUnavailable(): boolean {
  return Date.now() < outboxUnavailableUntil
}

function markOutboxUnavailable(error: string): void {
  if (!outboxMissingLogged) {
    outboxMissingLogged = true
    console.error(
      `[TelegramOutbox] the telegram_outbox table is not available (${error}). ` +
        'Telegram notifications are queued nowhere and will be lost until ' +
        'migration 20261022_telegram_outbox.sql is applied. The sync itself is unaffected.'
    )
  }
  outboxUnavailableUntil = Date.now() + 10 * 60_000
}

/** خادم تليجرام يسمح ~30 رسالة/ثانية لكل بوت. 15 حدود آمنة وتُبقي Others. */
const SEND_RATE_PER_SEC = 15

/** مهلة نداء تليجرام — بلاها يعلّق عامل الإرسال إلى الأبد. */
const SEND_TIMEOUT_MS = 5_000

/**
 * تأخير رسالة الوصول. خلال هذه النافذة تكتمل المزامنة عادةً (ثوانٍ)، فتُلغى
 * رسالة الوصول وتُرسَل رسالة النتيجة وحدها ⇒ **رسالة واحدة لكل طلب**.
 * إن تأخرت المزامنة، تخرج رسالة الوصول أولاً (تنبيه فوري) ثم النتيجة.
 */
export const TELEGRAM_ARRIVAL_DELAY_MS = 20_000

let sendTokens = SEND_RATE_PER_SEC
let lastRefill = Date.now()

function refillTokens(): void {
  const now = Date.now()
  const elapsed = now - lastRefill
  if (elapsed <= 0) return
  sendTokens = Math.min(SEND_RATE_PER_SEC, sendTokens + (elapsed * SEND_RATE_PER_SEC) / 1000)
  lastRefill = now
}

function takeToken(): boolean {
  refillTokens()
  if (sendTokens < 1) return false
  sendTokens -= 1
  return true
}

/**
 * القرار عند التعارض — **خالص** ليبقى قابلاً للاختبار بلا قاعدة بيانات.
 *
 * - لا صف معلّق ⇒ `insert`.
 * - صف معلّق بأولوية ≥ ⇒ `skip` (رسالة واحدة لكل طلب).
 * - صف معلّق بأولوية < ⇒ `replace` (رسالة الفشل تُبقي مكان رسالة النجاح).
 */
export type OutboxDecision = 'insert' | 'skip' | 'replace'

export function decideOutboxAction(
  existingPriority: number | null | undefined,
  newPriority: number
): OutboxDecision {
  if (existingPriority === null || existingPriority === undefined) return 'insert'
  return existingPriority >= newPriority ? 'skip' : 'replace'
}

/**
 * تأخير المحاولة التالية — **خالص**.
 * `retry_after` الذي يطلبه تليجرام له الأولوية المطلقة.
 */
export function nextAttemptDelayMs(attempts: number, retryAfterMs?: number): number {
  if (retryAfterMs && retryAfterMs > 0) return retryAfterMs
  const minutes = Math.min(15, 2 ** Math.max(0, attempts - 1))
  return minutes * 60_000
}

/**
 * يُدرج رسالة في الصندوق مع ضمان "رسالة واحدة لكل حدث".
 *
 * - إن وُجد صف معلّق بنفس `event_key`:
 *   - أولويته ≥ أولوية الجديدة ⇒ تُهمَل الجديدة (لا تكرار).
 *   - أولويته <  ⇒ تُستبدل (رسالة الفشل تُبقي رسالة النجاح مكانها).
 * - الفهرس الجزئي `uq_telegram_outbox_pending_event` هو الضمان الذرّي
 *   (23505 = تكرار حميد، لا خطأ).
 */
export async function enqueueTelegramMessage(args: EnqueueTelegramArgs): Promise<EnqueueResult> {
  if (!args.workspaceId || !args.botId || !args.chatId || !args.body) {
    return { queued: false, reason: 'invalid' }
  }
  if (outboxUnavailable()) {
    return { queued: false, reason: 'insert_failed' }
  }

  if (args.eventKey) {
    try {
      const { data: existing } = await supabase
        .from('telegram_outbox')
        .select('id,priority')
        .eq('event_key', args.eventKey)
        .eq('status', 'pending')
        .limit(1)
        .maybeSingle()

      if (existing) {
        const existingPriority = Number((existing as { priority?: number }).priority ?? 0)
        const decision = decideOutboxAction(existingPriority, args.priority)
        if (decision === 'skip') {
          return { queued: false, reason: 'duplicate_event' }
        }
        if (decision === 'replace') {
          // أولوية أعلى (فشل بدل نجاح) ⇒ نستبدل الصف المعلّق.
          await supabase.from('telegram_outbox').delete().eq('id', (existing as { id: string }).id)
        }
      }
    } catch {
      // فحص الدفعة الأولى فشل — نكمل، والفهرس الجزئي هو الضمان النهائي.
    }
  }

  const row: Record<string, unknown> = {
    workspace_id: args.workspaceId,
    bot_id: args.botId,
    chat_id: args.chatId,
    chat_label: args.chatLabel ?? null,
    language: args.language,
    kind: args.kind,
    priority: args.priority,
    event_key: args.eventKey ?? null,
    body: args.body,
    status: 'pending',
    attempts: 0,
    available_at: (args.availableAt ?? new Date()).toISOString(),
    next_attempt_at: (args.availableAt ?? new Date()).toISOString(),
  }

  const { error } = await supabase.from('telegram_outbox').insert(row)
  if (error) {
    // 23505 = نفس الحدث مُدرج بالتوازي ⇒ تكرار حميد (لا رسالة ثانية).
    if (error.code === '23505') return { queued: false, reason: 'duplicate_event' }
    // الجدول غير موجود ⇒ الترحيل لم يُطبَّق بعد (PostgREST: PGRST205).
    if (isMissingRelationError(error.code)) {
      markOutboxUnavailable(error.message)
      return { queued: false, reason: 'insert_failed' }
    }
    console.error('[TelegramOutbox] insert failed:', error.message)
    return { queued: false, reason: 'insert_failed' }
  }
  outboxMissingLogged = false
  return { queued: true }
}

// ─── المُرسِل ─────────────────────────────────────────────────────────────────

interface OutboxRow {
  id: string
  bot_id: string
  chat_id: string
  body: string
  attempts: number
  event_key: string | null
}

export interface OutboxCycleResult {
  sent: number
  failed: number
  deferred: number
  skipped: number
}

function backoffMs(attempts: number): number {
  return nextAttemptDelayMs(attempts)
}

/**
 * دورة إرسال واحدة: تلتقط الصفوف المستحقة، ترسلها بمعدل محدود، وتحدّث
 * الحالة. لا ترمي استثناءً أبداً — الفشل في دور واحد لا يوقف شيئاً.
 */
export async function runTelegramOutboxCycle(limit = 25): Promise<OutboxCycleResult> {
  const result: OutboxCycleResult = { sent: 0, failed: 0, deferred: 0, skipped: 0 }
  const nowIso = new Date().toISOString()

  let rows: OutboxRow[] = []
  if (outboxUnavailable()) return result
  try {
    const { data, error } = await supabase
      .from('telegram_outbox')
      .select('id,bot_id,chat_id,body,attempts,event_key')
      .eq('status', 'pending')
      .lte('available_at', nowIso)
      .lte('next_attempt_at', nowIso)
      .order('next_attempt_at', { ascending: true })
      .limit(Math.max(1, Math.min(limit, 100)))

    if (error) {
      if (isMissingRelationError(error.code)) {
        markOutboxUnavailable(error.message)
        return result
      }
      console.error('[TelegramOutbox] fetch failed:', error.message)
      return result
    }

    rows = (data ?? []) as OutboxRow[]
  } catch (err: unknown) {
    console.error('[TelegramOutbox] fetch failed:', err instanceof Error ? err.message : err)
    return result
  }

  if (rows.length === 0) return result

  // جلب التوكنات مرة واحدة لكل البوتات المشاركة.
  const botIds = [...new Set(rows.map((r) => r.bot_id).filter(Boolean))]
  const tokens = new Map<string, string>()
  if (botIds.length > 0) {
    try {
      const { data: bots } = await supabase
        .from('telegram_bots')
        .select('id,bot_token')
        .in('id', botIds)
      for (const bot of (bots ?? []) as Array<{ id: string; bot_token: string }>) {
        try {
          tokens.set(bot.id, decrypt(bot.bot_token))
        } catch {
          // توكن غير قابل للفكّ (مدوّر بمفتاح قديم) — يُتخطى.
        }
      }
    } catch {
      // غير قاتل.
    }
  }

  for (const row of rows) {
    if (!takeToken()) {
      result.deferred += 1
      continue
    }

    const token = tokens.get(row.bot_id)
    if (!token) {
      // لا توكن (أو توكن مدوّر بمفتاح قديم) ⇒ نسجّلها فاشلة لتكون مرئية
      // بدل أن تختفي بصمت.
      await markFailed(row, 'bot token unavailable')
      result.failed += 1
      continue
    }

    const sent = await sendTelegramMessage(token, row.chat_id, row.body)

    if (sent.ok) {
      await supabase
        .from('telegram_outbox')
        .update({ status: 'sent', sent_at: new Date().toISOString(), last_error: null })
        .eq('id', row.id)
      result.sent += 1
      continue
    }

    if (sent.retryAfterMs) {
      // 429 من تليجرام: ننتظر ما يطلبه تليجرام نفسه (parameters.retry_after).
      await supabase
        .from('telegram_outbox')
        .update({
          attempts: row.attempts + 1,
          next_attempt_at: new Date(Date.now() + sent.retryAfterMs).toISOString(),
          last_error: sent.description ?? 'rate limited',
        })
        .eq('id', row.id)
      result.deferred += 1
      continue
    }

    const attempts = row.attempts + 1
    if (attempts >= OUTBOX_MAX_ATTEMPTS) {
      await markFailed(row, sent.description ?? 'send failed')
      result.failed += 1
      continue
    }
    await supabase
      .from('telegram_outbox')
      .update({
        attempts,
        next_attempt_at: new Date(Date.now() + backoffMs(attempts)).toISOString(),
        last_error: sent.description ?? 'send failed',
      })
      .eq('id', row.id)
    result.deferred += 1
  }

  return result
}

async function markFailed(row: OutboxRow, error: string): Promise<void> {
  await supabase
    .from('telegram_outbox')
    .update({ status: 'failed', attempts: row.attempts + 1, last_error: error.slice(0, 300) })
    .eq('id', row.id)
}

export interface TelegramSendOutcome {
  ok: boolean
  description?: string
  /** Milliseconds to wait before retrying, when the platform says so. */
  retryAfterMs?: number
}

/**
 * إرسال واحد إلى تليجرام — **بمهلة**. بلا مهلة كان `fetch` المعلّق يحتجز
 * عامل الإرسال إلى الأبد.
 */
export async function sendTelegramMessage(
  botToken: string,
  chatId: string,
  body: string
): Promise<TelegramSendOutcome> {
  const url = `https://api.telegram.org/bot${botToken}/sendMessage`
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), SEND_TIMEOUT_MS)
  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ chat_id: chatId, text: body }),
      signal: controller.signal,
    })
    let json: { ok?: boolean; description?: string; parameters?: { retry_after?: number } } | undefined
    try {
      json = await res.json()
    } catch {
      // رد غير JSON
    }
    if (json?.ok === true) return { ok: true }

    const description = (json?.description as string) ?? `HTTP ${res.status}`
    // تليجرام يردّ 429 مع parameters.retry_after بالثواني.
    const retryAfterSec = Number(json?.parameters?.retry_after ?? 0)
    if (res.status === 429 && Number.isFinite(retryAfterSec) && retryAfterSec > 0) {
      return { ok: false, description, retryAfterMs: retryAfterSec * 1000 }
    }
    return { ok: false, description }
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err)
    return { ok: false, description: message }
  } finally {
    clearTimeout(timer)
  }
}

// ─── الحلقة الخلفية ──────────────────────────────────────────────────────────

interface OutboxGlobals {
  __telegramOutboxStarted?: boolean
  __telegramOutboxProcessing?: boolean
  __telegramOutboxInterval?: NodeJS.Timeout
}

const g = globalThis as unknown as OutboxGlobals

// Do not query telegram_outbox every few seconds when no linked bots exist.
// Re-check infrequently so a newly linked bot starts sending without restart.
let telegramBotPresenceUntil = 0
let telegramHasLinkedBot = true
async function hasLinkedTelegramBot(): Promise<boolean> {
  if (Date.now() < telegramBotPresenceUntil) return telegramHasLinkedBot
  const { data, error } = await supabase.from('telegram_bots')
    .select('id').eq('status', 'linked').limit(1)
  if (error) return true // Fail open: never suppress durable delivery on DB errors.
  telegramHasLinkedBot = (data?.length ?? 0) > 0
  telegramBotPresenceUntil = Date.now() + 60_000
  return telegramHasLinkedBot
}

// Keep Telegram durable delivery independent of the Odoo sync worker.
// A 2-second idle poll produced ~43,200 Supabase REST reads per day per process.
// Ten seconds retains prompt notifications while avoiding ~80% of idle reads.
// Operators can temporarily lower this interval without a code change.
const requestedOutboxIntervalMs = Number(process.env.TELEGRAM_OUTBOX_POLL_INTERVAL_MS)
export const OUTBOX_INTERVAL_MS =
  Number.isFinite(requestedOutboxIntervalMs) && requestedOutboxIntervalMs >= 2_000
    ? Math.min(60_000, Math.trunc(requestedOutboxIntervalMs))
    : 10_000

/** يبدأ مُرسّل الصندوق — مرة واحدة لكل عملية. */
export function startTelegramOutboxRunner(): void {
  if (process.env.NEXT_PHASE === 'phase-production-build') return
  if (process.env.TELEGRAM_OUTBOX_ENABLED === 'false') return
  if (g.__telegramOutboxStarted) return
  g.__telegramOutboxStarted = true

  const tick = async () => {
    if (g.__telegramOutboxProcessing) return
    g.__telegramOutboxProcessing = true
    try {
      if (!await hasLinkedTelegramBot()) return
      const result = await runTelegramOutboxCycle()
      if (result.failed > 0) {
        console.warn(`[TelegramOutbox] ${result.failed} message(s) exhausted retries`)
      }
    } catch (err: unknown) {
      console.error('[TelegramOutbox] cycle error:', err instanceof Error ? err.message : err)
    } finally {
      g.__telegramOutboxProcessing = false
    }
  }

  void tick()
  const timer = setInterval(() => {
    void tick()
  }, OUTBOX_INTERVAL_MS)
  if (typeof timer.unref === 'function') timer.unref()
  g.__telegramOutboxInterval = timer
  console.log('[TelegramOutbox] outbox sender started')
}

export function stopTelegramOutboxRunner(): void {
  if (g.__telegramOutboxInterval) {
    clearInterval(g.__telegramOutboxInterval)
    g.__telegramOutboxInterval = undefined
  }
  g.__telegramOutboxStarted = false
}

/**
 * تنظيف الصندوق: الصفوف المُرسلة بعد 7 أيام، والفاشلة بعد 30 يوماً.
 * يُستدعى من تنظيف الطابور الدوري.
 */
export async function pruneTelegramOutbox(): Promise<{ removed: number }> {
  let removed = 0
  try {
    const sentCutoff = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString()
    const failedCutoff = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString()
    const { count: sentCount } = await supabase
      .from('telegram_outbox')
      .delete({ count: 'exact' })
      .eq('status', 'sent')
      .lt('created_at', sentCutoff)
    const { count: failedCount } = await supabase
      .from('telegram_outbox')
      .delete({ count: 'exact' })
      .eq('status', 'failed')
      .lt('created_at', failedCutoff)
    removed = (sentCount ?? 0) + (failedCount ?? 0)
  } catch {
    // غير قاتل.
  }
  return { removed }
}
