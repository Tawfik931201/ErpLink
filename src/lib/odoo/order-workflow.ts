import { getSmartDefaultOrderState } from '@/lib/auto-bootstrap'
import { upsertEntityLink } from '@/lib/entity-links'
import { withErpCreateIdentity } from '@/lib/erp-effect-context'
import { resolveSettingsStoreKey } from '@/lib/mapping-settings'
import { getSaleOrderSelectionKeys } from '@/lib/odoo/field-meta'
import { createOrderInvoice } from '@/lib/odoo/order-invoice'
import { reconcilePendingPaymentsForOrder, syncOrderPayment } from '@/lib/odoo/order-payment'
import type { OdooClient } from '@/lib/odoo-client'
import { assertOrderActionResults } from '@/lib/orders/action-results'
import { getCachedStandardMappingSettings } from '@/lib/sync/settings'
import { supabaseAdmin } from '@/lib/sync-runtime'
import { ttlCache } from '@/lib/ttl-cache'
import type { VatCountryRule } from '@/lib/zid/order-helpers'
import { resolveOrderVatTax, resolveZidCodAmount, resolveZidStatus } from '@/lib/zid/order-helpers'

// ─── Helper: resolve platform order status → Odoo state ──────────────────────
// Uses DB order_status_mappings table; falls back to defaults from settings.
// Per-store rows overlay the platform defaults ('').
async function orderStatusStoreKey(workspaceId: string, platform: string, storeId: string): Promise<string> {
  return ttlCache.get(
    `eng:stdsets:${workspaceId}:status-store:${platform}:${storeId}`,
    30_000,
    () => resolveSettingsStoreKey(supabaseAdmin, platform, storeId, workspaceId),
  )
}

export async function resolveOrderState(
  workspaceId: string,
  zidStatus: string,
  platform?: 'zid' | 'salla' | 'shopify',
  storeId = '',
): Promise<string | null> {
  storeId = await orderStatusStoreKey(workspaceId, platform || 'zid', storeId)
  let query = supabaseAdmin
    .from('order_status_mappings')
    .select('odoo_state, store_id')
    .eq('workspace_id', workspaceId)
    .eq('zid_status', zidStatus) as any
  if (platform) query = query.eq('platform', platform)
  query = query.in('store_id', storeId ? [storeId, ''] : [''])
  const { data } = await query
  const rows = (Array.isArray(data) ? data : data ? [data] : []) as Array<{ odoo_state: string; store_id?: string }>
  const hit = rows.find(r => (r.store_id || '') === storeId) ?? rows.find(r => !r.store_id)
  if (hit?.odoo_state) return hit.odoo_state
  return getSmartDefaultOrderState(zidStatus, platform)
}

// ──── Helper: read the status-mapping row (state + enabled flag) ─────
export async function getOrderStatusRow(
  workspaceId: string,
  zidStatus: string,
  platform?: 'zid' | 'salla' | 'shopify',
  storeId = '',
): Promise<{
  odoo_state: string
  enabled: boolean
  invoice_action?: string
  picking_action?: string
} | null> {
  storeId = await orderStatusStoreKey(workspaceId, platform || 'zid', storeId)
  try {
    let query = supabaseAdmin
      .from('order_status_mappings')
      .select('odoo_state, enabled, store_id, invoice_action, picking_action')
      .eq('workspace_id', workspaceId)
      .eq('zid_status', zidStatus) as any
    if (platform) query = query.eq('platform', platform)
    query = query.in('store_id', storeId ? [storeId, ''] : [''])
    const { data, error } = await query
    if (error) throw error
    const rows = (Array.isArray(data) ? data : data ? [data] : []) as Array<{
      odoo_state: string
      enabled?: boolean
      store_id?: string
      invoice_action?: string
      picking_action?: string
    }>
    const hit = rows.find(r => (r.store_id || '') === storeId) ?? rows.find(r => !r.store_id)
    let rowResult: { odoo_state: string; enabled: boolean; invoice_action?: string; picking_action?: string } | null = hit
      ? {
          odoo_state: hit.odoo_state || '',
          enabled: hit.enabled !== false,
          invoice_action: hit.invoice_action || '',
          picking_action: hit.picking_action || '',
        }
      : null

    // A modern table row is authoritative, including intentionally cleared
    // actions. Do not resurrect old invoice/picking actions from the JSON copy.
    if (rowResult) return rowResult

    // Dual-storage fallback: check JSON standard_mapping_settings
    try {
      const orderStdSettings = await getCachedStandardMappingSettings(workspaceId, platform || 'zid', 'orders', storeId)
      const statusActions = orderStdSettings?.order?.status_actions || (orderStdSettings as any)?.status_actions
      const jsonConfig = statusActions?.[zidStatus]
      if (jsonConfig && typeof jsonConfig === 'object') {
        const state = String(jsonConfig.state || '')
        const enabled = jsonConfig.enabled !== false
        const invAction = String(jsonConfig.invoice_action || '')
        const pickAction = String(jsonConfig.picking_action || '')

        rowResult = { odoo_state: state, enabled, invoice_action: invAction, picking_action: pickAction }
      }
    } catch {
      // Non-fatal
    }
    return rowResult
  } catch {
    // Pre-migration DBs without invoice_action/picking_action or enabled:
    // fall back to a select without them (backward compatible).
    let rowResult: { odoo_state: string; enabled: boolean; invoice_action?: string; picking_action?: string } | null = null
    try {
      let fallback = supabaseAdmin
        .from('order_status_mappings')
        .select('odoo_state, enabled, store_id')
        .eq('workspace_id', workspaceId)
        .eq('zid_status', zidStatus) as any
      if (platform) fallback = fallback.eq('platform', platform)
      fallback = fallback.in('store_id', storeId ? [storeId, ''] : [''])
      const { data, error } = await fallback
      if (error) throw error
      const rows = (Array.isArray(data) ? data : data ? [data] : []) as Array<{ odoo_state: string; enabled?: boolean; store_id?: string }>
      const hit = rows.find(r => (r.store_id || '') === storeId) ?? rows.find(r => !r.store_id)
      if (hit?.odoo_state) {
        rowResult = { odoo_state: hit.odoo_state, enabled: hit.enabled !== false, invoice_action: '', picking_action: '' }
      }
    } catch {
      try {
        let legacy = supabaseAdmin
          .from('order_status_mappings')
          .select('odoo_state, store_id')
          .eq('workspace_id', workspaceId)
          .eq('zid_status', zidStatus) as any
        if (platform) legacy = legacy.eq('platform', platform)
        legacy = legacy.in('store_id', storeId ? [storeId, ''] : [''])
        const { data: legacyRows } = await legacy
        const data = Array.isArray(legacyRows)
          ? legacyRows.find((r: any) => (r.store_id || '') === storeId) ?? legacyRows.find((r: any) => !r.store_id)
          : legacyRows
        if (!data?.odoo_state) {
          // Keep rowResult as null
        } else {
          rowResult = { odoo_state: data.odoo_state, enabled: true, invoice_action: '', picking_action: '' }
        }
      } catch {
        // Fall through
      }
    }

    // Merge JSON settings
    try {
      const orderStdSettings = await getCachedStandardMappingSettings(workspaceId, platform || 'zid', 'orders', storeId)
      const statusActions = orderStdSettings?.order?.status_actions || (orderStdSettings as any)?.status_actions
      const jsonConfig = statusActions?.[zidStatus]
      if (jsonConfig && typeof jsonConfig === 'object') {
        const state = String(jsonConfig.state || '')
        const enabled = jsonConfig.enabled !== false
        const invAction = String(jsonConfig.invoice_action || '')
        const pickAction = String(jsonConfig.picking_action || '')

        if (!rowResult) {
          rowResult = { odoo_state: state, enabled, invoice_action: invAction, picking_action: pickAction }
        } else {
          if (!rowResult.invoice_action && invAction) rowResult.invoice_action = invAction
          if (!rowResult.picking_action && pickAction) rowResult.picking_action = pickAction
          if (!rowResult.odoo_state && state) rowResult.odoo_state = state
        }
      }
    } catch {
      // Non-fatal
    }
    return rowResult
  }
}

