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
import { resolveOrderRelatedRecord } from '@/lib/orders/related-matching'
import { getCachedStandardMappingSettings } from '@/lib/sync/settings'
import { supabaseAdmin } from '@/lib/sync-runtime'
import { readOrderRelatedDetails } from '@/lib/zid/order-related-data'
import {
  extractOrderLocationInfo,
  paymentKeysFromOrder,
  resolveAnalyticDistribution,
  toOdooAnalyticFields,
} from '@/lib/odoo/analytic-distribution'
import type { OdooClient } from '@/lib/odoo-client'
import type { PlatformKey } from '@/lib/platform-fields'
import {
  resolveOrderDiscountAmount,
  resolveOrderVatTax,
  resolveZidCodAmount,
  resolveZidShippingCost,
} from '@/lib/zid/order-helpers'

import {
  extractStoreReturnReason,
  extractZidReceivedReturnLines,
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
  readCreditNoteReturnLedger,
  readNegativeReturnLedger,
  resolveOdooProductId,
  type OdooReturnLine,
  type OriginalSaleOrder,
  type SaleOrderLineInfo,
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
  lines: readonly StoreReturnLine[],
  identity?: { workspaceId: string; storeId: string },
): Promise<{ byProduct: Map<number, number>; unresolved: number }> {
  const byProduct = new Map<number, number>()
  let unresolved = 0
  // Match the same product.product and match fields as normal order lines.
  // Source return UUIDs are not a substitute for a merchant's saved SKU,
  // barcode or custom match pair.
  const matchSettings = identity
    ? await getCachedStandardMappingSettings(identity.workspaceId, platform, 'products', identity.storeId)
    : null
  for (const line of lines) {
    let odooId: number | null
    if (identity && platform === 'zid') {
      const source: Record<string, unknown> = {
        id: line.storeProductId, product_id: line.storeProductId,
        sku: line.sku, name: line.name,
      }
      const match = await resolveOrderRelatedRecord(client, supabaseAdmin,
        { workspaceId: identity.workspaceId, platform, storeId: identity.storeId },
        'products', source, matchSettings,
        () => readOrderRelatedDetails(client, {
          workspaceId: identity.workspaceId, platform, storeId: identity.storeId,
        }, 'products', source))
      odooId = match.configured ? match.recordId
        : await resolveOdooProductId(client, platform, line.storeProductId, line.sku)
      if (match.configured && !odooId) {
        throw new Error('return_configured_product_not_found:' + (line.sku || line.storeProductId))
      }
    } else {
      odooId = await resolveOdooProductId(client, platform, line.storeProductId, line.sku)
    }
    if (!odooId) {
      unresolved += 1
      continue
    }
    byProduct.set(odooId, (byProduct.get(odooId) || 0) + Math.abs(line.quantity))
  }
  return { byProduct, unresolved }
}

function isFeeOrServiceLine(
  line: SaleOrderLineInfo,
  orderStdSettings?: Record<string, any> | null
): boolean {
  const settings = orderStdSettings || {}
  const shippingId = Number(settings.shipping_product_id || settings.order?.shipping_product_id)
  const codId = Number(settings.cod_product_id || settings.order?.cod_product_id)
  const discountId = Number(settings.discount_product_id || settings.order?.discount_product_id)

  if (shippingId && line.productId === shippingId) return true
  if (codId && line.productId === codId) return true
  if (discountId && line.productId === discountId) return true

  const lower = (line.productName || '').toLowerCase()
  if (lower.includes('shipping') || line.productName.includes('شحن') || line.productName.includes('توصيل')) {
    return true
  }
  if (
    lower.includes('cash on delivery') ||
    lower.includes('cod') ||
    line.productName.includes('الدفع عند الاستلام') ||
    line.productName.includes('تحصيل')
  ) {
    return true
  }
  if (lower.includes('discount') || line.productName.includes('خصم') || line.priceUnit < 0) {
    return true
  }
  return false
}

export function resolveOrderDiscountPercent(payload: Record<string, unknown> | null | undefined): number {
  if (!payload) return 0
  const p = payload as any
  const directPct = parseFloat(String(
    p.discount_percentage ||
    p.order?.discount_percentage ||
    p.amounts?.discount?.percentage ||
    p.order?.amounts?.discount?.percentage ||
    '0'
  ))
  if (!isNaN(directPct) && directPct > 0) return directPct

  const discountAmount = resolveOrderDiscountAmount(payload)
  if (discountAmount > 0) {
    const subtotal = parseFloat(String(
      p.sub_total ||
      p.order?.sub_total ||
      p.amounts?.sub_total ||
      p.order_subtotal ||
      p.subtotal ||
      '0'
    ))
    if (!isNaN(subtotal) && subtotal > 0) {
      return Math.round((discountAmount / subtotal) * 100 * 100) / 100
    }
  }
  return 0
}

