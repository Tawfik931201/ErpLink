/**
 * Orchestrates one return: resolve the original sale order, work out what is
 * still unreturned, then write it to Odoo using the configured mode.
 *
 * The quantity rule is deliberately self-correcting instead of storing a
 * "how much did we already return" counter of our own:
 *
 *   target returned   = platform's cumulative returned quantity
 *   already returned  = Odoo's own view of it
 *                       (negative-SO ledger, or ordered - qty_delivered)
 *   to return now     = target - already
 *
 * A redelivered webhook therefore computes 0 and does nothing, a genuine
 * second partial return computes the delta, and a failed attempt is retried
 * with the full remaining amount instead of a lost one.
 */

import { resolveEntityLinkId, upsertEntityLink } from '@/lib/entity-links'
import {
  extractOrderLocationInfo,
  paymentKeysFromOrder,
  resolveAnalyticDistribution,
  toOdooAnalyticFields,
} from '@/lib/odoo/analytic-distribution'
import type { OdooClient } from '@/lib/odoo-client'
import type { PlatformKey } from '@/lib/platform-fields'
import { isSaudiShippingAddress } from '@/lib/zid/order-helpers'

import {
  returnDedupeKey,
  returnSnapshotSignature,
  type ReturnSettings,
  type StoreReturnLine,
} from './detect'
import {
  createCreditNote,
  createNegativeSaleOrder,
  createStockReturn,
  findInvoiceForOrder,
  findOriginalSaleOrder,
  readNegativeReturnLedger,
  resolveOdooProductId,
  type OdooReturnLine,
  type OriginalSaleOrder,
} from './odoo'

export interface ReturnEventInput {
  client: OdooClient
  platform: PlatformKey
  event: string
  workspaceId: string
  storeId: string
  orderId: string
  payload: Record<string, unknown>
  settings: ReturnSettings
  /** Salla: cumulative refunded quantities taken from the payload/API. */
  refundedLines?: StoreReturnLine[]
  /** Zid: remaining returnable quantities from `view-for-return`. */
  remaining?: { known: boolean; lines: StoreReturnLine[] }
  autoConfirm?: boolean
  orderStdSettings?: Record<string, any> | null
}

export interface ReturnOutcome {
  handled: boolean
  status: 'success' | 'failed' | 'skipped'
  message: string
  odooRecordId?: number
  actions: string[]
}

function skipped(message: string): ReturnOutcome {
  return { handled: true, status: 'skipped', message, actions: [] }
}

async function resolveStoreLines(
  client: OdooClient,
  platform: PlatformKey,
  lines: readonly StoreReturnLine[]
): Promise<{ byProduct: Map<number, number>; unresolved: number }> {
  const byProduct = new Map<number, number>()
  let unresolved = 0
  for (const line of lines) {
    const odooId = await resolveOdooProductId(client, platform, line.storeProductId, line.sku)
    if (!odooId) {
      unresolved += 1
      continue
    }
    byProduct.set(odooId, (byProduct.get(odooId) || 0) + Math.abs(line.quantity))
  }
  return { byProduct, unresolved }
}

