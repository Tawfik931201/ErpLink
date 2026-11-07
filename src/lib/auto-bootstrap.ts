/**
 * Auto-Bootstrap Service
 *
 * Automatically provisions battle-tested defaults for new or existing workspaces
 * across Zid, Salla, Shopify, and Odoo.
 *
 * Provides:
 * 1. Smart default order status mappings (no manual mapping needed).
 * 2. Auto-detection of Odoo defaults (default warehouse, pricelist, accounts).
 * 3. Smart defaults for categories, products, customers, and orders.
 */

import { decrypt } from '@/lib/crypto'
import { defaultCustomerMatchFields, type CustomerMatchField } from '@/lib/customers/matching-settings'
import { OdooClient } from '@/lib/odoo-client'
import { supabase } from '@/lib/supabase'

export const SMART_DEFAULT_ORDER_STATUSES: Record<string, Record<string, string>> = {
  zid: {
    new: 'draft',
    preparing: 'draft',
    ready: 'sale',
    indelivery: 'sale',
    delivered: 'sale',
    canceled: 'cancel',
    reversed: 'cancel',
    partially_reversed: 'cancel',
    reverse_in_progress: 'cancel',
  },
  salla: {
    under_review: 'draft',
    confirmed: 'draft',
    preparing: 'draft',
    ready: 'sale',
    shipped: 'sale',
    in_transit: 'sale',
    delivered: 'sale',
    completed: 'done',
    canceled: 'cancel',
    refunded: 'cancel',
    partial: 'draft',
    pending_payment: 'draft',
    on_hold: 'draft',
  },
  shopify: {
    pending: 'draft',
    authorized: 'draft',
    paid: 'sale',
    partially_paid: 'draft',
    partially_refunded: 'cancel',
    refunded: 'cancel',
    voided: 'cancel',
  },
}

/**
 * Returns the smart default Odoo state for any store status
 */
export function getSmartDefaultOrderState(
  status: string,
  platform: string = 'zid'
): string | null {
  const normStatus = String(status).trim().toLowerCase()
  const normPlatform = (platform || 'zid').toLowerCase()
  const mapping = SMART_DEFAULT_ORDER_STATUSES[normPlatform] || SMART_DEFAULT_ORDER_STATUSES.zid

  if (mapping[normStatus]) {
    return mapping[normStatus]
  }

  // Generic heuristic fallback
  if (['cancel', 'cancelled', 'canceled', 'refund', 'refunded', 'void', 'voided', 'reverse', 'reversed'].includes(normStatus)) {
    return 'cancel'
  }
  if (['done', 'completed', 'delivered'].includes(normStatus)) {
    return 'sale'
  }
  if (['paid', 'confirmed', 'ready', 'shipping', 'shipped', 'indelivery'].includes(normStatus)) {
    return 'sale'
  }
  if (['draft', 'new', 'pending', 'preparing', 'under_review'].includes(normStatus)) {
    return 'draft'
  }

  return null
}

/**
 * Auto-bootstraps a workspace with smart defaults and Odoo defaults
 */
