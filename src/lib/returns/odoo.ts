/**
 * Odoo side of the return pipeline.
 *
 * Version notes (the app supports Odoo 16-19; production is 19):
 *   - `stock.move` quantity is `quantity` on 17+ and `quantity_done` before.
 *   - The return wizard method is `action_create_returns` on 17+ and
 *     `create_returns` before; both are attempted at runtime instead of
 *     pinning a version, because a custom build can lag behind its version.
 *   - `account.move.reversal` is deliberately NOT used: it reverses the WHOLE
 *     invoice, while a merchant return is usually partial. A manual
 *     `out_refund` with `reversed_entry_id` + `sale_line_ids` works on every
 *     supported version and matches the returned quantities exactly.
 *   - UoM is never written: lines inherit it from the product, which removes
 *     the `product_uom` -> `uom_id` rename from the equation.
 */

import { resolveEntityLinkId, upsertEntityLink } from '@/lib/entity-links'
import { assertSaleOrderLinkOwnership } from '@/lib/orders/matching'
import { getCachedStandardMappingSettings } from '@/lib/sync/settings'
import { resolveZidMatchValue } from '@/lib/sync-helpers'
import { supabaseAdmin } from '@/lib/sync-runtime'
import {
  extractOrderLocationInfo,
  paymentKeysFromOrder,
  resolveAnalyticDistribution,
  toOdooAnalyticFields,
} from '@/lib/odoo/analytic-distribution'
import type { OdooClient } from '@/lib/odoo-client'
import {
  platformIdFieldNames,
  type PlatformKey,
} from '@/lib/platform-fields'
import { supabase } from '@/lib/supabase'

export interface SaleOrderLineInfo {
  id: number
  productId: number
  productName: string
  orderedQty: number
  deliveredQty: number
  priceUnit: number
  taxIds: number[]
  discount?: number
  productUomId?: number | null
  analyticDistribution?: Record<string, number> | null
  analyticAccountId?: number | null
  analyticTagIds?: number[]
}

export interface OriginalSaleOrder {
  id: number
  name: string
  state: string
  partnerId: number | null
  partnerInvoiceId?: number | null
  partnerShippingId?: number | null
  pricelistId: number | null
  companyId: number | null
  warehouseId: number | null
  fiscalPositionId?: number | null
  paymentTermId?: number | null
  teamId?: number | null
  userId?: number | null
  analyticAccountId?: number | null
  invoiceIds: number[]
  lines: SaleOrderLineInfo[]
}

export interface OdooReturnLine {
  productId: number
  quantity: number
  priceUnit: number
  name: string
  taxIds: number[]
  discount?: number
  productUomId?: number | null
  analyticDistribution?: Record<string, number> | null
  analyticAccountId?: number | null
  analyticTagIds?: number[]
  saleLineId?: number
}

function many2oneId(value: unknown): number | null {
  if (Array.isArray(value) && value.length > 0) {
    const id = Number(value[0])
    return Number.isInteger(id) && id > 0 ? id : null
  }
  const id = Number(value)
  return Number.isInteger(id) && id > 0 ? id : null
}

function many2manyIds(value: unknown): number[] {
  if (!Array.isArray(value)) return []
  return value
    .map(v => Number(Array.isArray(v) ? v[0] : v))
    .filter(v => Number.isInteger(v) && v > 0)
}

function toNumber(value: unknown): number {
  const n = Number(value)
  return Number.isFinite(n) ? n : 0
}

const RETURN_REF_PREFIX = 'RET:'

export function returnRefFor(orderName: string): string {
  return `${RETURN_REF_PREFIX}${orderName}`
}

function parseAnalyticDistribution(val: unknown): Record<string, number> | null {
  if (val && typeof val === 'object' && !Array.isArray(val)) {
    const res: Record<string, number> = {}
    for (const [k, v] of Object.entries(val)) {
      const n = Number(v)
      if (Number.isFinite(n)) res[k] = n
    }
    if (Object.keys(res).length > 0) return res
  }
  return null
}