async function buildReturnLines(
  client: OdooClient,
  original: OriginalSaleOrder,
  platform: PlatformKey,
  input: ReturnEventInput
): Promise<OdooReturnLine[]> {
  if (input.settings.mode === 'negative_so' && original.lines.length === 0) return []

  const ledger =
    input.settings.mode === 'negative_so'
      ? await readNegativeReturnLedger(client, original.name)
      : new Map<number, number>()

  // Zid only ever gives us "remaining returnable", so the cumulative returned
  // quantity is derived from the order itself. Salla gives the refunded lines
  // directly. Whichever source exists, the result is a per-product total.
  let targets = new Map<number, number>()
  if (input.remaining?.known) {
    const { byProduct, unresolved } = await resolveStoreLines(
      client,
      platform,
      input.remaining.lines
    )
    // Zid documents that `view-for-return` lists ONLY products that can still
    // come back, so a product missing from the list has nothing left to
    // return. The exception is an unresolvable row: then "missing" may mean
    // "we could not match it in Odoo", and guessing 0 would silently skip a
    // real return, while guessing "not returned" only delays it. Delay wins.
    const absentMeansFullyReturned = unresolved === 0
    for (const line of original.lines) {
      const remaining = byProduct.has(line.productId)
        ? byProduct.get(line.productId) || 0
        : absentMeansFullyReturned
          ? 0
          : line.orderedQty
      const target = Math.max(0, line.orderedQty - remaining)
      if (target > 0) targets.set(line.productId, target)
    }
  } else if (input.refundedLines && input.refundedLines.length > 0) {
    targets = (await resolveStoreLines(client, platform, input.refundedLines)).byProduct
  } else {
    // If view-for-return was unavailable but this is a reversal/return event,
    // all lines of the original order are treated as returned (or target lines).
    const ev = String(input.event || '').toLowerCase()
    const rawStatus = (input.payload?.order as any)?.order_status ?? input.payload?.order_status ?? (input.payload?.order as any)?.status ?? input.payload?.status
    const statusCode = String((rawStatus && typeof rawStatus === 'object') ? (rawStatus.code || rawStatus.name || '') : (rawStatus || '')).toLowerCase()
    const isReversal =
      ev.includes('reversed') ||
      ev.includes('refund') ||
      statusCode.includes('reverse') ||
      statusCode.includes('مرتجع') ||
      statusCode.includes('مسترجع') ||
      Boolean(input.payload?.reverse_order_label_request)
    if (platform === 'zid' && isReversal) {
      console.info(`[Returns] Zid view-for-return state unconfirmed; treating reversal "${input.orderId}" as all items returned`)
      for (const line of original.lines) {
        if (line.orderedQty > 0) targets.set(line.productId, line.orderedQty)
      }
    } else {
      throw new Error('return_quantities_unknown')
    }
  }

  // One product can appear on several order lines (different prices/discounts).
  // The target is per product, so it is spent once: without this budget the
  // second line would repeat the full quantity, and a credit note would refund
  // more than the customer paid.
  const consumed = new Map<number, number>()
  const out: OdooReturnLine[] = []
  for (const line of original.lines) {
    const target = targets.get(line.productId) || 0
    if (target <= 0) continue
    const already =
      input.settings.mode === 'negative_so'
        ? ledger.get(line.productId) || 0
        : Math.max(0, line.orderedQty - line.deliveredQty)
    const available = Math.max(0, target - already - (consumed.get(line.productId) || 0))
    const quantity =
      input.settings.mode === 'negative_so'
        ? available
        : Math.min(available, Math.max(0, line.deliveredQty - already))
    if (quantity <= 0) continue
    consumed.set(line.productId, (consumed.get(line.productId) || 0) + quantity)
    out.push({
      productId: line.productId,
      quantity,
      priceUnit: line.priceUnit,
      name: line.productName,
      taxIds: line.taxIds,
      discount: line.discount,
      productUomId: line.productUomId,
      analyticDistribution: line.analyticDistribution,
      analyticAccountId: line.analyticAccountId,
      analyticTagIds: line.analyticTagIds,
      saleLineId: line.id,
    })
  }
  return out
}

function extractPayloadProducts(payload: Record<string, unknown>): StoreReturnLine[] {
  const p = payload as any
  const candidates = [
    p.reverse_order_label_request?.products,
    p.products,
    p.order?.products,
    p.items,
    p.order?.items,
    p.line_items,
    p.order?.line_items,
  ]
  const list = candidates.find(c => Array.isArray(c) && c.length > 0) || []
  return list.map((item: any) => ({
    storeProductId: String(item.product_id || item.id || item.item_id || ''),
    sku: String(item.sku || item.code || ''),
    name: String(item.name || item.product_name || item.title || ''),
    quantity: Math.abs(Number(item.quantity ?? item.qty ?? item.count ?? 1) || 1),
    priceUnit: Number(item.price ?? item.price_unit ?? item.unit_price ?? item.total ?? 0) || 0,
  }))
}