// ──── Helper: perform the real Odoo workflow transition for a mapped state ─────
// sale   → action_confirm (from draft/sent only)
// cancel → action_cancel, with direct-write fallback for old versions
// done   → action_done through 16, action_lock from 17 (confirmed orders only)
// draft/sent → no-op (never downgrade; new orders are draft by nature)
// Never throws: status actions must not fail an otherwise successful sync.
export async function applyOrderStatusAction(
  client: OdooClient,
  odooRecordId: number,
  odooState: string,
  zidStatus: string,
): Promise<void> {
  try {
    const recs = await client.searchRead<any>('sale.order', [['id', '=', odooRecordId]], ['state'])
    let cur = String(recs?.[0]?.state || '')
    if (odooState === 'sale') {
      if (cur === 'sale' || cur === 'done') {
        console.info(`[SyncEngine] Order #${odooRecordId} already "${cur}"; confirm skipped (zid status "${zidStatus}")`)
        return
      }
      if (cur !== 'draft' && cur !== 'sent') {
        console.info(`[SyncEngine] Order #${odooRecordId} state "${cur || 'unknown'}" — confirm skipped (zid status "${zidStatus}")`)
        return
      }
      await client.execute('sale.order', 'action_confirm', [odooRecordId])
      console.info(`[SyncEngine] Order #${odooRecordId} CONFIRMED (zid status "${zidStatus}")`)
      return
    }
    if (odooState === 'cancel') {
      if (cur === 'cancel') {
        console.info(`[SyncEngine] Order #${odooRecordId} already cancelled; cancel skipped (zid status "${zidStatus}")`)
        return
      }
      // Odoo 17 otherwise returns a UI wizard without actually cancelling.
      // Let business-rule failures surface; writing state bypasses stock/invoice workflows.
      await client.execute('sale.order', 'action_cancel', [[odooRecordId]], {
        context: { disable_cancel_warning: true },
      })
      console.info(`[SyncEngine] Order #${odooRecordId} CANCELLED (zid status "${zidStatus}")`)
      return
    }
    if (odooState === 'done') {
      if (cur === 'draft' || cur === 'sent') {
        await client.execute('sale.order', 'action_confirm', [[odooRecordId]])
        cur = 'sale'
      }
      if (cur === 'done' || cur === 'cancel') {
        console.info(`[SyncEngine] Order #${odooRecordId} already "${cur}"; lock skipped (zid status "${zidStatus}")`)
        return
      }
      if (cur !== 'sale') {
        console.info(`[SyncEngine] Order #${odooRecordId} state "${cur || 'unknown'}" — lock skipped, only confirmed orders can be locked (zid status "${zidStatus}")`)
        return
      }
      const majorVersion = await client.getMajorVersion()
      await client.execute('sale.order', majorVersion >= 17 ? 'action_lock' : 'action_done', [[odooRecordId]])
      console.info(`[SyncEngine] Order #${odooRecordId} LOCKED (zid status "${zidStatus}")`)
      return
    }
    console.info(`[SyncEngine] No status action for target "${odooState}" (zid status "${zidStatus}")`)
  } catch (err: any) {
    console.warn(`[SyncEngine] Status action "${odooState}" failed for order #${odooRecordId} (zid status "${zidStatus}"):`, err?.message || err)
  }
}

// ──── Helper: apply stock picking action for a sales order ─────
async function applyOrderPickingAction(
  client: OdooClient,
  orderId: number,
  action: string,
  zidStatus: string,
): Promise<void> {
  if (!action || action === 'none') return
  try {
    const orders = await client.searchRead<any>('sale.order', [['id', '=', orderId]], ['name', 'state', 'picking_ids'])
    const order = orders?.[0]
    if (!order) return

    // If action is create or create_and_validate, ensure order is confirmed so picking exists
    if (action === 'create' || action === 'create_and_validate') {
      if (order.state === 'draft' || order.state === 'sent') {
        try {
          await client.execute('sale.order', 'action_confirm', [orderId])
          console.info(`[SyncEngine] Confirmed sale.order #${orderId} to generate picking (status "${zidStatus}")`)
        } catch (e: any) {
          try {
            await client.execute('sale.order', 'action_confirm', [[orderId]])
            console.info(`[SyncEngine] Confirmed sale.order #${orderId} via [[orderId]] fallback (status "${zidStatus}")`)
          } catch (e2: any) {
            console.warn(`[SyncEngine] Failed to confirm sale.order #${orderId} for picking:`, e2?.message || e2)
          }
        }
      }
    }

    if (action === 'create') {
      console.info(`[SyncEngine] Picking created/ensured for sale.order #${orderId} (status "${zidStatus}")`)
      return
    }

    if (action === 'validate' || action === 'create_and_validate') {
      await processFullDelivery(client, 'sale.order', orderId)
      console.info(`[SyncEngine] Validated stock picking for sale.order #${orderId} (status "${zidStatus}")`)
      return
    }

    if (action === 'cancel') {
      let pickingIds: number[] = Array.isArray(order?.picking_ids) ? order.picking_ids : []
      if (pickingIds.length === 0 && order?.name) {
        const pickings = await client.searchRead<any>('stock.picking', [
          ['origin', '=', order.name],
          ['state', 'not in', ['cancel', 'done']]
        ], ['id'])
        pickingIds = pickings.map(p => p.id)
      }
      for (const pId of pickingIds) {
        try {
          const [pRec] = await client.searchRead<any>('stock.picking', [['id', '=', pId]], ['state'])
          if (pRec?.state && pRec.state !== 'cancel' && pRec.state !== 'done') {
            await client.execute('stock.picking', 'action_cancel', [pId])
            console.info(`[SyncEngine] Cancelled stock picking #${pId} for sale.order #${orderId}`)
          }
        } catch (pickErr: any) {
          console.warn(`[SyncEngine] Failed to cancel picking #${pId}:`, pickErr?.message || pickErr)
        }
      }
      return
    }
  } catch (err: any) {
    console.warn(`[SyncEngine] Picking action "${action}" failed for order #${orderId} (status "${zidStatus}"):`, err?.message || err)
  }
}