export async function readSaleOrder(
  client: OdooClient,
  orderId: number
): Promise<OriginalSaleOrder | null> {
  const majorVersion = await client.getMajorVersion().catch(() => 17)
  const fullOrderFields = [
    'id',
    'name',
    'state',
    'partner_id',
    'partner_invoice_id',
    'partner_shipping_id',
    'pricelist_id',
    'company_id',
    'warehouse_id',
    'fiscal_position_id',
    'payment_term_id',
    'team_id',
    'user_id',
    ...(majorVersion < 17 ? ['analytic_account_id'] : []),
    'invoice_ids',
    'order_line',
  ]
  const coreOrderFields = [
    'id',
    'name',
    'state',
    'partner_id',
    'pricelist_id',
    'company_id',
    'warehouse_id',
    'invoice_ids',
    'order_line',
  ]

  let order: any = null
  try {
    const [found] = await client.searchRead<any>(
      'sale.order',
      [['id', '=', orderId]],
      fullOrderFields,
      1
    )
    order = found
  } catch {
    const [found] = await client.searchRead<any>(
      'sale.order',
      [['id', '=', orderId]],
      coreOrderFields,
      1
    )
    order = found
  }
  if (!order?.id) return null

  const lineIds = many2manyIds(order.order_line)
  const lines: SaleOrderLineInfo[] = []
  if (lineIds.length > 0) {
    const majorVersion = await client.getMajorVersion().catch(() => 17)
    const taxField = majorVersion >= 18 ? 'tax_ids' : 'tax_id'
    const uomField = majorVersion >= 18 ? 'product_uom_id' : 'product_uom'
    const fullLineFields = [
      'id',
      'product_id',
      'name',
      'product_uom_qty',
      'qty_delivered',
      'price_unit',
      'discount',
      uomField,
      taxField,
      ...(majorVersion >= 16 ? ['analytic_distribution'] : ['analytic_account_id', 'analytic_tag_ids']),
    ]
    let rows: any[] = []
    try {
      rows = await client.searchRead<any>(
        'sale.order.line',
        [['id', 'in', lineIds]],
        fullLineFields,
        lineIds.length
      )
    } catch {
      try {
        const altTaxField = taxField === 'tax_ids' ? 'tax_id' : 'tax_ids'
        const altUomField = uomField === 'product_uom_id' ? 'product_uom' : 'product_uom_id'
        rows = await client.searchRead<any>(
          'sale.order.line',
          [['id', 'in', lineIds]],
          [
            'id',
            'product_id',
            'name',
            'product_uom_qty',
            'qty_delivered',
            'price_unit',
            'discount',
            altUomField,
            altTaxField,
            ...(majorVersion >= 16 ? ['analytic_distribution'] : ['analytic_account_id', 'analytic_tag_ids']),
          ],
          lineIds.length
        )
      } catch {
        rows = await client.searchRead<any>(
          'sale.order.line',
          [['id', 'in', lineIds]],
          ['id', 'product_id', 'name', 'product_uom_qty', 'qty_delivered', 'price_unit', 'discount'],
          lineIds.length
        )
      }
    }
    for (const row of rows || []) {
      const productId = many2oneId(row.product_id)
      if (!productId) continue
      lines.push({
        id: Number(row.id),
        productId,
        productName: String(row.name || ''),
        orderedQty: toNumber(row.product_uom_qty),
        deliveredQty: toNumber(row.qty_delivered),
        priceUnit: toNumber(row.price_unit),
        taxIds: many2manyIds(row[taxField] ?? row.tax_ids ?? row.tax_id),
        discount: toNumber(row.discount),
        productUomId: many2oneId(row[uomField] ?? row.product_uom_id ?? row.product_uom),
        analyticDistribution: parseAnalyticDistribution(row.analytic_distribution),
        analyticAccountId: many2oneId(row.analytic_account_id),
        analyticTagIds: many2manyIds(row.analytic_tag_ids),
      })
    }
  }

  return {
    id: Number(order.id),
    name: String(order.name || ''),
    state: String(order.state || ''),
    partnerId: many2oneId(order.partner_id),
    partnerInvoiceId: many2oneId(order.partner_invoice_id),
    partnerShippingId: many2oneId(order.partner_shipping_id),
    pricelistId: many2oneId(order.pricelist_id),
    companyId: many2oneId(order.company_id),
    warehouseId: many2oneId(order.warehouse_id),
    fiscalPositionId: many2oneId(order.fiscal_position_id),
    paymentTermId: many2oneId(order.payment_term_id),
    teamId: many2oneId(order.team_id),
    userId: many2oneId(order.user_id),
    analyticAccountId: many2oneId(order.analytic_account_id),
    invoiceIds: many2manyIds(order.invoice_ids),
    lines,
  }
}

/**
 * Resiliently resolve the original Odoo sale order for a store return.
 *
 * Checks in order:
 * 1. odoo_entity_links (fastest, permanent store-scoped link)
 * 2. sync_logs (recent order sync records)
 * 3. Direct Odoo search by client_order_ref, origin, name, or x_<platform>_id
 *
 * If found via fallback, the link is saved to odoo_entity_links for fast subsequent queries.
 */