async function resolveCustomerPartner(
  client: OdooClient,
  payload: Record<string, unknown>,
  orderStdSettings?: Record<string, any> | null
): Promise<number | null> {
  const custSettings = orderStdSettings || {}
  const defaultCustId = Number(custSettings.order?.default_customer_id || custSettings.default_customer_id)
  if (custSettings.customer_fallback_policy === 'default_customer' && Number.isInteger(defaultCustId) && defaultCustId > 0) {
    return defaultCustId
  }

  const p = payload as any
  const cust = p.customer || p.order?.customer || {}
  const shipping = p.shipping_address || p.order?.shipping_address || {}
  const billing = p.billing_address || p.order?.billing_address || {}

  const rawName = cust.name
    || [cust.first_name, cust.last_name].filter(Boolean).join(' ')
    || p.customer_name
    || shipping.name
    || [shipping.first_name, shipping.last_name].filter(Boolean).join(' ')
    || billing.name
    || ''
  const custName = String(rawName).trim()

  const custEmail = String(cust.email || p.customer_email || p.email || shipping.email || billing.email || '').trim()
  const custPhone = String(cust.phone || cust.mobile || p.customer_phone || p.phone || shipping.mobile || shipping.phone || '').trim()
  const custVat = String(cust.tax_number || cust.vat || cust.tax_id || p.tax_number || '').trim()

  // 1. Search by VAT
  if (custVat) {
    try {
      const ids = await client.search('res.partner', [['vat', '=', custVat]], 1)
      if (ids && ids.length > 0) return Number(ids[0])
    } catch {}
  }

  // 2. Search by Email
  if (custEmail) {
    try {
      const ids = await client.search('res.partner', [['email', '=', custEmail]], 1)
      if (ids && ids.length > 0) return Number(ids[0])
    } catch {}
  }

  // 3. Search by Phone
  if (custPhone) {
    const variants = [custPhone]
    const noPlus = custPhone.replace(/^\+/, '')
    if (noPlus !== custPhone) variants.push(noPlus)
    if (noPlus.startsWith('9665')) variants.push('05' + noPlus.slice(4))
    for (const ph of variants) {
      try {
        const ids = await client.search('res.partner', [['phone', 'ilike', ph]], 1)
        if (ids && ids.length > 0) return Number(ids[0])
      } catch {}
    }
  }

  // 4. Search by Name
  if (custName) {
    try {
      const ids = await client.search('res.partner', [['name', 'ilike', custName]], 1)
      if (ids && ids.length > 0) return Number(ids[0])
    } catch {}
  }

  // 5. Create new partner if not found
  if (custName || custEmail || custPhone) {
    try {
      const partnerVals: Record<string, any> = {
        name: custName || custPhone || custEmail || 'Store Customer',
        customer_rank: 1,
      }
      if (custEmail) partnerVals.email = custEmail
      if (custPhone) partnerVals.phone = custPhone
      if (custVat) partnerVals.vat = custVat
      const newId = await client.create('res.partner', partnerVals)
      if (newId) return Number(newId)
    } catch {}
  }

  // 6. Fallback to default customer or any active partner
  if (Number.isInteger(defaultCustId) && defaultCustId > 0) {
    return defaultCustId
  }
  try {
    const ids = await client.search('res.partner', [['customer_rank', '>', 0]], 1)
    if (ids && ids.length > 0) return Number(ids[0])
    const anyIds = await client.search('res.partner', [], 1)
    if (anyIds && anyIds.length > 0) return Number(anyIds[0])
  } catch {}

  return null
}

