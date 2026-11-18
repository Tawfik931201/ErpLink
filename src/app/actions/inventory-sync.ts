'use server'

import { auth } from '@clerk/nextjs/server'

import { decrypt } from '@/lib/crypto'
import { getInventorySyncSettings } from '@/lib/inventory-sync-settings'
import { reconcileOdooStockWebhook, registerOdooStockWebhook, unregisterOdooStockWebhook } from '@/lib/odoo-webhook'
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

  // The stock webhook is platform-level, not store-level. Keep the default row
  // and every enabled/legacy store row on the same canonical refs so an old
  // per-store reference can never resurrect an orphan Odoo automation.
  const { data, error } = await supabase
    .from('standard_mapping_settings')
    .select('store_id, settings')
    .eq('workspace_id', user.active_workspace_id)
    .eq('store_type', storeType)
    .eq('entity_type', 'products')
  if (error) throw error

  const rows = (data || []) as Array<{ store_id: string; settings: Record<string, any> | null }>
  const byStore = new Map(rows.map(row => [row.store_id || '', row]))
  if (!byStore.has('')) byStore.set('', { store_id: '', settings: {} })

  const upserts = Array.from(byStore.values())
    .filter(row => {
      if ((row.store_id || '') === '') return true
      const inv = ((row.settings || {}).inventory || {}) as Record<string, any>
      return inv.sync_enabled === true || !!inv.odoo_stock_webhook
    })
    .map(row => {
      const settings = { ...(row.settings || {}) } as Record<string, any>
      settings.inventory = {
        ...((settings.inventory || {}) as Record<string, any>),
        odoo_stock_webhook: refs,
      }
      return {
        workspace_id: user.active_workspace_id,
        store_type: storeType,
        store_id: row.store_id || '',
        entity_type: 'products',
        settings,
        updated_at: new Date().toISOString(),
      }
    })

  const { error: upErr } = await supabase.from('standard_mapping_settings').upsert(
    upserts,
    { onConflict: 'workspace_id, store_type, store_id, entity_type' }
  )
  if (upErr) throw upErr
  return refs
}

async function reconcileStoredWebhook(
  workspaceId: string,
  refs: OdooStockWebhookRefs,
  storeType: InventoryStoreType
): Promise<OdooStockWebhookRefs> {
  const { data: erpConn } = await supabase
    .from('erp_connections')
    .select('*')
    .eq('workspace_id', workspaceId)
    .maybeSingle()
  if (!erpConn) throw new Error('ERP not connected')

  const repaired = await reconcileOdooStockWebhook(
    {
      url: erpConn.url,
      db: erpConn.db_name || '',
      username: erpConn.username,
      apiKey: decrypt(erpConn.password),
    },
    workspaceId,
    { baseAutomationId: refs.base_automation_id, serverActionId: refs.server_action_id }
  )
  // ERP webhook RPC uses camelCase; the saved Standard Mapping schema is
  // snake_case. Keep one canonical persisted shape in all store settings.
  const canonical: OdooStockWebhookRefs = repaired
    ? { base_automation_id: repaired.baseAutomationId, server_action_id: repaired.serverActionId }
    : refs
  await persistWebhookRefs(canonical, storeType)
  return canonical
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
      const canonical = await reconcileStoredWebhook(workspaceId, ownRefs, storeType)
      return { success: true, refs: canonical }
    }

    const otherRefs = await getWebhookRefs(workspaceId, otherStoreType(storeType))
    if (otherRefs?.base_automation_id) {
      const canonical = await reconcileStoredWebhook(workspaceId, otherRefs, storeType)
      return { success: true, refs: canonical }
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
    const canonical = await reconcileStoredWebhook(workspaceId, refs, storeType)
    return { success: true, refs: canonical }
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