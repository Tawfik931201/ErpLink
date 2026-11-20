/**
 * Sync Queue Background Runner — drains the sync queue and runs Zid
 * reconciliation from inside the app process, with no external scheduler.
 *
 * ⚠️ لا تستدعِ startSyncQueueRunner() داخل مسار طلب (route handler / webhook).
 * إقلاع setInterval لكل طلب يكدّس مؤقتات ويضغط السيرفر. يُستدعى مرة واحدة فقط
 * من `src/instrumentation.ts` عند إقلاع الخادم.
 *
 * لماذا نعتمد عليه بدل cron خارجي: استضافة Hostinger المشتركة لا توفّر
 * `crontab` صالحاً (الأمر موجود لكنه لا يكتب إلى `/var/spool/cron`)، فالمهام
 * المجدولة لا تعمل رغم تسجيلها بنجاح. المعالج الداخلي يزيل هذا الاعتماد كلياً.
 *
 * في الإنتاج يتطلب تفعيلاً صريحاً عبر `SYNC_QUEUE_SELF_RUNNER=true` حتى لا
 * يبدأ معالج دائم على منصة بلا عمليات طويلة العمر. في التطوير يعمل تلقائياً.
 *
 * الأمان: حارس تداخل لكل دورة (لا تتراكم الدورات ولا تتداخل)، ومؤقت واحد
 * فقط لكل عملية، وسقف توازي داخل `processSyncQueue`. الحمل ينمو مع عدد
 * الطلبات الفعلية فقط ولا يتضخم مع مرور الوقت.
 */

import { SYNC_QUEUE_DEFAULT_BATCH, processSyncQueue } from './sync-queue'

// Use global variable to survive Hot Module Replacement (HMR) during development
const g = global as unknown as {
  __syncQueueRunnerStarted?: boolean
  __syncQueueRunnerInterval?: NodeJS.Timeout
  __syncQueueRunnerProcessing?: boolean
  __syncQueueReconcileInterval?: NodeJS.Timeout
  __syncQueueReconcileProcessing?: boolean
  __syncQueueCronWarned?: boolean
  __workspaceArchiveInterval?: NodeJS.Timeout
  __workspaceArchiveProcessing?: boolean
}

/**
 * يقرأ فترة من متغير البيئة مع حماية من القيم غير الصالحة (0، سالبة، NaN،
 * أو نص غير رقمي) حتى لا يتحول المؤقت إلى حلقة محمومة أو يتوقف كلياً.
 */
function envInterval(name: string, fallbackMs: number, minMs: number): number {
  const raw = Number(process.env[name])
  return Number.isFinite(raw) && raw >= minMs ? raw : fallbackMs
}

/** تصريف الطابور كل 10 ثوانٍ افتراضياً (قابل للضبط من البيئة). */
const POLL_INTERVAL_MS = envInterval('SYNC_QUEUE_POLL_INTERVAL_MS', 10_000, 5_000)
const IDLE_INTERVAL_MS = envInterval('SYNC_QUEUE_IDLE_INTERVAL_MS', 60_000, 15_000)

/** تسوية زد كل 10 دقائق افتراضياً (نفس-periodic كـ cron التسوية). */
const RECONCILE_INTERVAL_MS = envInterval('SYNC_RECONCILE_INTERVAL_MS', 600_000, 60_000)

/**
 * أرشفة المساحات المنتهية كل 6 ساعات افتراضياً. هذه المهمة الخفيفة تضبط
 * `workspaces.archived_at` لكل مساحة عمل كان آخر اشتراك نشط فيها منتهيًا
 * ولم يعد هناك اشتراك سارٍ آخر — أي "أرشفة" المساحة غير المدفوعة.
 * الاسترجاع يحدث تلقائياً عند تسجيل أو تمديد اشتراك جديد (انظر
 * `src/lib/workspace-archive.ts`).
 */
