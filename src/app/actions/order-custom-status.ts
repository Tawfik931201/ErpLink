'use server'

import { auth } from '@clerk/nextjs/server'
import { revalidatePath, revalidateTag } from 'next/cache'

import { decrypt } from '@/lib/crypto'
import { OdooClient } from '@/lib/odoo-client'
import { DEFAULT_ZID_ORDER_STATUSES, type ZidStatusOption } from '@/lib/order-custom-status-constants'
import { supabase } from '@/lib/supabase'
import { ttlCache } from '@/lib/ttl-cache'
import { getOrCreateDbUser } from '@/lib/users'
import { getAccessToken } from '@/lib/zid/token'
import { ZidAPI } from '@/lib/zid-client'

/**
 * Fetch Zid order statuses — queries the Zid custom-statuses API if connected,
 * otherwise returns the standard predefined list.
 */
export async function getZidOrderStatuses(force = false): Promise<{
  success: boolean
  statuses: ZidStatusOption[]
  source: 'zid_api' | 'default'
  error?: string
}> {
  try {
    const { userId } = await auth()
    if (!userId) throw new Error('Unauthorized')
    const user = await getOrCreateDbUser(userId)
    if (!user.active_workspace_id) throw new Error('No active workspace')

    const cacheKey = `zid:order-statuses:${user.active_workspace_id}`
    if (force) ttlCache.delete(cacheKey)

    const cached = await ttlCache.get<{ statuses: ZidStatusOption[]; source: 'zid_api' | 'default' } | null>(
      cacheKey,
      5 * 60 * 1000,
      async () => {
        // Try fetching live from Zid API
        const { data: merchantTok } = await supabase
          .from('merchant_tokens')
          .select('*')
          .eq('workspace_id', user.active_workspace_id)
          .maybeSingle()

        if (!merchantTok) {
          return { statuses: DEFAULT_ZID_ORDER_STATUSES, source: 'default' }
        }

        try {
          const tokenData = await getAccessToken(merchantTok.merchant_id)
          const zidCreds = {
            authorization: tokenData.authorization || '',
            managerToken: tokenData.accessToken,
            storeId: merchantTok.store_id || undefined,
          }

          const rawList = await ZidAPI.storeMeta.orderStatuses(zidCreds)
          if (!rawList || !Array.isArray(rawList) || rawList.length === 0) {
            return { statuses: DEFAULT_ZID_ORDER_STATUSES, source: 'default' }
          }

          // Build unique statuses list starting with defaults
          const statusMap = new Map<string, string>()
          for (const def of DEFAULT_ZID_ORDER_STATUSES) {
            statusMap.set(def.key, def.label)
          }

          // Merge live main statuses & sub_statuses from Zid
          for (const item of rawList) {
            const code = String(item.code || '').trim()
            const name = String(item.status || item.name || '').trim()
            if (code) {
              const label = name ? `${name} (${code})` : code
              statusMap.set(code, label)
            }
            if (Array.isArray(item.sub_statuses)) {
              for (const sub of item.sub_statuses) {
                const subCode = String(sub.code || '').trim()
                const subNameAr = sub.name?.ar || sub.name?.en || sub.name || ''
                if (subCode) {
                  const subLabel = subNameAr ? `${subNameAr} (${subCode})` : subCode
                  statusMap.set(subCode, subLabel)
                }
              }
            }
          }

          const statuses: ZidStatusOption[] = Array.from(statusMap.entries()).map(([key, label]) => ({
            key,
            label,
          }))

          return { statuses, source: 'zid_api' }
        } catch (apiErr) {
          console.warn('[order-custom-status] Live Zid statuses fetch failed, using defaults:', apiErr)
          return { statuses: DEFAULT_ZID_ORDER_STATUSES, source: 'default' }
        }
      }
    )

    return {
      success: true,
      statuses: cached?.statuses || DEFAULT_ZID_ORDER_STATUSES,
      source: cached?.source || 'default',
    }
  } catch (err: any) {
    console.error('[getZidOrderStatuses] Error:', err)
    return {
      success: true,
      statuses: DEFAULT_ZID_ORDER_STATUSES,
      source: 'default',
    }
  }
}

async function getOdooClientForWorkspace() {
  const { userId } = await auth()
  if (!userId) throw new Error('Unauthorized')
  const user = await getOrCreateDbUser(userId)
  if (!user.active_workspace_id) throw new Error('No active workspace selected')

  const { data: conn } = await supabase
    .from('erp_connections')
    .select('*')
    .eq('workspace_id', user.active_workspace_id)
    .maybeSingle()

  if (!conn) throw new Error('Odoo connection not found. Please connect to Odoo first.')
  if (conn.erp_type && conn.erp_type !== 'odoo') {
    throw new Error('إنشاء الحقول المخصصة لحالة الطلب متاح حالياً لنظام أودو (Supported for Odoo only)')
  }

  const client = new OdooClient({
    url: conn.url,
    db: conn.db_name || '',
    username: conn.username,
    apiKey: decrypt(conn.password),
  })

  return { client, workspaceId: user.active_workspace_id, connectionId: conn.id }
}

