import { supabaseAdmin } from '@/lib/sync-runtime'

/**
 * سياسة الاحتفاظ بسجلات المزامنة (حتى لا تزدحم قاعدة البيانات):
 * - الناجح: يُحذف بعد 72 ساعة (3 أيام) — انتهت فائدته التشغيلية.
 * - غير الناجح (failed/skipped/processing): يُحذف بعد 60 يوماً — يبقى
 *   متاحاً للتدقيق وإعادة الإرسال طوال الموسم وما بعده بفترة كافية.
 */
export const SYNC_LOG_SUCCESS_RETENTION_HOURS = 72

export const SYNC_LOG_FAILURE_RETENTION_DAYS = 60

export async function cleanupExpiredLogs() {
  console.info('[SyncEngine] Running cleanupExpiredLogs...')
  try {
    const successCutoff = new Date(
      Date.now() - SYNC_LOG_SUCCESS_RETENTION_HOURS * 60 * 60 * 1000
    ).toISOString()
    const failureCutoff = new Date(
      Date.now() - SYNC_LOG_FAILURE_RETENTION_DAYS * 24 * 60 * 60 * 1000
    ).toISOString()

    // 1. Delete successful logs older than 72 hours
    const { error: err1 } = await supabaseAdmin
      .from('sync_logs')
      .delete()
      .eq('status', 'success')
      .lt('created_at', successCutoff)

    // 2. Delete all other logs older than 60 days
    const { error: err2 } = await supabaseAdmin
      .from('sync_logs')
      .delete()
      .neq('status', 'success')
      .lt('created_at', failureCutoff)

    if (err1 || err2) {
      console.error('[SyncEngine] Failed to delete expired logs:', err1 || err2)
    } else {
      console.info('[SyncEngine] Expired sync logs purged successfully.')
    }
  } catch (err) {
    console.error('[SyncEngine] Exception during log purge:', err)
  }
}