const WORKSPACE_ARCHIVE_INTERVAL_MS = envInterval('WORKSPACE_ARCHIVE_INTERVAL_MS', 21_600_000, 300_000)

/**
 * عدد سجلات صندوق الاستلام المُعاد دفعها في الدورة الواحدة.
 *
 * كان 25 ⇒ **50/دقيقة** فقط، أي أن موجة آلاف الأحداث تستغرق ساعات
 * لتفريغها. المسار الآمن هو الاستقبال (كل حدث يُدرَج في الطابور مباشرة)،
 * وهذا المسار هو **الإنقاذ** — فسعة الاستبقاء أهم من فسعة الفراغ.
 */
const WEBHOOK_INBOX_DRAIN_BATCH = 100

/**
 * يمنع المؤقت من إبقاء العملية حية وحده (worker-friendly)، وكل عملية
 * `unref` اختياري على بيئات لا تدعمه.
 */
function unref(timer: NodeJS.Timeout | undefined): void {
  const maybe = timer as unknown as { unref?: () => void } | undefined
  if (typeof maybe?.unref === 'function') maybe.unref()
}

/**
 * دورة تصريف واحدة. حارس التداخل يضمن توفّر عملية واحدة كحد أقصى مهما تغيّرت
 * الفترة أو تضخّم الطابور — الدورات الزائدة تُتجاهل فوراً بدل أن تتراكم.
 *
 * الترتيب مقصود: `webhook_inbox` أولاً. كل ويب هوك يُكتب فيه قبل أي معالجة،
 * فإن فشل إدراجه في الطابور يبقى `pending` هناك. بلا هذه الخطوة تكون شبكة
 * الأمان معطّلة على استضافة بلا cron صالح.
 */
async function runDrainCycle(): Promise<boolean> {
  if (g.__syncQueueRunnerProcessing) return false
  try {
    g.__syncQueueRunnerProcessing = true
    const { drainWebhookInbox } = await import('./webhook-inbox')
    const drained = await drainWebhookInbox(WEBHOOK_INBOX_DRAIN_BATCH)
    // كان الصمت الكامل هنا يجعل خطأ drain (تعطل inbox / رسالة تخزين) غير
    // مرئي — يظهر لاحقاً فقط كتراكم مخزن. تُسجل الدورات الفاشلة فقط،
    // لا كل دورة سليمة.
    if (drained.failed > 0 || drained.inboxMissing) {
      console.warn(
        `[sync-queue] inbox drain had issues: failed=${drained.failed} inboxMissing=${drained.inboxMissing}`
      )
    }
    const processed = await processSyncQueue(SYNC_QUEUE_DEFAULT_BATCH)

    // ── نشر عمق الطابور لبوابة الاستقبال ───────────────────────────────────
    // السقف الديناميكي (120 ← 2000) يُشتق من فراغ الطابور: وهو المصدر
    // الوحيد الصادق لـ«كم ضغط النظام الآن». بدونه يبقى السقف على أساسه.
    await publishIngressPendingDepth()

    // ── تنبيهات الأدمن ─────────────────────────────────────────────────────
    // الدالة نفسها تقيّد نفسها (مرة كل 5 دقائق + نفس السبب مرة كل ساعة).
    const { checkAdminAlerts } = await import('./admin-alerts')
    await checkAdminAlerts().catch(() => {})
    return drained.scanned > 0 || processed > 0
  } catch {
    // Keep worker failures visible without serializing provider/customer data.
    console.error('[sync-queue] drain cycle failed; durable pending work will be retried on a later cycle')
    return true // Retry sooner after a transient error.
  } finally {
    g.__syncQueueRunnerProcessing = false
  }
}

/**
 * يحسب عمق الطابور الحالي وينشره لبوابة الاستقبال.
 * استعلام واحد عددي (head) — رخيص، ويجري مرة كل دورة.
 */
