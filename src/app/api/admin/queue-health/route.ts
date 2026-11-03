import { auth } from '@clerk/nextjs/server'
import { NextResponse } from 'next/server'

import { adminAlertWorkspaceId } from '@/lib/admin-alerts'
import { isAdmin } from '@/lib/auth'
import {
  INGRESS_BASE_CEILING,
  INGRESS_GLOBAL_CAP_PER_MIN,
  INGRESS_MAX_CEILING,
  INGRESS_TARGET_PENDING,
  getIngressMetrics,
} from '@/lib/ingress-admission'
import { supabase } from '@/lib/supabase'
import {
  MAX_CONCURRENT_PER_WORKSPACE,
  SYNC_QUEUE_CONCURRENCY,
  SYNC_QUEUE_DEFAULT_BATCH,
  SYNC_QUEUE_MAX_RETRIES,
  coalesceWindowMs,
  getCircuitBreakerState,
  getSyncQueueMetrics,
  isSeasonMode,
} from '@/lib/sync-queue'

/**
 * GET /api/admin/queue-health — قائمة تحقق ما قبل الموسم (P0-2).
 *
 * يجيب عن ثلاثة أسئلة في استدعاء واحد:
 *   1. هل Runner يعمل؟ (SYNC_QUEUE_SELF_RUNNER في الإنتاج)
 *   2. هل ترحيلا الموثوقية مطبقان؟ (الجداول + عمود dedup_key)
 *   3. ما عمق الطابور الآن؟ (معلق / مجمد / يتيم / ميت + عمر أقدم معلق)
 *
 * Read-only تماماً: لا يكتب شيئاً ولا يشغّل دورة. مخصص للأدمن فقط.
 */

interface TableCheck {
  ok: boolean
  error?: string
}

async function checkTable(table: string, columns?: string): Promise<TableCheck> {
  try {
    const { error } = await supabase
      .from(table)
      .select(columns ?? 'id')
      .limit(1)
    if (error) {
      const code = (error as { code?: string }).code ?? ''
      // 42P01 = جدول غير موجود، 42703 = عمود غير موجود (ترحيل ناقص)
      return { ok: false, error: `${code || 'error'}: ${error.message?.slice(0, 120)}` }
    }
    return { ok: true }
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message.slice(0, 120) : 'check_failed' }
  }
}

async function countRows(
  table: string,
  filter?: (q: any) => any
): Promise<number | null> {
  try {
    let q: any = supabase.from(table).select('id', { count: 'exact', head: true })
    if (filter) q = filter(q)
    const { count, error } = await q
    if (error) return null
    return typeof count === 'number' ? count : null
  } catch {
    return null
  }
}

