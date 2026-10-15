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

type InventoryStoreType = 'zid' | 'salla'

function otherStoreType(storeType: InventoryStoreType): InventoryStoreType {
  return storeType === 'zid' ? 'salla' : 'zid'
}

/**
 * Reads `inventory.odoo_stock_webhook` for one store's products settings.
 */
async function getWebhookRefs(
  workspaceId: string,
  storeType: InventoryStoreType
): Promise<OdooStockWebhookRefs | null> {
  const invSettings = await getInventorySyncSettings(workspaceId, storeType)
  return invSettings.odoo_stock_webhook
}

/**
 * Persists `inventory.odoo_stock_webhook` inside a store's products standard settings.
 */
async function persistWebhookRefs(refs: OdooStockWebhookRefs | null, storeType: InventoryStoreType = 'zid') {
  const { userId } = await auth()
  if (!userId) throw new Error('Unauthorized')
  const user = await getOrCreateDbUser(userId)
  if (!user.active_workspace_id) throw new Error('No active workspace')

  // Platform-default row (store_id = ''): the stock webhook refs are
  // store_type-level (one Automated Action per workspace), inherited by every
  // store of the platform via the per-store → '' fallback. Since migration
  // 20261013 the unique key is (workspace_id, store_type, store_id,
  // entity_type) — the old 3-column ON CONFLICT spec matches no constraint
  // and Postgres rejects it ("no unique ... matching the ON CONFLICT").
  const { data, error } = await supabase
    .from('standard_mapping_settings')
    .select('settings')
    .eq('workspace_id', user.active_workspace_id)
    .eq('store_type', storeType)
    .eq('store_id', '')
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
      store_type: storeType,
      store_id: '',
      entity_type: 'products',
      settings,
      updated_at: new Date().toISOString(),
    },
    { onConflict: 'workspace_id, store_type, store_id, entity_type' }
  )
  if (upErr) throw upErr
  return refs
}

/**
 * Creates (or reuses) the Odoo Automated Action on stock.quant when the user
 * enables "مزامنة المخزون (من أودو إلى زد)" for a store. Returns the stored
 * webhook refs.
 *
 * There is ONE Odoo Automated Action per workspace. If this store or the other
 * store already holds refs, they are reused — never re-registered. The ERP
 * connection is only required when a brand-new action must be created.
 */
export async function enableOdooStockWebhook(
  storeType: InventoryStoreType = 'zid'
): Promise<{
  success: boolean
  refs?: OdooStockWebhookRefs | null
  error?: string
}> {
  try {
    const { userId } = await auth()
    if (!userId) throw new Error('Unauthorized')
    const user = await getOrCreateDbUser(userId)
    if (!user.active_workspace_id) throw new Error('No active workspace')

    const workspaceId = user.active_workspace_id

    const ownRefs = await getWebhookRefs(workspaceId, storeType)
    if (ownRefs?.base_automation_id) {
      return { success: true, refs: ownRefs }
    }

    const otherRefs = await getWebhookRefs(workspaceId, otherStoreType(storeType))
    if (otherRefs?.base_automation_id) {
      const persisted = await persistWebhookRefs(otherRefs, storeType)
      return { success: true, refs: persisted }
    }

    const { data: erpConn } = await supabase
      .from('erp_connections')
      .select('*')
      .eq('workspace_id', workspaceId)
      .maybeSingle()
    if (!erpConn) throw new Error('ERP not connected')

    const created = await registerOdooStockWebhook(
      {
        url: erpConn.url,
        db: erpConn.db_name || '',
        username: erpConn.username,
        apiKey: decrypt(erpConn.password),
      },
      workspaceId
    )

    const refs: OdooStockWebhookRefs = {
      base_automation_id: created.baseAutomationId,
      server_action_id: created.serverActionId,
    }
    const persisted = await persistWebhookRefs(refs, storeType)
    return { success: true, refs: persisted }
  } catch (error: any) {
    console.error('[InventorySync] Enable webhook failed:', error)
    return { success: false, error: error.message || 'Failed to enable inventory sync webhook' }
  }
}

/**
 * Removes this store's webhook refs. The shared Odoo Automated Action is only
 * unregistered when the OTHER store holds no refs either (both stores stopped
 * syncing inventory from Odoo).
 */
export async function disableOdooStockWebhook(
  storeType: InventoryStoreType = 'zid'
): Promise<{ success: boolean; error?: string }> {
  try {
    const { userId } = await auth()
    if (!userId) throw new Error('Unauthorized')
    const user = await getOrCreateDbUser(userId)
    if (!user.active_workspace_id) return { success: true }

    const workspaceId = user.active_workspace_id
    const refs = await getWebhookRefs(workspaceId, storeType)

    if (refs?.base_automation_id) {
      const otherRefs = await getWebhookRefs(workspaceId, otherStoreType(storeType))
      if (!otherRefs?.base_automation_id) {
        const { data: erpConn } = await supabase
          .from('erp_connections')
          .select('*')
          .eq('workspace_id', workspaceId)
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
    }

    await persistWebhookRefs(null, storeType)
    return { success: true }
  } catch (error: any) {
    console.error('[InventorySync] Disable webhook failed:', error)
    return { success: false, error: error.message || 'Failed to disable inventory sync webhook' }
  }
}