async function publishIngressPendingDepth(): Promise<void> {
  try {
    const { supabase } = await import('./supabase')
    const { count } = await supabase
      .from('sync_queue')
      .select('id', { count: 'exact', head: true })
      .not('next_retry_at', 'is', null)
    const { setIngressPendingDepth } = await import('./ingress-admission')
    setIngressPendingDepth(typeof count === 'number' ? count : 0)
  } catch {
    // غير قاتل — السقف يبقى على قيمته الأساسية.
  }
}

/**
 * دورة تسوية واحدة (تعويض ويب هوكdrops من زد). تستدعيها نفسPeriodic التي كان
 * يجدولها cron كل 10 دقائق، وتحدّ نفسها داخلياً بـ MAX_API_CALLS_PER_RUN و
 * MAX_ENQUEUED_PER_RUN فلا ت pressures واجهة زد.
 */
async function runReconcileCycle(): Promise<void> {
  if (g.__syncQueueReconcileProcessing) return
  try {
    g.__syncQueueReconcileProcessing = true
    const { reconcileZidOrders } = await import('./reconciliation')
    const result = await reconcileZidOrders()
    if (result.stopped === 'error') {
      console.error('[sync-queue] reconcile cycle failed:', result.errors.join('; '))
    }
    // Zid API category deletes can fail to emit a category.delete delivery.
    // A bounded, twice-confirmed 404 audit repairs only known entity links.
    const { reconcileZidDeletedCategories } = await import('./category-delete-reconciliation')
    const categories = await reconcileZidDeletedCategories()
    if (categories.errors.length > 0) {
      console.warn('[sync-queue] category deletion audit issues:', categories.errors.join('; '))
    }
  } catch (error: unknown) {
    console.error(
      '[sync-queue] reconcile cycle threw:',
      error instanceof Error ? error.message : String(error)
    )
  } finally {
    g.__syncQueueReconcileProcessing = false
  }
}

/**
 * دورة أرشفة واحدة: تحوّل المساحات التي انتهى اشتراكها إلى حالة "مؤرشفة".
 * خفيفة جداً (3 استعلامات + 1 تحديث على الأكثر)، ومحسورة داخلياً بـ
 * MAX 2000 صف في كل مرور. حارس التداخل يمنع تراكم الدورات.
 */
async function runWorkspaceArchiveCycle(): Promise<void> {
  if (g.__workspaceArchiveProcessing) return
  try {
    g.__workspaceArchiveProcessing = true
    const { archiveExpiredWorkspaces } = await import('./workspace-archive')
    const result = await archiveExpiredWorkspaces()
    if (result.error) {
      console.error('[sync-queue] workspace archive cycle failed:', result.error)
    } else if (result.archived > 0) {
      console.warn(`[sync-queue] archived ${result.archived} expired workspace(s)`)
    }
  } catch (error: unknown) {
    console.error(
      '[sync-queue] workspace archive cycle threw:',
      error instanceof Error ? error.message : String(error)
    )
  } finally {
    g.__workspaceArchiveProcessing = false
  }
}

/**
 * ابدأ الحلقة الخلفية — للسيرفر طويل العمر فقط. آمنة ضد التكرار والتداخل.
 * يتطلب متغير البيئة SYNC_QUEUE_SELF_RUNNER=true
 */
