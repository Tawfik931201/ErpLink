/**
 * Inventory Sync (Odoo → Store) — shared settings helpers.
 *
 * Each enabled store tab's Products standard mapping settings
 * (store_type='<store>', entity_type='products') hold that store's
 * inventory-sync choice under `.inventory`:
 *   {
 *     sync_enabled: boolean      // checkbox "مزامنة المخزون (من أودو إلى زد)"
 *     sync_mode: 'actual'|'forecast'  // الرصيد الفعلي أو الفوركاست المتوقع
 *     odoo_stock_webhook: { base_automation_id, server_action_id } | null
 *   }
 *
 * The webhook refs are deliberately shared across stores: there is ONE Odoo
 * Automated Action per workspace (registered lazily), and saving it to a
 * second store's settings reuses the same refs instead of registering a
 * duplicate. `disableOdooStockWebhook` only unregisters it once no store holds
 * a reference.
 *
 * This module is used both by the webhook receiver (queue), the sync-engine
 * (to suppress the reverse store→Odoo stock write when any store syncs from
 * Odoo) and the bulk stock-sync action. It never throws — returns boolean.
 */
import { supabase } from './supabase'

export type InventorySyncStoreType = 'zid' | 'salla'

export interface InventorySyncSettings {
  sync_enabled: boolean
  sync_mode: 'actual' | 'forecast'
  odoo_stock_webhook: { base_automation_id?: number; server_action_id?: number } | null
}

const DISABLED: InventorySyncSettings = {
  sync_enabled: false,
  sync_mode: 'actual',
  odoo_stock_webhook: null,
}

export async function getInventorySyncSettings(
  workspaceId: string,
  storeType: InventorySyncStoreType = 'zid',
  storeId = ''
): Promise<InventorySyncSettings> {
  if (!workspaceId) {
    return { ...DISABLED }
  }
  try {
    // Per-store row first, platform default ('') as fallback — each store
    // carries its own Odoo→store stock toggle.
    const key = String(storeId ?? '').trim()
    const { data, error } = await supabase
      .from('standard_mapping_settings')
      .select('store_id, settings')
      .eq('workspace_id', workspaceId)
      .eq('store_type', storeType)
      .eq('entity_type', 'products')
      .in('store_id', key ? [key, ''] : [''])
    if (error || !data?.length) {
      return { ...DISABLED }
    }
    const rows = data as Array<{ store_id: string; settings: unknown }>
    // Compare as TEXT on both sides: store_id round-trips as a string, so a
    // numeric caller would never match `r.store_id === storeId` and would
    // silently fall back to the platform default.
    const hit =
      rows.find(r => (r.store_id || '') === key) ??
      rows.find(r => (r.store_id || '') === '')
    const inv = ((hit?.settings as Record<string, any> | null)?.inventory ?? {}) as Record<string, any>
    return {
      sync_enabled: inv.sync_enabled === true,
      sync_mode: inv.sync_mode === 'forecast' ? 'forecast' : 'actual',
      odoo_stock_webhook: inv.odoo_stock_webhook || null,
    }
  } catch (err) {
    console.warn('[InventorySyncSettings] Failed to load settings:', err)
    return { ...DISABLED }
  }
}

/**
 * True when Odoo→Store inventory sync is effectively ON for the platform —
 * either the platform default or ANY linked store enabled it. Used as the
 * dispatch gate (a store row can turn its own push on while the platform
 * default stays off).
 */
export async function isInventorySyncActive(
  workspaceId: string,
  storeType: InventorySyncStoreType = 'zid'
): Promise<boolean> {
  if (!workspaceId) return false
  try {
    const { data, error } = await supabase
      .from('standard_mapping_settings')
      .select('settings')
      .eq('workspace_id', workspaceId)
      .eq('store_type', storeType)
      .eq('entity_type', 'products')
    if (error || !data?.length) return false
    return (data as Array<{ settings: unknown }>).some(
      r => ((r.settings as Record<string, any> | null)?.inventory as Record<string, any> | undefined)?.sync_enabled === true
    )
  } catch {
    return false
  }
}

/**
 * True when Odoo→Store inventory sync is enabled for the workspace on ANY
 * store (Zid or Salla). When enabled the reverse store→Odoo stock write is
 * suppressed.
 */
export async function isInventorySyncErpToStoreEnabled(workspaceId: string): Promise<boolean> {
  const [zidState, sallaState] = await Promise.all([
    isInventorySyncActive(workspaceId, 'zid'),
    isInventorySyncActive(workspaceId, 'salla'),
  ])
  return zidState || sallaState
}