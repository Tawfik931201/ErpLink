/**
 * تنبيهات الأدمن — قناة واحدة تكفي.
 *
 * القصة: `GET /api/admin/queue-health` كان يعرض كل شيء، لكن **لا أحد ينظر
 * إليه** كل 30 ثانية. فالنتيجة أن أول إنذار جاء من العميل نفسه.
 * الآن: نفس الأرقام تُفحص داخلياً، وعند تجاوز حدّ يُرسَل **تنبيه واحد**
 * إلى تليجرام.
 *
 * لماذا تليجرام وليس بريداً؟ لأن البنية موجودة: نفس الصندوق
 * (`telegram_outbox`)، نفس الـbot، نفس واجهة الاشتراك. **لا بنية جديدة.**
 *
 * كيف يربط الأدمن نفسه: ينشئ بوتاً (المسار المعتاد `/app/settings/notifications`)
 * ويربط محادثته بـ`ADMIN_ALERT_WORKSPACE_ID`. لا شيء آخر.
 *
 * ⚠️ التنبيه **مُقيَّد** (كل مجموعة أسباب مرة واحدة في الساعة) حتى لا
 * Becomes a spammer — والأهم: **رسالة واحدة** لكل مرة (كل الأسباب مجمّعة).
 */

import { supabase } from '@/lib/supabase'

/** المساحة التي تصلك تنبيهات الأدمن (اربط محادثتك بها). */
export function adminAlertWorkspaceId(): string {
  return String(process.env.ADMIN_ALERT_WORKSPACE_ID || '').trim()
}

/** الحد الأدنى بين نقطتي فحص — الفحص كل 5 دقائق. */
const CHECK_THROTTLE_MS = 5 * 60 * 1000

/** المدة التي لا يُعاد فيها نفس التنبيه. */
const ALERT_THROTTLE_MS = 60 * 60 * 1000

export interface AdminAlertCondition {
  key: string
  ar: string
  en: string
  value: string
}

interface HealthSnapshot {
  pending: number
  frozen: number
  unknownOutcome: number
  deadLetter: number
  inboxFailed: number
  telegramPending: number
  telegramFailed: number
  oldestPendingAgeSec: number | null
  rejectedGlobal: number
  rejectedUnauthenticated: number
}

async function readHealth(): Promise<HealthSnapshot> {
  const safe = async (fn: () => PromiseLike<{ count: number | null }>): Promise<number> => {
    try {
      const { count } = await fn()
      return typeof count === 'number' ? count : 0
    } catch {
      return 0
    }
  }

  const [
    pending,
    frozen,
    unknownOutcome,
    deadLetter,
    inboxFailed,
    telegramPending,
    telegramFailed,
  ] = await Promise.all([
    safe(() => supabase.from('sync_queue').select('id', { count: 'exact', head: true }).not('next_retry_at', 'is', null)),
    safe(() => supabase.from('sync_queue').select('id', { count: 'exact', head: true }).is('next_retry_at', null).eq('outcome_unknown', false)),
    safe(() => supabase.from('sync_queue').select('id', { count: 'exact', head: true }).eq('outcome_unknown', true)),
    safe(() => supabase.from('sync_queue_dead').select('id', { count: 'exact', head: true })),
    safe(() => supabase.from('webhook_inbox').select('id', { count: 'exact', head: true }).eq('status', 'failed')),
    safe(() => supabase.from('telegram_outbox').select('id', { count: 'exact', head: true }).eq('status', 'pending')),
    safe(() => supabase.from('telegram_outbox').select('id', { count: 'exact', head: true }).eq('status', 'failed')),
  ])

  let oldestPendingAgeSec: number | null = null
  try {
    const { data } = await supabase
      .from('sync_queue')
      .select('next_retry_at')
      .not('next_retry_at', 'is', null)
      .order('next_retry_at', { ascending: true })
      .limit(1)
      .maybeSingle()
    const ts = (data as { next_retry_at?: string } | null)?.next_retry_at
    if (ts) oldestPendingAgeSec = Math.max(0, Math.round((Date.now() - new Date(ts).getTime()) / 1000))
  } catch {
    oldestPendingAgeSec = null
  }

  const { getIngressMetrics } = await import('@/lib/ingress-admission')
  const ingress = getIngressMetrics()

  return {
    pending,
    frozen,
    unknownOutcome,
    deadLetter,
    inboxFailed,
    telegramPending,
    telegramFailed,
    oldestPendingAgeSec,
    rejectedGlobal: ingress.rejectedGlobal,
    rejectedUnauthenticated: ingress.rejectedUnauthenticated,
  }
}

