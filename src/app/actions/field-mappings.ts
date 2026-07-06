'use server'

import { auth } from '@clerk/nextjs/server'
import { revalidatePath } from 'next/cache'
import { supabase } from '@/lib/supabase'
import { getOrCreateDbUser as ensureDbUser } from '@/lib/users'
import { decrypt } from '@/lib/crypto'
import { registerOdooWebhook, unregisterOdooWebhook } from '@/lib/odoo-webhook'
import crypto from 'crypto'

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
  platform?: 'zid' | 'salla'
  syncDirection?: string
}) {
  console.log('[saveFieldMapping] Started action with parameters:', {
    id: data.id,
    name: data.name,
    action: data.action,
    odooModel: data.odooModel,
    odooOperation: data.odooOperation || 'create',
    odooMatchField: data.odooMatchField || '',
    zidMatchField: data.zidMatchField || '',
    platform: data.platform || 'auto',
    syncDirection: data.syncDirection || 'store_to_erp',
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

    // Fetch connection info
    console.log('[saveFieldMapping] Querying erp_connections...')
    const { data: odooConn } = await supabase
      .from('erp_connections')
      .select('*')
      .eq('workspace_id', user.active_workspace_id)
      .maybeSingle()
    console.log('[saveFieldMapping] odooConn resolved:', odooConn?.id || 'none')

    const isSallaEvent = (action: string) => {
      // Detect Salla events by their prefix patterns (all events specific to Salla)
      return (
        action.startsWith('product.') ||
        action.startsWith('order.') ||
        action.startsWith('customer.') ||
        action.startsWith('category.') ||
        action.startsWith('store.branch.') ||
        action.startsWith('store.settings.') ||
        action.startsWith('abandoned.cart') ||
        action.startsWith('coupon.') ||
        action.startsWith('brand.') ||
        action.startsWith('special.offer.') ||
        action.startsWith('app.')
      )
    }

    const isSalla = data.platform === 'salla' || (data.platform === undefined && isSallaEvent(data.action))

    let merchantId: string
    let storeId: string | null = null

    if (isSalla) {
      console.log('[saveFieldMapping] Querying salla_tokens...')
      const { data: sallaTok } = await supabase
        .from('salla_tokens')
        .select('merchant_id')
        .eq('workspace_id', user.active_workspace_id)
        .maybeSingle()
      console.log('[saveFieldMapping] sallaTok resolved:', sallaTok ? { merchant_id: sallaTok.merchant_id } : 'none')

      if (!sallaTok) {
        throw new Error('متجرك في سلة غير متصل - يرجى ربط سلة أولاً (Salla store not connected)')
      }
      merchantId = sallaTok.merchant_id
    } else {
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
      merchantId = merchantTok.merchant_id
      storeId = merchantTok.store_id || null
    }

    // Generate mapping ID beforehand if new, so we can pass it to Odoo webhook config
    const mappingId = data.id || crypto.randomUUID()

    let odooWebhookId: number | null = null
    let odooServerActionId: number | null = null

    // Register Webhook / Automated Action in Odoo if sync direction contains ERP -> Store
    const syncDirection = data.syncDirection || 'store_to_erp'
    const hasErpToStore = syncDirection.split(',').map(s => s.trim()).includes('erp_to_store')
    if (hasErpToStore && odooConn) {
      // If we are editing, unregister the old one first
      if (data.id) {
        const { data: oldMapping } = await supabase
          .from('field_mappings')
          .select('odoo_webhook_id, odoo_server_action_id')
          .eq('id', data.id)
          .maybeSingle()

        if (oldMapping?.odoo_webhook_id) {
          try {
            console.log('[saveFieldMapping] Unregistering old Odoo Webhook...')
            const decryptedPassword = decrypt(odooConn.password)
            await unregisterOdooWebhook(
              {
                url: odooConn.url,
                db: odooConn.db_name || '',
                username: odooConn.username,
                apiKey: decryptedPassword,
              },
              oldMapping.odoo_webhook_id,
              oldMapping.odoo_server_action_id || undefined
            )
          } catch (err) {
            console.error('[saveFieldMapping] Failed to unregister old webhook in Odoo:', err)
          }
        }
      }

      try {
        console.log('[saveFieldMapping] Registering new Webhook in Odoo...')
        const decryptedPassword = decrypt(odooConn.password)
        
        // Build unique field names to track (mapped lines + match field)
        const modelMappings = data.mappings?.[data.odooModel] || []
        const fieldNames = Array.from(new Set([
          ...modelMappings.map((m: any) => m.erpField),
          ...(data.odooMatchField ? [data.odooMatchField] : [])
        ])).filter(Boolean)

        const webhookResult = await registerOdooWebhook(
          {
            url: odooConn.url,
            db: odooConn.db_name || '',
            username: odooConn.username,
            apiKey: decryptedPassword,
          },
          data.odooModel,
          mappingId,
          fieldNames
        )
        odooWebhookId = webhookResult.baseAutomationId
        odooServerActionId = webhookResult.serverActionId || null
      } catch (err: any) {
        console.error('[saveFieldMapping] Failed to register webhook in Odoo:', err)
        throw new Error(`فشل ربط وتفعيل المزامنة التلقائية في أودو: ${err.message}`)
      }
    }

    const mappingData = {
      id: mappingId,
      name: data.name.trim(),
      workspace_id: user.active_workspace_id,
      erp_connection_id: odooConn?.id || null,
      merchant_id: merchantId,
      store_id: storeId,
      action: data.action,
      odoo_model: data.odooModel,
      odoo_operation: data.odooOperation || 'create',
      odoo_match_field: data.odooMatchField || null,
      zid_match_field: data.zidMatchField || null,
      mappings: data.mappings,
      sync_direction: syncDirection,
      odoo_webhook_id: odooWebhookId,
      odoo_server_action_id: odooServerActionId,
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

    // Fetch mapping details to unregister webhook from Odoo
    const { data: mapping } = await supabase
      .from('field_mappings')
      .select('odoo_webhook_id, odoo_server_action_id, erp_connection_id')
      .eq('id', id)
      .maybeSingle()

    if (mapping?.odoo_webhook_id && mapping.erp_connection_id) {
      const { data: odooConn } = await supabase
        .from('erp_connections')
        .select('*')
        .eq('id', mapping.erp_connection_id)
        .maybeSingle()

      if (odooConn) {
        try {
          console.log('[deleteFieldMapping] Unregistering webhook from Odoo...')
          const decryptedPassword = decrypt(odooConn.password)
          await unregisterOdooWebhook(
            {
              url: odooConn.url,
              db: odooConn.db_name || '',
              username: odooConn.username,
              apiKey: decryptedPassword,
            },
            mapping.odoo_webhook_id,
            mapping.odoo_server_action_id || undefined
          )
        } catch (err) {
          console.error('[deleteFieldMapping] Failed to unregister webhook from Odoo:', err)
        }
      }
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