async function createFromPayloadWithoutOrder(
  input: ReturnEventInput,
  rawLines: readonly StoreReturnLine[]
): Promise<ReturnOutcome> {
  const { client, platform, workspaceId, storeId, orderId, settings, orderStdSettings } = input
  const lines = rawLines.length > 0 ? rawLines : extractPayloadProducts(input.payload)
  if (lines.length === 0) return skipped('no_return_lines')
  const signature = returnSnapshotSignature(lines, `${platform}:${orderId}`)
  const key = returnDedupeKey(platform, orderId, signature)
  const existing = await resolveEntityLinkId({
    workspaceId,
    platform,
    storeId,
    odooModel: 'sale.order',
    storeEntityId: key,
  })
  if (existing) return skipped(`already_applied:${existing}`)

  const defaultProductId = Number(orderStdSettings?.order?.default_product_id || orderStdSettings?.default_product_id)
  const resolved: OdooReturnLine[] = []
  for (const line of lines) {
    let productId = await resolveOdooProductId(client, platform, line.storeProductId, line.sku)
    if (!productId && Number.isInteger(defaultProductId) && defaultProductId > 0) {
      productId = defaultProductId
    }
    if (!productId) continue
    resolved.push({
      productId,
      quantity: Math.abs(line.quantity),
      priceUnit: line.priceUnit || 0,
      name: line.name || '',
      taxIds: [],
    })
  }
  if (resolved.length === 0) return skipped('no_matching_products')

  const partnerId = await resolveCustomerPartner(client, input.payload, orderStdSettings)
  if (!partnerId) return skipped('customer_not_found')

  const majorVersion = await client.getMajorVersion().catch(() => 17)
  const taxField = majorVersion >= 18 ? 'tax_ids' : 'tax_id'

  // Resolve VAT / taxes from Standard Mapping
  const isSaudi = isSaudiShippingAddress(input.payload)
  const vatTaxId = isSaudi
    ? Number(orderStdSettings?.vat_saudi_tax_id || orderStdSettings?.order?.vat_saudi_tax_id)
    : Number(orderStdSettings?.vat_non_saudi_tax_id || orderStdSettings?.order?.vat_non_saudi_tax_id)
  const defaultTaxId = Number(orderStdSettings?.order?.default_tax_id || orderStdSettings?.tax?.default_tax_ids)
  const taxToApply = Number.isInteger(vatTaxId) && vatTaxId > 0
    ? vatTaxId
    : (Number.isInteger(defaultTaxId) && defaultTaxId > 0 ? defaultTaxId : null)

  // Resolve Analytic Distribution from Standard Mapping
  const stdAnalytic = orderStdSettings?.order?.analytic || orderStdSettings?.analytic
  let evaluatedAnalyticFields: Record<string, unknown> | null = null
  if (stdAnalytic) {
    try {
      const { locationId, locationName } = extractOrderLocationInfo(input.payload, platform)
      const dist = resolveAnalyticDistribution({
        config: stdAnalytic,
        locationId,
        locationName,
        paymentKeys: paymentKeysFromOrder(input.payload, platform),
        preservePercentages: true,
      })
      if (dist.length > 0) {
        evaluatedAnalyticFields = toOdooAnalyticFields(dist, majorVersion >= 16, majorVersion < 16)
      }
    } catch {}
  }

  // Resolve warehouse from Standard Mapping
  let warehouseId: number | null = null
  const storeWhMappings = orderStdSettings?.order?.store_warehouse_mappings
  if (storeWhMappings && typeof storeWhMappings === 'object') {
    const { locationId } = extractOrderLocationInfo(input.payload, platform)
    if (locationId && storeWhMappings[locationId]) {
      const parsedWh = Number(storeWhMappings[locationId])
      if (Number.isInteger(parsedWh) && parsedWh > 0) warehouseId = parsedWh
    }
  }
  if (!warehouseId) {
    const defWh = Number(orderStdSettings?.order?.default_warehouse_id || orderStdSettings?.default_warehouse_id)
    if (Number.isInteger(defWh) && defWh > 0) warehouseId = defWh
  }

  const pricelistId = Number(orderStdSettings?.order?.default_pricelist_id || orderStdSettings?.default_pricelist_id)
  const paymentTermId = Number(orderStdSettings?.order?.default_payment_term_id || orderStdSettings?.default_payment_term_id)
  const companyId = Number(orderStdSettings?.company_id || orderStdSettings?.order?.company_id)

  const orderLines = resolved.map(line => {
    const lineVals: Record<string, unknown> = {
      product_id: line.productId,
      name: line.name || `Return - ${orderId}`,
      product_uom_qty: -Math.abs(line.quantity),
      price_unit: line.priceUnit,
    }
    if (taxToApply) {
      lineVals[taxField] = [[6, 0, [taxToApply]]]
    }
    if (evaluatedAnalyticFields && Object.keys(evaluatedAnalyticFields).length > 0) {
      Object.assign(lineVals, evaluatedAnalyticFields)
    }
    return [0, 0, lineVals]
  })

  const soVals: Record<string, unknown> = {
    partner_id: partnerId,
    client_order_ref: `RET:${platform}:${orderId}`,
    origin: `${platform}:${orderId}`,
    note: settings.reason || `Return of ${platform}:${orderId}`,
    order_line: orderLines,
  }
  if (warehouseId) soVals.warehouse_id = warehouseId
  if (Number.isInteger(pricelistId) && pricelistId > 0) soVals.pricelist_id = pricelistId
  if (Number.isInteger(paymentTermId) && paymentTermId > 0) soVals.payment_term_id = paymentTermId
  if (Number.isInteger(companyId) && companyId > 0) soVals.company_id = companyId

  let created: number
  try {
    created = await client.create('sale.order', soVals)
  } catch (err) {
    const coreVals = {
      partner_id: partnerId,
      client_order_ref: soVals.client_order_ref,
      origin: soVals.origin,
      note: soVals.note,
      order_line: soVals.order_line,
    }
    if (soVals.pricelist_id) (coreVals as any).pricelist_id = soVals.pricelist_id
    if (soVals.warehouse_id) (coreVals as any).warehouse_id = soVals.warehouse_id
    created = await client.create('sale.order', coreVals)
  }

  if (input.autoConfirm) {
    try {
      await client.execute('sale.order', 'action_confirm', [[Number(created)]])
    } catch (confErr: any) {
      console.warn(`[Returns] auto-confirm negative sale order #${created} failed:`, confErr?.message || confErr)
    }
  }

  await upsertEntityLink(
    { workspaceId, platform, storeId, odooModel: 'sale.order', storeEntityId: key },
    Number(created)
  )
  return {
    handled: true,
    status: 'success',
    message: `negative_so_without_original:${created}`,
    odooRecordId: Number(created),
    actions: ['negative_so'],
  }
}

