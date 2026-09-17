'use server'

import { auth } from '@clerk/nextjs/server'
import { revalidatePath } from 'next/cache'

import { supabase } from '@/lib/supabase'
import { getOrCreateDbUser } from '@/lib/users'

export async function saveStandardMappingSettings(
  storeType: string,
  entityType: string,
  settings: Record<string, any>
) {
  try {
    const { userId } = await auth()
    if (!userId) throw new Error('Unauthorized')

    const user = await getOrCreateDbUser(userId)
    if (!user.active_workspace_id) throw new Error('No active workspace')

    const { data, error } = await supabase
      .from('standard_mapping_settings')
      .upsert({
        workspace_id: user.active_workspace_id,
        store_type: storeType,
        entity_type: entityType,
        settings,
        updated_at: new Date().toISOString(),
      }, {
        onConflict: 'workspace_id, store_type, entity_type',
      })
      .select()
      .single()

    if (error) throw error

    revalidatePath('/dashboard/mapping-center')
    return { success: true, data }
  } catch (error: any) {
    console.error('[StandardMapping] Save failed:', error)
    return { success: false, error: error?.message || 'Failed to save settings' }
  }
}

export async function getStandardMappingSettings(
  storeType: string,
  entityType: string
) {
  try {
    const { userId } = await auth()
    if (!userId) throw new Error('Unauthorized')

    const user = await getOrCreateDbUser(userId)
    if (!user.active_workspace_id) return { success: true, settings: null }

    const { data, error } = await supabase
      .from('standard_mapping_settings')
      .select('settings')
      .eq('workspace_id', user.active_workspace_id)
      .eq('store_type', storeType)
      .eq('entity_type', entityType)
      .maybeSingle()

    if (error) throw error

    return { success: true, settings: data?.settings || null }
  } catch (error: any) {
    console.error('[StandardMapping] Get failed:', error)
    return { success: false, error: error?.message || 'Failed to fetch settings', settings: null }
  }
}