export async function autoBootstrapWorkspace(workspaceId: string): Promise<{
  success: boolean
  bootstrapped: string[]
  error?: string
}> {
  if (!workspaceId) return { success: false, bootstrapped: [], error: 'Workspace ID is required' }

  const bootstrapped: string[] = []

  try {
    // 1. Check Odoo connection
    const { data: erpConn } = await supabase
      .from('erp_connections')
      .select('*')
      .eq('workspace_id', workspaceId)
      .maybeSingle()

    let defaultWarehouseId: number | null = null
    let defaultPricelistId: number | null = null
    let defaultIncomeAccountId: number | null = null
    let defaultExpenseAccountId: number | null = null
    let customerMatchFields: Record<string, CustomerMatchField> = {}

    if (erpConn && erpConn.status === 'connected' && erpConn.erp_type !== 'erpnext') {
      try {
        const apiKey = decrypt(erpConn.password)
        const client = new OdooClient({
          url: erpConn.url,
          db: erpConn.db_name || '',
          username: erpConn.username,
          apiKey,
        })

        try {
          customerMatchFields = await client.execute<Record<string, CustomerMatchField>>('res.partner', 'fields_get', [], { attributes: ['type'] })
        } catch {
          // Phone is available across supported Odoo versions; do not guess mobile.
        }

        let defaultCompanyId: number | null = null
        try {
          const uid = await client.authenticate()
          const userRecs = await client.searchRead<any>('res.users', [['id', '=', uid]], ['company_id'], 1)
          if (userRecs && userRecs[0]?.company_id) {
            defaultCompanyId = Array.isArray(userRecs[0].company_id) ? userRecs[0].company_id[0] : userRecs[0].company_id
          }
        } catch {}

        // Auto-detect default warehouse
        const warehouseDomain = defaultCompanyId ? [['company_id', 'in', [defaultCompanyId, false]]] : []
        const warehouses = await client.searchRead<any>(
          'stock.warehouse',
          warehouseDomain,
          ['id', 'name', 'code'],
          1
        )
        if (warehouses && warehouses.length > 0) {
          defaultWarehouseId = warehouses[0].id
        }

        // Auto-detect default pricelist (filter by company to avoid multi-company mismatch)
        const pricelistDomain = defaultCompanyId ? [['company_id', 'in', [defaultCompanyId, false]]] : []
        const pricelists = await client.searchRead<any>(
          'product.pricelist',
          pricelistDomain,
          ['id', 'name'],
          1
        )
        if (pricelists && pricelists.length > 0) {
          defaultPricelistId = pricelists[0].id
        }

        // Auto-detect income / expense accounts
        const incomeAccounts = await client.searchRead<any>(
          'account.account',
          [['account_type', 'in', ['income', 'income_other']]],
          ['id', 'name', 'code'],
          1
        )
        if (incomeAccounts && incomeAccounts.length > 0) {
          defaultIncomeAccountId = incomeAccounts[0].id
        }

        const expenseAccounts = await client.searchRead<any>(
          'account.account',
          [['account_type', 'in', ['expense', 'expense_direct_cost', 'expense_depreciation']]],
          ['id', 'name', 'code'],
          1
        )
        if (expenseAccounts && expenseAccounts.length > 0) {
          defaultExpenseAccountId = expenseAccounts[0].id
        }
      } catch (erpErr) {
        console.warn('[AutoBootstrap] Odoo defaults inspection non-fatal warning:', erpErr)
      }
    }

    // 2. Ensure Order Status Mappings for all platforms
    const platforms = ['zid', 'salla', 'shopify']
    for (const platform of platforms) {
      const { data: existingStatuses } = await supabase
        .from('order_status_mappings')
        .select('zid_status')
        .eq('workspace_id', workspaceId)
        .eq('platform', platform)

      const existingKeys = new Set((existingStatuses || []).map((s: any) => s.zid_status))
      const statusMap = SMART_DEFAULT_ORDER_STATUSES[platform] || {}
      const toInsert: any[] = []

      for (const [key, odooState] of Object.entries(statusMap)) {
        if (!existingKeys.has(key)) {
          toInsert.push({
            workspace_id: workspaceId,
            platform,
            store_id: '',
            zid_status: key,
            odoo_state: odooState,
            enabled: true,
          })
        }
      }

      if (toInsert.length > 0) {
        // Unique key since migration 20261013 is
        // (workspace_id, platform, store_id, zid_status).
        await supabase
          .from('order_status_mappings')
          .upsert(toInsert, { onConflict: 'workspace_id, platform, store_id, zid_status' })
        bootstrapped.push(`order_status_mappings:${platform}`)
      }
    }

    // 3. Ensure Standard Mapping Settings (Categories, Products, Customers, Orders)
    for (const storeType of platforms) {
      // Products
      const { data: prodSettings } = await supabase
        .from('standard_mapping_settings')
        .select('id')
        .eq('workspace_id', workspaceId)
        .eq('store_type', storeType)
        .eq('store_id', '')
        .eq('entity_type', 'products')
        .maybeSingle()

      if (!prodSettings) {
        await supabase.from('standard_mapping_settings').insert([
          {
            workspace_id: workspaceId,
            store_type: storeType,
            store_id: '',
            entity_type: 'products',
            settings: {
              product_type: 'product',
              on_delete: 'archive',
              match_zid_field: 'sku',
              match_odoo_field: 'default_code',
              enabled_actions: ['create', 'update'],
            },
          },
        ])
        bootstrapped.push(`standard_mapping:${storeType}:products`)
      }

      // Customers
      const { data: custSettings } = await supabase
        .from('standard_mapping_settings')
        .select('id')
        .eq('workspace_id', workspaceId)
        .eq('store_type', storeType)
        .eq('store_id', '')
        .eq('entity_type', 'customers')
        .maybeSingle()

      if (!custSettings) {
        await supabase.from('standard_mapping_settings').insert([
          {
            workspace_id: workspaceId,
            store_type: storeType,
            store_id: '',
            entity_type: 'customers',
            settings: {
              customer_type: 'person',
              on_delete: 'nothing',
              ...(erpConn?.erp_type === 'erpnext'
                ? { match_zid_field: 'mobile', match_odoo_field: 'mobile' }
                : defaultCustomerMatchFields(storeType, customerMatchFields)),
              enabled_actions: ['create', 'update'],
            },
          },
        ])
        bootstrapped.push(`standard_mapping:${storeType}:customers`)
      }

      // Categories
      const { data: catSettings } = await supabase
        .from('standard_mapping_settings')
        .select('id')
        .eq('workspace_id', workspaceId)
        .eq('store_type', storeType)
        .eq('store_id', '')
        .eq('entity_type', 'categories')
        .maybeSingle()

      if (!catSettings) {
        await supabase.from('standard_mapping_settings').insert([
          {
            workspace_id: workspaceId,
            store_type: storeType,
            store_id: '',
            entity_type: 'categories',
            settings: {
              costing_method: 'fifo',
              inventory_valuation: 'real_time',
              on_delete: 'nothing',
              match_zid_field: storeType === 'zid' ? 'name.ar' : storeType === 'shopify' ? 'title' : 'name',
              match_odoo_field: 'name',
              income_account_id: defaultIncomeAccountId,
              expense_account_id: defaultExpenseAccountId,
              enabled_actions: ['create', 'update'],
            },
          },
        ])
        bootstrapped.push(`standard_mapping:${storeType}:categories`)
      }

      // Orders
      const { data: orderSettings } = await supabase
        .from('standard_mapping_settings')
        .select('id, settings')
        .eq('workspace_id', workspaceId)
        .eq('store_type', storeType)
        .eq('store_id', '')
        .eq('entity_type', 'orders')
        .maybeSingle()

      if (!orderSettings) {
        await supabase.from('standard_mapping_settings').insert([
          {
            workspace_id: workspaceId,
            store_type: storeType,
            store_id: '',
            entity_type: 'orders',
            settings: {
              match_zid_field: 'id',
              match_odoo_field: 'client_order_ref',
              enabled_actions: ['create', 'update'],
              order: {
                default_warehouse_id: defaultWarehouseId,
                default_pricelist_id: defaultPricelistId,
                auto_confirm: false,
                auto_invoice: false,
              },
            },
          },
        ])
        bootstrapped.push(`standard_mapping:${storeType}:orders`)
      } else if (defaultWarehouseId && !(orderSettings.settings as any)?.order?.default_warehouse_id) {
        // Backfill detected warehouse if not yet set
        const updated = {
          ...(orderSettings.settings as any),
          order: {
            ...((orderSettings.settings as any)?.order || {}),
            default_warehouse_id: defaultWarehouseId,
            default_pricelist_id: defaultPricelistId || (orderSettings.settings as any)?.order?.default_pricelist_id,
          },
        }
        await supabase
          .from('standard_mapping_settings')
          .update({ settings: updated, updated_at: new Date().toISOString() })
          .eq('id', orderSettings.id)
      }
    }

    // 4. Backfill missing sync_settings events for existing connections
    // (multi-store: every Zid row of the workspace, adding only absent keys —
    // never overwriting the merchant's own toggles).
    const { data: merchantTokens } = await supabase
      .from('merchant_tokens')
      .select('id, sync_settings')
      .eq('workspace_id', workspaceId)

    for (const merchantToken of merchantTokens ?? []) {
      if (!merchantToken?.sync_settings) continue
      const ss = merchantToken.sync_settings as Record<string, { odoo2zid?: boolean; zid2odoo?: boolean }>
      const defaults = {
        customer_update: { odoo2zid: false, zid2odoo: true },
        category_create: { odoo2zid: false, zid2odoo: true },
        category_update: { odoo2zid: false, zid2odoo: true },
        category_delete: { odoo2zid: false, zid2odoo: true },
        product_publish: { odoo2zid: false, zid2odoo: true },
      }
      let changed = false
      for (const [key, val] of Object.entries(defaults)) {
        if (!ss[key]) {
          ss[key] = val
          changed = true
        }
      }
      if (changed) {
        await supabase
          .from('merchant_tokens')
          .update({ sync_settings: ss, updated_at: new Date().toISOString() })
          .eq('id', merchantToken.id)
        bootstrapped.push('sync_settings:backfill_events')
      }
    }

    console.info(`[AutoBootstrap] Workspace ${workspaceId} successfully bootstrapped:`, bootstrapped)
    return { success: true, bootstrapped }
  } catch (error: any) {
    console.error('[AutoBootstrap] Failed to bootstrap workspace:', error)
    return { success: false, bootstrapped, error: error?.message || 'Bootstrap failed' }
  }
}