export async function findOriginalSaleOrder(
  client: OdooClient,
  params: {
    workspaceId: string
    platform: PlatformKey
    storeId: string
    orderId: string
    orderCode?: string
    payload?: Record<string, unknown>
  }
): Promise<OriginalSaleOrder | null> {
  const { workspaceId, platform, storeId, orderId, orderCode } = params
  const candidatesToLink = [orderId, orderCode].filter((id): id is string => Boolean(id && String(id).trim()))

  // Returns must respect the same configured Orders match pair as order
  // updates. If explicitly configured, never fall back to an unrelated
  // client_order_ref / name / platform ID when the configured key is missing.
  // This also protects a store's original sale.order from cross-order credits.
  const orderSettings = await getCachedStandardMappingSettings(
    workspaceId, platform, 'orders', storeId
  )
  const sourceField = String(orderSettings?.match_zid_field || '').trim()
  const targetField = String(orderSettings?.match_odoo_field || '').trim()
  if (sourceField || targetField) {
    if (!sourceField || !targetField) throw new Error('return_order_match_pair_incomplete')
    const raw = resolveZidMatchValue(params.payload || {}, sourceField)
    const sourceValue = raw ?? (sourceField === 'id' ? orderId : undefined)
    if (sourceValue === undefined || sourceValue === null || sourceValue === '') {
      throw new Error('return_order_match_source_missing:' + sourceField)
    }
    // Odoo text references are strings even when Zid sends a numeric ID.
    const typedValue = targetField === 'id' ? Number(sourceValue) : String(sourceValue)
    if (targetField === 'id' && (!Number.isSafeInteger(typedValue) || Number(typedValue) <= 0)) {
      throw new Error('return_order_match_invalid_id')
    }
    const found = await client.searchRead<any>('sale.order',
      [[targetField, '=', typedValue], ['state', '!=', 'cancel']],
      ['id', 'amount_total'], 2)
    if (found.length > 1) throw new Error('return_order_match_ambiguous:' + targetField)
    if (!found.length) return null
    const recordId = Number(found[0].id)
    if (!Number.isSafeInteger(recordId) || recordId <= 0 ||
        Number(found[0].amount_total) < 0) {
      throw new Error('return_order_match_invalid:' + targetField)
    }
    const linkedId = await resolveEntityLinkId({
      workspaceId, platform, storeId, odooModel: 'sale.order',
      storeEntityId: orderId,
    })
    if (linkedId && linkedId !== recordId) {
      throw new Error('return_order_match_conflicts_with_durable_link')
    }
    await assertSaleOrderLinkOwnership(supabaseAdmin, recordId, {
      workspaceId, platform, storeId, storeEntityId: orderId,
    })
    const original = await readSaleOrder(client, recordId)
    if (!original) throw new Error('return_order_match_readback_missing')
    const saved = await upsertEntityLink(
      { workspaceId, platform, storeId, odooModel: 'sale.order', storeEntityId: orderId },
      recordId,
    )
    if (!saved) throw new Error('return_order_match_link_not_saved')
    return original
  }

  // 1. Resolve via durable entity links (primary)
  for (const id of candidatesToLink) {
    const linkedId = await resolveEntityLinkId({
      workspaceId,
      platform,
      storeId,
      odooModel: 'sale.order',
      storeEntityId: id,
    })
    if (linkedId) {
      const order = await readSaleOrder(client, linkedId)
      if (order) return order
    }
  }

  // 2. Resolve via sync_logs
  for (const id of candidatesToLink) {
    try {
      const { data: logRow } = await supabase
        .from('sync_logs')
        .select('odoo_record_id')
        .eq('workspace_id', workspaceId)
        .eq('zid_entity_id', id)
        .eq('odoo_model', 'sale.order')
        .eq('status', 'success')
        .not('odoo_record_id', 'is', null)
        .order('created_at', { ascending: false })
        .limit(1)
        .maybeSingle()

      if (logRow?.odoo_record_id) {
        const idNum = Number(logRow.odoo_record_id)
        if (Number.isInteger(idNum) && idNum > 0) {
          const order = await readSaleOrder(client, idNum)
          if (order) {
            void upsertEntityLink(
              { workspaceId, platform, storeId, odooModel: 'sale.order', storeEntityId: orderId },
              idNum
            )
            return order
          }
        }
      }
    } catch {
      // Continue to direct search
    }
  }

  // 3. Fallback: Search directly in Odoo sale.order by standard reference fields
  for (const field of ['client_order_ref', 'origin', 'name']) {
    for (const val of candidatesToLink) {
      try {
        const found = await client.searchRead<any>(
          'sale.order',
          [[field, '=', val]],
          ['id'],
          1
        )
        const first = Array.isArray(found) ? found[0] : null
        if (first?.id) {
          const idNum = Number(first.id)
          const order = await readSaleOrder(client, idNum)
          if (order) {
            void upsertEntityLink(
              { workspaceId, platform, storeId, odooModel: 'sale.order', storeEntityId: orderId },
              idNum
            )
            return order
          }
        }
      } catch {
        // Field not searchable or error, try next
      }
    }
  }

  // 4. Try custom platform id fields (e.g. x_zid_id)
  for (const field of platformIdFieldNames(platform)) {
    for (const val of candidatesToLink) {
      try {
        const found = await client.searchRead<any>(
          'sale.order',
          [[field, '=', val]],
          ['id'],
          1
        )
        const first = Array.isArray(found) ? found[0] : null
        if (first?.id) {
          const idNum = Number(first.id)
          const order = await readSaleOrder(client, idNum)
          if (order) {
            void upsertEntityLink(
              { workspaceId, platform, storeId, odooModel: 'sale.order', storeEntityId: orderId },
              idNum
            )
            return order
          }
        }
      } catch {
        // Field does not exist on this Odoo database
      }
    }
  }

  return null
}

/**
 * Store product id / SKU -> Odoo `product.product` id.
 *
 * The engine stores `x_<platform>_id` on `product.template` (see AGENTS.md),
 * while sale lines reference the variant, so the template is searched first
 * and its `product_variant_id` is used.
 */
