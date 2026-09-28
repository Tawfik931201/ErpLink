import { type NextRequest, NextResponse } from 'next/server'

import { getSyncQueueMetrics, SYNC_QUEUE_DEFAULT_BATCH } from '@/lib/sync-queue'
import { runSyncQueueOnce } from '@/lib/sync-queue-runner'
import { countOrphanReceipts, drainWebhookInbox } from '@/lib/webhook-inbox'

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
    if (bearer !== cronSecret && secretHeader !== cronSecret) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }
  } else if (process.env.NODE_ENV === 'production') {
    console.error('[Cron] Security Alert: CRON_SECRET is not configured on production server.')
    return NextResponse.json({ error: 'Cron secret not configured on server' }, { status: 500 })
  }

  const batchSize = Number(req.nextUrl.searchParams.get('batch')) || SYNC_QUEUE_DEFAULT_BATCH

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

export async function POST(req: NextRequest) {
  return GET(req)
}
