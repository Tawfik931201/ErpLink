'use server'

import { getActiveUserId } from '@/lib/auth'
import { categoryFields, prepareCategoryValues } from '@/lib/categories/odoo-values'
import { decrypt } from '@/lib/crypto'
import { validateCustomerMatchSettings, type CustomerMatchField } from '@/lib/customers/matching-settings'
import { OdooClient } from '@/lib/odoo-client'
import { assertBomCapability } from '@/lib/products/bom-capability'
import { supabase } from '@/lib/supabase'
import { ttlCache } from '@/lib/ttl-cache'
import { getOrCreateDbUser } from '@/lib/users'

import { getActiveWorkspaceErpConnection } from './odoo'

export async function getCategoryMatchFields() {
  try {
    const result = await getActiveWorkspaceErpConnection()
    if (!result.success || !result.connection) throw new Error('Odoo connection is required')
    const connection = result.connection
    const client = new OdooClient({ url: connection.url, db: connection.db_name || '', username: connection.username, apiKey: decrypt(connection.password) })
    const fields = await categoryFields(client)
    return { success: true, fields: [
      { value: 'id', label: 'ID' },
      ...Object.entries(fields).filter(([name, field]) => name !== 'id' && !field.readonly && ['char', 'text', 'integer', 'float', 'selection'].includes(field.type)).map(([name, field]) => ({ value: name, label: field.string || name })),
    ] }
  } catch (error: any) {
    return { success: false, error: error?.message || 'Cannot read category match fields', fields: [] }
  }
}

// Saved settings barely change while the page is open — memoize reads so tab
// switches, background prefetch and post-save refetch are instant reads,
// not repeated Supabase round trips. Cleared on every successful save.
const TTL_SETTINGS_MS = 30 * 1000

const settingsKey = (workspaceId: string, storeType: string, entityType: string, storeId = '') =>
  `stdsets:${workspaceId}:${storeType}:${storeId}:${entityType}`

export async function saveStandardMappingSettings(
  storeType: string,
  entityType: string,
  settings: Record<string, any>,
  storeId = ''
) {
  try {
    const userId = await getActiveUserId()
    if (!userId) throw new Error('Unauthorized')

    const user = await getOrCreateDbUser(userId)
    if (!user.active_workspace_id) throw new Error('No active workspace')

    if (settings.disabled !== true && (entityType === 'customers' || (entityType === 'products' && settings.bom?.enabled))) {
      const result = await getActiveWorkspaceErpConnection()
      if (!result.success || !result.connection) throw new Error('Odoo connection is required')
      const connection = result.connection
      if (connection.erp_type !== 'erpnext') {
        const client = new OdooClient({ url: connection.url, db: connection.db_name || '', username: connection.username, apiKey: decrypt(connection.password) })
        if (entityType === 'customers') {
          const fields = await client.execute<Record<string, CustomerMatchField>>('res.partner', 'fields_get', [], { attributes: ['type', 'readonly'] })
          validateCustomerMatchSettings(settings, fields)
        } else {
          await assertBomCapability(client, settings.bom.type || 'phantom')
        }
      }
    }

    if (entityType === 'categories') {
      if (!!settings.match_zid_field !== !!settings.match_odoo_field) throw new Error('Select both category match fields')
      const result = await getActiveWorkspaceErpConnection()
      if (!result.success || !result.connection) throw new Error('Odoo connection is required')
      const connection = result.connection
      const client = new OdooClient({ url: connection.url, db: connection.db_name || '', username: connection.username, apiKey: decrypt(connection.password) })
      const fields = await categoryFields(client)
      if (settings.match_odoo_field && settings.match_odoo_field !== 'id') {
        const field = fields[settings.match_odoo_field]
        if (!field || field.readonly || !['char', 'text', 'integer', 'float', 'selection'].includes(field.type)) throw new Error('Unsupported category match field')
      }
      prepareCategoryValues({ ...(settings.costing_method ? { property_cost_method: settings.costing_method } : {}), ...(settings.inventory_valuation ? { property_valuation: settings.inventory_valuation } : {}) }, fields)
    }

    const { data, error } = await supabase
      .from('standard_mapping_settings')
      .upsert({
        workspace_id: user.active_workspace_id,
        store_type: storeType,
        store_id: storeId,
        entity_type: entityType,
        settings,
        updated_at: new Date().toISOString(),
      }, {
        onConflict: 'workspace_id, store_type, store_id, entity_type',
      })
      .select()
      .single()

    if (error) throw error

    // Invalidate memoized reads for this workspace so the UI reflects the
    // just-saved values on the refetch that follows a save.
    ttlCache.clear(`stdsets:${user.active_workspace_id}`)
    ttlCache.clear(`stdsets_all:${user.active_workspace_id}`)
    ttlCache.clear(`eng:stdsets:${user.active_workspace_id}:`)
    ttlCache.clear(`webhook-gate:${user.active_workspace_id}:`)

    return { success: true, data }
  } catch (error: any) {
    console.error('[StandardMapping] Save failed:', error)
    return { success: false, error: error?.message || 'Failed to save settings' }
  }
}


export async function getStandardMappingSettings(
  storeType: string,
  entityType: string,
  storeId = ''
) {
  try {
    const userId = await getActiveUserId()
    if (!userId) throw new Error('Unauthorized')

    const user = await getOrCreateDbUser(userId)
    if (!user.active_workspace_id) return { success: true, settings: null }

    const settings = await ttlCache.get(
      settingsKey(user.active_workspace_id, storeType, entityType, storeId),
      TTL_SETTINGS_MS,
      async () => {
        // Per-store row first, platform default ('') as fallback — so a new
        // store inherits the shared platform settings until it saves its own.
        const { data, error } = await supabase
          .from('standard_mapping_settings')
          .select('store_id, settings')
          .eq('workspace_id', user.active_workspace_id)
          .eq('store_type', storeType)
          .eq('entity_type', entityType)
          .in('store_id', storeId ? [storeId, ''] : [''])

        if (error) throw error

        const rows = (data ?? []) as Array<{ store_id: string; settings: unknown }>
        const hit = rows.find(r => r.store_id === storeId) ?? rows.find(r => r.store_id === '')
        return (hit?.settings || null) as Record<string, any> | null
      }
    )

    return { success: true, settings }
  } catch (error: any) {
    console.error('[StandardMapping] Get failed:', error)
    return { success: false, error: error?.message || 'Failed to fetch settings', settings: null }
  }
}