export async function resolveOdooProductId(
  client: OdooClient,
  platform: PlatformKey,
  storeProductId: string,
  sku: string
): Promise<number | null> {
  const idText = String(storeProductId || '').trim()
  if (idText) {
    for (const field of platformIdFieldNames(platform)) {
      try {
        const [template] = await client.searchRead<any>(
          'product.template',
          [[field, '=', idText]],
          ['id', 'product_variant_id'],
          1
        )
        const variantId = many2oneId(template?.product_variant_id)
        if (variantId) return variantId
      } catch {
        // Field missing on this database - try the next candidate.
      }
      try {
        const [variant] = await client.searchRead<any>(
          'product.product',
          [[field, '=', idText]],
          ['id'],
          1
        )
        if (variant?.id) return Number(variant.id)
      } catch {
        // Ignore and fall back to SKU.
      }
    }
  }

  const skuText = String(sku || '').trim()
  if (skuText) {
    for (const field of ['default_code', 'barcode']) {
      try {
        const [variant] = await client.searchRead<any>(
          'product.product',
          [[field, '=', skuText]],
          ['id'],
          1
        )
        if (variant?.id) return Number(variant.id)
      } catch {
        // Ignore.
      }
    }
  }
  return null
}

/** Quantities already returned through negative sale orders for this order. */
export async function readNegativeReturnLedger(
  client: OdooClient,
  orderName: string
): Promise<Map<number, number>> {
  const ledger = new Map<number, number>()
  const ref = returnRefFor(orderName)
  const orders = await client.searchRead<any>(
    'sale.order',
    [['client_order_ref', '=', ref], ['state', '!=', 'cancel']],
    ['id', 'order_line'],
    50
  )
  const lineIds = (orders || []).flatMap(o => many2manyIds(o.order_line))
  if (lineIds.length === 0) return ledger
  const lines = await client.searchRead<any>(
    'sale.order.line',
    [['id', 'in', lineIds]],
    ['id', 'product_id', 'product_uom_qty'],
    lineIds.length
  )
  for (const line of lines || []) {
    const productId = many2oneId(line.product_id)
    if (!productId) continue
    // Negative lines: the ledger tracks how much was already returned.
    const qty = Math.abs(toNumber(line.product_uom_qty))
    if (qty <= 0) continue
    ledger.set(productId, (ledger.get(productId) || 0) + qty)
  }
  return ledger
}

export interface NegativeSaleOrderOptions {
  orderStdSettings?: Record<string, any> | null
  payload?: Record<string, unknown>
  platform?: PlatformKey
}

export async function createNegativeSaleOrder(
  client: OdooClient,
  original: OriginalSaleOrder,
  lines: readonly OdooReturnLine[],
  reason: string,
  options?: NegativeSaleOrderOptions
): Promise<number> {
  const majorVersion = await client.getMajorVersion().catch(() => 17)
  const taxField = majorVersion >= 18 ? 'tax_ids' : 'tax_id'
  const values: Record<string, unknown> = {
    partner_id: original.partnerId,
    client_order_ref: returnRefFor(original.name),
    origin: original.name,
    note: reason || `Return of ${original.name}`,
  }
  if (original.partnerInvoiceId) values.partner_invoice_id = original.partnerInvoiceId
  if (original.partnerShippingId) values.partner_shipping_id = original.partnerShippingId
  if (original.pricelistId) values.pricelist_id = original.pricelistId
  if (original.companyId) values.company_id = original.companyId
  if (original.warehouseId) values.warehouse_id = original.warehouseId
  if (original.fiscalPositionId) values.fiscal_position_id = original.fiscalPositionId
  if (original.paymentTermId) values.payment_term_id = original.paymentTermId
  if (original.teamId) values.team_id = original.teamId
  if (original.userId) values.user_id = original.userId
  if (original.analyticAccountId) values.analytic_account_id = original.analyticAccountId

  const stdAnalytic = options?.orderStdSettings?.order?.analytic || options?.orderStdSettings?.analytic
  let evaluatedAnalyticFields: Record<string, unknown> | null = null
  if (stdAnalytic) {
    try {
      const { locationId, locationName } = extractOrderLocationInfo(options?.payload, options?.platform)
      const dist = resolveAnalyticDistribution({
        config: stdAnalytic,
        locationId,
        locationName,
        paymentKeys: paymentKeysFromOrder(options?.payload, options?.platform),
        preservePercentages: true,
      })
      if (dist.length > 0) {
        evaluatedAnalyticFields = toOdooAnalyticFields(dist, majorVersion >= 16, majorVersion < 16)
      }
    } catch {
      // Ignore evaluation errors
    }
  }

  const defaultTaxes: number[] = []
  const configuredTax = options?.orderStdSettings?.order?.default_tax_id ?? options?.orderStdSettings?.tax?.default_tax_ids
  if (configuredTax) {
    const rawArr = Array.isArray(configuredTax) ? configuredTax : [configuredTax]
    for (const t of rawArr) {
      const id = Number(t)
      if (Number.isInteger(id) && id > 0) defaultTaxes.push(id)
    }
  }

  values.order_line = lines.map(line => {
    const lineVals: Record<string, unknown> = {
      product_id: line.productId,
      name: line.name || `Return - ${original.name}`,
      product_uom_qty: -Math.abs(line.quantity),
      price_unit: line.priceUnit,
    }
    if (line.discount !== undefined && line.discount > 0) {
      lineVals.discount = line.discount
    }
    if (line.productUomId) {
      if (majorVersion >= 18) {
        lineVals.product_uom_id = line.productUomId
      } else {
        lineVals.product_uom = line.productUomId
      }
    }

    // Taxes: replicate from original line if present, otherwise fallback to standard mapping default taxes
    // Always send an explicit M2M command. Odoo's product/customer default
    // taxes otherwise silently reappear on an untaxed negative return line.
    lineVals[taxField] = [[6, 0,
      line.taxIds?.length ? line.taxIds : defaultTaxes
    ]]

    // Analytic accounts: replicate from original line if present, otherwise fallback to evaluated standard mapping analytics
    if (line.analyticDistribution && Object.keys(line.analyticDistribution).length > 0) {
      if (majorVersion >= 16) {
        lineVals.analytic_distribution = line.analyticDistribution
      } else {
        const top = Object.entries(line.analyticDistribution).sort((a, b) => b[1] - a[1])[0]
        if (top) lineVals.analytic_account_id = Number(top[0])
      }
    } else if (line.analyticAccountId) {
      if (majorVersion >= 16) {
        lineVals.analytic_distribution = { [String(line.analyticAccountId)]: 100 }
      } else {
        lineVals.analytic_account_id = line.analyticAccountId
      }
    } else if (evaluatedAnalyticFields && Object.keys(evaluatedAnalyticFields).length > 0) {
      Object.assign(lineVals, evaluatedAnalyticFields)
    }

    if (line.analyticTagIds && line.analyticTagIds.length > 0 && majorVersion < 16) {
      lineVals.analytic_tag_ids = [[6, 0, line.analyticTagIds]]
    }

    return [0, 0, lineVals]
  })

  try {
    return await client.create('sale.order', values)
  } catch (err: any) {
    // If an optional header field failed on a stripped Odoo installation, retry with core fields
    const coreValues: Record<string, unknown> = {
      partner_id: values.partner_id,
      client_order_ref: values.client_order_ref,
      origin: values.origin,
      note: values.note,
      order_line: values.order_line,
    }
    if (values.pricelist_id) (coreValues as any).pricelist_id = values.pricelist_id
    if (values.company_id) (coreValues as any).company_id = values.company_id
    if (values.warehouse_id) (coreValues as any).warehouse_id = values.warehouse_id
    return await client.create('sale.order', coreValues)
  }
}

