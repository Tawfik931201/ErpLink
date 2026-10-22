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

      // The Telegram poller used to be started only as a side effect of the
      // server actions that add a bot token or generate a link code. That made
      // it survive exactly as long as the process that ran the action: after
      // any restart or deploy no poller existed at all, so `/start <code>`
      // was silently ignored until the user re-added the token by hand. It
      // reads its bots and pending codes from the database on a 30s refresh,
      // so it does not need an action to wake it up.
      const { startTelegramPoller } = await import('@/lib/telegram-long-poller')
      startTelegramPoller()

      // مُرسّل صندوق التليجرام: كل إشعار يُحفظ أولاً ثم يُرسل بمُرسّل
      // مستقل. قبل ذلك كان `notifySyncResult` يستدعي api.telegram.org داخل
      // عامل المزامنة — 429 كان يبتلع الرسالة بلا إعادة محاولة، و`fetch` بلا
      // مهلة كان يحتجز عامل المزامنة إلى الأبد.
      const { startTelegramOutboxRunner } = await import('@/lib/telegram-outbox')
      startTelegramOutboxRunner()
    }
  }
}