export async function processReturnEvent(input: ReturnEventInput): Promise<ReturnOutcome> {
  const { client, platform, workspaceId, storeId, orderId, settings } = input
  if (settings.mode === 'nothing') {
    return { handled: false, status: 'skipped', message: 'returns_disabled', actions: [] }
  }

  try {
    const original = await findOriginalSaleOrder(client, {
      workspaceId,
      platform,
      storeId,
      orderId,
      orderCode: String((input.payload?.order as any)?.code || input.payload?.code || input.payload?.order_code || ''),
      payload: input.payload,
    })

    if (!original) {
      if (settings.fallback_when_missing === 'skip') {
        return skipped(`original_order_not_found:${orderId}`)
      }
      return createFromPayloadWithoutOrder(input, input.refundedLines || [])
    }
    if (original.state === 'cancel' && settings.mode !== 'negative_so') {
      return skipped(`original_order_cancelled:${original.name}`)
    }

    const lines = await buildReturnLines(client, original, platform, input)
    if (lines.length === 0) {
      return skipped(`nothing_to_return:${original.name}`)
    }

    const actions: string[] = []
    let odooRecordId: number | undefined

    if (settings.mode === 'negative_so') {
      odooRecordId = await createNegativeSaleOrder(client, original, lines, settings.reason, {
        orderStdSettings: input.orderStdSettings,
        payload: input.payload,
        platform,
      })
      actions.push(`negative_so:${odooRecordId}`)
      if (input.autoConfirm) {
        await client.execute('sale.order', 'action_confirm', [[odooRecordId]])
        actions.push('confirmed')
      }
    } else {
      const majorVersion = await client.getMajorVersion().catch(() => 17)
      const stock = await createStockReturn(client, original.id, lines, majorVersion)
      actions.push(`stock_return:${stock.pickingIds.join(',') || 'none'}`)
      odooRecordId = original.id

      if (settings.create_credit_note) {
        const invoiceId = await findInvoiceForOrder(client, original)
        if (!invoiceId) {
          actions.push('credit_note_skipped:no_invoice')
        } else {
          const creditId = await createCreditNote(
            client,
            original,
            invoiceId,
            lines,
            settings.credit_note_journal_id,
            settings.reason
          )
          actions.push(`credit_note:${creditId}`)
        }
      }
    }

    return {
      handled: true,
      status: 'success',
      message: actions.join('|'),
      odooRecordId,
      actions,
    }
  } catch (err: any) {
    return {
      handled: true,
      status: 'failed',
      message: err?.message ? String(err.message).slice(0, 300) : String(err).slice(0, 300),
      actions: [],
    }
  }
}
