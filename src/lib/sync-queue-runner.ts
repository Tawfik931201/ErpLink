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
}

/**
 * يقرأ فترة من متغير البيئة مع حماية من القيم غير الصالحة (0، سالبة، NaN،
 * أو نص غير رقمي) حتى لا يتحول المؤقت إلى حلقة محمومة أو يتوقف كلياً.
 */
function envInterval(name: string, fallbackMs: number, minMs: number): number {
  const raw = Number(process.env[name])
  return Number.isFinite(raw) && raw >= minMs ? raw : fallbackMs
}

/** تصريف الطابور كل 30 ثانية افتراضياً (بديل cron كل دقيقة). */
const POLL_INTERVAL_MS = envInterval('SYNC_QUEUE_POLL_INTERVAL_MS', 30_000, 5_000)

/** تسوية زد كل 10 دقائق افتراضياً (نفس-periodic كـ cron التسوية). */
const RECONCILE_INTERVAL_MS = envInterval('SYNC_RECONCILE_INTERVAL_MS', 600_000, 60_000)

/**
 * عدد سجلات صندوق الاستلام المُعاد دفعها في الدورة الواحدة. صغير عمداً:
 * الاستعادة حالة طوارئ، لا المسار الطبيعي.
 */
const WEBHOOK_INBOX_DRAIN_BATCH = 25

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
async function runDrainCycle(): Promise<void> {
  if (g.__syncQueueRunnerProcessing) return
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
    await processSyncQueue(SYNC_QUEUE_DEFAULT_BATCH)
  } catch {
    // الأخطاء مسجلة في عدادات الطابور — لا console لكل دورة.
  } finally {
    g.__syncQueueRunnerProcessing = false
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

  g.__syncQueueRunnerInterval = setInterval(() => {
    void runDrainCycle()
  }, POLL_INTERVAL_MS)
  unref(g.__syncQueueRunnerInterval)

  g.__syncQueueReconcileInterval = setInterval(() => {
    void runReconcileCycle()
  }, RECONCILE_INTERVAL_MS)
  unref(g.__syncQueueReconcileInterval)

  // Fix-up drain shortly after boot: anything that arrived while the process
  // was down is picked up immediately instead of waiting for the first tick.
  setTimeout(() => {
    void runDrainCycle()
  }, 5_000).unref?.()

  console.warn(
    `[sync-queue] background runner started — drain every ${POLL_INTERVAL_MS / 1000}s, reconcile every ${
      RECONCILE_INTERVAL_MS / 60_000
    }min`
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
    clearInterval(g.__syncQueueRunnerInterval)
    g.__syncQueueRunnerInterval = undefined
  }
  if (g.__syncQueueReconcileInterval) {
    clearInterval(g.__syncQueueReconcileInterval)
    g.__syncQueueReconcileInterval = undefined
  }
  g.__syncQueueRunnerStarted = false
  g.__syncQueueRunnerProcessing = false
  g.__syncQueueReconcileProcessing = false
}