// ──── Helper: direct draft invoice creation for sale.order when _create_invoices yields no lines ─────
// This happens in Odoo whenever products have invoice_policy = 'delivery' and items have not yet
// been validated in stock.picking. Creating the account.move directly linked via sale_line_ids
// fulfills the user's explicit configuration without violating Odoo stock delivery rules.
export async function createDraftInvoiceForOrder(
  client: OdooClient,
  orderId: number,
): Promise<number | null> {
  try {
    const majorVersion = await client.getMajorVersion().catch(() => 17)
    const orders = await client.searchRead<any>(
      'sale.order',
      [['id', '=', orderId]],
      ['id', 'name', 'partner_id', 'partner_invoice_id', 'currency_id', 'company_id', 'payment_term_id', 'fiscal_position_id', 'order_line',
        ...(majorVersion < 16 ? ['analytic_account_id'] : [])]
    )
    const order = orders?.[0]
    if (!order) return null

    const companyId = Number(Array.isArray(order.company_id) ? order.company_id[0] : order.company_id)
    if (!Number.isInteger(companyId) || companyId <= 0) {
      console.warn(`[SyncEngine] Cannot create invoice for sale.order #${orderId}: missing company.`)
      return null
    }

    const lineIds: number[] = Array.isArray(order.order_line)
      ? order.order_line.filter((v: unknown) => Number.isInteger(Number(v)) && Number(v) > 0)
      : []
    if (lineIds.length === 0) {
      console.warn(`[SyncEngine] Cannot create invoice for sale.order #${orderId}: order has no order lines.`)
      return null
    }

    const taxField = majorVersion >= 18 ? 'tax_ids' : 'tax_id'
    const uomField = majorVersion >= 19 ? 'product_uom_id' : 'product_uom'
    const analyticFields = majorVersion >= 16 ? ['analytic_distribution'] : ['analytic_tag_ids']

    let orderLines: any[] = []
    try {
      orderLines = await client.searchRead<any>(
        'sale.order.line',
        [['id', 'in', lineIds], ['display_type', '=', false]],
        ['id', 'name', 'product_id', 'product_uom_qty', 'price_unit', 'discount', taxField, uomField, ...analyticFields],
        lineIds.length
      )
    } catch {
      try {
        const altTaxField = taxField === 'tax_ids' ? 'tax_id' : 'tax_ids'
        const altUomField = uomField === 'product_uom_id' ? 'product_uom' : 'product_uom_id'
        orderLines = await client.searchRead<any>(
          'sale.order.line',
          [['id', 'in', lineIds], ['display_type', '=', false]],
          ['id', 'name', 'product_id', 'product_uom_qty', 'price_unit', 'discount', altTaxField, altUomField, ...analyticFields],
          lineIds.length
        )
      } catch (lineReadError) {
        // Tax, unit and analytics are accounting data. A reduced read would
        // turn missing fields into empty taxes and silently change the invoice.
        throw lineReadError
      }
    }
    if (!orderLines || orderLines.length === 0) {
      console.warn(`[SyncEngine] Cannot create invoice for sale.order #${orderId}: no valid product lines found.`)
      return null
    }

    // Never borrow another company's journal. Odoo 14–17 computes each line's
    // income account from its product/category and fiscal position during create;
    // imposing the first income account would bypass that accounting setup.
    const journals = await client.searchRead<any>(
      'account.journal', [['type', '=', 'sale'], ['company_id', '=', companyId]], ['id'], 1
    )
    const defaultJournalId = journals?.[0]?.id
    if (!defaultJournalId) return null

    const invoiceLines = orderLines.map((line: any) => {
      const lineVals: Record<string, any> = {
        name: line.name || (Array.isArray(line.product_id) ? line.product_id[1] : 'Item'),
        quantity: typeof line.product_uom_qty === 'number' && Number.isFinite(line.product_uom_qty) ? line.product_uom_qty : 1,
        price_unit: typeof line.price_unit === 'number' ? line.price_unit : 0,
      }
      if (Array.isArray(line.product_id) && line.product_id[0]) {
        lineVals.product_id = line.product_id[0]
      }
      if (typeof line.discount === 'number' && line.discount > 0) {
        lineVals.discount = line.discount
      }
      const uomVal = line.product_uom_id ?? line.product_uom
      if (Array.isArray(uomVal) && uomVal[0]) {
        lineVals.product_uom_id = uomVal[0]
      } else if (Number.isInteger(Number(uomVal)) && Number(uomVal) > 0) {
        lineVals.product_uom_id = Number(uomVal)
      }
      const taxes = line.tax_ids ?? line.tax_id
      if (Array.isArray(taxes) && taxes.length > 0) {
        lineVals.tax_ids = [[6, 0, taxes]]
      } else {
        lineVals.tax_ids = [[5, 0, 0]]
      }
      // Mirror Odoo's own sale.order.line._prepare_invoice_line: distribution
      // is line-scoped from 16; 14/15 use the order account plus line tags.
      if (majorVersion >= 16) {
        if (line.analytic_distribution && typeof line.analytic_distribution === 'object' && !Array.isArray(line.analytic_distribution)) {
          lineVals.analytic_distribution = line.analytic_distribution
        }
      } else {
        const analyticAccountId = Array.isArray(order.analytic_account_id) ? order.analytic_account_id[0] : order.analytic_account_id
        if (analyticAccountId) lineVals.analytic_account_id = analyticAccountId
        if (Array.isArray(line.analytic_tag_ids)) lineVals.analytic_tag_ids = [[6, 0, line.analytic_tag_ids]]
      }
      lineVals.sale_line_ids = [[6, 0, [line.id]]]
      return [0, 0, lineVals]
    })

    const partnerId = Array.isArray(order.partner_invoice_id)
      ? order.partner_invoice_id[0]
      : Array.isArray(order.partner_id)
      ? order.partner_id[0]
      : order.partner_id

    const moveVals: Record<string, any> = {
      move_type: 'out_invoice',
      partner_id: partnerId,
      invoice_origin: order.name,
      invoice_date: new Date().toISOString().slice(0, 10),
      invoice_line_ids: invoiceLines,
    }
    if (defaultJournalId) {
      moveVals.journal_id = defaultJournalId
    }
    moveVals.company_id = companyId
    if (Array.isArray(order.currency_id) && order.currency_id[0]) {
      moveVals.currency_id = order.currency_id[0]
    }
    if (Array.isArray(order.payment_term_id) && order.payment_term_id[0]) {
      moveVals.invoice_payment_term_id = order.payment_term_id[0]
    }
    if (Array.isArray(order.fiscal_position_id) && order.fiscal_position_id[0]) {
      moveVals.fiscal_position_id = order.fiscal_position_id[0]
    }

    // Preserve fiscal position and payment terms on failure as well: a generic
    // retry without them can silently change accounting or duplicate a timed-out create.
    const moveId = await client.create('account.move', moveVals)

    if (moveId) {
      console.info(`[SyncEngine] ✅ Created direct draft invoice #${moveId} for sale.order #${orderId} (${order.name})`)
    }
    return moveId
  } catch (fallbackErr: any) {
    console.error(`[SyncEngine] ❌ Failed to create direct draft invoice for sale.order #${orderId}:`, fallbackErr?.message || fallbackErr)
    return null
  }
}

