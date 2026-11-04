'use server'

import { revalidatePath } from 'next/cache'

import { getActiveUserId } from '@/lib/auth'
import { supabase } from '@/lib/supabase'
import { ttlCache } from '@/lib/ttl-cache'
import { getOrCreateDbUser } from '@/lib/users'

export async function saveOrderStatusMappings(
  platform: string,
  mappings: Record<string, { state: string; enabled: boolean; invoice_action?: string; picking_action?: string } | string>,
  storeId = ''
) {
  try {
    const userId = await getActiveUserId()
    if (!userId) throw new Error('Unauthorized')

    const user = await getOrCreateDbUser(userId)
    if (!user.active_workspace_id) throw new Error('No active workspace')

    const workspaceId = user.active_workspace_id

    // Get current mappings first (safe: no data loss if this fails) —
    // scoped to this store so sibling stores' rows are never touched.
    const { data: existing, error: existingError } = await supabase
      .from('order_status_mappings')
      .select('zid_status')
      .eq('workspace_id', workspaceId)
      .eq('platform', platform)
      .eq('store_id', storeId)

    if (existingError) throw existingError

    // Upsert new/changed mappings (safe: old data preserved if this fails)
    // Accepts the object shape { state, enabled, invoice_action, picking_action }; legacy plain-string values
    // are tolerated and treated as enabled.
    const stateOf = (v: unknown): string => {
      const s = typeof v === 'string' ? v : (v as { state?: unknown } | null)?.state
      return String(s || '').trim()
    }
    const pickingActionOf = (v: unknown): string | null => {
      if (!v || typeof v !== 'object') return null
      const a = (v as { picking_action?: unknown }).picking_action
      return a ? String(a).trim() || null : null
    }
    const invoiceActionOf = (v: unknown): string | null => {
      if (!v || typeof v !== 'object') return null
      const a = (v as { invoice_action?: unknown }).invoice_action
      return a ? String(a).trim() || null : null
    }

    const rows = Object.entries(mappings)
      .filter(([, v]) => stateOf(v) !== '' || pickingActionOf(v) !== null || invoiceActionOf(v) !== null)
      .map(([zidStatus, v]) => ({
        workspace_id: workspaceId,
        zid_status: zidStatus,
        odoo_state: stateOf(v) || 'draft',
        enabled: typeof v === 'string' ? true : ((v as { enabled?: unknown } | null)?.enabled ?? true),
        platform,
        store_id: storeId,
        picking_action: pickingActionOf(v),
        invoice_action: invoiceActionOf(v),
      }))

    let requiresJsonActions = false
    if (rows.length > 0) {
      let { error: upsertError } = await supabase
        .from('order_status_mappings')
        .upsert(rows, {
          onConflict: 'workspace_id, platform, store_id, zid_status',
        })

      // Graceful fallback for pre-migration database without invoice_action / picking_action columns
      if (
        upsertError &&
        (upsertError.message?.includes('picking_action') ||
          upsertError.message?.includes('invoice_action') ||
          (upsertError as any).code === '42703')
      ) {
        requiresJsonActions = true
        console.warn('[OrderStatusMappings] Columns picking_action/invoice_action not found in DB, falling back to basic columns')
        const fallbackRows = rows.map(({ picking_action: _p, invoice_action: _i, ...rest }) => rest)
        const res = await supabase
          .from('order_status_mappings')
          .upsert(fallbackRows, {
            onConflict: 'workspace_id, platform, store_id, zid_status',
          })
        upsertError = res.error
      }

      if (upsertError) throw upsertError
    }

    // Delete mappings no longer in the new set (safe: if this fails, stale rows remain harmlessly)
    const newStatuses = Object.entries(mappings)
      .filter(([, v]) => {
        const s = typeof v === 'string' ? v : (v as { state?: unknown } | null)?.state
        const p = pickingActionOf(v)
        const i = invoiceActionOf(v)
        return (s && String(s).trim() !== '') || p !== null || i !== null
      })
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
        .eq('store_id', storeId)
        .in('zid_status', toDelete)

      if (deleteError) throw deleteError
    }

    // Persist status_actions into standard_mapping_settings JSONB as dual storage (zero-migration guarantee)
    try {
      const { data: stdRows, error: readError } = await supabase
        .from('standard_mapping_settings')
        .select('settings, store_id')
        .eq('workspace_id', workspaceId)
        .eq('store_type', platform)
        .in('store_id', storeId ? [storeId, ''] : [''])
        .eq('entity_type', 'orders')

      if (readError) throw readError
      const stdRow = stdRows?.find(row => row.store_id === storeId) ?? stdRows?.find(row => row.store_id === '')
      const currentSettings = stdRow?.settings && typeof stdRow.settings === 'object' ? stdRow.settings : {}
      const orderConfig = currentSettings.order && typeof currentSettings.order === 'object' ? currentSettings.order : {}
      const updatedSettings = {
        ...currentSettings,
        order: {
          ...orderConfig,
          status_actions: mappings,
        },
      }
      const { error: jsonError } = await supabase
        .from('standard_mapping_settings')
        .upsert({
          workspace_id: workspaceId,
          store_type: platform,
          store_id: storeId,
          entity_type: 'orders',
          settings: updatedSettings,
          updated_at: new Date().toISOString(),
        }, {
          onConflict: 'workspace_id, store_type, store_id, entity_type',
        })
      if (jsonError) throw jsonError
    } catch (stdErr) {
      if (requiresJsonActions) throw stdErr
      console.warn('[OrderStatusMappings] Non-fatal: failed to dual-save status_actions to standard_mapping_settings:', stdErr)
    }

    ttlCache.clear(`stdsets:${workspaceId}:`)
    ttlCache.clear(`stdsets_all:${workspaceId}:`)
    ttlCache.clear(`eng:stdsets:${workspaceId}:`)
    ttlCache.clear(`webhook-gate:${workspaceId}:`)
    revalidatePath('/app/mapping-center')
    return { success: true }
  } catch (error: any) {
    console.error('[OrderStatusMappings] Save failed:', error)
    return { success: false, error: error?.message || 'Failed to save order status mappings' }
  }
}