export async function GET() {
  const { userId } = await auth()
  if (!userId || !isAdmin(userId)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const isProduction = process.env.NODE_ENV === 'production'
  const selfRunner = process.env.SYNC_QUEUE_SELF_RUNNER === 'true'
  const pollMs = Number(process.env.SYNC_QUEUE_POLL_INTERVAL_MS) || 30_000
  const reconcileMs = Number(process.env.SYNC_RECONCILE_INTERVAL_MS) || 600_000

  // ── ترحيلا الموثوقية ──────────────────────────────────────────────
  const inbox = await checkTable('webhook_inbox')
  const queueDedup = await checkTable('sync_queue', 'dedup_key')
  const inboxDedup = await checkTable('webhook_inbox', 'dedup_key')
  const dead = await checkTable('sync_queue_dead')
  const reconcileState = await checkTable('sync_reconcile_state')
  // صندوق التليجرام — ترحيل 20261022. منفصل عن البقية لأن فائدته
  // "الإشعارات" فقط، بينما البقية تمنع **فقد الطلبات**.
  const telegramOutbox = await checkTable('telegram_outbox')
  const durableQueue = await checkTable('sync_queue', 'receipt_id,lease_token,lease_expires_at,outcome_unknown,erp_connection_id,connection_generation')
  const effectLedger = await checkTable('erp_effects', 'id,status')
  const acceptanceLedger = await checkTable('webhook_acceptances', 'id')
  const targetBindings = await checkTable('erp_workspace_bindings', 'workspace_id')
  const migrationsOk =
    inbox.ok && queueDedup.ok && inboxDedup.ok && dead.ok && reconcileState.ok &&
    durableQueue.ok && effectLedger.ok && acceptanceLedger.ok && targetBindings.ok
  const [unknownOutcomes, activeLeases, uncertainEffects, accepted24h] = await Promise.all([
    countRows('sync_queue', q => q.eq('outcome_unknown', true)),
    countRows('sync_queue', q => q.not('lease_token', 'is', null)),
    countRows('erp_effects', q => q.in('status', ['uncertain', 'in_progress'])),
    countRows('webhook_acceptances', q => q.gte('received_at', new Date(Date.now() - 86_400_000).toISOString())),
  ])

  // ── عمق الطابور ──────────────────────────────────────────────────
  const [pending, frozen, orphans, deadCount, skipped24h, inboxPending, inboxFailed, telegramPending, telegramFailed] =
    await Promise.all([
      countRows('sync_queue', (q: any) => q.not('next_retry_at', 'is', null)),
      countRows('sync_queue', (q: any) => q.is('next_retry_at', null)),
      countRows('webhook_inbox', (q: any) => q.eq('status', 'pending').is('workspace_id', null)),
      countRows('sync_queue_dead'),
      countRows('sync_logs', (q: any) =>
        q
          .eq('status', 'skipped')
          .eq('trigger_type', 'webhook-ingress')
          .gte('created_at', new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString())
      ),
      // إيصالات محفوظة تنتظر الدفع إلى الطابور — مسار الإنقاذ. ارتفاع هذا
      // الرقم يعني أن الإدراج في `sync_queue` يفشل ويتراكم الإنقاذ.
      countRows('webhook_inbox', (q: any) => q.eq('status', 'pending').not('workspace_id', 'is', null)),
      // إيصالات فشلت 10 محاولات دفع ⇒ توقفت للأبد. كانت غير مرئية تماماً.
      countRows('webhook_inbox', (q: any) => q.eq('status', 'failed')),
      // صندوق التليجرام: رسائل لم تُرسل بعد (تأخّر أو إعادة محاولة).
      countRows('telegram_outbox', (q: any) => q.eq('status', 'pending')),
      // رسائل استنفدت محاولاتها ⇒ مرئية وقابلة للإعادة (لم تكن موجودة).
      countRows('telegram_outbox', (q: any) => q.eq('status', 'failed')),
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

  const runnerOk = !isProduction || selfRunner

  // ── حكم الجاهزية: سؤال واحد — "هل نحن مستعدون لأول عميل؟" ─────────────
  // كل عائق هنا = سبب **يضيّع طلباً** أو يُعطّل المعالجة. العناصر
  // التحذيرية (warnings) لا تمنع الجاهزية.
  const ingressSnapshot = getIngressMetrics()
  const blockers: Array<{ key: string; ar: string; en: string }> = []
  const warnings: Array<{ key: string; ar: string; en: string }> = []

  if (!runnerOk) {
    blockers.push({
      key: 'runner_not_started',
      ar: 'عامل الطابور لا يعمل — SYNC_QUEUE_SELF_RUNNER غير مضبوط. الطلبات ستتكدّس ولا تُعالَج.',
      en: 'The queue runner is not running — SYNC_QUEUE_SELF_RUNNER is not set. Events will pile up and never sync.',
    })
  }
  if (!migrationsOk) {
    blockers.push({
      key: 'missing_migrations',
      ar: 'ترحيلات الموثوقية غير مطبَّقة — راجع قسم migrations أدناه.',
      en: 'The reliability migrations are not applied — see the migrations section below.',
    })
  }
  if (!telegramOutbox.ok) {
    warnings.push({
      key: 'telegram_outbox_missing',
      ar: 'ترحيل 20261022_telegram_outbox.sql غير مطبَّق — إشعارات التليجرام تضيع (المزامنة نفسها سليمة).',
      en: 'Migration 20261022_telegram_outbox.sql is not applied — Telegram notifications are lost (the sync itself is fine).',
    })
  }
  if (ingressSnapshot.rejectedUnauthenticated > 0) {
    blockers.push({
      key: 'unauthenticated_rejections',
      ar: `${ingressSnapshot.rejectedUnauthenticated} رفضاً لطلبات بلا اعتماد — متجر لم يُسجَّل بالأسرار المشتقة بعد. شغّل مسارات refresh.`,
      en: `${ingressSnapshot.rejectedUnauthenticated} rejection(s) for requests without a credential — a store is not re-registered yet. Run the refresh routes.`,
    })
  }
  if (ingressSnapshot.rejectedGlobal > 0) {
    blockers.push({
      key: 'global_cap_closed',
      ar: 'صمام الأمان العام أُغلق — طلبات موثّقة رُفضت بـ503.',
      en: 'The global safety valve closed — certified requests were refused with 503.',
    })
  }
  if (frozen && frozen > 0) {
    warnings.push({
      key: 'frozen_rows',
      ar: `${frozen} صفاً مجمداً — أعد تشغيلها من شاشة الطابور.`,
      en: `${frozen} frozen row(s) — restart them from the queue screen.`,
    })
  }
  if (inboxFailed && inboxFailed > 0) {
    warnings.push({
      key: 'inbox_failed',
      ar: `${inboxFailed} إيصالاً توقّف بعد 10 محاولات دفع — تحتاج تدخّلاً يدوياً.`,
      en: `${inboxFailed} receipt(s) stopped after 10 delivery attempts — they need manual attention.`,
    })
  }
  if (!adminAlertWorkspaceId()) {
    warnings.push({
      key: 'admin_alerts_off',
      ar: 'تنبيهات الأدمن معطّلة (ADMIN_ALERT_WORKSPACE_ID غير مضبوط) — لا إنذار تلقائي عند الخلل.',
      en: 'Admin alerts are off (ADMIN_ALERT_WORKSPACE_ID is not set) — no automatic warning on failure.',
    })
  }

  const ready = blockers.length === 0

  return NextResponse.json({
    success: true,
    ready,
    /**
     * حكم الجاهزية — كل `blockers` فيه سبب **يضيّع طلباً** أو يُعطّل
     * المعالجة. `warnings` منها يخفّف (إشعارات، أدوات) ولا يوقف.
     */
    readiness: {
      ready,
      blockers,
      warnings,
      adminAlertsConfigured: Boolean(adminAlertWorkspaceId()),
    },
    timestamp: new Date().toISOString(),
    runner: {
      ok: runnerOk,
      selfRunner,
      nodeEnv: process.env.NODE_ENV ?? 'development',
      pollIntervalSec: Math.round(pollMs / 1000),
      reconcileIntervalMin: Math.round(reconcileMs / 60000),
      concurrency: SYNC_QUEUE_CONCURRENCY,
      batchSize: SYNC_QUEUE_DEFAULT_BATCH,
      maxPerWorkspace: MAX_CONCURRENT_PER_WORKSPACE,
      maxRetries: SYNC_QUEUE_MAX_RETRIES,
      seasonMode: isSeasonMode(),
      coalesceWindowMs: coalesceWindowMs(),
      circuitBreakerThreshold: Number(process.env.SYNC_CB_THRESHOLD) || 10,
      circuitBreakerCooldownMin: Number(process.env.SYNC_CB_COOLDOWN_MIN) || 15,
    },
    migrations: {
      ok: migrationsOk,
      durableQueue, effectLedger, acceptanceLedger, targetBindings,
      webhook_inbox: inbox,
      sync_queue_dedup_key: queueDedup,
      webhook_inbox_dedup_key: inboxDedup,
      sync_queue_dead: dead,
      sync_reconcile_state: reconcileState,
      telegram_outbox: telegramOutbox,
    },
    depth: {
      unknownOutcomes, activeLeases, uncertainEffects, accepted24h,
      pending,
      frozen,
      orphans,
      deadLetter: deadCount,
      ingressSkipped24h: skipped24h,
      inboxPending,
      inboxFailed,
      telegramPending,
      telegramFailed,
      oldestPendingAgeSec,
    },
    ingressRateLimit: {
      /**
       * الحد 120/دقيقة يبقى **للمجهولين فقط** (طلب بلا أي اعتماد) — هو
       * حماية العملية من سكربت عشوائي. الطلب الموثّق (توقيع HMAC أو سر مشتق)
       * لا يخضع له: الاعتماد نفسه هو الحماية، والحد كان يحوّل ذروة العميل
       * إلى ضياع صامت (429 ⇒ المنصات لا تعيد الإرسال بعد 4xx).
       */
      unauthenticatedPerIpPerMinute: 120,
      authenticatedRejection: 'none — certified deliveries are never rejected',
      note: 'الطلب الموثّق يمرّ ببوابة الاستقبال: يُقبل دائماً، وما فوق الحصة يُؤجَّل لا يُرفض.',
    },
    /**
     * بوابة الاستقبال الجديدة (المرحلة 1): لا رفض للطلبات الموثّقة.
     * `admitted` = مقبول ضمن الحصة، `overflow` = مقبول فوق الحصة (يُعالَج
     * ويتأخّر، ولا يُرفض)، `rejectedGlobal` = صمام الأمان العام الوحيد.
     */
    ingressAdmission: {
      baseCeilingPerMin: INGRESS_BASE_CEILING,
      maxCeilingPerMin: INGRESS_MAX_CEILING,
      targetPending: INGRESS_TARGET_PENDING,
      globalCapPerMin: INGRESS_GLOBAL_CAP_PER_MIN,
      ...getIngressMetrics(),
    },
    circuitBreakers: getCircuitBreakerState(),
    metrics: getSyncQueueMetrics(),
  })
}