// ──── Helper: apply invoice action for a sales order ─────
async function applyOrderInvoiceAction(
  client: OdooClient,
  orderId: number,
  action: string,
  zidStatus: string,
  workspaceId: string,
  platform: 'zid' | 'salla' | 'shopify',
  storeId: string,
  zidEntityId: string,
): Promise<void> {
  if (!action || action === 'none') return
  try {
    const orders = await client.searchRead<any>('sale.order', [['id', '=', orderId]], ['name', 'state', 'invoice_ids'])
    const order = orders?.[0]
    if (!order) return

    if (action === 'create' || action === 'create_and_post') {
      let existingInvoiceIds: number[] = Array.isArray(order?.invoice_ids)
        ? order.invoice_ids.filter((v: unknown) => Number.isInteger(Number(v)) && Number(v) > 0)
        : []

      // In Odoo, sale.order should be confirmed to invoice
      if (order.state === 'draft' || order.state === 'sent') {
        try {
          await client.execute('sale.order', 'action_confirm', [orderId])
          console.info(`[SyncEngine] Confirmed sale.order #${orderId} for invoice creation (status "${zidStatus}")`)
        } catch (e: any) {
          try {
            await client.execute('sale.order', 'action_confirm', [[orderId]])
            console.info(`[SyncEngine] Confirmed sale.order #${orderId} via [[orderId]] fallback before invoice (status "${zidStatus}")`)
          } catch (e2: any) {
            console.warn(`[SyncEngine] Failed to confirm sale.order #${orderId} before invoice:`, e2?.message || e2)
          }
        }
      }

      // If no invoice exists yet, create one
      if (existingInvoiceIds.length === 0) {
        // Use the public wizard available in Odoo 14–17. Private methods
        // cannot be called through XML-RPC; repeated signature retries add load.
        try {
          await createOrderInvoice(client, orderId)
        } catch (invoiceErr: any) {
          console.warn(`[SyncEngine] Standard invoice creation skipped/failed for sale.order #${orderId}: ${invoiceErr?.message || invoiceErr}`)
        }

        // Re-read invoice_ids after the public wizard (also after an ambiguous response)
        const [reloaded] = await client.searchRead<any>('sale.order', [['id', '=', orderId]], ['invoice_ids'])
        existingInvoiceIds = Array.isArray(reloaded?.invoice_ids)
          ? reloaded.invoice_ids.filter((v: unknown) => Number.isInteger(Number(v)) && Number(v) > 0)
          : []

        // If the wizard returned empty (because product policy is "delivery" and items not delivered yet),
        // create draft invoice directly linked to the sale.order
        if (existingInvoiceIds.length === 0) {
          console.info(`[SyncEngine] Invoice wizard produced no invoices for sale.order #${orderId} (likely policy "delivery"). Creating direct draft invoice...`)
          const directId = await createDraftInvoiceForOrder(client, orderId)
          if (directId) {
            existingInvoiceIds = [directId]
          }
        }
      }

      if (existingInvoiceIds.length > 0) {
        const invoices = await client.searchRead<any>(
          'account.move',
          [['id', 'in', existingInvoiceIds], ['move_type', '=', 'out_invoice']],
          ['id', 'name', 'state'],
          existingInvoiceIds.length
        )
        const latest = (invoices || []).slice().sort((a: any, b: any) => Number(b.id) - Number(a.id))[0]
        if (latest?.id && workspaceId) {
          await upsertEntityLink(
            {
              workspaceId,
              platform,
              storeId: String(storeId),
              odooModel: 'account.move',
              storeEntityId: String(zidEntityId),
            },
            Number(latest.id)
          ).catch(e => console.warn('[SyncEngine] Invoice entity link failed:', e))
        }

        if (action === 'create_and_post') {
          // Post draft invoices
          const draftInvoices = (invoices || []).filter((inv: any) => inv.state === 'draft')
          for (const inv of draftInvoices) {
            try {
              await client.execute('account.move', 'action_post', [inv.id])
              console.info(`[SyncEngine] Posted invoice #${inv.id} for sale.order #${orderId}`)
            } catch (postErr: any) {
              try {
                await client.execute('account.move', 'action_post', [[inv.id]])
              } catch (pErr2: any) {
                try {
                  await client.execute('account.move', 'post', [inv.id])
                  console.info(`[SyncEngine] Posted invoice #${inv.id} via post fallback for sale.order #${orderId}`)
                } catch (pErr3: any) {
                  console.warn(`[SyncEngine] Failed to post invoice #${inv.id}:`, pErr3?.message || pErr3)
                }
              }
            }
          }
        }

        // Reconcile any existing payment previously created for this order
        for (const invId of existingInvoiceIds) {
          await reconcilePendingPaymentsForOrder({
            client,
            saleOrderId: orderId,
            invoiceId: invId,
            workspaceId,
            platform,
            storeId,
            zidEntityId,
          }).catch(recErr => console.warn('[SyncEngine] Pending payment reconciliation error:', recErr?.message || recErr))
        }
      }
      return
    }

    if (action === 'post') {
      let invoiceIds: number[] = Array.isArray(order.invoice_ids)
        ? order.invoice_ids.filter((v: unknown) => Number.isInteger(Number(v)) && Number(v) > 0)
        : []
      if (invoiceIds.length === 0) {
        const directId = await createDraftInvoiceForOrder(client, orderId)
        if (directId) invoiceIds = [directId]
      }
      if (invoiceIds.length > 0) {
        const invoicesToPost = await client.searchRead<any>(
          'account.move',
          [['id', 'in', invoiceIds], ['move_type', '=', 'out_invoice'], ['state', '=', 'draft']],
          ['id']
        )
        for (const inv of invoicesToPost || []) {
          try {
            await client.execute('account.move', 'action_post', [inv.id])
            console.info(`[SyncEngine] Posted draft invoice #${inv.id} for sale.order #${orderId}`)
          } catch (postErr: any) {
            try {
              await client.execute('account.move', 'action_post', [[inv.id]])
            } catch (pErr2: any) {
              try {
                await client.execute('account.move', 'post', [inv.id])
                console.info(`[SyncEngine] Posted invoice #${inv.id} via post fallback for sale.order #${orderId}`)
              } catch (pErr3: any) {
                console.warn(`[SyncEngine] Failed to post invoice #${inv.id}:`, pErr3?.message || pErr3)
              }
            }
          }

          await reconcilePendingPaymentsForOrder({
            client,
            saleOrderId: orderId,
            invoiceId: inv.id,
            workspaceId,
            platform,
            storeId,
            zidEntityId,
          }).catch(recErr => console.warn('[SyncEngine] Pending payment reconciliation error:', recErr?.message || recErr))
        }
      }
      return
    }

    if (action === 'cancel') {
      const invoiceIds: number[] = Array.isArray(order.invoice_ids)
        ? order.invoice_ids.filter((v: unknown) => Number.isInteger(Number(v)) && Number(v) > 0)
        : []
      if (invoiceIds.length > 0) {
        const invoicesToCancel = await client.searchRead<any>(
          'account.move',
          [['id', 'in', invoiceIds], ['move_type', '=', 'out_invoice'], ['state', '!=', 'cancel']],
          ['id', 'state']
        )
        for (const inv of invoicesToCancel || []) {
          try {
            await client.execute('account.move', 'button_cancel', [inv.id])
            console.info(`[SyncEngine] Cancelled invoice #${inv.id} for sale.order #${orderId}`)
          } catch (cancelErr: any) {
            try {
              await client.execute('account.move', 'action_cancel', [inv.id])
            } catch {
              await client.write('account.move', [inv.id], { state: 'cancel' }).catch(() => {})
            }
          }
        }
      }
      return
    }
  } catch (err: any) {
    console.warn(`[SyncEngine] Invoice action "${action}" failed for order #${orderId} (status "${zidStatus}"):`, err?.message || err)
  }
}