interface DeliveredMove {
  id: number
  pickingId: number
  productId: number
  quantity: number
}

async function readDeliveredMoves(
  client: OdooClient,
  orderId: number,
  orderName: string | undefined,
  majorVersion: number
): Promise<DeliveredMove[]> {
  const domain: any[] = orderName
    ? ['&', '|', ['sale_id', '=', orderId], ['origin', '=', orderName], ['state', '=', 'done']]
    : [['sale_id', '=', orderId], ['state', '=', 'done']]

  let pickings = await client.searchRead<any>('stock.picking', domain, ['id'], 100)

  // If no done pickings found, check for assigned/confirmed outgoing pickings and validate them
  if (!pickings || pickings.length === 0) {
    const pendingDomain: any[] = orderName
      ? ['&', '|', ['sale_id', '=', orderId], ['origin', '=', orderName], ['state', 'in', ['assigned', 'confirmed', 'waiting']]]
      : [['sale_id', '=', orderId], ['state', 'in', ['assigned', 'confirmed', 'waiting']]]
    const pending = await client.searchRead<any>('stock.picking', pendingDomain, ['id'], 20)
    if (pending && pending.length > 0) {
      for (const p of pending) {
        try {
          await client.execute('stock.picking', 'button_validate', [[p.id]], {
            context: { skip_backorder: true, skip_sms: true },
          })
          console.info(`[Returns] Auto-validated pending picking #${p.id} for order #${orderId} to allow return`)
        } catch (vErr: any) {
          console.warn(`[Returns] Failed to validate pending picking #${p.id}:`, vErr?.message || vErr)
        }
      }
      pickings = await client.searchRead<any>('stock.picking', domain, ['id'], 100)
    }
  }

  const pickingIds = (pickings || []).map(p => Number(p.id)).filter(Boolean)
  if (pickingIds.length === 0) return []

  const qtyField = majorVersion >= 17 ? 'quantity' : 'quantity_done'
  let moves: any[] = []
  try {
    moves = await client.searchRead<any>(
      'stock.move',
      [['picking_id', 'in', pickingIds], ['state', '=', 'done']],
      ['id', 'picking_id', 'product_id', qtyField],
      Math.max(pickingIds.length * 50, 100)
    )
  } catch {
    moves = await client.searchRead<any>(
      'stock.move',
      [['picking_id', 'in', pickingIds], ['state', '=', 'done']],
      ['id', 'picking_id', 'product_id', 'product_uom_qty'],
      Math.max(pickingIds.length * 50, 100)
    )
    return (moves || []).map(m => ({
      id: Number(m.id),
      pickingId: many2oneId(m.picking_id) || 0,
      productId: many2oneId(m.product_id) || 0,
      quantity: toNumber(m.product_uom_qty),
    }))
  }
  return (moves || []).map(m => ({
    id: Number(m.id),
    pickingId: many2oneId(m.picking_id) || 0,
    productId: many2oneId(m.product_id) || 0,
    quantity: toNumber(m[qtyField]),
  }))
}

