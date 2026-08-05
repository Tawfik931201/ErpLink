'use server'

import { auth } from '@clerk/nextjs/server'
import { revalidatePath } from 'next/cache'

import { supabase } from '@/lib/supabase'
import { getOrCreateDbUser } from '@/lib/users'

export async function saveOrderStatusMappings(
  platform: string,
  mappings: Record<string, string>
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
    const rows = Object.entries(mappings)
      .filter(([, odooState]) => odooState && String(odooState).trim() !== '')
      .map(([zidStatus, odooState]) => ({
        workspace_id: workspaceId,
        zid_status: zidStatus,
        odoo_state: String(odooState).trim(),
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
      .filter(([, odooState]) => odooState && String(odooState).trim() !== '')
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
      .select('zid_status, odoo_state')
      .eq('workspace_id', user.active_workspace_id)
      .eq('platform', platform)

    if (error) throw error

    const mappings: Record<string, string> = {}
    for (const row of data || []) {
      if (row.odoo_state) mappings[row.zid_status] = row.odoo_state
    }

    return { success: true, mappings }
  } catch (error: any) {
    console.error('[OrderStatusMappings] Get failed:', error)
    return { success: false, error: error?.message || 'Failed to fetch order status mappings', mappings: {} }
  }
}