// ──── Helper: dispatch the configured status action after the record write ─────
// Looks up the order_status_mappings row for the payload status:
//   - no row      → nothing (legacy passive state write already applied upstream)
//   - disabled    → Odoo fully untouched for this status
//   - enabled     → real workflow transition via applyOrderStatusAction, applyOrderPickingAction, applyOrderInvoiceAction
/**
 * Verifies and enforces the correct country VAT on all sale.order.line items in Odoo.
 * Whenever an order is created, confirmed, or updated, Odoo's internal compute logic can
 * automatically reset taxes to domestic 15% VAT on export orders.
 * This function inspects the order lines and explicitly enforces the tax ID configured in
 * Standard Mapping by destination shipping country (e.g. 0% for Egypt/UAE/OTHER).
 */
export async function ensureSaleOrderTaxes(
  client: OdooClient,
  odooOrderId: number,
  zidData: Record<string, unknown>,
  workspaceId: string,
  platform?: 'zid' | 'salla' | 'shopify',
  storeId = '',
  strict = false,
): Promise<void> {
  if (!workspaceId || !odooOrderId) return
  try {
    const resolvedPlatform = platform || 'zid'
    const orderStdSettings = await getCachedStandardMappingSettings(workspaceId, resolvedPlatform, 'orders', storeId)
    const enableVat = orderStdSettings?.enable_vat ?? (orderStdSettings as any)?.order?.enable_vat ?? false
    // Preserve Salla/Shopify's legacy non-VAT behaviour; this zero-tax fix
    // applies only to the Zid Standard Mapping orders contract.
    if (!enableVat && resolvedPlatform !== 'zid') return
    // Odoo recalculates default product and shipping taxes during sale.order writes.
    // When Standard Mapping disables VAT, a no-op here silently restores those
    // inherited taxes on status updates even if create had correctly cleared them.
    // Read each line below and clear only mismatching taxes, also in zero-VAT mode.
    const vatCountryRules: VatCountryRule[] = (
      orderStdSettings?.vat_country_rules
      ?? (orderStdSettings as any)?.order?.vat_country_rules
      ?? []
    )
    const vatSaudiTaxId = orderStdSettings?.vat_saudi_tax_id ?? (orderStdSettings as any)?.order?.vat_saudi_tax_id
    const vatNonSaudiTaxId = orderStdSettings?.vat_non_saudi_tax_id ?? (orderStdSettings as any)?.order?.vat_non_saudi_tax_id

    const { taxId: expectedTaxId, destinationCountryCode, appliedCountryCode } = enableVat
      ? resolveOrderVatTax(zidData, {
          enableVat: true,
          vatCountryRules,
          vatSaudiTaxId,
          vatNonSaudiTaxId,
        })
      : { taxId: null, destinationCountryCode: '', appliedCountryCode: 'VAT disabled by Orders Standard Mapping' }

    const expectedTaxIds = expectedTaxId ? [expectedTaxId] : []

    const majorVersion = await client.getMajorVersion().catch(() => 19)
    let taxField = majorVersion >= 18 ? 'tax_ids' : 'tax_id'

    let lines: any[] = []
    try {
      lines = await client.searchRead<any>(
        'sale.order.line',
        [['order_id', '=', odooOrderId], ['display_type', '=', false]],
        ['id', 'name', taxField]
      )
    } catch {
      taxField = taxField === 'tax_ids' ? 'tax_id' : 'tax_ids'
      lines = await client.searchRead<any>(
        'sale.order.line',
        [['order_id', '=', odooOrderId], ['display_type', '=', false]],
        ['id', 'name', taxField]
      )
    }

    if (!lines || lines.length === 0) {
      if (strict) throw new Error('Cannot verify taxes: Odoo sale order has no readable lines')
      return
    }

    const linesNeedingUpdate: number[] = []
    for (const line of lines) {
      const rawTaxes = line[taxField] ?? line.tax_ids ?? line.tax_id
      const currentTaxIds: number[] = Array.isArray(rawTaxes)
        ? rawTaxes.map(Number).filter(n => !isNaN(n) && n > 0)
        : []

      const isMatch = (
        (expectedTaxIds.length === 0 && currentTaxIds.length === 0) ||
        (expectedTaxIds.length === currentTaxIds.length && expectedTaxIds.every(t => currentTaxIds.includes(t)))
      )

      if (!isMatch) {
        linesNeedingUpdate.push(line.id)
      }
    }

    if (linesNeedingUpdate.length > 0) {
      const taxCmd = expectedTaxIds.length > 0 ? [[6, 0, expectedTaxIds]] : [[6, 0, []]]
      // Odoo 20 forbids changing tax_ids once a sale order is locked. Status
      // actions such as Delivered can lock the order before this strict
      // post-workflow tax verification runs. Temporarily unlock only when a
      // tax correction is actually needed, then restore the original lock.
      let relockAfterTaxWrite = false
      if (majorVersion >= 20) {
        try {
          const [orderState] = await client.searchRead<any>(
            'sale.order',
            [['id', '=', odooOrderId]],
            ['id', 'locked'],
            1
          )
          if (orderState?.locked === true) {
            const unlocked = await client.write('sale.order', [odooOrderId], { locked: false })
            if (strict && !unlocked) throw new Error('Odoo rejected temporary unlock for configured taxes')
            relockAfterTaxWrite = unlocked === true
          }
        } catch (unlockErr) {
          if (strict) throw unlockErr
          console.warn(
            `[SyncEngine] Could not temporarily unlock sale.order #${odooOrderId} before tax enforcement:`,
            (unlockErr as any)?.message || unlockErr
          )
        }
      }

      try {
        const written = await client.write('sale.order.line', linesNeedingUpdate, {
          [taxField]: taxCmd,
        })
        if (strict && !written) throw new Error('Odoo rejected the configured order taxes')
      } finally {
        if (relockAfterTaxWrite) {
          const relocked = await client.write('sale.order', [odooOrderId], { locked: true })
          if (strict && !relocked) throw new Error('Odoo rejected restoring the sale order lock after configured taxes')
        }
      }
      console.info(
        `[SyncEngine] ✅ Enforced destination tax (${expectedTaxIds.length > 0 ? expectedTaxIds.join(',') : '0%'} ` +
        `for country "${destinationCountryCode || 'Unknown'}" matched "${appliedCountryCode}") on ${linesNeedingUpdate.length} line(s) of sale.order #${odooOrderId}`
      )
    }

    // A successful RPC acknowledgement alone cannot prove taxes stayed applied.
    // Odoo customizations may recompute tax_ids during or immediately after a
    // write. Re-read persisted lines before declaring the Zid event successful.
    if (strict) {
      const confirmedLines = await client.searchRead<any>(
        'sale.order.line',
        [['order_id', '=', odooOrderId], ['display_type', '=', false]],
        ['id', taxField],
      )
      const expectedLineIds = new Set(lines.map((line: any) => Number(line.id)))
      if (confirmedLines.length !== expectedLineIds.size ||
          confirmedLines.some((line: any) => !expectedLineIds.has(Number(line.id)))) {
        throw new Error('ERP_OUTCOME_UNKNOWN: Odoo order lines changed while validating taxes')
      }
      for (const line of confirmedLines) {
        const raw = line[taxField]
        if (!Array.isArray(raw)) {
          throw new Error('Configured order taxes could not be read back')
        }
        const current = raw.map(Number).filter((id: number) => Number.isInteger(id) && id > 0)
        if (current.length !== expectedTaxIds.length ||
            current.some((id: number) => !expectedTaxIds.includes(id))) {
          throw new Error('Configured order taxes did not persist in Odoo')
        }
      }
    }
  } catch (err: any) {
    if (strict) throw err
    console.warn(`[SyncEngine] Failed to enforce order lines taxes on sale.order #${odooOrderId} (non-fatal):`, err?.message || err)
  }
}