async function createReturnPicking(
  client: OdooClient,
  pickingId: number,
  moves: readonly { moveId: number; productId: number; quantity: number }[],
  majorVersion: number
): Promise<number | null> {
  // Odoo 20 removed the stock.return.picking wizard model. The supported
  // public RPC entry point is stock.picking.action_return(), which creates
  // the return picking and returns an action with its res_id. Odoo 14-19
  // continue to use the transient wizard below.
  if (majorVersion >= 20) {
    // Retry safety: action_return() is not transactional with our later
    // validation RPC. If validation fails after the return picking is created,
    // the queue retries and would otherwise mint another draft return each time.
    // Reuse an existing non-cancelled return only when its origin move/quantity
    // set exactly matches the requested return.
    const existingReturns = await client.searchRead<any>(
      'stock.picking',
      [['return_id', '=', pickingId], ['state', 'not in', ['done', 'cancel']]],
      ['id', 'state', 'move_ids'],
      20
    )
    const desiredByOrigin = new Map(
      moves.map(move => [move.moveId, Math.abs(move.quantity)] as const)
    )
    for (const candidate of existingReturns || []) {
      const candidateMoves = await client.searchRead<any>(
        'stock.move',
        [['picking_id', '=', Number(candidate.id)], ['state', '!=', 'cancel']],
        ['id', 'origin_returned_move_id', 'product_uom_qty'],
        200
      )
      if (candidateMoves.length !== desiredByOrigin.size) continue
      let exact = true
      for (const move of candidateMoves) {
        const originMoveId = many2oneId(move.origin_returned_move_id)
        const desired = originMoveId ? desiredByOrigin.get(originMoveId) : undefined
        if (desired === undefined || Math.abs(toNumber(move.product_uom_qty) - desired) > 0.000001) {
          exact = false
          break
        }
      }
      if (exact) {
        console.info(`[Returns] Reusing Odoo 20 draft return picking #${candidate.id} after a retry`)
        return Number(candidate.id)
      }
    }

    const result = await client.execute<any>('stock.picking', 'action_return', [[pickingId]])
    const newPickingId = Number(result?.res_id ?? result?.resId ?? 0)
    if (!Number.isInteger(newPickingId) || newPickingId <= 0) return null

    const returnMoves = await client.searchRead<any>(
      'stock.move',
      [['picking_id', '=', newPickingId], ['state', '!=', 'cancel']],
      ['id', 'product_id', 'origin_returned_move_id', 'product_uom_qty'],
      200
    )
    for (const returnMove of returnMoves || []) {
      const originMoveId = many2oneId(returnMove.origin_returned_move_id)
      const desiredQty = originMoveId ? desiredByOrigin.get(originMoveId) : undefined
      const quantity = desiredQty ?? 0
      await client.write('stock.move', [Number(returnMove.id)], {
        product_uom_qty: quantity,
      })
    }
    return newPickingId
  }

  const wizardId = await client.create('stock.return.picking', {
    picking_id: pickingId,
    product_return_moves: moves.map(m => [
      0,
      0,
      {
        move_id: m.moveId,
        product_id: m.productId,
        quantity: Math.abs(m.quantity),
        to_refund: true,
      },
    ]),
  })
  if (!wizardId) return null

  let result: any
  try {
    result = await client.execute('stock.return.picking', 'action_create_returns', [[wizardId]])
  } catch (modernErr: any) {
    console.info(
      `[Returns] action_create_returns unavailable, falling back to create_returns:`,
      modernErr?.message || modernErr
    )
    result = await client.execute('stock.return.picking', 'create_returns', [[wizardId]])
  }
  const newPickingId = Number(result?.res_id ?? result?.resId ?? 0)
  return Number.isInteger(newPickingId) && newPickingId > 0 ? newPickingId : null
}

export interface StockReturnResult {
  pickingIds: number[]
  returnedQty: number
}

