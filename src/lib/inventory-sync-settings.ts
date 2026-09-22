/**
 * Inventory Sync (Odoo → Store) — shared settings helpers.
 *
 * The Products standard mapping settings (store_type='zid', entity_type='products')
 * hold the user's inventory-sync choice under `.inventory`:
 *   {
 *     sync_enabled: boolean      // checkbox "مزامنة المخزون (من أودو إلى زد)"
 *     sync_mode: 'actual'|'forecast'  // الرصيد الفعلي أو الفوركاست المتوقع
 *     odoo_stock_webhook: { base_automation_id, server_action_id } | null
 *   }
 *
 * This module is used both by the webhook receiver (queue), the sync-engine
 * (to suppress the reverse Zid→Odoo stock write when enabled) and the bulk
 * stock-sync action. It never throws — returns boolean.
 */
import { supabase } from './supabase'

export interface InventorySyncSettings {
  sync_enabled: boolean
  sync_mode: 'actual' | 'forecast'
  odoo_stock_webhook: { base_automation_id?: number; server_action_id?: number } | null
}

export async function getInventorySyncSettings(workspaceId: string): Promise<InventorySyncSettings> {
  if (!workspaceId) {
    return { sync_enabled: false, sync_mode: 'actual', odoo_stock_webhook: null }
  }
  try {
    const { data, error } = await supabase
      .from('standard_mapping_settings')
      .select('settings')
      .eq('workspace_id', workspaceId)
      .eq('store_type', 'zid')
      .eq('entity_type', 'products')
      .maybeSingle()
    if (error || !data?.settings) {
      return { sync_enabled: false, sync_mode: 'actual', odoo_stock_webhook: null }
    }
    const inv = (data.settings as Record<string, any>)?.inventory ?? {}
    return {
      sync_enabled: inv.sync_enabled === true,
      sync_mode: inv.sync_mode === 'forecast' ? 'forecast' : 'actual',
      odoo_stock_webhook: inv.odoo_stock_webhook || null,
    }
  } catch (err) {
    console.warn('[InventorySyncSettings] Failed to load settings:', err)
    return { sync_enabled: false, sync_mode: 'actual', odoo_stock_webhook: null }
  }
}

/**
 * True when Odoo→Store inventory sync is enabled for the workspace (Zid store).
 * When enabled the reverse Zid→Odoo stock write is suppressed.
 */
export async function isInventorySyncErpToStoreEnabled(workspaceId: string): Promise<boolean> {
  const settings = await getInventorySyncSettings(workspaceId)
  return settings.sync_enabled
}