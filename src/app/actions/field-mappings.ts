'use server'

import crypto from 'crypto'

import { revalidatePath } from 'next/cache'

import { getActiveUserId } from '@/lib/auth'
import { decrypt } from '@/lib/crypto'
import { registerOdooWebhook, unregisterOdooWebhook } from '@/lib/odoo-webhook'
import { supabase } from '@/lib/supabase'
import { getOrCreateDbUser as ensureDbUser } from '@/lib/users'

async function getOrCreateDbUser() {
  const userId = await getActiveUserId()
  if (!userId) throw new Error('Unauthorized')
  const dbUser = await ensureDbUser(userId)
  return dbUser
}


export async function getFieldMappings() {
  try {
    const user = await getOrCreateDbUser()
    if (!user.active_workspace_id) {
      return { success: true, mappings: [] }
    }

    const { data: mappings, error } = await supabase
      .from('field_mappings')
      .select('*')
      .eq('workspace_id', user.active_workspace_id)
      .order('created_at', { ascending: false })

    if (error) throw new Error('Failed to query field mappings: ' + error.message)

    return { success: true, mappings: mappings || [] }
  } catch (error: any) {
    console.error('[Field Mapping Action] getFieldMappings failed:', error)
    return { success: false, error: error.message || 'Failed to fetch field mappings' }
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
  odooFallbackPolicy?: 'none' | 'create' | 'block'
  mappings: any
  platform?: 'zid' | 'salla' | 'shopify'
  /** Multi-store: merchant_id (zid/salla) or shop_domain (shopify). Defaults to the newest store. */
  storeKey?: string
  syncDirection?: string
  variantSyncMode?: string
  variantOdooMatchField?: string
  variantZidMatchField?: string
}) {
  try {
    const user = await getOrCreateDbUser()
    if (!user.active_workspace_id) {
      throw new Error('لم يتم تحديد بيئة عمل نشطة (No active workspace selected)')
    }

    if (!data.name || !data.name.trim()) {
      throw new Error('اسم إعداد الربط مطلوب (Field mapping name is required)')
    }

    // Fetch connection info
    const { data: odooConn } = await supabase
      .from('erp_connections')
      .select('*')
      .eq('workspace_id', user.active_workspace_id)
      .maybeSingle()

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

    const isShopify = data.platform === 'shopify' || (data.platform === undefined && (data.action.includes('/') || data.action.startsWith('shopify:')))
    const isSalla = !isShopify && (data.platform === 'salla' || (data.platform === undefined && isSallaEvent(data.action)))

    let merchantId: string
    let storeId: string | null = null
    // Multi-store: explicit storeKey wins, otherwise the newest store.
    const pickByKey = <T,>(rows: T[] | null, match: (r: T) => string): T | null => {
      if (!rows || rows.length === 0) return null
      if (data.storeKey) return rows.find(r => match(r) === String(data.storeKey)) ?? null
      return rows[0]
    }

    if (isShopify) {
      const { data: shopifyToks } = await supabase
        .from('shopify_tokens')
        .select('shop_domain')
        .eq('workspace_id', user.active_workspace_id)
        .order('updated_at', { ascending: false, nullsFirst: false })

      const shopifyTok: any = pickByKey(shopifyToks, r => String((r as any).shop_domain))
      if (!shopifyTok) {
        throw new Error('متجرك في شوبيفاي غير متصل - يرجى ربط شوبيفاي أولاً (Shopify store not connected)')
      }
      merchantId = shopifyTok.shop_domain
    } else if (isSalla) {
      const { data: sallaToks } = await supabase
        .from('salla_tokens')
        .select('merchant_id')
        .eq('workspace_id', user.active_workspace_id)
        .order('updated_at', { ascending: false, nullsFirst: false })

      const sallaTok: any = pickByKey(sallaToks, r => String((r as any).merchant_id))
      if (!sallaTok) {
        throw new Error('متجرك في سلة غير متصل - يرجى ربط سلة أولاً (Salla store not connected)')
      }
      merchantId = sallaTok.merchant_id
    } else {
      const { data: merchantToks } = await supabase
        .from('merchant_tokens')
        .select('merchant_id, store_id')
        .eq('workspace_id', user.active_workspace_id)
        .order('updated_at', { ascending: false, nullsFirst: false })

      const merchantTok: any = pickByKey(merchantToks, r => String((r as any).merchant_id))
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

    // Multi-store: editing a mapping without an explicit storeKey must NOT
    // reassign it to the newest store — preserve the row's own store.
    if (data.id && !data.storeKey) {
      const { data: existing } = await supabase
        .from('field_mappings')
        .select('merchant_id, store_id')
        .eq('id', data.id)
        .eq('workspace_id', user.active_workspace_id)
        .maybeSingle()
      if (existing?.merchant_id) {
        merchantId = existing.merchant_id
        storeId = (existing as { store_id?: string | null }).store_id || null
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
      odoo_fallback_policy: data.odooFallbackPolicy || 'none',
      mappings: data.mappings,
      variant_sync_mode: data.variantSyncMode || 'AS_VARIANTS',
      variant_odoo_match_field: data.variantOdooMatchField || null,
      variant_zid_match_field: data.variantZidMatchField || null,
      sync_direction: syncDirection,
      odoo_webhook_id: odooWebhookId,
      odoo_server_action_id: odooServerActionId,
      updated_at: new Date().toISOString()
    }

    if (data.id) {
      const { error } = await supabase
        .from('field_mappings')
        .update(mappingData)
        .eq('id', data.id)
        .eq('workspace_id', user.active_workspace_id)

      if (error) throw new Error('Failed to update field mapping: ' + error.message)
    } else {
      const { error } = await supabase
        .from('field_mappings')
        .insert([{
          ...mappingData,
          created_at: new Date().toISOString()
        }])

      if (error) throw new Error('Failed to create field mapping: ' + error.message)
    }

    revalidatePath('/app/mapping-center')

    return { success: true }
  } catch (error: any) {
    console.error('[Field Mapping Action] saveFieldMapping failed:', error)
    return { success: false, error: error.message || 'Failed to save field mapping' }
  }
}

export async function deleteFieldMapping(id: string) {
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
      .eq('workspace_id', user.active_workspace_id)
      .maybeSingle()

    if (mapping?.odoo_webhook_id && mapping.erp_connection_id) {
      const { data: odooConn } = await supabase
        .from('erp_connections')
        .select('*')
        .eq('id', mapping.erp_connection_id)
        .maybeSingle()

      if (odooConn) {
        try {
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

    revalidatePath('/app/mapping-center')
    return { success: true }
  } catch (error: any) {
    console.error('[Field Mapping Action] deleteFieldMapping failed:', error)
    return { success: false, error: error.message || 'Failed to delete field mapping' }
  }
}