export async function getOrderStatusMappings(platform: string, storeId = '') {
  try {
    const userId = await getActiveUserId()
    if (!userId) throw new Error('Unauthorized')

    const user = await getOrCreateDbUser(userId)
    if (!user.active_workspace_id) return { success: true, mappings: {} }

    // Per-store rows overlay the platform defaults (''): a store inherits
    // everything it has not overridden.
    let data: any[] | null = null
    let legacyActions = false
    const res = await supabase
      .from('order_status_mappings')
      .select('zid_status, odoo_state, enabled, store_id, invoice_action, picking_action')
      .eq('workspace_id', user.active_workspace_id)
      .eq('platform', platform)
      .in('store_id', storeId ? [storeId, ''] : [''])

    if (res.error) {
      legacyActions = true
      // Pre-migration DB fallback without invoice_action/picking_action columns
      const fallbackRes = await supabase
        .from('order_status_mappings')
        .select('zid_status, odoo_state, enabled, store_id')
        .eq('workspace_id', user.active_workspace_id)
        .eq('platform', platform)
        .in('store_id', storeId ? [storeId, ''] : [''])
      if (fallbackRes.error) throw fallbackRes.error
      data = fallbackRes.data
    } else {
      data = res.data
    }

    const byStatus = new Map<
      string,
      { state: string; enabled: boolean; store: string; invoice_action?: string; picking_action?: string }
    >()
    for (const row of data || []) {
      if (!row.zid_status) continue
      const prev = byStatus.get(row.zid_status)
      // Store-specific row wins over the platform default.
      if (!prev || (prev.store === '' && row.store_id !== '')) {
        byStatus.set(row.zid_status, {
          state: row.odoo_state || '',
          enabled: (row as { enabled?: unknown }).enabled !== false,
          store: row.store_id || '',
          invoice_action: (row as any).invoice_action || '',
          picking_action: (row as any).picking_action || '',
        })
      }
    }
    const mappings: Record<
      string,
      { state: string; enabled: boolean; invoice_action?: string; picking_action?: string }
    > = {}
    for (const [k, v] of byStatus) {
      mappings[k] = {
        state: v.state,
        enabled: v.enabled,
        invoice_action: v.invoice_action || '',
        picking_action: v.picking_action || '',
      }
    }

    // Dual-storage check: if picking_action/invoice_action was empty (pre-migration DB),
    // merge with JSON settings stored in standard_mapping_settings
    try {
      const { data: stdRows } = await supabase
        .from('standard_mapping_settings')
        .select('settings, store_id')
        .eq('workspace_id', user.active_workspace_id)
        .eq('store_type', platform)
        .in('store_id', storeId ? [storeId, ''] : [''])
        .eq('entity_type', 'orders')

      // A store's settings replace the default object; do not mix actions from
      // a sibling/default row into an explicitly saved per-store configuration.
      const effectiveRow = stdRows?.find(row => row.store_id === storeId) ?? stdRows?.find(row => row.store_id === '')
      for (const row of effectiveRow ? [effectiveRow] : []) {
        const jsonActions = row?.settings?.order?.status_actions || row?.settings?.status_actions
        if (jsonActions && typeof jsonActions === 'object') {
          for (const [statusKey, cfg] of Object.entries(jsonActions)) {
            if (cfg && typeof cfg === 'object') {
              const c = cfg as any
              if (!mappings[statusKey]) {
                mappings[statusKey] = {
                  state: String(c.state || ''),
                  enabled: c.enabled !== false,
                  invoice_action: String(c.invoice_action || ''),
                  picking_action: String(c.picking_action || ''),
                }
              } else {
                if (legacyActions && !mappings[statusKey].invoice_action && c.invoice_action) {
                  mappings[statusKey].invoice_action = String(c.invoice_action)
                }
                if (legacyActions && !mappings[statusKey].picking_action && c.picking_action) {
                  mappings[statusKey].picking_action = String(c.picking_action)
                }
                if (!mappings[statusKey].state && c.state) {
                  mappings[statusKey].state = String(c.state)
                }
              }
            }
          }
        }
      }
    } catch {
      // Safe fallback: table mappings already populated
    }

    return { success: true, mappings }
  } catch (error: any) {
    console.error('[OrderStatusMappings] Get failed:', error)
    return { success: false, error: error?.message || 'Failed to fetch order status mappings', mappings: {} }
  }
}
