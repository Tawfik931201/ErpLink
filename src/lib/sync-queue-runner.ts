/**
 * Sync Queue Background Runner — للعمليات طويلة العمر فقط (dev / worker مخصص).
 *
 * ⚠️ لا تستدعِ startSyncQueueRunner() داخل مسار طلب (route handler / webhook).
 * إقلاع setInterval لكل طلب يكدّس مؤقتات ويضغط السيرفر. المعالجة في الإنتاج
 * تتم عبر GET /api/cron/sync-queue بمجدول خارجي (Vercel Cron أو ما يشابهه).
 *
 * لا يعمل تلقائياً في الإنتاج — يحتاج تفعيل صريح عبر متغير البيئة
 * SYNC_QUEUE_SELF_RUNNER=true للاستضافة التي تدعم عمليات طويلة العمر
 * (VM, Container, Coolify, Railway، إلخ). في التطوير يعمل تلقائياً.
 */

import { SYNC_QUEUE_DEFAULT_BATCH, processSyncQueue } from './sync-queue'

// Use global variable to survive Hot Module Replacement (HMR) during development
const g = global as unknown as {
  __syncQueueRunnerStarted?: boolean
  __syncQueueRunnerInterval?: NodeJS.Timeout
  __syncQueueRunnerProcessing?: boolean
  __syncQueueCronWarned?: boolean
}

const RUNNER_INTERVAL_MS = 15_000 // Poll every 15s (was 5s — lighter on the DB)

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
    // On shared hosting (Hostinger) this is the correct state: the queue is
    // drained by the external cron hitting /api/cron/sync-queue. If that cron
    // job was never created, nothing drains the queue and events pile up
    // silently — so say it once, loudly, at boot.
    if (!g.__syncQueueCronWarned) {
      g.__syncQueueCronWarned = true
      console.warn(
        '[sync-queue] SYNC_QUEUE_SELF_RUNNER is not enabled — queue processing depends ENTIRELY on an external scheduler calling GET /api/cron/sync-queue (Hostinger: cPanel Cron Job, every minute). If no cron job exists, events will queue up and never sync.'
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

  g.__syncQueueRunnerInterval = setInterval(async () => {
    // Prevent overlapping execution
    if (g.__syncQueueRunnerProcessing) {
      return
    }

    try {
      g.__syncQueueRunnerProcessing = true
      await processSyncQueue(SYNC_QUEUE_DEFAULT_BATCH)
    } catch {
      // الأخطاء مسجلة في عدّادات الطابور — لا console لكل دورة.
    } finally {
      g.__syncQueueRunnerProcessing = false
    }
  }, RUNNER_INTERVAL_MS)

  // Allow the process to exit even if the runner is active (worker-friendly).
  if (typeof (g.__syncQueueRunnerInterval as unknown as { unref?: () => void }).unref === 'function') {
    ;(g.__syncQueueRunnerInterval as unknown as { unref: () => void }).unref()
  }
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
  g.__syncQueueRunnerStarted = false
  g.__syncQueueRunnerProcessing = false
}
