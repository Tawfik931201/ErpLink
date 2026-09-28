'use server'

import { getActiveUserId } from '@/lib/auth'
import { supabase } from '@/lib/supabase'
import { ttlCache } from '@/lib/ttl-cache'
import { getOrCreateDbUser } from '@/lib/users'

// Saved settings barely change while the page is open — memoize reads so tab
// switches, background prefetch and post-save refetch are instant reads,
// not repeated Supabase round trips. Cleared on every successful save.
const TTL_SETTINGS_MS = 30 * 1000

const settingsKey = (workspaceId: string, storeType: string, entityType: string) =>
  `stdsets:${workspaceId}:${storeType}:${entityType}`

export async function saveStandardMappingSettings(
  storeType: string,
  entityType: string,
  settings: Record<string, any>
) {
  try {
    const userId = await getActiveUserId()
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

    // Invalidate memoized reads for this workspace so the UI reflects the
    // just-saved values on the refetch that follows a save.
    ttlCache.clear(`stdsets:${user.active_workspace_id}`)
    ttlCache.clear(`stdsets_all:${user.active_workspace_id}`)

    return { success: true, data }
  } catch (error: any) {
    console.error('[StandardMapping] Save failed:', error)
    return { success: false, error: error?.message || 'Failed to save settings' }
  }
}

export interface AllStandardMappingSettings {
  categories: Record<string, any> | null
  products: Record<string, any> | null
  customers: Record<string, any> | null
  orders: Record<string, any> | null
  orderStatusMappings?: Record<string, any> | null
}

/**
 * Fetch all standard mapping settings (categories, products, customers, orders)
 * plus order status mappings for a store in a single fast query.
 */
export async function getAllStandardMappingSettings(storeType: string): Promise<{
  success: boolean
  settings: AllStandardMappingSettings
  error?: string
}> {
  try {
    const userId = await getActiveUserId()
    if (!userId) throw new Error('Unauthorized')

    const user = await getOrCreateDbUser(userId)
    if (!user.active_workspace_id) {
      return {
        success: true,
        settings: { categories: null, products: null, customers: null, orders: null, orderStatusMappings: null },
      }
    }

    const cacheKey = `stdsets_all:${user.active_workspace_id}:${storeType}`
    const result = await ttlCache.get(
      cacheKey,
      TTL_SETTINGS_MS,
      async () => {
        const [settingsRes, statusRes] = await Promise.all([
          supabase
            .from('standard_mapping_settings')
            .select('entity_type, settings')
            .eq('workspace_id', user.active_workspace_id)
            .eq('store_type', storeType),
          supabase
            .from('order_status_mappings')
            .select('zid_status, odoo_state, enabled')
            .eq('workspace_id', user.active_workspace_id)
            .eq('platform', storeType),
        ])

        if (settingsRes.error) throw settingsRes.error

        const statusMappings: Record<string, { state: string; enabled: boolean }> = {}
        for (const row of (statusRes.data || []) as Array<{ zid_status: string; odoo_state: string; enabled?: boolean }>) {
          if (row.zid_status && row.odoo_state) {
            statusMappings[row.zid_status] = {
              state: row.odoo_state,
              enabled: row.enabled !== false,
            }
          }
        }

        const mapped: AllStandardMappingSettings = {
          categories: null,
          products: null,
          customers: null,
          orders: null,
          orderStatusMappings: Object.keys(statusMappings).length > 0 ? statusMappings : null,
        }

        for (const row of settingsRes.data || []) {
          const e = row.entity_type as keyof Omit<AllStandardMappingSettings, 'orderStatusMappings'>
          if (e && (row.settings || null)) {
            mapped[e] = row.settings as Record<string, any>
          }
        }

        return mapped
      }
    )

    return { success: true, settings: result }
  } catch (error: any) {
    console.error('[StandardMapping] GetAll failed:', error)
    return {
      success: false,
      error: error?.message || 'Failed to fetch all settings',
      settings: { categories: null, products: null, customers: null, orders: null, orderStatusMappings: null },
    }
  }
}

export async function getStandardMappingSettings(
  storeType: string,
  entityType: string
) {
  try {
    const userId = await getActiveUserId()
    if (!userId) throw new Error('Unauthorized')

    const user = await getOrCreateDbUser(userId)
    if (!user.active_workspace_id) return { success: true, settings: null }

    const settings = await ttlCache.get(
      settingsKey(user.active_workspace_id, storeType, entityType),
      TTL_SETTINGS_MS,
      async () => {
        const { data, error } = await supabase
          .from('standard_mapping_settings')
          .select('settings')
          .eq('workspace_id', user.active_workspace_id)
          .eq('store_type', storeType)
          .eq('entity_type', entityType)
          .maybeSingle()

        if (error) throw error

        return (data?.settings || null) as Record<string, any> | null
      }
    )

    return { success: true, settings }
  } catch (error: any) {
    console.error('[StandardMapping] Get failed:', error)
    return { success: false, error: error?.message || 'Failed to fetch settings', settings: null }
  }
}
