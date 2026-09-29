'use server'

import { revalidatePath } from 'next/cache'

import { getActiveUserId } from '@/lib/auth'
import { supabase } from '@/lib/supabase'
import { enqueueWebhookEvent } from '@/lib/sync-queue'
import { getOrCreateDbUser } from '@/lib/users'

export async function bulkRetryOrders(logIds: string[]) {
  try {
    const userId = await getActiveUserId()
    if (!userId) throw new Error('Unauthorized')
    const user = await getOrCreateDbUser(userId)
    if (!user.active_workspace_id) throw new Error('No active workspace')

    const { data: logs, error: logErr } = await supabase
      .from('sync_logs')
      .select('*')
      .in('id', logIds)
      .eq('workspace_id', user.active_workspace_id)

    if (logErr) throw new Error('Failed to fetch logs')
    if (!logs || logs.length === 0) throw new Error('No matching logs found')

    const mappingIds = [...new Set(logs.map(l => l.field_mapping_id).filter(Boolean))]
    const { data: mappings, error: mapErr } = await supabase
      .from('field_mappings')
      .select('*')
      .in('id', mappingIds)
      .eq('workspace_id', user.active_workspace_id)

    if (mapErr) throw new Error('Failed to fetch mappings')
    const mappingMap = new Map((mappings || []).map(m => [m.id, m]))

    const results: { logId: string; success: boolean; error?: string }[] = []

    // If more than 5 logs, queue them in sync_queue to avoid Server Action timeout
    if (logs.length > 5) {
      for (const log of logs) {
        try {
          await supabase
            .from('sync_logs')
            .update({ status: 'processing', updated_at: new Date().toISOString() })
            .eq('id', log.id)

          await enqueueWebhookEvent({
            workspaceId: user.active_workspace_id,
            storeId: String(log.store_id || ''),
            event: log.event,
            platform: log.event?.includes('shopify') ? 'shopify' : log.event?.includes('salla') ? 'salla' : 'zid',
            payload: log.payload || {},
          })
          results.push({ logId: log.id, success: true })
        } catch (err: any) {
          results.push({ logId: log.id, success: false, error: err?.message || 'Failed to queue retry' })
        }
      }
    } else {
      const { processSingleMapping } = await import('@/lib/sync-engine')
      for (const log of logs) {
        const mapping = mappingMap.get(log.field_mapping_id)
        if (!mapping) {
          results.push({ logId: log.id, success: false, error: 'Mapping not found' })
          continue
        }
        try {
          await processSingleMapping(mapping, log.event, log.store_id, log.payload || {}, 'manual', log.id)
          results.push({ logId: log.id, success: true })
        } catch (err: any) {
          results.push({ logId: log.id, success: false, error: err.message })
        }
      }
    }

    revalidatePath('/app/mapping-center/orders')
    return { success: true, results }
  } catch (error: any) {
    return { success: false, error: error.message }
  }
}