export async function createStockReturn(
  client: OdooClient,
  orderId: number,
  lines: readonly OdooReturnLine[],
  majorVersion: number,
  options?: {
    orderName?: string
    pickingAction?: string
  }
): Promise<StockReturnResult> {
  const moves = await readDeliveredMoves(client, orderId, options?.orderName, majorVersion)
  const byPicking = new Map<number, { moveId: number; productId: number; quantity: number }[]>()
  const remaining = new Map<number, number>()
  for (const line of lines) {
    remaining.set(line.productId, (remaining.get(line.productId) || 0) + Math.abs(line.quantity))
  }

  for (const move of moves) {
    const need = remaining.get(move.productId) || 0
    if (need <= 0) continue
    const take = Math.min(need, move.quantity)
    if (take <= 0) continue
    const list = byPicking.get(move.pickingId) || []
    list.push({ moveId: move.id, productId: move.productId, quantity: take })
    byPicking.set(move.pickingId, list)
    remaining.set(move.productId, need - take)
  }

  // Do not create a credit note for inventory that Odoo has never shipped.
  // In the live QA run this returned { pickingIds: [], returnedQty: 0 } and
  // the caller posted a financial credit anyway, incorrectly reporting success.
  const missing = [...remaining.entries()].filter(([, qty]) => qty > 0.000001)
  if (missing.length > 0) {
    throw new Error('stock_return_missing_delivered_moves:' +
      missing.map(([id, qty]) => `${id}:${qty}`).join(','))
  }

  const pickingIds: number[] = []
  let returnedQty = 0
  const pickingAction = String(options?.pickingAction || '')
  // If explicitly 'create', keep as draft; if contains 'validate' or not specified, validate
  const shouldValidate = pickingAction
    ? (pickingAction === 'create_and_validate' || pickingAction === 'validate')
    : true

  for (const [pickingId, pickingMoves] of byPicking.entries()) {
    const created = await createReturnPicking(client, pickingId, pickingMoves, majorVersion)
    if (!created) {
      throw new Error(`stock_return_not_created: picking ${pickingId}`)
    }
    if (shouldValidate) {
      try {
        const [beforeValidate] = await client.searchRead<any>(
          'stock.picking', [['id', '=', created]], ['id', 'state'], 1
        )
        if (beforeValidate?.state === 'draft') {
          await client.execute('stock.picking', 'action_confirm', [[created]])
        }
        const [afterConfirm] = await client.searchRead<any>(
          'stock.picking', [['id', '=', created]], ['id', 'state'], 1
        )
        if (afterConfirm && afterConfirm.state !== 'assigned' && afterConfirm.state !== 'done') {
          await client.execute('stock.picking', 'action_assign', [[created]])
        }
        await client.execute('stock.picking', 'button_validate', [[created]], {
          context: { skip_backorder: true, skip_sms: true },
        })
      } catch (valErr: any) {
        throw new Error(`stock_return_validate_failed:${created}: ${valErr?.message || valErr}`)
      }
      const [validated] = await client.searchRead<any>(
        'stock.picking', [['id', '=', created]], ['id', 'state'], 1
      )
      if (validated?.state !== 'done') {
        throw new Error(`stock_return_not_done:${created}:${validated?.state || 'missing'}`)
      }
    } else {
      console.info(`[Returns] Return picking #${created} kept as draft (picking_action="${pickingAction}")`)
    }
    pickingIds.push(created)
    returnedQty += pickingMoves.reduce((sum, m) => sum + m.quantity, 0)
  }
  return { pickingIds, returnedQty }
}

export async function findInvoiceForOrder(
  client: OdooClient,
  original: OriginalSaleOrder
): Promise<number | null> {
  for (const id of original.invoiceIds) {
    const [invoice] = await client.searchRead<any>(
      'account.move',
      [['id', '=', id], ['move_type', '=', 'out_invoice'], ['state', '!=', 'cancel']],
      ['id'],
      1
    )
    if (invoice?.id) return Number(invoice.id)
  }
  if (!original.name) return null
  const [fallback] = await client.searchRead<any>(
    'account.move',
    [
      ['invoice_origin', '=', original.name],
      ['move_type', '=', 'out_invoice'],
      ['state', '!=', 'cancel'],
    ],
    ['id'],
    1
  )
  return fallback?.id ? Number(fallback.id) : null
}

/** Quantities already returned through credit notes (out_refund) for this order. */
export async function readCreditNoteReturnLedger(
  client: OdooClient,
  orderName: string
): Promise<Map<number, number>> {
  const ledger = new Map<number, number>()
  if (!orderName) return ledger
  try {
    const moves = await client.searchRead<any>(
      'account.move',
      [
        ['move_type', '=', 'out_refund'],
        ['state', '!=', 'cancel'],
        ['invoice_origin', '=', orderName],
      ],
      ['id'],
      50
    )
    if (!moves || moves.length === 0) return ledger
    const moveIds = moves.map(m => Number(m.id)).filter(Boolean)
    const lines = await client.searchRead<any>(
      'account.move.line',
      [['move_id', 'in', moveIds], ['product_id', '!=', false]],
      ['product_id', 'quantity'],
      moveIds.length * 50
    )
    for (const l of lines || []) {
      const prodId = many2oneId(l.product_id)
      if (!prodId) continue
      const qty = toNumber(l.quantity)
      if (qty > 0) {
        ledger.set(prodId, (ledger.get(prodId) || 0) + qty)
      }
    }
  } catch (err: any) {
    console.warn(`[Returns] Failed to read credit note return ledger for ${orderName}:`, err?.message || err)
  }
  return ledger
}

