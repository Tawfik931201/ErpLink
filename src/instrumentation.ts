/**
 * Next.js Instrumentation Hook
 * Runs once upon server boot. In standalone/Node.js environments,
 * it starts the background queue worker.
 */
export async function register() {
  if (process.env.NEXT_RUNTIME === 'nodejs') {
    // Avoid starting background intervals during production build phase or next export
    if (process.env.NEXT_PHASE === 'phase-production-build') return

    // In serverless platforms like Vercel, cron is handled via vercel.json /api/cron/sync-queue.
    // In standalone Node/Docker VPS servers, start the interval runner.
    if (!process.env.VERCEL) {
      const { startSyncQueueRunner } = await import('@/lib/sync-queue-runner')
      startSyncQueueRunner()
    }
  }
}