/**
 * Financial preflight for Zid's explicitly mapped COD fee.
 *
 * Order lines are intentionally immutable after Odoo confirmation. If a
 * historic sale.order predates today's COD mapping, status actions must not
 * post an under-valued invoice and then claim webhook success. A nonzero Zid
 * payment.invoice COD row is authoritative; never manufacture an extra line
 * on a locked or already invoiced order. The merchant must reconcile it.
 */
/**
 * Last financial gate before a Zid status action creates/posts an invoice.
 * Compare the actual persisted Odoo sale.order total (after all settings,
 * taxes, shipping, discounts, and COD) against the authoritative Zid order
 * total. Legacy confirmed orders can predate a changed Standard Mapping and
 * cannot safely have their lines mutated during a status webhook.
 */
export async function assertZidOrderTotalBeforeInvoice(
  client: OdooClient,
  saleOrderId: number,
  zidData: Record<string, unknown>,
  settings: Record<string, any> | null | undefined,
): Promise<void> {
  const value = zidData.order_total ??
    (zidData.payment_summary as Record<string, unknown> | undefined)?.total
  if (value === null || value === undefined || value === '') {
    // Partial webhooks are allowed; full Zid enrichment normally provides the
    // authoritative order_total. Never infer an amount from product totals.
    return
  }
  const sourceTotal = Number(String(value).replace(/,/g, ''))
  if (!Number.isFinite(sourceTotal) || sourceTotal < 0) {
    throw new Error('order_invoice_source_total_invalid_requires_review')
  }

  const rateRaw = settings?._currency_conversion_rate ?? settings?.currency_conversion_rate ?? 1
  const rate = Number(rateRaw)
  if (!Number.isFinite(rate) || rate <= 0) {
    throw new Error('order_invoice_conversion_rate_invalid_requires_review')
  }

  const [record] = await client.searchRead<any>(
    'sale.order', [['id', '=', saleOrderId]],
    ['id', 'amount_total', 'currency_id'], 1,
  )
  if (!record) throw new Error('order_invoice_original_sale_order_unreadable')
  const actual = Number(record.amount_total)
  if (!Number.isFinite(actual)) {
    throw new Error('order_invoice_total_unreadable_requires_review')
  }
  // Native-currency comparisons must confirm the underlying currency; do not
  // accept equal bare numbers if source currency and ERP currency differ.
  const sourceCurrency = String(zidData.currency_code || '').trim().toUpperCase()
  if (sourceCurrency && rate === 1) {
    const raw = record.currency_id
    const currencyId = Number(Array.isArray(raw) ? raw[0] : raw)
    if (!Number.isSafeInteger(currencyId) || currencyId <= 0) {
      throw new Error('order_invoice_currency_unreadable_requires_review')
    }
    const [currency] = await client.searchRead<any>(
      'res.currency', [['id', '=', currencyId]], ['id', 'name'], 1,
    )
    const targetCode = String(currency?.name || '').trim().toUpperCase()
    if (!targetCode || targetCode !== sourceCurrency) {
      throw new Error('order_invoice_currency_mismatch_requires_review')
    }
  }

  const expected = Math.round(sourceTotal * rate * 100) / 100
  if (Math.abs(actual - expected) > 0.05) {
    throw new Error(`order_invoice_total_mismatch_requires_review:${saleOrderId}:${expected}:${actual}`)
  }
}

export async function assertZidCodFeeBeforeInvoice(
  client: OdooClient,
  saleOrderId: number,
  zidData: Record<string, unknown>,
  settings: Record<string, any> | null | undefined,
): Promise<void> {
  const order = settings?.order || {}
  const configured = order.add_cod_as_line ?? settings?.add_cod_as_line
  if (configured !== true) return
  const fee = resolveZidCodAmount(zidData)
  if (!(fee > 0)) return

  const rawId = order.cod_product_id ?? settings?.cod_product_id
  const productId = Number(rawId)
  if (!Number.isSafeInteger(productId) || productId <= 0) {
    // Even if a merchant configured an SKU-only fallback, an invoice should
    // never post without an actual Odoo fee line to reconcile against.
    throw new Error('order_cod_fee_product_not_configured_requires_review')
  }

  const lines = await client.searchRead<any>(
    'sale.order.line',
    [['order_id', '=', saleOrderId], ['display_type', '=', false]],
    ['id', 'product_id', 'price_total'],
    200,
  )
  const matching = (lines || []).filter(line => {
    const raw = line.product_id
    const id = Number(Array.isArray(raw) ? raw[0] : raw)
    return id === productId
  })
  if (!matching.length) {
    throw new Error(`order_cod_fee_missing_on_sale_order_requires_review:${saleOrderId}:${fee}`)
  }

  // price_total is the actual persisted amount including applied Odoo tax,
  // unlike price_unit which is pre-tax when prices_include_tax is enabled.
  // The same currency conversion rate used by the order-line builder must
  // apply to the incoming Zid COD fee before comparing the amounts.
  const rateRaw = settings?._currency_conversion_rate ?? settings?.currency_conversion_rate ?? 1
  const rate = Number(rateRaw)
  if (!Number.isFinite(rate) || rate <= 0) {
    throw new Error('order_cod_fee_currency_rate_invalid_requires_review')
  }
  const actual = matching.reduce((sum: number, line: any) => sum + Number(line.price_total ?? NaN), 0)
  const expected = Math.round(fee * rate * 100) / 100
  if (!Number.isFinite(actual) || Math.abs(actual - expected) > 0.02) {
    throw new Error(`order_cod_fee_amount_mismatch_requires_review:${saleOrderId}:${expected}:${actual}`)
  }
}

