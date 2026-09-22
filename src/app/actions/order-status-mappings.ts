'use server'

import { auth } from '@clerk/nextjs/server'
import { revalidatePath } from 'next/cache'

import { supabase } from '@/lib/supabase'
import { getOrCreateDbUser } from '@/lib/users'

export async function saveOrderStatusMappings(
  platform: string,
  mappings: Record<string, { state: string; enabled: boolean }>
) {
  try {
    const { userId } = await auth()
    if (!userId) throw new Error('Unauthorized')

    const user = await getOrCreateDbUser(userId)
    if (!user.active_workspace_id) throw new Error('No active workspace')

    const workspaceId = user.active_workspace_id

    // Get current mappings first (safe: no data loss if this fails)
    const { data: existing } = await supabase
      .from('order_status_mappings')
      .select('zid_status')
      .eq('workspace_id', workspaceId)
      .eq('platform', platform)

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
      }))

    if (rows.length > 0) {
      const { error: upsertError } = await supabase
        .from('order_status_mappings')
        .upsert(rows, {
          onConflict: 'workspace_id, platform, zid_status',
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
        .in('zid_status', toDelete)

      if (deleteError) throw deleteError
    }

    revalidatePath('/dashboard/mapping-center')
    return { success: true }
  } catch (error: any) {
    console.error('[OrderStatusMappings] Save failed:', error)
    return { success: false, error: error?.message || 'Failed to save order status mappings' }
  }
}

export async function getOrderStatusMappings(platform: string) {
  try {
    const { userId } = await auth()
    if (!userId) throw new Error('Unauthorized')

    const user = await getOrCreateDbUser(userId)
    if (!user.active_workspace_id) return { success: true, mappings: {} }

    const { data, error } = await supabase
      .from('order_status_mappings')
      .select('zid_status, odoo_state, enabled')
      .eq('workspace_id', user.active_workspace_id)
      .eq('platform', platform)

    if (error) throw error

    const mappings: Record<string, { state: string; enabled: boolean }> = {}
    for (const row of data || []) {
      if (row.odoo_state) mappings[row.zid_status] = { state: row.odoo_state, enabled: (row as { enabled?: unknown }).enabled !== false }
    }

    return { success: true, mappings }
  } catch (error: any) {
    console.error('[OrderStatusMappings] Get failed:', error)
    return { success: false, error: error?.message || 'Failed to fetch order status mappings', mappings: {} }
  }
}
