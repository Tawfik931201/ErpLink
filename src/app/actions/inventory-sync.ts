'use server'

import { auth } from '@clerk/nextjs/server'

import { decrypt } from '@/lib/crypto'
import { getInventorySyncSettings } from '@/lib/inventory-sync-settings'
import { registerOdooStockWebhook, unregisterOdooStockWebhook } from '@/lib/odoo-webhook'
import { supabase } from '@/lib/supabase'
import { getOrCreateDbUser } from '@/lib/users'

export interface OdooStockWebhookRefs {
  base_automation_id?: number
  server_action_id?: number
}

/**
 * Persists `inventory.odoo_stock_webhook` inside the products standard settings.
 */
async function persistWebhookRefs(refs: OdooStockWebhookRefs | null) {
  const { userId } = await auth()
  if (!userId) throw new Error('Unauthorized')
  const user = await getOrCreateDbUser(userId)
  if (!user.active_workspace_id) throw new Error('No active workspace')

  const { data, error } = await supabase
    .from('standard_mapping_settings')
    .select('settings')
    .eq('workspace_id', user.active_workspace_id)
    .eq('store_type', 'zid')
    .eq('entity_type', 'products')
    .maybeSingle()
  if (error) throw error

  const settings = (data?.settings || {}) as Record<string, any>
  const inventory = { ...((settings.inventory || {}) as Record<string, any>) }
  inventory.odoo_stock_webhook = refs
  settings.inventory = inventory

  const { error: upErr } = await supabase.from('standard_mapping_settings').upsert(
    {
      workspace_id: user.active_workspace_id,
      store_type: 'zid',
      entity_type: 'products',
      settings,
      updated_at: new Date().toISOString(),
    },
    { onConflict: 'workspace_id, store_type, entity_type' }
  )
  if (upErr) throw upErr
  return refs
}

/**
 * Creates the Odoo Automated Action on stock.quant when the user enables
 * "مزامنة المخزون (من أودو إلى زد)". Returns the stored webhook refs.
 */
export async function enableOdooStockWebhook(): Promise<{
  success: boolean
  refs?: OdooStockWebhookRefs | null
  error?: string
}> {
  try {
    const { userId } = await auth()
    if (!userId) throw new Error('Unauthorized')
    const user = await getOrCreateDbUser(userId)
    if (!user.active_workspace_id) throw new Error('No active workspace')

    const { data: erpConn } = await supabase
      .from('erp_connections')
      .select('*')
      .eq('workspace_id', user.active_workspace_id)
      .maybeSingle()
    if (!erpConn) throw new Error('ERP not connected')

    const created = await registerOdooStockWebhook(
      {
        url: erpConn.url,
        db: erpConn.db_name || '',
        username: erpConn.username,
        apiKey: decrypt(erpConn.password),
      },
      user.active_workspace_id
    )

    const refs: OdooStockWebhookRefs = {
      base_automation_id: created.baseAutomationId,
      server_action_id: created.serverActionId,
    }
    const persisted = await persistWebhookRefs(refs)
    return { success: true, refs: persisted }
  } catch (error: any) {
    console.error('[InventorySync] Enable webhook failed:', error)
    return { success: false, error: error.message || 'Failed to enable inventory sync webhook' }
  }
}

/**
 * Removes the Odoo Automated Action when the user disables the inventory sync.
 */
export async function disableOdooStockWebhook(): Promise<{ success: boolean; error?: string }> {
  try {
    const { userId } = await auth()
    if (!userId) throw new Error('Unauthorized')
    const user = await getOrCreateDbUser(userId)
    if (!user.active_workspace_id) return { success: true }

    const invSettings = await getInventorySyncSettings(user.active_workspace_id)
    const refs = invSettings.odoo_stock_webhook

    if (refs?.base_automation_id) {
      const { data: erpConn } = await supabase
        .from('erp_connections')
        .select('*')
        .eq('workspace_id', user.active_workspace_id)
        .maybeSingle()
      if (erpConn) {
        await unregisterOdooStockWebhook(
          {
            url: erpConn.url,
            db: erpConn.db_name || '',
            username: erpConn.username,
            apiKey: decrypt(erpConn.password),
          },
          refs.base_automation_id,
          refs.server_action_id
        )
      }
    }

    await persistWebhookRefs(null)
    return { success: true }
  } catch (error: any) {
    console.error('[InventorySync] Disable webhook failed:', error)
    return { success: false, error: error.message || 'Failed to disable inventory sync webhook' }
  }
}