export async function maybeApplyOrderStatusAction(
  client: OdooClient,
  odooRecordId: number,
  zidData: Record<string, unknown>,
  workspaceId: string,
  platform?: 'zid' | 'salla' | 'shopify',
  storeId = '',
  sallaCreateSettings?: { auto_confirm?: boolean; auto_invoice?: boolean },
): Promise<void> {
  try {
    const zidStatus = resolveZidStatus(zidData)
    if (!zidStatus && !sallaCreateSettings) return

    const resolvedPlatform = platform || 'zid'
    const syncConfiguredPayment = async () => {
      const result = await syncOrderPayment({ client, saleOrderId: odooRecordId, zidData,
        workspaceId, platform: resolvedPlatform, storeId,
        zidEntityId: String(zidData.id || (zidData as any).order_id || ''),
      })
      if ((resolvedPlatform === 'zid' || sallaCreateSettings) && result.errorReason) {
        throw new Error(`Configured order payment failed: ${result.errorReason}`)
      }
    }

    // ── 1. Always update the custom status selection field in Odoo if configured ──
    try {
      const orderStdSettings = await getCachedStandardMappingSettings(workspaceId, resolvedPlatform, 'orders', storeId)
      const customField = orderStdSettings?.order_status_custom_field || (orderStdSettings as any)?.order?.order_status_custom_field
      const isEnabled = orderStdSettings?.update_custom_status_field !== false && (orderStdSettings as any)?.order?.update_custom_status_field !== false
      if (zidStatus && customField && isEnabled) {
        // Monotonic guard: do not downgrade an already completed / delivered / confirmed order to 'new' or 'draft'
        let shouldWriteCustom = true
        if (zidStatus === 'new' || zidStatus === 'draft') {
          try {
            const currentRec = await client.searchRead<any>('sale.order', [['id', '=', odooRecordId]], ['state', customField], 1)
            const curState = currentRec?.[0]?.state
            const curCustom = currentRec?.[0]?.[customField]
            const isAdvancedState = curState === 'sale' || curState === 'done' || curState === 'cancel'
            const isAdvancedCustom = curCustom && curCustom !== 'new' && curCustom !== 'draft'
            if (isAdvancedState || isAdvancedCustom) {
              console.info(`[SyncEngine] Skipping custom status downgrade to "${zidStatus}" on sale.order #${odooRecordId} (current state="${curState}", ${customField}="${curCustom}")`)
              shouldWriteCustom = false
            }
          } catch {
            // Non-fatal
          }
        }
        if (shouldWriteCustom) {
          const knownKeys = await getSaleOrderSelectionKeys(client, workspaceId, customField)
          if (!knownKeys || knownKeys.has(zidStatus)) {
            const written = await client.write('sale.order', [odooRecordId], { [customField]: zidStatus })
            if (!written && sallaCreateSettings) throw new Error('Odoo rejected the configured order status field')
            console.info(`[SyncEngine] Synced ${resolvedPlatform} status "${zidStatus}" to custom field "${customField}" on sale.order #${odooRecordId}`)
          } else {
            console.warn(`[SyncEngine] Skipping custom status "${zidStatus}" on sale.order #${odooRecordId} — not an option of "${customField}"`)
          }
        }
      }
    } catch (fieldErr: any) {
      if (resolvedPlatform === 'zid' || sallaCreateSettings) throw fieldErr
      console.warn(`[SyncEngine] Failed to write custom status field on sale.order #${odooRecordId} (non-fatal):`, fieldErr?.message || fieldErr)
    }

    // ── 2. Apply mapped native workflow transition ──
    const configuredRow = zidStatus ? await getOrderStatusRow(workspaceId, zidStatus, resolvedPlatform, storeId) : null
    const row = sallaCreateSettings ? {
      enabled: configuredRow?.enabled ?? true,
      odoo_state: configuredRow?.odoo_state || (sallaCreateSettings.auto_confirm ? 'sale' : ''),
      picking_action: configuredRow?.picking_action || '',
      invoice_action: configuredRow?.invoice_action || (sallaCreateSettings.auto_invoice && configuredRow?.odoo_state !== 'cancel' ? 'create' : ''),
    } : configuredRow || (resolvedPlatform === 'zid' ? {
      odoo_state: getSmartDefaultOrderState(zidStatus, resolvedPlatform) || '', enabled: true,
      picking_action: '', invoice_action: '',
    } : null)
    if (!row) {
      await syncConfiguredPayment()
      console.info(`[SyncEngine] No status mapping row for "${zidStatus}" (${resolvedPlatform}) — status action skipped`)
      return
    }
    if (!row.enabled) {
      await syncConfiguredPayment()
      console.info(`[SyncEngine] Status "${zidStatus}" mapping is DISABLED — Odoo untouched (#${odooRecordId})`)
      return
    }

    // When store return handling is active (negative_so or stock_return_credit_note),
    // a return status must NOT cancel the original sale order via the status mapping ladder:
    // the return policy manages returns cleanly without voiding the original sale.
    const isReturnStatus =
      zidStatus === 'reversed' ||
      zidStatus === 'partially_reversed' ||
      zidStatus === 'reverse_in_progress' ||
      zidStatus.includes('reverse') ||
      zidStatus.includes('مرتجع') ||
      zidStatus.includes('استرجاع')
    if (isReturnStatus) {
      try {
        const orderStdSettings = await getCachedStandardMappingSettings(workspaceId, resolvedPlatform, 'orders', storeId)
        const returnMode = orderStdSettings?.order?.returns?.mode || (orderStdSettings as any)?.returns?.mode
        if (returnMode && returnMode !== 'nothing' && row.odoo_state === 'cancel') {
          console.info(
            `[SyncEngine] Status "${zidStatus}" mapping to "cancel" skipped on order #${odooRecordId} because return handling policy is active ("${returnMode}")`
          )
          return
        }
      } catch {
        // Fall through
      }
    }

    // 2a. Order state action (quotation, confirm, done, cancel)
    if (row.odoo_state) {
      await applyOrderStatusAction(client, odooRecordId, row.odoo_state, zidStatus)
    }

    // 2b. Stock picking action (create, validate, create_and_validate, cancel)
    if (row.picking_action) {
      await applyOrderPickingAction(client, odooRecordId, row.picking_action, zidStatus)
    }

    // Keep invoice taxes consistent with the prepared SO before invoicing.
    // For Zid orders, a successful status event must not conceal a rejected
    // tax correction; otherwise the queue deletes the only retryable receipt.
    await ensureSaleOrderTaxes(client, odooRecordId, zidData, workspaceId, resolvedPlatform, storeId,
      resolvedPlatform === 'zid' || !!sallaCreateSettings)

    // 2c. Invoice action (create, post, create_and_post, cancel)
    const invoiceAction = row.invoice_action
    if (invoiceAction) {
      if (resolvedPlatform === 'zid' && /^(?:create|post|create_and_post)$/.test(invoiceAction)) {
        const orderSettings = await getCachedStandardMappingSettings(
          workspaceId, resolvedPlatform, 'orders', storeId,
        )
        await assertZidCodFeeBeforeInvoice(client, odooRecordId, zidData, orderSettings)
        await assertZidOrderTotalBeforeInvoice(client, odooRecordId, zidData, orderSettings)
      }
      const zidEntityId = String(zidData.id || (zidData as any).order_id || '')
      const applyInvoice = () => applyOrderInvoiceAction(
        client,
        odooRecordId,
        invoiceAction,
        zidStatus,
        workspaceId,
        resolvedPlatform,
        storeId,
        zidEntityId
      )
      if (sallaCreateSettings) await withErpCreateIdentity('salla-order-invoice', applyInvoice)
      else await applyInvoice()
    }

    if (sallaCreateSettings) {
      await assertOrderActionResults(client, odooRecordId, {
        ...row, invoice_action: row.invoice_action === 'post' ? 'create_and_post' : row.invoice_action,
      })
    }
    await syncConfiguredPayment()
    // Payment, invoice and workflow hooks may cause another Odoo tax recompute.
    // Verify the *final* persisted line taxes before claiming Zid status success.
    if (resolvedPlatform === 'zid') {
      await ensureSaleOrderTaxes(client, odooRecordId, zidData, workspaceId, resolvedPlatform, storeId, true)
      await assertOrderActionResults(client, odooRecordId, row)
    }
  } catch (err: any) {
    if ((platform || 'zid') === 'zid' || sallaCreateSettings) throw err
    console.warn('[SyncEngine] Status mapping dispatch failed (non-fatal):', err?.message || err)
  }
}