/**
 * Creates or updates the Selection field `x_zid_order_status` on `sale.order` in Odoo.
 * Injects it into the sale.order form view, saves settings in standard_mapping_settings,
 * and clears cache so it reflects immediately in UI dropdowns.
 */
export async function createZidOrderStatusFieldInOdoo(customFieldName = 'x_zid_order_status'): Promise<{
  success: boolean
  fieldName?: string
  fieldLabel?: string
  options?: ZidStatusOption[]
  viewWarning?: string | null
  error?: string
}> {
  try {
    const { client, workspaceId, connectionId } = await getOdooClientForWorkspace()

    // 1. Get the list of statuses
    const statusesRes = await getZidOrderStatuses(true)
    const options = statusesRes.statuses

    const fieldLabel = 'حالة الطلب في زد'
    const fieldName = customFieldName.startsWith('x_') ? customFieldName : `x_${customFieldName}`

    // 2. Find model_id for sale.order
    const modelRecords = await client.execute<Array<{ id: number; model: string; name: string }>>(
      'ir.model',
      'search_read',
      [[['model', '=', 'sale.order']]],
      { fields: ['id', 'model', 'name'], limit: 1 }
    )

    if (!modelRecords || modelRecords.length === 0) {
      throw new Error('Model "sale.order" not found in Odoo')
    }
    const modelId = modelRecords[0].id

    // Format selection string for Odoo: [('key1', 'label1'), ('key2', 'label2')]
    const selStr = options
      .map(opt => `('${opt.key.replace(/'/g, "\\'")}', '${opt.label.replace(/'/g, "\\'")}')`)
      .join(', ')
    const selectionVal = `[${selStr}]`

    // 3. Check if field already exists in ir.model.fields
    const existing = await client.execute<Array<{ id: number; name: string; ttype: string }>>(
      'ir.model.fields',
      'search_read',
      [[['model_id', '=', modelId], ['name', '=', fieldName]]],
      { fields: ['id', 'name', 'ttype', 'field_description', 'selection'], limit: 1 }
    )

    let odooFieldId: number
    if (existing && existing.length > 0) {
      odooFieldId = existing[0].id
      console.log(`[order-custom-status] Field "${fieldName}" already exists in Odoo (id=${odooFieldId}). Updating selection options...`)
      try {
        await client.write('ir.model.fields', [odooFieldId], {
          selection: selectionVal,
          field_description: fieldLabel,
        })
      } catch (writeErr: any) {
        console.warn('[order-custom-status] Failed to update selection string on existing field (non-critical):', writeErr?.message)
      }
    } else {
      console.log(`[order-custom-status] Creating field "${fieldName}" in ir.model.fields for sale.order...`)
      odooFieldId = await client.create('ir.model.fields', {
        name: fieldName,
        field_description: fieldLabel,
        model_id: modelId,
        ttype: 'selection',
        selection: selectionVal,
        store: true,
        tracking: true,
        readonly: false,
        required: false,
        copied: true,
        help: 'حالة الطلب المستلمة من زد (Zid Order Status)',
      })
      console.log(`[order-custom-status] Field created in Odoo (id=${odooFieldId})`)
    }

    // 4. Inject into sale.order form view
    let viewWarning: string | null = null
    try {
      // Inject view using the established robust injector by attempting injection
      const baseViews = await client.execute<Array<{ id: number; name: string; priority: number }>>(
        'ir.ui.view',
        'search_read',
        [[['model', '=', 'sale.order'], ['type', '=', 'form'], ['inherit_id', '=', false]]],
        { fields: ['id', 'name', 'priority'], limit: 1, order: 'priority asc, id asc' }
      )
      const baseView = baseViews?.[0]
      if (baseView) {
        const viewName = `erplink_sale_order_${fieldName}_form`
        const viewExists = await client.execute<Array<{ id: number }>>(
          'ir.ui.view',
          'search_read',
          [[['name', '=', viewName], ['model', '=', 'sale.order']]],
          { fields: ['id'], limit: 1 }
        )
        if (!viewExists || viewExists.length === 0) {
          const archAttempts = [
            `<data><xpath expr="//group[@name='erp_link_group']" position="inside"><field name="${fieldName}" string="${fieldLabel}"/></xpath></data>`,
            `<data><xpath expr="//sheet" position="inside"><group name="erp_link_group" string="ERP Link"><field name="${fieldName}" string="${fieldLabel}"/></group></xpath></data>`,
            `<data><xpath expr="//sheet//group[last()]" position="after"><group name="erp_link_group" string="ERP Link"><field name="${fieldName}" string="${fieldLabel}"/></group></xpath></data>`,
            `<data><xpath expr="//notebook" position="before"><group name="erp_link_group" string="ERP Link"><field name="${fieldName}" string="${fieldLabel}"/></group></xpath></data>`,
            `<data><xpath expr="//field[@name='partner_id']" position="after"><field name="${fieldName}" string="${fieldLabel}"/></data>`,
          ]
          for (let i = 0; i < archAttempts.length; i++) {
            try {
              await client.create('ir.ui.view', {
                name: viewName,
                model: 'sale.order',
                inherit_id: baseView.id,
                arch_base: archAttempts[i],
                mode: 'extension',
                type: 'form',
                priority: 99,
                active: true,
              })
              console.log(`[order-custom-status] Form view extension injected successfully (attempt ${i + 1})`)
              break
            } catch (vErr: any) {
              console.warn(`[order-custom-status] Form view attempt ${i + 1} failed:`, vErr?.message)
            }
          }
        }
      }
    } catch (vErr: any) {
      console.warn('[order-custom-status] Non-critical view injection error:', vErr?.message)
      viewWarning = vErr?.message || null
    }

    // 5. Store / update custom field record in Supabase custom_odoo_fields
    try {
      await supabase.from('custom_odoo_fields').upsert({
        workspace_id: workspaceId,
        odoo_field_id: odooFieldId,
        field_name: fieldName,
        field_label: fieldLabel,
        odoo_model: 'sale.order',
        field_type: 'selection',
        views: 'form',
        properties: {
          readonly: false,
          required: false,
          copy: true,
          selection_options: options,
        },
        created_at: new Date().toISOString(),
      }, { onConflict: 'workspace_id, odoo_model, field_name' as any })
    } catch (supaErr) {
      console.warn('[order-custom-status] Supabase custom_odoo_fields upsert non-critical error:', supaErr)
    }

    // 6. Update standard_mapping_settings for orders to activate this field
    try {
      const { data: existingRow } = await supabase
        .from('standard_mapping_settings')
        .select('settings')
        .eq('workspace_id', workspaceId)
        .eq('store_type', 'zid')
        .eq('entity_type', 'orders')
        .maybeSingle()

      const updatedSettings = {
        ...(existingRow?.settings || {}),
        update_custom_status_field: true,
        order_status_custom_field: fieldName,
      }

      await supabase.from('standard_mapping_settings').upsert({
        workspace_id: workspaceId,
        store_type: 'zid',
        entity_type: 'orders',
        settings: updatedSettings,
        updated_at: new Date().toISOString(),
      }, { onConflict: 'workspace_id, store_type, entity_type' })

      console.info(`[order-custom-status] Enabled custom status sync for Zid orders -> ${fieldName}`)
    } catch (setErr) {
      console.warn('[order-custom-status] Failed to update standard_mapping_settings:', setErr)
    }

    // 7. Clear caches so field immediately shows in dropdowns and settings reflect
    ttlCache.clear(`odoo:fields:${connectionId}`)
    ttlCache.clear(`stdsets:${workspaceId}`)
    ttlCache.clear(`stdsets_all:${workspaceId}`)
    try {
      revalidateTag('odoo-fields')
      revalidateTag('odoo-model-fields')
    } catch {}

    revalidatePath('/app/mapping-center')
    revalidatePath('/app/mapping-center')

    return {
      success: true,
      fieldName,
      fieldLabel,
      options,
      viewWarning,
    }
  } catch (error: any) {
    console.error('[createZidOrderStatusFieldInOdoo] Failed:', error)
    return {
      success: false,
      error: error?.message || 'Failed to create order status field in Odoo',
    }
  }
}

