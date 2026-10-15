'use server'

import { auth } from '@clerk/nextjs/server'
import { revalidatePath } from 'next/cache'

import { supabase } from '@/lib/supabase'
import { getOrCreateDbUser } from '@/lib/users'

export async function saveOrderStatusMappings(
  platform: string,
  mappings: Record<string, { state: string; enabled: boolean }>,
  storeId = ''
) {
  try {
    const { userId } = await auth()
    if (!userId) throw new Error('Unauthorized')

    const user = await getOrCreateDbUser(userId)
    if (!user.active_workspace_id) throw new Error('No active workspace')

    const workspaceId = user.active_workspace_id

    // Get current mappings first (safe: no data loss if this fails) —
    // scoped to this store so sibling stores' rows are never touched.
    const { data: existing } = await supabase
      .from('order_status_mappings')
      .select('zid_status')
      .eq('workspace_id', workspaceId)
      .eq('platform', platform)
      .eq('store_id', storeId)

    // Upsert new/changed mappings (safe: old data preserved if this fails)
    // Accepts the object shape { state, enabled }; legacy plain-string values
    // are tolerated and treated as enabled.
    const stateOf = (v: unknown): string => {
      const s = typeof v === 'string' ? v : (v as { state?: unknown } | null)?.state
      return String(s || '').trim()
    }
    const rows = Object.entries(mappings)
      .filter(([, v]) => stateOf(v) !== '')
      .map(([zidStatus, v]) => ({
        workspace_id: workspaceId,
        zid_status: zidStatus,
        odoo_state: stateOf(v),
        enabled: typeof v === 'string' ? true : ((v as { enabled?: unknown } | null)?.enabled ?? true),
        platform,
        store_id: storeId,
      }))

    if (rows.length > 0) {
      const { error: upsertError } = await supabase
        .from('order_status_mappings')
        .upsert(rows, {
          onConflict: 'workspace_id, platform, store_id, zid_status',
        })

      if (upsertError) throw upsertError
    }

    // Delete mappings no longer in the new set (safe: if this fails, stale rows remain harmlessly)
    const newStatuses = Object.entries(mappings)
      .filter(([, v]) => {
        const s = typeof v === 'string' ? v : (v as { state?: unknown } | null)?.state
        return s && String(s).trim() !== ''
      })
      .map(([zidStatus]) => zidStatus)
    const toDelete = (existing || [])
      .filter(e => !newStatuses.includes(e.zid_status))
      .map(e => e.zid_status)
    if (toDelete.length > 0) {
      const { error: deleteError } = await supabase
        .from('order_status_mappings')
        .delete()
        .eq('workspace_id', workspaceId)
        .eq('platform', platform)
        .eq('store_id', storeId)
        .in('zid_status', toDelete)

      if (deleteError) throw deleteError
    }

    revalidatePath('/app/mapping-center')
    return { success: true }
  } catch (error: any) {
    console.error('[OrderStatusMappings] Save failed:', error)
    return { success: false, error: error?.message || 'Failed to save order status mappings' }
  }
}

export async function getOrderStatusMappings(platform: string, storeId = '') {
  try {
    const { userId } = await auth()
    if (!userId) throw new Error('Unauthorized')

    const user = await getOrCreateDbUser(userId)
    if (!user.active_workspace_id) return { success: true, mappings: {} }

    // Per-store rows overlay the platform defaults (''): a store inherits
    // everything it has not overridden.
    const { data, error } = await supabase
      .from('order_status_mappings')
      .select('zid_status, odoo_state, enabled, store_id')
      .eq('workspace_id', user.active_workspace_id)
      .eq('platform', platform)
      .in('store_id', storeId ? [storeId, ''] : [''])

    if (error) throw error

    const byStatus = new Map<string, { state: string; enabled: boolean; store: string }>()
    for (const row of data || []) {
      if (!row.zid_status || !row.odoo_state) continue
      const prev = byStatus.get(row.zid_status)
      // Store-specific row wins over the platform default.
      if (!prev || (prev.store === '' && row.store_id !== '')) {
        byStatus.set(row.zid_status, {
          state: row.odoo_state,
          enabled: (row as { enabled?: unknown }).enabled !== false,
          store: row.store_id || '',
        })
      }
    }
    const mappings: Record<string, { state: string; enabled: boolean }> = {}
    for (const [k, v] of byStatus) mappings[k] = { state: v.state, enabled: v.enabled }

    return { success: true, mappings }
  } catch (error: any) {
    console.error('[OrderStatusMappings] Get failed:', error)
    return { success: false, error: error?.message || 'Failed to fetch order status mappings', mappings: {} }
  }
}
