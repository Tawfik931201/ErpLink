'use server'

import { auth } from '@clerk/nextjs/server'
import { revalidatePath } from 'next/cache'
import { supabase } from '@/lib/supabase'
import { getOrCreateDbUser as ensureDbUser } from '@/lib/users'

async function getOrCreateDbUser() {
  const { userId } = await auth()
  if (!userId) throw new Error('Unauthorized')
  return ensureDbUser(userId)
}

export async function getFixedMappings() {
  try {
    const user = await getOrCreateDbUser()
    if (!user.active_workspace_id) {
      return { success: true, mappings: [] }
    }

    const { data: mappings, error } = await supabase
      .from('fixed_mappings')
      .select('*')
      .eq('workspace_id', user.active_workspace_id)
      .order('created_at', { ascending: false })

    if (error) throw new Error(error.message)

    return { success: true, mappings: mappings || [] }
  } catch (error: any) {
    console.error('[Fixed Mapping Action] getFixedMappings failed:', error)
    return { success: false, error: error.message || 'Failed to fetch fixed mappings' }
  }
}

export async function saveFixedMapping(data: {
  id?: string
  platform: 'zid' | 'salla'
  odooModel: string
  action: string
  odooField: string
  platformField: string
}) {
  try {
    const user = await getOrCreateDbUser()
    if (!user.active_workspace_id) {
      throw new Error('لم يتم تحديد بيئة عمل نشطة (No active workspace selected)')
    }

    const mappingData = {
      workspace_id: user.active_workspace_id,
      platform: data.platform,
      odoo_model: data.odooModel,
      action: data.action,
      odoo_field: data.odooField,
      platform_field: data.platformField,
      updated_at: new Date().toISOString()
    }

    if (data.id) {
      const { error } = await supabase
        .from('fixed_mappings')
        .update(mappingData)
        .eq('id', data.id)
        .eq('workspace_id', user.active_workspace_id)

      if (error) throw new Error('Failed to update fixed mapping: ' + error.message)
    } else {
      const { error } = await supabase
        .from('fixed_mappings')
        .upsert({
          ...mappingData,
          created_at: new Date().toISOString()
        }, {
          onConflict: 'workspace_id,platform,odoo_model,action'
        })

      if (error) throw new Error('Failed to create/upsert fixed mapping: ' + error.message)
    }

    revalidatePath('/dashboard/field-mapping')
    return { success: true }
  } catch (error: any) {
    console.error('[Fixed Mapping Action] saveFixedMapping failed:', error)
    return { success: false, error: error.message || 'Failed to save fixed mapping' }
  }
}

export async function deleteFixedMapping(id: string) {
  try {
    const user = await getOrCreateDbUser()
    if (!user.active_workspace_id) {
      throw new Error('No active workspace selected')
    }

    const { error } = await supabase
      .from('fixed_mappings')
      .delete()
      .eq('id', id)
      .eq('workspace_id', user.active_workspace_id)

    if (error) throw new Error('Failed to delete fixed mapping: ' + error.message)

    revalidatePath('/dashboard/field-mapping')
    return { success: true }
  } catch (error: any) {
    console.error('[Fixed Mapping Action] deleteFixedMapping failed:', error)
    return { success: false, error: error.message || 'Failed to delete fixed mapping' }
  }
}