/** الحدود — تُقاس بالأرقام لا بالحدس. */
export const ALERT_THRESHOLDS = {
  /** أقدم طلب منتظر (ثانية) — هدف التشغيل 30 دقيقة. */
  oldestPendingAgeSec: 1800,
  /** عمق الطابور — فوقه نبدأ نتكلّم عن ضغط حقيقي. */
  pending: 2000,
  /** صندوق التليجرام المعلّق — فوقه المُرسِل متأخر. */
  telegramPending: 200,
}

/** يقيّم اللقطة ⇒ قائمة الأسباب. **خالص** ليبقى قابلاً للاختبار. */
export function evaluateAlertConditions(health: HealthSnapshot): AdminAlertCondition[] {
  const conditions: AdminAlertCondition[] = []

  if (health.oldestPendingAgeSec !== null && health.oldestPendingAgeSec > ALERT_THRESHOLDS.oldestPendingAgeSec) {
    const minutes = Math.round(health.oldestPendingAgeSec / 60)
    conditions.push({
      key: 'oldest_pending',
      ar: `أقدم طلب منتظر مضى عليه ${minutes} دقيقة (الحد ${ALERT_THRESHOLDS.oldestPendingAgeSec / 60} دقيقة)`,
      en: `The oldest pending request is ${minutes} minutes old (limit ${ALERT_THRESHOLDS.oldestPendingAgeSec / 60} min)`,
      value: String(health.oldestPendingAgeSec),
    })
  }
  if (health.unknownOutcome > 0) {
    conditions.push({
      key: 'outcome_unknown',
      ar: `${health.unknownOutcome} عملية نتيجة تنفيذها في ERP غير مؤكدة — تحتاج تسوية مع أودوو قبل أي إعادة محاولة؛ لا تعِد تشغيلها تلقائياً`,
      en: `${health.unknownOutcome} ERP operation(s) have unknown outcomes — reconcile against ERP before retrying; never auto-replay`,
      value: String(health.unknownOutcome),
    })
  }
  if (health.frozen > 0) {
    conditions.push({
      key: 'frozen',
      ar: `${health.frozen} صفاً مجمداً (استُنفدت محاولاته) — تحتاج إعادة تشغيل`,
      en: `${health.frozen} frozen row(s) exhausted their retries — they need a restart`,
      value: String(health.frozen),
    })
  }
  if (health.deadLetter > 0) {
    conditions.push({
      key: 'dead_letter',
      ar: `${health.deadLetter} صفاً في صندوق الموتى (استرجاعه يدوي من شاشة الطابور)`,
      en: `${health.deadLetter} row(s) in the dead-letter archive (manual replay from the queue screen)`,
      value: String(health.deadLetter),
    })
  }
  if (health.inboxFailed > 0) {
    conditions.push({
      key: 'inbox_failed',
      ar: `${health.inboxFailed} إيصالاً توقّف بعد 10 محاولات دفع — لم يُعالَج`,
      en: `${health.inboxFailed} receipt(s) stopped after 10 delivery attempts — never processed`,
      value: String(health.inboxFailed),
    })
  }
  if (health.telegramFailed > 0) {
    conditions.push({
      key: 'telegram_failed',
      ar: `${health.telegramFailed} رسالة تليجرام استنفدت محاولاتها`,
      en: `${health.telegramFailed} Telegram message(s) exhausted their retries`,
      value: String(health.telegramFailed),
    })
  }
  if (health.rejectedGlobal > 0) {
    conditions.push({
      key: 'global_cap',
      ar: `صمام الأمان العام أُغلق ${health.rejectedGlobal} مرة (طلب موثّق رُفض بـ503)`,
      en: `The global safety valve closed ${health.rejectedGlobal} time(s) (a certified request was refused with 503)`,
      value: String(health.rejectedGlobal),
    })
  }
  if (health.rejectedUnauthenticated > 0) {
    conditions.push({
      key: 'unauthenticated_rejected',
      ar: `${health.rejectedUnauthenticated} رفضاً لطلبات بلا اعتماد (سقف الـIP) — متجر لم يُسجَّل بالأسرار المشتقة`,
      en: `${health.rejectedUnauthenticated} rejection(s) for requests without a credential (the IP limit) — a store is not re-registered yet`,
      value: String(health.rejectedUnauthenticated),
    })
  }
  if (health.pending > ALERT_THRESHOLDS.pending) {
    conditions.push({
      key: 'deep_backlog',
      ar: `عمق الطابور ${health.pending} (الحد ${ALERT_THRESHOLDS.pending})`,
      en: `Queue depth ${health.pending} (limit ${ALERT_THRESHOLDS.pending})`,
      value: String(health.pending),
    })
  }
  return conditions
}

