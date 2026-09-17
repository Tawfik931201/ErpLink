import { type NextRequest, NextResponse } from 'next/server'

import { getSyncQueueMetrics, SYNC_QUEUE_DEFAULT_BATCH } from '@/lib/sync-queue'
import { runSyncQueueOnce } from '@/lib/sync-queue-runner'

/**
 * GET /api/cron/sync-queue — مشغّل الطابور الدوري
 *
 * يُستدعى بواسطة مجدول خارجي (مثل Vercel Cron, Supabase pg_cron, أو خادم Cron مستقل)
 * لمعالجة أي طلبات متراكمة في طابور المزامنة `sync_queue`.
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
  }

  const batchSize = Number(req.nextUrl.searchParams.get('batch')) || SYNC_QUEUE_DEFAULT_BATCH

  try {
    await runSyncQueueOnce(batchSize)
    const metrics = getSyncQueueMetrics()

    return NextResponse.json({
      success: true,
      timestamp: new Date().toISOString(),
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