export async function createCreditNote(
  client: OdooClient,
  original: OriginalSaleOrder,
  invoiceId: number | null,
  lines: readonly OdooReturnLine[],
  journalId: number | null,
  reason: string,
  options?: {
    invoiceAction?: string
  }
): Promise<number> {
  const majorVersion = await client.getMajorVersion().catch(() => 17)
  const today = new Date().toISOString().slice(0, 10)
  const values: Record<string, unknown> = {
    move_type: 'out_refund',
    partner_id: original.partnerId,
    invoice_date: today,
    invoice_origin: original.name,
    ref: reason || `Return of ${original.name}`,
    invoice_line_ids: lines.map(line => {
      const lineVals: Record<string, unknown> = {
        product_id: line.productId,
        name: line.name || `Return - ${original.name}`,
        quantity: Math.abs(line.quantity),
        price_unit: line.priceUnit,
      }
      if (line.discount !== undefined && line.discount > 0) {
        lineVals.discount = line.discount
      }
      // Explicitly clear Odoo product defaults for tax-exempt returns.
      // Omitting tax_ids made live Zid 139.25 SAR returns post as 160.14 SAR.
      lineVals.tax_ids = [[6, 0, line.taxIds || []]]
      if (line.productUomId) {
        lineVals.product_uom_id = line.productUomId
      }
      if (line.saleLineId) {
        lineVals.sale_line_ids = [[6, 0, [line.saleLineId]]]
      }
      if (line.analyticDistribution && Object.keys(line.analyticDistribution).length > 0) {
        if (majorVersion >= 16) {
          lineVals.analytic_distribution = line.analyticDistribution
        } else {
          const top = Object.entries(line.analyticDistribution).sort((a, b) => b[1] - a[1])[0]
          if (top) lineVals.analytic_account_id = Number(top[0])
        }
      } else if (line.analyticAccountId) {
        if (majorVersion >= 16) {
          lineVals.analytic_distribution = { [String(line.analyticAccountId)]: 100 }
        } else {
          lineVals.analytic_account_id = line.analyticAccountId
        }
      }
      return [0, 0, lineVals]
    }),
  }
  if (invoiceId) values.reversed_entry_id = invoiceId
  if (original.companyId) values.company_id = original.companyId
  if (journalId) values.journal_id = journalId
  const creditId = await client.create('account.move', values)
  if (!creditId) throw new Error('credit_note_not_created')

  // A posted credit note is a real financial effect. Verify persisted taxes
  // before posting AND after posting: Odoo can reapply partner/product defaults
  // during either operation. Never log success for a silently taxed refund.
  const assertPersistedCreditTaxes = async () => {
    const [move] = await client.searchRead<any>(
      'account.move', [['id', '=', creditId]],
      ['id', 'state', 'invoice_line_ids', 'amount_total'], 1
    )
    if (!move) throw new Error(`credit_note_readback_missing:${creditId}`)
    const invoiceLineIds = many2manyIds(move.invoice_line_ids)
    if (invoiceLineIds.length !== lines.length) {
      throw new Error(`credit_note_line_count_mismatch:${creditId}:${invoiceLineIds.length}/${lines.length}`)
    }
    const persisted = await client.searchRead<any>(
      'account.move.line', [['id', 'in', invoiceLineIds]],
      ['id', 'product_id', 'quantity', 'tax_ids'], invoiceLineIds.length
    )
    const expected = lines.map(line => ({
      productId: line.productId, quantity: Math.abs(line.quantity),
      taxes: [...(line.taxIds || [])].map(Number).sort((a, b) => a - b),
    }))
    for (const row of persisted || []) {
      const productId = many2oneId(row.product_id)
      const taxes = many2manyIds(row.tax_ids).sort((a, b) => a - b)
      const qty = toNumber(row.quantity)
      const ix = expected.findIndex(line =>
        line.productId === productId &&
        Math.abs(line.quantity - qty) < 0.000001 &&
        line.taxes.length === taxes.length &&
        line.taxes.every((tax, index) => tax === taxes[index])
      )
      if (ix < 0) throw new Error(`credit_note_tax_or_quantity_mismatch:${creditId}:${productId}`)
      expected.splice(ix, 1)
    }
    if (expected.length > 0) {
      throw new Error(`credit_note_lines_missing:${creditId}:${expected.length}`)
    }
    if (lines.every(line => !line.taxIds?.length)) {
      const expectedUntaxedTotal = Math.round(lines.reduce((sum, line) =>
        sum + Math.abs(line.quantity) * line.priceUnit * (1 - (line.discount || 0) / 100), 0) * 100) / 100
      if (Math.abs(toNumber(move.amount_total) - expectedUntaxedTotal) > 0.011) {
        throw new Error(`credit_note_total_mismatch:${creditId}:${move.amount_total}/${expectedUntaxedTotal}`)
      }
    }
  }
  await assertPersistedCreditTaxes()

  const invoiceAction = String(options?.invoiceAction || '')
  // If explicitly 'create', keep as draft; if contains 'post' or not specified, post
  const shouldPost = invoiceAction
    ? (invoiceAction === 'create_and_post' || invoiceAction === 'post')
    : true

  if (shouldPost) {
    try {
      await client.execute('account.move', 'action_post', [[creditId]])
    } catch (postErr: any) {
      throw new Error(`credit_note_post_failed:${creditId}: ${postErr?.message || postErr}`)
    }
    await assertPersistedCreditTaxes()
    const [posted] = await client.searchRead<any>(
      'account.move', [['id', '=', creditId]], ['id', 'state'], 1
    )
    if (posted?.state !== 'posted') throw new Error(`credit_note_not_posted:${creditId}`)
  } else {
    console.info(`[Returns] Credit note #${creditId} kept as draft (invoice_action="${invoiceAction}")`)
  }
  return creditId
}
