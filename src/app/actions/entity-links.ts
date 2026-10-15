'use server'

import { getActiveUserId } from '@/lib/auth'
import { supabase } from '@/lib/supabase'
import { getOrCreateDbUser as ensureDbUser } from '@/lib/users'

async function getActiveWorkspaceId(): Promise<string | null> {
  const userId = await getActiveUserId()
  if (!userId) return null
  const dbUser = await ensureDbUser(userId)
  return dbUser.active_workspace_id ?? null
}

/**
 * How many durable Odoo links exist for one store + model, and the newest.
 * Read-only, always scoped to the caller's active workspace — a merchant can
 * never see another workspace's links. Powers the "saved Odoo ID" hint in
 * the custom-mapping form (update/delete flows).
 */
export async function getEntityLinkStats(params: {
  platform: 'zid' | 'salla' | 'shopify'
  storeKey: string
  odooModel?: string
}): Promise<{
  success: boolean
  count?: number
  last?: { storeEntityId: string; odooRecordId: number; lastSyncedAt: string } | null
  error?: string
}> {
  try {
    const workspaceId = await getActiveWorkspaceId()
    if (!workspaceId) return { success: false, error: 'Unauthorized' }
    if (!params.storeKey) return { success: false, error: 'Missing store' }

    const model = params.odooModel || 'sale.order'
    const { data, error } = await supabase
      .from('odoo_entity_links')
      .select('store_entity_id,odoo_record_id,last_synced_at')
      .eq('workspace_id', workspaceId)
      .eq('platform', params.platform)
      .eq('store_id', params.storeKey)
      .eq('odoo_model', model)
      .order('last_synced_at', { ascending: false })
      .limit(50)

    if (error) {
      // Table may not exist yet if the migration was never applied.
      if ((error as { code?: string }).code === '42P01') {
        return { success: true, count: 0, last: null }
      }
      throw new Error('Failed to query entity links: ' + error.message)
    }

    const rows = (data ?? []) as Array<{
      store_entity_id: string
      odoo_record_id: number
      last_synced_at: string
    }>
    const first = rows[0]
    return {
      success: true,
      count: rows.length >= 50 ? 50 : rows.length,
      last: first
        ? {
            storeEntityId: first.store_entity_id,
            odooRecordId: Number(first.odoo_record_id),
            lastSyncedAt: first.last_synced_at,
          }
        : null,
    }
  } catch (error: unknown) {
    console.error('[Entity Link Action] getEntityLinkStats failed:', error)
    return { success: false, error: error instanceof Error ? error.message : 'Failed to fetch entity links' }
  }
}
