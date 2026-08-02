'use server'

import { auth } from '@clerk/nextjs/server'
import { revalidatePath } from 'next/cache'

import { supabase } from '@/lib/supabase'
import { getOrCreateDbUser } from '@/lib/users'

type MappingTable = 'payment_method_mappings' | 'shipping_method_mappings' | 'warehouse_mappings' | 'currency_mappings' | 'tax_mappings' | 'payment_term_mappings' | 'pricelist_mappings'

export async function getStaticMappings(table: MappingTable, platform: string = 'zid') {
  try {
    const { userId } = await auth()
    if (!userId) throw new Error('Unauthorized')

    const user = await getOrCreateDbUser(userId)
    if (!user.active_workspace_id) return { success: true, mappings: [] }

    const { data, error } = await supabase
      .from(table)
      .select('*')
      .eq('workspace_id', user.active_workspace_id)
      .eq('platform', platform)
      .order('created_at', { ascending: false })

    if (error) throw error

    return { success: true, mappings: data || [] }
  } catch (error: any) {
    console.error(`[StaticMappings] Get ${table} failed:`, error)
    return { success: false, error: error?.message || 'Failed to fetch mappings', mappings: [] }
  }
}

export async function saveStaticMapping(table: MappingTable, row: Record<string, any>, platform: string = 'zid') {
  try {
    const { userId } = await auth()
    if (!userId) throw new Error('Unauthorized')

    const user = await getOrCreateDbUser(userId)
    if (!user.active_workspace_id) throw new Error('No active workspace')

    const { id, ...data } = row
    const payload: Record<string, any> = {
      workspace_id: user.active_workspace_id,
      platform,
      ...data,
      updated_at: new Date().toISOString(),
    }

    if (id) {
      payload.id = id
    }

    const { error } = await supabase
      .from(table)
      .upsert(payload, { onConflict: id ? 'id' : undefined })

    if (error) throw error

    revalidatePath('/dashboard/mapping-center')
    return { success: true }
  } catch (error: any) {
    console.error(`[StaticMappings] Save ${table} failed:`, error)
    return { success: false, error: error?.message || 'Failed to save mapping' }
  }
}

export async function deleteStaticMapping(table: MappingTable, id: string) {
  try {
    const { userId } = await auth()
    if (!userId) throw new Error('Unauthorized')

    const user = await getOrCreateDbUser(userId)
    if (!user.active_workspace_id) throw new Error('No active workspace')

    const { error } = await supabase
      .from(table)
      .delete()
      .eq('id', id)
      .eq('workspace_id', user.active_workspace_id)

    if (error) throw error

    revalidatePath('/dashboard/mapping-center')
    return { success: true }
  } catch (error: any) {
    console.error(`[StaticMappings] Delete ${table} failed:`, error)
    return { success: false, error: error?.message || 'Failed to delete mapping' }
  }
}
