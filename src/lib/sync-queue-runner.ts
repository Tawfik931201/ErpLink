/**
 * Sync Queue Background Runner — للعمليات طويلة العمر فقط (dev / worker مخصص).
 *
 * ⚠️ لا تستدعِ startSyncQueueRunner() داخل مسار طلب (route handler / webhook).
 * إقلاع setInterval لكل طلب يكدّس مؤقتات ويضغط السيرفر. المعالجة في الإنتاج
 * تتم عبر GET /api/cron/sync-queue بمجدول خارجي (Vercel Cron أو ما يشابهه).
 */

import { SYNC_QUEUE_DEFAULT_BATCH, processSyncQueue } from './sync-queue'

// Use global variable to survive Hot Module Replacement (HMR) during development
const g = global as unknown as {
  __syncQueueRunnerStarted?: boolean
  __syncQueueRunnerInterval?: NodeJS.Timeout
  __syncQueueRunnerProcessing?: boolean
}

const RUNNER_INTERVAL_MS = 15_000 // Poll every 15s (was 5s — lighter on the DB)

/**
 * ابدأ الحلقة الخلفية — للسيرفر طويل العمر فقط. آمنة ضد التكرار والتداخل.
 */
export function startSyncQueueRunner(): void {
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
export async function runSyncQueueOnce(batchSize = SYNC_QUEUE_DEFAULT_BATCH): Promise<void> {
  if (process.env.NEXT_PHASE === 'phase-production-build') return
  await processSyncQueue(batchSize)
}

export function stopSyncQueueRunner(): void {
  if (g.__syncQueueRunnerInterval) {
    clearInterval(g.__syncQueueRunnerInterval)
    g.__syncQueueRunnerInterval = undefined
  }
  g.__syncQueueRunnerStarted = false
  g.__syncQueueRunnerProcessing = false
}
