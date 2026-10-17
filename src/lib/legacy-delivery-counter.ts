/**
 * عدّاد التسليمات غير المصادقة (legacy) — دائم في جدول `webhook_legacy_counters`.
 *
 * لماذا DB وليس الذاكرة: العدّاد في الذاكرة يُصفَّر عند كل إعادة تشغيل للعملية،
 * فإشارة "بلغ العدّاد الصفر — أغلق النافذة" التي يعتمد عليها قرار رفض legacy
 * لم تكن قابلة للثقة إطلاقاً. هذا الوحدة هي النسخة الدائمة:
 *  - `incrementLegacyDelivery(platform, scope?)` — fire-and-forget؛ فشلها
 *    لا يفشل التسليم أبداً (العدّاد تلميح تشغيلي، لا مسار حرج).
 *  - `getLegacyDeliveryCounts()` — للقراءة في مسار admin.
 */

import { supabase } from '@/lib/supabase'

export const LEGACY_COUNTER_TABLE = 'webhook_legacy_counters'

export async function incrementLegacyDelivery(
  platform: 'odoo' | 'zid' | 'salla' | 'shopify',
  scope?: string
): Promise<void> {
  try {
    const { error } = await supabase.rpc('increment_legacy_delivery', {
      p_platform: platform,
    })
    if (error) {
      // صامت عمداً: العدّاد يجب ألا يؤثر على مسار التسليم مطلقاً.
      console.warn(
        `[legacy-delivery-counter] increment failed for ${platform}${scope ? ` (${scope})` : ''}:`,
        error.message
      )
    }
  } catch (err) {
    console.warn('[legacy-delivery-counter] increment threw for', platform, err)
  }
}

export async function getLegacyDeliveryCounts(): Promise<
  Array<{ platform: string; count: number; updated_at: string }>
> {
  const { data, error } = await supabase
    .from(LEGACY_COUNTER_TABLE)
    .select('platform, count, updated_at')
    .order('platform', { ascending: true })
  if (error) throw error
  return (data ?? []) as Array<{ platform: string; count: number; updated_at: string }>
}

export type LegacyCounterPlatform = 'odoo' | 'zid' | 'salla' | 'shopify'

export const LEGACY_COUNTER_PLATFORMS: LegacyCounterPlatform[] = [
  'odoo',
  'zid',
  'salla',
  'shopify',
]

export function isLegacyCounterPlatform(value: unknown): value is LegacyCounterPlatform {
  return (
    typeof value === 'string' &&
    (LEGACY_COUNTER_PLATFORMS as string[]).includes(value)
  )
}

/**
 * تصفير عدّاد منصة (أو كلها) — مسار إداري صريح فقط.
 *
 * التصفير هو ما يجعل "الصفر" صادقاً بعد تشغيل مسارات refresh: نصفّر
 * نعم نتفق أن ما يتراكم بعد التصفير هو إشارة تشغيل true، لا مخلّفات
 * قبل-refresh. الكتابة المباشرة على الجدول من كشف service_role —
 * العدّاد نفسه لا يمر عبر RPC زيادة التصفير لا يقرأ قيمة قديمة.
 */
export async function resetLegacyDeliveryCounts(
  platforms: LegacyCounterPlatform[]
): Promise<void> {
  const valid = platforms.filter(isLegacyCounterPlatform)
  if (valid.length === 0) {
    throw new Error('resetLegacyDeliveryCounts: no valid platform')
  }
  const { error } = await supabase
    .from(LEGACY_COUNTER_TABLE)
    .update({ count: 0, updated_at: new Date().toISOString() })
    .in('platform', valid)
  if (error) throw error
}
