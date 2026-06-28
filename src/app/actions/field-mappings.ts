'use server'

import { auth } from '@clerk/nextjs/server'
import { revalidatePath } from 'next/cache'
import { supabase } from '@/lib/supabase'
import { getOrCreateDbUser as ensureDbUser } from '@/lib/users'

async function getOrCreateDbUser() {
  console.log('[getFieldMappings/saveFieldMapping] Calling Clerk auth()...')
  const { userId } = await auth()
  console.log('[getFieldMappings/saveFieldMapping] Clerk userId:', userId)
  if (!userId) throw new Error('Unauthorized')
  
  console.log('[getFieldMappings/saveFieldMapping] Calling ensureDbUser...')
  const dbUser = await ensureDbUser(userId)
  console.log('[getFieldMappings/saveFieldMapping] dbUser resolved with active_workspace_id:', dbUser?.active_workspace_id)
  return dbUser
}

export async function getFieldMappings() {
  try {
    const user = await getOrCreateDbUser()
    if (!user.active_workspace_id) {
      return { success: true, mappings: [] }
    }

    console.log('[getFieldMappings] Fetching all mappings from Supabase...')
    const { data: mappings, error } = await supabase
      .from('field_mappings')
      .select('*')
      .eq('workspace_id', user.active_workspace_id)
      .order('created_at', { ascending: false })

    if (error) throw new Error('Failed to query field mappings: ' + error.message)
    console.log('[getFieldMappings] Successfully fetched mappings count:', mappings?.length || 0)

    return { success: true, mappings: mappings || [] }
  } catch (error: any) {
    console.error('[Field Mapping Action] getFieldMappings failed:', error)
    return { success: false, error: error.message || 'Failed to fetch field mappings' }
  }
}

export async function getFieldMappingById(id: string) {
  try {
    const user = await getOrCreateDbUser()
    if (!user.active_workspace_id) {
      return { success: false, error: 'No active workspace selected' }
    }

    console.log('[getFieldMappingById] Fetching single mapping by ID:', id)
    const { data: mapping, error } = await supabase
      .from('field_mappings')
      .select('*')
      .eq('id', id)
      .eq('workspace_id', user.active_workspace_id)
      .maybeSingle()

    if (error) throw new Error('Failed to query field mapping: ' + error.message)
    if (!mapping) return { success: false, error: 'Field mapping not found' }

    return { success: true, mapping }
  } catch (error: any) {
    console.error('[Field Mapping Action] getFieldMappingById failed:', error)
    return { success: false, error: error.message || 'Failed to fetch field mapping' }
  }
}

export async function saveFieldMapping(data: {
  id?: string
  name: string
  action: string
  odooModel: string
  odooOperation?: 'create' | 'update' | 'delete'
  odooMatchField?: string
  zidMatchField?: string
  mappings: any
}) {
  console.log('[saveFieldMapping] Started action with parameters:', {
    id: data.id,
    name: data.name,
    action: data.action,
    odooModel: data.odooModel,
    odooOperation: data.odooOperation || 'create',
    odooMatchField: data.odooMatchField || '',
    zidMatchField: data.zidMatchField || '',
    mappingsCount: data.mappings ? Object.keys(data.mappings).length : 0
  })

  try {
    const user = await getOrCreateDbUser()
    if (!user.active_workspace_id) {
      throw new Error('لم يتم تحديد بيئة عمل نشطة (No active workspace selected)')
    }

    if (!data.name || !data.name.trim()) {
      throw new Error('اسم إعداد الربط مطلوب (Field mapping name is required)')
    }

    // Fetch connection and merchant info
    console.log('[saveFieldMapping] Querying odoo_connections...')
    const { data: odooConn } = await supabase
      .from('odoo_connections')
      .select('id')
      .eq('workspace_id', user.active_workspace_id)
      .maybeSingle()
    console.log('[saveFieldMapping] odooConn resolved:', odooConn?.id || 'none')

    console.log('[saveFieldMapping] Querying merchant_tokens...')
    const { data: merchantTok } = await supabase
      .from('merchant_tokens')
      .select('merchant_id, store_id')
      .eq('workspace_id', user.active_workspace_id)
      .maybeSingle()
    console.log('[saveFieldMapping] merchantTok resolved:', merchantTok ? { merchant_id: merchantTok.merchant_id, store_id: merchantTok.store_id } : 'none')

    if (!merchantTok) {
      throw new Error('متجرك في زد غير متصل - يرجى ربط زد أولاً (Zid store not connected)')
    }

    const mappingData = {
      name: data.name.trim(),
      workspace_id: user.active_workspace_id,
      odoo_connection_id: odooConn?.id || null,
      merchant_id: merchantTok.merchant_id,
      store_id: merchantTok.store_id || null,
      action: data.action,
      odoo_model: data.odooModel,
      odoo_operation: data.odooOperation || 'create',
      odoo_match_field: data.odooMatchField || null,
      zid_match_field: data.zidMatchField || null,
      mappings: data.mappings,
      updated_at: new Date().toISOString()
    }

    if (data.id) {
      console.log('[saveFieldMapping] Updating existing mapping ID:', data.id)
      const { error } = await supabase
        .from('field_mappings')
        .update(mappingData)
        .eq('id', data.id)
        .eq('workspace_id', user.active_workspace_id)

      if (error) throw new Error('Failed to update field mapping: ' + error.message)
      console.log('[saveFieldMapping] Update completed successfully.')
    } else {
      console.log('[saveFieldMapping] Inserting new field mapping...')
      const { error } = await supabase
        .from('field_mappings')
        .insert([{
          ...mappingData,
          created_at: new Date().toISOString()
        }])

      if (error) throw new Error('Failed to create field mapping: ' + error.message)
      console.log('[saveFieldMapping] Insert completed successfully.')
    }

    console.log('[saveFieldMapping] Revalidating path /dashboard/field-mapping...')
    revalidatePath('/dashboard/field-mapping')
    console.log('[saveFieldMapping] Revalidation complete.')

    return { success: true }
  } catch (error: any) {
    console.error('[Field Mapping Action] saveFieldMapping failed:', error)
    return { success: false, error: error.message || 'Failed to save field mapping' }
  }
}

export async function deleteFieldMapping(id: string) {
  console.log('[deleteFieldMapping] Deleting mapping ID:', id)
  try {
    const user = await getOrCreateDbUser()
    if (!user.active_workspace_id) {
      throw new Error('No active workspace selected')
    }

    const { error } = await supabase
      .from('field_mappings')
      .delete()
      .eq('id', id)
      .eq('workspace_id', user.active_workspace_id)

    if (error) throw new Error('Failed to delete field mapping: ' + error.message)
    console.log('[deleteFieldMapping] Delete completed successfully.')

    revalidatePath('/dashboard/field-mapping')
    return { success: true }
  } catch (error: any) {
    console.error('[Field Mapping Action] deleteFieldMapping failed:', error)
    return { success: false, error: error.message || 'Failed to delete field mapping' }
  }
}
