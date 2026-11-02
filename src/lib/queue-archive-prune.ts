/**
 * حذف صفوف `queue_archives` المنتهية — خادم فقط.
 *
 * ⚠️ لماذا ملف منفصل عن `./queue-archive`: ذاك يُستورد من مكوّن عميل
 * (`queue-client.tsx`)، وأي استيراد هناك يصل إلى `@/lib/supabase`
 * (`@/lib/auth` → `next/headers`) يُفشل `next build`. القواعد الخالصة في
 * `./queue-archive`، وكل ما يلمس قاعدة البيانات هنا.
 *
 * يُستدعى من `maybeCleanup()` في عامل الطابور مرة في الساعة، مع
 * `cleanupExpiredLogs()` و`pruneProcessedInbox()`.
 */

import { QUEUE_ARCHIVES_TABLE } from '@/lib/queue-archive'
import { supabase } from '@/lib/supabase'

/**
 * حذف الأرشيف المنتهي — يُستدعى من `maybeCleanup()` في عامل الطابور (مرة/ساعة).
 *
 * الحذف بلا نسخة أخرى هو **القصد**: المدة سبعة أيام أُعلنت للتاجر في الواجهة،
 * وبعدها لا يبقى للأرشيف معنى. لا يمس صفوف مساحة أخرى إلا بانتهاء مدتها.
 *
 * «أفضل جهد»: تعيد 0 ولا ترمي أبداً، فقاعدة بيانات لم تُطبَّق عليها migration
 * `20261102_queue_archives.sql` لا تُسقِط عامل الطابور.
 */
export async function pruneExpiredQueueArchives(now: number = Date.now()): Promise<number> {
  try {
    const { data, error } = await supabase
      .from(QUEUE_ARCHIVES_TABLE)
      .delete()
      .lt('expires_at', new Date(now).toISOString())
      .select('id')
    if (error) return 0
    return Array.isArray(data) ? data.length : 0
  } catch {
    return 0
  }
}