let lastCheckAt = 0

export interface AdminAlertResult {
  checked: boolean
  sent: boolean
  conditions: AdminAlertCondition[]
  reason?: string
}

/**
 * يفحص الصحة ويحرج تنبيهاً واحداً (مجمّع الأسباب) إن لزم.
 * يُستدعى من دورة الطابور كل 5 دقائق.
 */
export async function checkAdminAlerts(force = false): Promise<AdminAlertResult> {
  const workspaceId = adminAlertWorkspaceId()
  if (!workspaceId) {
    return { checked: false, sent: false, conditions: [], reason: 'ADMIN_ALERT_WORKSPACE_ID not set' }
  }
  if (!force && Date.now() - lastCheckAt < CHECK_THROTTLE_MS) {
    return { checked: false, sent: false, conditions: [], reason: 'throttled' }
  }
  lastCheckAt = Date.now()

  const health = await readHealth()
  const conditions = evaluateAlertConditions(health)
  if (conditions.length === 0) {
    return { checked: true, sent: false, conditions: [] }
  }

  // مفتاح التنبيه = مجموعة الأسباب ⇒ نفس المجموعة لا تُرسل مرتين في الساعة.
  const key = conditions.map((c) => c.key).sort().join('|')
  const eventKey = `admin-alert:${workspaceId}:${key}`

  try {
    const { data: recent } = await supabase
      .from('telegram_outbox')
      .select('id,created_at')
      .eq('event_key', eventKey)
      .gte('created_at', new Date(Date.now() - ALERT_THROTTLE_MS).toISOString())
      .limit(1)
    if (recent && recent.length > 0) {
      return { checked: true, sent: false, conditions, reason: 'already_alerted' }
    }
  } catch {
    // الفحص فشل — نُرسل على أي حال (أفضل من الصمت).
  }

  const { data: chats } = await supabase
    .from('telegram_bot_chats')
    .select('id,chat_id,bot_id,language')
    .eq('workspace_id', workspaceId)
    .eq('enabled', true)
    .limit(10)

  if (!chats || chats.length === 0) {
    return { checked: true, sent: false, conditions, reason: 'no_linked_admin_chat' }
  }

  const { enqueueTelegramMessage } = await import('@/lib/telegram-outbox')
  let sent = 0
  for (const chat of chats as Array<{ chat_id: string; bot_id: string; language?: string }>) {
    const isAr = (chat.language ?? 'ar') === 'ar'
    const body = [
      isAr ? '🚨 تنبيه تشغيلي — طابور ERP لينك' : '🚨 Operational alert — ERP Link queue',
      '─────────────────',
      ...conditions.map((c) => (isAr ? c.ar : c.en)),
      '',
      isAr
        ? `المساحة: ${workspaceId} — التفاصيل: /api/admin/queue-health`
        : `Workspace: ${workspaceId} — details: /api/admin/queue-health`,
    ].join('\n')

    const outcome = await enqueueTelegramMessage({
      workspaceId,
      botId: chat.bot_id,
      chatId: chat.chat_id,
      language: isAr ? 'ar' : 'en',
      kind: 'result',
      priority: 2,
      eventKey: `${eventKey}:${chat.chat_id}`,
      body,
    })
    if (outcome.queued) sent += 1
  }

  return { checked: true, sent: sent > 0, conditions }
}