export function startSyncQueueRunner(): void {
  // Runner disabled by default in production — requires explicit opt-in.
  // In development it is always on: without a drain there is no way to test
  // the webhook → queue → store pipeline locally, and events pile up silently
  // while the route answers 202 "queued".
  const isProduction = process.env.NODE_ENV === 'production'
  if (isProduction && process.env.SYNC_QUEUE_SELF_RUNNER !== 'true') {
    // The queue is then drained only by an external scheduler calling
    // GET /api/cron/sync-queue. On the current Hostinger host that scheduler
    // cannot be made to work (crontab installs nothing), so if this env var is
    // missing the queue will never drain — say so once, loudly, at boot.
    if (!g.__syncQueueCronWarned) {
      g.__syncQueueCronWarned = true
      console.warn(
        '[sync-queue] SYNC_QUEUE_SELF_RUNNER is not enabled — queue processing depends ENTIRELY on an external scheduler calling GET /api/cron/sync-queue. This host has no working crontab, so set SYNC_QUEUE_SELF_RUNNER=true or events will queue up and never sync.'
      )
    }
    return
  }

  // Prevent running during production build phase
  if (process.env.NEXT_PHASE === 'phase-production-build') return

  // Prevent duplicate runner instances
  if (g.__syncQueueRunnerStarted) {
    return
  }
  g.__syncQueueRunnerStarted = true

  // Adapt polling to activity: queue receives a prompt direct drain on webhook
  // ingress, while an idle server avoids ~5 Supabase REST calls every 10 seconds.
  // A timeout is re-armed only after completion so cycles never pile up.
  const scheduleDrain = (delay: number) => {
    g.__syncQueueRunnerInterval = setTimeout(async () => {
      if (!g.__syncQueueRunnerStarted) return
      const busy = await runDrainCycle()
      if (g.__syncQueueRunnerStarted) scheduleDrain(busy ? POLL_INTERVAL_MS : IDLE_INTERVAL_MS)
    }, delay)
    unref(g.__syncQueueRunnerInterval)
  }
  scheduleDrain(POLL_INTERVAL_MS)

  g.__syncQueueReconcileInterval = setInterval(() => {
    void runReconcileCycle()
  }, RECONCILE_INTERVAL_MS)
  unref(g.__syncQueueReconcileInterval)

  g.__workspaceArchiveInterval = setInterval(() => {
    void runWorkspaceArchiveCycle()
  }, WORKSPACE_ARCHIVE_INTERVAL_MS)
  unref(g.__workspaceArchiveInterval)

  // Fix-up drain shortly after boot: anything that arrived while the process
  // was down is picked up immediately instead of waiting for the first tick.
  setTimeout(() => {
    void runDrainCycle()
  }, 5_000).unref?.()

  // First archive pass shortly after boot so workspaces that expired while
  // the process was down are archived promptly instead of waiting a full
  // WORKSPACE_ARCHIVE_INTERVAL_MS.
  setTimeout(() => {
    void runWorkspaceArchiveCycle()
  }, 30_000).unref?.()

  console.warn(
    `[sync-queue] background runner started — drain every ${POLL_INTERVAL_MS / 1000}s, reconcile every ${
      RECONCILE_INTERVAL_MS / 60_000
    }min, archive every ${WORKSPACE_ARCHIVE_INTERVAL_MS / 3_600_000}h`
  )
}

/**
 * دفعة واحدة بدون مؤقت — للاستدعاء من cron route أو سكربت.
 */
export async function runSyncQueueOnce(batchSize = SYNC_QUEUE_DEFAULT_BATCH): Promise<number> {
  if (process.env.NEXT_PHASE === 'phase-production-build') return 0
  return await processSyncQueue(batchSize)
}

export function stopSyncQueueRunner(): void {
  if (g.__syncQueueRunnerInterval) {
    clearTimeout(g.__syncQueueRunnerInterval)
    g.__syncQueueRunnerInterval = undefined
  }
  if (g.__syncQueueReconcileInterval) {
    clearInterval(g.__syncQueueReconcileInterval)
    g.__syncQueueReconcileInterval = undefined
  }
  if (g.__workspaceArchiveInterval) {
    clearInterval(g.__workspaceArchiveInterval)
    g.__workspaceArchiveInterval = undefined
  }
  g.__syncQueueRunnerStarted = false
  g.__syncQueueRunnerProcessing = false
  g.__syncQueueReconcileProcessing = false
  g.__workspaceArchiveProcessing = false
}
