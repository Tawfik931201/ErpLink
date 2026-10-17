import { auth } from '@clerk/nextjs/server'
import { NextResponse } from 'next/server'

import { isAdmin } from '@/lib/auth'
import {
  getLegacyDeliveryCounts,
  isLegacyCounterPlatform,
  resetLegacyDeliveryCounts,
} from '@/lib/legacy-delivery-counter'
import { countOrphanReceipts } from '@/lib/webhook-inbox'

/**
 * GET /api/admin/webhook-legacy-status — قراءة عدادات التسليمات غير المصادقة
 * (الدائمة في `webhook_legacy_counters`) وعدّاد الأيتام.
 *
 * القرار التشغيلي الذي تدعمه النافذة:
 *  - العدّاد يزيد مع كل تسليمة legacy ولا يهبط إلا بقرار إداري (تصفير).
 *  - عدّاد منصة صفر (بعد فترة هدوء) يعني: لا تسليمات legacy تصل — إغلاق
 *    النافذة (فعل STRICT_WEBHOOK_AUTH) آمن للمنصة بعد أن نُفِّذ مسار
 *    refresh الخاص بها (الذي يرفع للأعلى كل متاجر رُبطت قبل المفتاح).
 *  - عدّاد الأيتام > 0 يعني أحداث متاجر غير مربوطة تنتظر الاسترداد اليدوي
 *    (POST /api/admin/webhook-orphans/replay).
 */
export async function GET() {
  const { userId } = await auth()
  if (!userId || !isAdmin(userId)) {
    return NextResponse.json({ error: 'Admin access required' }, { status: 403 })
  }

  try {
    const counters = await getLegacyDeliveryCounts()
    const orphans = await countOrphanReceipts()
    return NextResponse.json({
      legacyCounters: counters,
      orphans,
      note: 'counter === 0 for a platform means no legacy deliveries arrive — closing the legacy window (STRICT_WEBHOOK_AUTH) is safe for it once its refresh route ran.',
    })
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'legacy status read failed' },
      { status: 500 }
    )
  }
}

/**
 * POST /api/admin/webhook-legacy-status — explicit admin action: reset the
 * durable counters to 0 so "the counter hits zero" becomes a trustworthy
 * signal after the refresh routes ran. Body: { platform?: 'odoo'|'zid'|'salla'|'shopify' } —
 * a scoped platform resets its row only; no/`all` resets every row.
 *
 * This never touches ingestion — it is a bookkeeping reset only.
 */
export async function POST(req: Request) {
  const { userId } = await auth()
  if (!userId || !isAdmin(userId)) {
    return NextResponse.json({ error: 'Admin access required' }, { status: 403 })
  }

  let platform: string | null = null
  try {
    const body = (await req.json()) as { platform?: string }
    if (typeof body?.platform === 'string' && body.platform !== 'all') {
      if (!isLegacyCounterPlatform(body.platform)) {
        return NextResponse.json(
          { error: `Unknown platform "${body.platform}"` },
          { status: 400 }
        )
      }
      platform = body.platform
    }
  } catch {
    // جسم فارغ — تصفير الكل (كل منصة في الجدول عبر update بدون .in).
  }

  try {
    await resetLegacyDeliveryCounts(
      platform ? [platform as 'odoo' | 'zid' | 'salla' | 'shopify'] : (['odoo', 'zid', 'salla', 'shopify'] as const).slice()
    )
    const counters = await getLegacyDeliveryCounts()
    return NextResponse.json({ ok: true, reset: platform ?? 'all', legacyCounters: counters })
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'counter reset failed' },
      { status: 500 }
    )
  }
}
