import { type NextRequest, NextResponse } from 'next/server'

import { getSyncQueueMetrics, SYNC_QUEUE_DEFAULT_BATCH } from '@/lib/sync-queue'
import { runSyncQueueOnce } from '@/lib/sync-queue-runner'
import { countOrphanReceipts, drainWebhookInbox } from '@/lib/webhook-inbox'
import { secretMatches } from '@/lib/webhook-secret'

/**
 * GET /api/cron/sync-queue — مشغّل الطابور الدوري
 *
 * يعمل على استضافة مشتركة (Hostinger) أو خادم سحابي:
 * استدعاء دوري (كل دقيقة) يقوم بـ:
 *
 *   1. `drainWebhookInbox` — يعيد دفع أي ويب هوك محفوظ في صندوق الاستلام ولم
 *      يصل إلى الطابور (تعطُّر سابق، فشل شبكة، إعادة تشغيل). يمنع فقدان أي حدث.
 *   2. حلقة تصريف منضبطة زمنياً (Time-bounded drain loop):
 *      تنفذ دفعات متتالية بأمان حتى 40 ثانية كحد أقصى (لتفادي Timeout الدقيقة)،
 *      مما يتيح تصريف مئات الطلبات المتراكمة في أوقات الذروة والمواسم دون تأخير لساعات.
 *   3. أرشفة الصفوف المجمّدة إلى `sync_queue_dead` (مخنوقة داخلياً إلى مرة/ساعة).
 *
 * يدعم التحقق من سر CRON_SECRET إن وُجد لحماية المسار.
 */
export async function GET(req: NextRequest) {
  const authHeader = req.headers.get('authorization')
  const cronSecret = process.env.CRON_SECRET

  if (cronSecret) {
    const bearer = authHeader?.replace(/^Bearer\s+/i, '')
    const secretHeader = req.headers.get('x-cron-secret')
    if (!secretMatches(bearer ?? '', cronSecret) && !secretMatches(secretHeader ?? '', cronSecret)) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }
  } else if (process.env.NODE_ENV === 'production') {
    console.error('[Cron] Security Alert: CRON_SECRET is not configured on production server.')
    return NextResponse.json({ error: 'Cron secret not configured on server' }, { status: 500 })
  }

  // Cap: an unbounded `?batch=` is a one-request DoS (memory + Odoo/Zid
  // request storm on shared hosting). Clamp to 1..100 regardless of input.
  const rawBatch = Number(req.nextUrl.searchParams.get('batch'))
  const batchSize = Number.isFinite(rawBatch)
    ? Math.min(100, Math.max(1, Math.trunc(rawBatch)))
    : SYNC_QUEUE_DEFAULT_BATCH

  // Rate limit cron invocations per caller (60/min) — a retry loop must not
  // become a tight hammer.
  const { checkRateLimit: checkCronRl } = await import('@/lib/rate-limit')
  const cronIp = req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() || 'anonymous'
  const cronRl = checkCronRl(`cron-sync-queue:${cronIp}`, 60, 60_000)
  if (!cronRl.allowed) {
    return NextResponse.json({ error: 'Too many requests' }, { status: 429 })
  }

  try {
    // 1) الشفاء أولاً: أضيق نافذة زمنية يوجد فيها احتمال فقدان حدث.
    const inbox = await drainWebhookInbox(25)

    // 2) التنفيذ الفعلي بحلقة زمنية محددة لتصريف الزخم دون تجاوز مهلة الدقيقة.
    // ننفذ دفعات متتالية بأمان حتى 40 ثانية كحد أقصى أو حتى نفاد العناصر المستحقة.
    const CRON_MAX_RUNTIME_MS = 40_000
    const cronStart = Date.now()
    let totalProcessed = 0
    let batchesRun = 0

    while (Date.now() - cronStart < CRON_MAX_RUNTIME_MS) {
      batchesRun++
      const processedCount = await runSyncQueueOnce(batchSize)
      totalProcessed += processedCount

      // إذا انتهت العناصر المستحقة أو الدفعة شبه فارغة، لا داعي لإكمال الحلقة
      if (processedCount === 0 || processedCount < Math.min(batchSize, 10)) {
        break
      }

      // راحة قصيرة جداً (200ms) لمنع قفل I/O متصل
      await new Promise((r) => setTimeout(r, 200))
    }

    // Web Push is independent of Odoo processing; failures must not fail the sync cron.
    const push = await import('@/lib/browser-push-worker')
      .then(({ runBrowserPushOnce }) => runBrowserPushOnce())
      .catch((err) => {
        console.error('[Cron] Web Push delivery error:', err)
        return { checked: 0, sent: 0, errors: 1 }
      })
    const metrics = getSyncQueueMetrics()

    // 3) مؤشرات تُقرأ من cPanel/مراقبة الخادم: أرقام تكشف الاختناقات مبكراً.
    // orphanInbox = أحداث محفوظة لمتجر غير مربوط (تحتاج ربطاً يدوياً).
    const orphanInbox = await countOrphanReceipts()

    return NextResponse.json({
      success: true,
      timestamp: new Date().toISOString(),
      inbox,
      batchesRun,
      totalProcessed,
      durationMs: Date.now() - cronStart,
      orphanInbox,
      metrics,
      push,
    })
  } catch (error: any) {
    return NextResponse.json(
      {
        success: false,
        error: error?.message || 'Failed to process sync queue',
      },
      { status: 500 }
    )
  }
}

// POST is intentionally NOT supported here: cron/scheduler pings are GET,
// and accepting state-changing POSTs widens CSRF-driven invocation surface.
export async function POST() {
  return NextResponse.json({ error: 'Method not allowed' }, { status: 405 })
}