/**
 * Checks if the custom order status field exists on `sale.order` in Odoo.
 */
export async function checkZidOrderStatusField(fieldName = 'x_zid_order_status'): Promise<{
  exists: boolean
  fieldName: string
  fieldLabel?: string
  options?: ZidStatusOption[]
  error?: string
}> {
  try {
    const { client } = await getOdooClientForWorkspace()
    const targetName = fieldName.startsWith('x_') ? fieldName : `x_${fieldName}`

    const modelRecords = await client.execute<Array<{ id: number }>>(
      'ir.model',
      'search_read',
      [[['model', '=', 'sale.order']]],
      { fields: ['id'], limit: 1 }
    )
    if (!modelRecords || modelRecords.length === 0) {
      return { exists: false, fieldName: targetName }
    }

    const fieldRecs = await client.execute<Array<{ id: number; name: string; field_description: string; selection: string }>>(
      'ir.model.fields',
      'search_read',
      [[['model_id', '=', modelRecords[0].id], ['name', '=', targetName]]],
      { fields: ['id', 'name', 'field_description', 'selection'], limit: 1 }
    )

    if (fieldRecs && fieldRecs.length > 0) {
      const f = fieldRecs[0]
      // Try parsing selection options
      const parsedOptions: ZidStatusOption[] = []
      try {
        if (f.selection) {
          // Eval safely or parse python tuples [('key', 'label'), ...]
          const regex = /\('([^']+)',\s*'([^']+)'\)/g
          let match
          while ((match = regex.exec(f.selection)) !== null) {
            parsedOptions.push({ key: match[1], label: match[2] })
          }
        }
      } catch {}

      return {
        exists: true,
        fieldName: f.name,
        fieldLabel: f.field_description,
        options: parsedOptions.length > 0 ? parsedOptions : DEFAULT_ZID_ORDER_STATUSES,
      }
    }

    return { exists: false, fieldName: targetName }
  } catch (err: any) {
    return { exists: false, fieldName, error: err?.message }
  }
}