export function resolveLineDiscountPercent(
  line: SaleOrderLineInfo | StoreReturnLine,
  payload: Record<string, unknown> | null | undefined,
  orderDiscountPercent: number
): number {
  if ('discount' in line && line.discount && line.discount > 0) {
    return line.discount
  }
  if (!payload) return orderDiscountPercent > 0 ? orderDiscountPercent : 0
  const p = payload as any
  const prods = [
    ...(Array.isArray(p?.products) ? p.products : []),
    ...(Array.isArray(p?.order?.products) ? p.order.products : []),
    ...(Array.isArray(p?.items) ? p.items : []),
    ...(Array.isArray(p?.order?.items) ? p.order.items : []),
    ...(Array.isArray(p?.line_items) ? p.line_items : []),
  ]
  const lineSku = ('sku' in line ? line.sku : '') || ''
  const lineName = ('productName' in line ? line.productName : ('name' in line ? line.name : '')) || ''
  const lineStoreId = ('storeProductId' in line ? line.storeProductId : '') || ''

  const match = prods.find(pr => {
    const prSku = String(pr.sku || pr.code || pr.product_sku || '')
    const prId = String(pr.id || pr.product_id || '')
    const prName = String(pr.name || pr.product_name || pr.title || '')
    if (lineSku && prSku && lineSku.toLowerCase() === prSku.toLowerCase()) return true
    if (lineStoreId && prId && lineStoreId === prId) return true
    if (lineName && prName && lineName.toLowerCase() === prName.toLowerCase()) return true
    return false
  })

  if (match) {
    const pct = parseFloat(String(match.discount_percentage || match.discount_percent || '0'))
    if (!isNaN(pct) && pct > 0) return pct
    const discAmount = parseFloat(String(match.discount || '0'))
    const price = parseFloat(String(match.price || match.price_unit || match.original_price || '0'))
    if (!isNaN(discAmount) && discAmount > 0 && !isNaN(price) && price > 0) {
      return Math.round((discAmount / price) * 100 * 100) / 100
    }
  }

  return orderDiscountPercent > 0 ? orderDiscountPercent : 0
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
      : await readCreditNoteReturnLedger(client, original.name)

  // Zid only ever gives us "remaining returnable", so the cumulative returned
  // quantity is derived from the order itself. Salla gives the refunded lines
  // directly. Whichever source exists, the result is a per-product total.
  let targets = new Map<number, number>()
  if (platform === 'zid') {
    const receipt = extractZidReceivedReturnLines(input.payload)
    if (receipt.error) throw new Error(receipt.error)
    if (!receipt.known) throw new Error('return_receipt_quantities_unknown')
    const { byProduct, unresolved } = await resolveStoreLines(client, platform, receipt.lines, { workspaceId: input.workspaceId, storeId: input.storeId })
    if (unresolved > 0) throw new Error('return_receipt_products_unmapped')
    targets = byProduct
  } else if (input.remaining?.known) {
    const { byProduct, unresolved } = await resolveStoreLines(
      client,
      platform,
      input.remaining.lines,
      { workspaceId: input.workspaceId, storeId: input.storeId },
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
    targets = (await resolveStoreLines(client, platform, input.refundedLines, { workspaceId: input.workspaceId, storeId: input.storeId })).byProduct
  } else {
    // Zid can report a partial return with no readable view-for-return API.
    // Guessing "everything was returned" corrupts inventory and credits.
    // Require an authoritative quantity snapshot instead of inventing a full return.
    throw new Error('return_quantities_unknown')
  }

  // If all regular lines are returned (or this is a full reversal), also include delivery, COD, and discount lines
  const regularLines = original.lines.filter(l => !isFeeOrServiceLine(l, input.orderStdSettings))
  const isFullReturn =
    regularLines.length === 0 ||
    regularLines.every(l => (targets.get(l.productId) || 0) >= l.orderedQty)

  if (isFullReturn) {
    for (const line of original.lines) {
      if (isFeeOrServiceLine(line, input.orderStdSettings)) {
        targets.set(line.productId, Math.max(1, Math.abs(line.orderedQty)))
      }
    }
  }

  const orderDiscountPercent = resolveOrderDiscountPercent(input.payload)

  // One product can appear on several order lines (different prices/discounts).
  // The target is per product, so it is spent once: without this budget the
  // second line would repeat the full quantity, and a credit note would refund
  // more than the customer paid.
  const consumed = new Map<number, number>()
  const out: OdooReturnLine[] = []
  for (const line of original.lines) {
    const target = targets.get(line.productId) || 0
    if (target <= 0) continue
    const already = ledger.get(line.productId) || 0
    const available = Math.max(0, target - already - (consumed.get(line.productId) || 0))
    const quantity = available
    if (quantity <= 0) continue
    consumed.set(line.productId, (consumed.get(line.productId) || 0) + quantity)

    let discount = line.discount && line.discount > 0 ? line.discount : undefined
    if (!discount && !isFeeOrServiceLine(line, input.orderStdSettings)) {
      const resolvedDisc = resolveLineDiscountPercent(line, input.payload, orderDiscountPercent)
      if (resolvedDisc > 0) discount = resolvedDisc
    }

    out.push({
      productId: line.productId,
      quantity,
      priceUnit: line.priceUnit,
      name: line.productName,
      taxIds: line.taxIds,
      discount,
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
  const orderDiscountPercent = resolveOrderDiscountPercent(input.payload)
  const resolved: OdooReturnLine[] = []
  for (const line of lines) {
    let productId = await resolveOdooProductId(client, platform, line.storeProductId, line.sku)
    if (!productId && Number.isInteger(defaultProductId) && defaultProductId > 0) {
      productId = defaultProductId
    }
    if (!productId) continue
    const discount = resolveLineDiscountPercent(line, input.payload, orderDiscountPercent)
    resolved.push({
      productId,
      quantity: Math.abs(line.quantity),
      priceUnit: line.priceUnit || 0,
      name: line.name || '',
      taxIds: [],
      discount: discount > 0 ? discount : undefined,
    })
  }
  if (resolved.length === 0) return skipped('no_matching_products')

  const partnerId = await resolveCustomerPartner(client, input.payload, orderStdSettings)
  if (!partnerId) return skipped('customer_not_found')

  const majorVersion = await client.getMajorVersion().catch(() => 17)
  const taxField = majorVersion >= 18 ? 'tax_ids' : 'tax_id'

  // Resolve VAT / taxes from Standard Mapping
  const { taxId: vatTaxId } = resolveOrderVatTax(input.payload, {
    enableVat: true,
    vatCountryRules: orderStdSettings?.vat_country_rules || orderStdSettings?.order?.vat_country_rules,
    vatSaudiTaxId: orderStdSettings?.vat_saudi_tax_id || orderStdSettings?.order?.vat_saudi_tax_id,
    vatNonSaudiTaxId: orderStdSettings?.vat_non_saudi_tax_id || orderStdSettings?.order?.vat_non_saudi_tax_id,
  })
  const defaultTaxId = Number(orderStdSettings?.order?.default_tax_id || orderStdSettings?.tax?.default_tax_ids)
  const taxToApply = Number.isInteger(vatTaxId) && (vatTaxId as number) > 0
    ? (vatTaxId as number)
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
    if (line.discount !== undefined && line.discount > 0) {
      lineVals.discount = line.discount
    }
    if (taxToApply) {
      lineVals[taxField] = [[6, 0, [taxToApply]]]
    }
    if (evaluatedAnalyticFields && Object.keys(evaluatedAnalyticFields).length > 0) {
      Object.assign(lineVals, evaluatedAnalyticFields)
    }
    return [0, 0, lineVals]
  })

  // Shipping line
  const shippingCost = resolveZidShippingCost(input.payload)
  const addShipping = !!orderStdSettings?.order?.add_shipping_as_line || !!orderStdSettings?.add_shipping_as_line || !!orderStdSettings?.shipping_product_id
  if (addShipping && shippingCost > 0) {
    let shippingProdId = Number(orderStdSettings?.shipping_product_id || orderStdSettings?.order?.shipping_product_id)
    if (!shippingProdId && orderStdSettings?.shipping_product_sku) {
      shippingProdId = (await resolveOdooProductId(client, platform, '', String(orderStdSettings.shipping_product_sku))) || 0
    }
    if (shippingProdId > 0) {
      const shipVals: Record<string, unknown> = {
        product_id: shippingProdId,
        name: 'Shipping (شحن)',
        product_uom_qty: -1,
        price_unit: shippingCost,
      }
      if (taxToApply) shipVals[taxField] = [[6, 0, [taxToApply]]]
      if (evaluatedAnalyticFields) Object.assign(shipVals, evaluatedAnalyticFields)
      orderLines.push([0, 0, shipVals])
    }
  }

  // COD fee line
  const codFee = resolveZidCodAmount(input.payload)
  const addCod = !!orderStdSettings?.order?.add_cod_as_line || !!orderStdSettings?.add_cod_as_line || !!orderStdSettings?.cod_product_id
  if (addCod && codFee > 0) {
    let codProdId = Number(orderStdSettings?.cod_product_id || orderStdSettings?.order?.cod_product_id)
    if (!codProdId && orderStdSettings?.cod_product_sku) {
      codProdId = (await resolveOdooProductId(client, platform, '', String(orderStdSettings.cod_product_sku))) || 0
    }
    if (codProdId > 0) {
      const codVals: Record<string, unknown> = {
        product_id: codProdId,
        name: 'Cash on Delivery (الدفع عند الاستلام)',
        product_uom_qty: -1,
        price_unit: codFee,
      }
      if (taxToApply) codVals[taxField] = [[6, 0, [taxToApply]]]
      if (evaluatedAnalyticFields) Object.assign(codVals, evaluatedAnalyticFields)
      orderLines.push([0, 0, codVals])
    }
  }

  // Fixed discount line
  const discountMode = String(orderStdSettings?.order?.discount_mode || orderStdSettings?.discount_mode || 'percent')
  const orderDiscountAmount = resolveOrderDiscountAmount(input.payload)
  const addDiscount = !!orderStdSettings?.order?.add_discount_as_line || !!orderStdSettings?.add_discount_as_line
  if (addDiscount && discountMode !== 'percent' && orderDiscountAmount > 0) {
    let discProdId = Number(orderStdSettings?.discount_product_id || orderStdSettings?.order?.discount_product_id)
    if (!discProdId && orderStdSettings?.discount_product_sku) {
      discProdId = (await resolveOdooProductId(client, platform, '', String(orderStdSettings.discount_product_sku))) || 0
    }
    if (discProdId > 0) {
      const discVals: Record<string, unknown> = {
        product_id: discProdId,
        name: 'Discount (خصم)',
        product_uom_qty: -1,
        price_unit: -Math.abs(orderDiscountAmount),
      }
      if (taxToApply) discVals[taxField] = [[6, 0, [taxToApply]]]
      if (evaluatedAnalyticFields) Object.assign(discVals, evaluatedAnalyticFields)
      orderLines.push([0, 0, discVals])
    }
  }

  const storeReason = extractStoreReturnReason(input.payload, platform)
  const effectiveReason =
    settings.reason_type === 'custom'
      ? (settings.reason || storeReason || `Return of ${platform}:${orderId}`)
      : (storeReason || settings.reason || `Return of ${platform}:${orderId}`)

  const soVals: Record<string, unknown> = {
    partner_id: partnerId,
    client_order_ref: `RET:${platform}:${orderId}`,
    origin: `${platform}:${orderId}`,
    note: effectiveReason,
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

function resolveTriggeringStatus(payload: Record<string, unknown>, event: string): string {
  const p = payload as any
  const statusRaw =
    p.order_status?.code ??
    p.order_status?.slug ??
    p.order?.order_status?.code ??
    p.order?.order_status?.slug ??
    p.order_status ??
    p.order?.order_status ??
    p.status ??
    p.order?.status ??
    p.financial_status ??
    p.orderStatus ??
    event
  const key = String(statusRaw || '').toLowerCase().trim().replace(/-/g, '_')
  if (key.includes('partially_reversed') || key.includes('partially')) return 'partially_reversed'
  if (key.includes('reverse_in_progress') || key.includes('in_progress')) return 'reverse_in_progress'
  if (key.includes('reversed') || key.includes('refund') || key.includes('return')) return 'reversed'
  return key
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

    const storeReason = extractStoreReturnReason(input.payload, platform)
    const effectiveReason =
      settings.reason_type === 'custom'
        ? (settings.reason || storeReason || `Return of ${platform}:${orderId}`)
        : (storeReason || settings.reason || `Return of ${platform}:${orderId}`)

    const triggeringStatus = resolveTriggeringStatus(input.payload, input.event)
    const statusActions =
      input.orderStdSettings?.order?.status_actions ||
      (input.orderStdSettings as any)?.status_actions ||
      {}
    const statusConfig =
      statusActions[triggeringStatus] ||
      statusActions['reversed'] ||
      statusActions['partially_reversed'] ||
      statusActions['reverse_in_progress'] ||
      {}
    const pickingAction = String(statusConfig.picking_action || '')
    const invoiceAction = String(statusConfig.invoice_action || '')

    const actions: string[] = []
    let odooRecordId: number | undefined

    if (settings.mode === 'negative_so') {
      odooRecordId = await createNegativeSaleOrder(client, original, lines, effectiveReason, {
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
      const stock = await createStockReturn(client, original.id, lines, majorVersion, {
        orderName: original.name,
        pickingAction,
      })
      actions.push(`stock_return:${stock.pickingIds.join(',') || 'none'}`)
      odooRecordId = original.id

      if (settings.create_credit_note) {
        const invoiceId = await findInvoiceForOrder(client, original)
        const creditId = await createCreditNote(
          client,
          original,
          invoiceId,
          lines,
          settings.credit_note_journal_id,
          effectiveReason,
          { invoiceAction }
        )
        actions.push(`credit_note:${creditId}`)
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