// ─── Helper: process partial delivery in Odoo ────────────────────────────────
export async function processPartialDelivery(
  client: OdooClient,
  odooModel: string,
  orderId: number,
  fulfilledItems: Array<{ sku: string; qty: number }>,
  _platform?: 'zid' | 'salla' | 'shopify',
): Promise<void> {
  // Find existing pickings for this order
  const pickings = await client.searchRead<any>('stock.picking', [
    ['origin', '=', `${odooModel},${orderId}`],
    ['state', '=', 'assigned']
  ], ['id', 'move_lines'])

  if (pickings.length > 0) {
    // Update existing picking moves with fulfilled quantities
    for (const picking of pickings) {
      const moveIds = await client.searchRead<any>('stock.move', [
        ['picking_id', '=', picking.id]
      ], ['id', 'product_id', 'product_uom_qty'])
      for (const move of moveIds) {
        const fulfilled = fulfilledItems.find(f => {
          const prodId = parseInt(f.sku)
          return !isNaN(prodId) && prodId === move.product_id[0]
        })
        if (fulfilled && fulfilled.qty < move.product_uom_qty) {
          await client.write('stock.move', [move.id], { product_uom_qty: fulfilled.qty })
        }
      }
      // Validate (transfer) the picking — Odoo auto-creates backorder
      await client.execute('stock.picking', 'action_assign', [picking.id])
      await client.execute('stock.picking', 'button_validate', [picking.id])
    }
  } else {
    // No existing picking — create one with partial quantities
    const orderLines = await client.searchRead<any>('sale.order.line', [
      ['order_id', '=', orderId]
    ], ['id', 'product_id', 'product_uom_qty'])
    if (orderLines.length > 0) {
      const moveVals: Record<string, any>[] = []
      for (const ol of orderLines) {
        const fulfilled = fulfilledItems.find(f => {
          const prodId = parseInt(f.sku)
          return !isNaN(prodId) && prodId === ol.product_id[0]
        })
        const qty = fulfilled ? fulfilled.qty : ol.product_uom_qty
        if (qty > 0) {
          moveVals.push({
            product_id: ol.product_id[0],
            product_uom_qty: qty,
            sale_line_id: ol.id,
            name: ol.product_id[1] || 'Delivery',
          })
        }
      }
      if (moveVals.length > 0) {
        const pickingData: Record<string, any> = {
          picking_type_id: (await client.searchRead<any>('stock.picking.type', [['code', '=', 'outgoing']], ['id'], 1))[0]?.id,
          location_id: (await client.searchRead<any>('stock.location', [['usage', '=', 'internal']], ['id'], 1))[0]?.id,
          location_dest_id: (await client.searchRead<any>('stock.location', [['usage', '=', 'customer']], ['id'], 1))[0]?.id,
          origin: `${odooModel},${orderId}`,
          move_lines: moveVals.map(m => [0, 0, m]),
        }
        const newPickingId = await client.create('stock.picking', pickingData)
        await client.execute('stock.picking', 'action_assign', [newPickingId])
        await client.execute('stock.picking', 'button_validate', [newPickingId])
      }
    }
  }
}

// ─── Helper: process complete/full delivery in Odoo via stock.picking ─────────
export async function processFullDelivery(client: OdooClient, odooModel: string, orderId: number): Promise<void> {
  const orders = await client.searchRead<any>(odooModel, [['id', '=', orderId]], ['name', 'picking_ids'])
  const order = orders[0]
  let pickingIds: number[] = Array.isArray(order?.picking_ids) ? order.picking_ids : []

  if (pickingIds.length === 0 && order?.name) {
    const pickings = await client.searchRead<any>('stock.picking', [
      ['origin', '=', order.name],
      ['state', 'not in', ['done', 'cancel']]
    ], ['id'])
    pickingIds = pickings.map(p => p.id)
  }

  if (pickingIds.length > 0) {
    for (const pId of pickingIds) {
      try {
        const pRecs = await client.searchRead<any>('stock.picking', [['id', '=', pId]], ['state'])
        const state = pRecs[0]?.state
        if (state === 'done' || state === 'cancel') continue

        if (state === 'draft' || state === 'confirmed') {
          await client.execute('stock.picking', 'action_assign', [pId]).catch(() => {})
        }

        const moves = await client.searchRead<any>('stock.move', [['picking_id', '=', pId]], ['id', 'product_uom_qty'])
        for (const m of moves) {
          try {
            await client.write('stock.move', [m.id], { quantity: m.product_uom_qty }).catch(async () => {
              await client.write('stock.move', [m.id], { quantity_done: m.product_uom_qty }).catch(() => {})
            })
          } catch {
            // ignore field differences across Odoo versions
          }
        }

        await client.execute('stock.picking', 'button_validate', [pId], { context: { skip_sms: true } })
        console.info(`[SyncEngine] Validated picking #${pId} for order #${orderId}`)
      } catch (pickErr: any) {
        console.warn(`[SyncEngine] Failed to validate picking #${pId}:`, pickErr?.message || pickErr)
      }
    }
  } else {
    console.info(`[SyncEngine] No pickings found to validate for order #${orderId}`)
  }
}
