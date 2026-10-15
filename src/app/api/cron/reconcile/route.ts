import { type NextRequest, NextResponse } from 'next/server'

import { reconcileZidOrders } from '@/lib/reconciliation'

/**
 * GET /api/cron/reconcile -- التسوية الدورية
 *
 * غرضها: تعويض اي ويب هوك اسقطته المنصة (Zid broken / Salla 3 محاولات /
 * Shopify 8 محاولات ثم حذف الاشتراك / Odoo automated action فاشل). تسحب
 * "ما تغير" من المتجر مباشرة وتعيد دفعه الى نفس الطابور الـidempotent،
 * فلا يتكرر العمل اذا كان قد وصل اصلا.
 *
 * مصممة للاستضافة المشتركة (Hostinger): دورة واحدة قصيرة ثم خروج. لا عملية
 * دائمة ولا ذاكرة. يجدول كل 10 دقائق من cPanel Cron:
 *
 *   curl -sS "https://<domain>/api/cron/reconcile?key=<CRON_SECRET>"
 */
export async function GET(req: NextRequest) {
  const authHeader = req.headers.get('authorization')
  const queryKey = req.nextUrl.searchParams.get('key') ?? ''
  const cronSecret = process.env.CRON_SECRET

  if (cronSecret) {
    const bearer = authHeader?.replace(/^Bearer\s+/i, '')
    if (bearer !== cronSecret && queryKey !== cronSecret) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }
  } else if (process.env.NODE_ENV === 'production') {
    console.error('[Cron Reconcile] Security Alert: CRON_SECRET is not configured on production server.')
    return NextResponse.json({ error: 'Cron secret not configured on server' }, { status: 500 })
  }

  // Cap `?window=` (1..1440 min) — an unbounded window turns one cron ping
  // into a full-history sweep (Zid 60 req/min budget + memory on shared host).
  const rawWindow = Number(req.nextUrl.searchParams.get('window'))
  const windowMinutes = Number.isFinite(rawWindow)
    ? Math.min(1440, Math.max(1, Math.trunc(rawWindow)))
    : undefined

  const { checkRateLimit: checkReconcileRl } = await import('@/lib/rate-limit')
  const reconcileIp = req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() || 'anonymous'
  const reconcileRl = checkReconcileRl(`cron-reconcile:${reconcileIp}`, 20, 60_000)
  if (!reconcileRl.allowed) {
    return NextResponse.json({ error: 'Too many requests' }, { status: 429 })
  }

  try {
    const result = await reconcileZidOrders({ windowMinutes })
    // نُبلغ فشلاً جزئياً بغير 200 حتى يظهر في مراقبة cPanel/الخادم.
    const status = result.stopped === 'error' ? 500 : 200
    return NextResponse.json(
      { success: result.stopped !== 'error', timestamp: new Date().toISOString(), result },
      { status }
    )
  } catch (error: unknown) {
    return NextResponse.json(
      {
        success: false,
        error: error instanceof Error ? error.message : 'reconciliation failed',
      },
      { status: 500 }
    )
  }
}

// POST is intentionally NOT supported here (see sync-queue route).
export async function POST() {
  return NextResponse.json({ error: 'Method not allowed' }, { status: 405 })
}
