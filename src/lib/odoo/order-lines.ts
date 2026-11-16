import { paymentKeysFromOrder, resolveAnalyticDistribution, toOdooAnalyticFields } from '@/lib/odoo/analytic-distribution'
import { fetchFieldMeta } from '@/lib/odoo/field-meta'
import { convertCurrencyAmount } from '@/lib/odoo/order-currency'
import { extractOrderLocationInfo, resolveShippingCarrier } from '@/lib/odoo/order-location'
import type { OdooClient } from '@/lib/odoo-client'
import { extractBundleComponents, formatBundleInternalNotes, isDynamicBundle, isVoucher } from '@/lib/products/bundle'
import { hasSallaItemPrice, orderItemBasePriceKeys, readSallaAmount, readSallaOrderDiscount } from '@/lib/salla/order-amounts'
import { getCachedStandardMappingSettings } from '@/lib/sync/settings'
import { resolvePath, toNameString } from '@/lib/sync-helpers'
import { supabaseAdmin } from '@/lib/sync-runtime'
import type { FieldMappingItem, FieldMappingRow, OdooFieldMeta } from '@/lib/sync-types'
import type { VatCountryRule } from '@/lib/zid/order-helpers'
import { isOrderCreationEvent, isSaudiShippingAddress, resolveEffectiveTaxRate, resolveOrderCountryCode, resolveOrderDiscountAmount, resolveOrderVatTax, resolveZidCodAmount, resolveZidShippingCost } from '@/lib/zid/order-helpers'
import { readOrderRelatedDetails } from '@/lib/zid/order-related-data'

// ─── Helper: build sale.order.line items for sale.order mappings ────────────

// ──── Helper: normalize sale.order lines for update writes ─────
// Converts (0,0,...) line creates into a full replace [(5,0,0), ...] so Zid
// edits (including line changes) mirror into Odoo without duplicating lines.
// Replace happens ONLY when all of these hold:
//   - the payload actually carries products AND at least one line resolved;
//   - the Odoo order is still a quotation (draft/sent).
// Otherwise order_line is dropped → header-only update, existing Odoo lines
// untouched (protects confirmed/invoiced orders, partial payloads and
// transient product-resolution failures).
async function normalizeOrderLinesForUpdate(
  client: OdooClient,
  odooRecordId: number,
  zidData: Record<string, unknown>,
  effectiveOdooValues: Record<string, unknown>,
  existingState?: string,
): Promise<void> {
  if (!('order_line' in effectiveOdooValues)) return
  const drop = (reason: string) => {
    delete effectiveOdooValues.order_line
    console.info(`[SyncEngine] Order lines left untouched on Odoo #${odooRecordId}: ${reason}`)
  }
  const cmds: unknown = effectiveOdooValues.order_line
  const creates = (Array.isArray(cmds) ? cmds : []).filter(
    (c): c is [number, number, Record<string, unknown>] => Array.isArray(c) && c[0] === 0
  )
  if (creates.length === 0) {
    drop('no lines built from payload')
    return
  }
  const payloadHasProducts = ['products', 'items', 'order_items', 'line_items', 'order_items_list'].some((k) => {
    const arr: unknown = zidData[k]
    return Array.isArray(arr) && arr.length > 0
  })
  if (!payloadHasProducts) {
    drop('no products in payload')
    return
  }
  let state = existingState ?? ''
  if (!state) {
    try {
      const recs = await client.searchRead<any>('sale.order', [['id', '=', odooRecordId]], ['state'])
      state = String(recs?.[0]?.state || '')
    } catch {
      state = ''
    }
  }
  if (state !== 'draft' && state !== 'sent') {
    drop(`order state is "${state || 'unknown'}" (lines are replaced only on draft/sent quotations)`)
    return
  }

  // Preserve existing line taxes so replacement lines don't revert to default domestic VAT
  try {
    const majorVersion = await client.getMajorVersion().catch(() => 19)
    const taxField = majorVersion >= 18 ? 'tax_ids' : 'tax_id'
    let existingLines: any[] = []
    try {
      existingLines = await client.searchRead<any>(
        'sale.order.line',
        [['order_id', '=', odooRecordId]],
        ['id', 'product_id', taxField, 'name'],
        50
      )
    } catch {
      const altTaxField = taxField === 'tax_ids' ? 'tax_id' : 'tax_ids'
      existingLines = await client.searchRead<any>(
        'sale.order.line',
        [['order_id', '=', odooRecordId]],
        ['id', 'product_id', altTaxField, 'name'],
        50
      ).catch(() => [])
    }
    if (existingLines && existingLines.length > 0) {
      const taxByProduct = new Map<number, number[]>()
      let fallbackTaxIds: number[] | null = null

      for (const el of existingLines) {
        const prodId = Array.isArray(el.product_id) ? el.product_id[0] : (typeof el.product_id === 'number' ? el.product_id : null)
        const rawTaxes = el.tax_ids ?? el.tax_id ?? el[taxField]
        const taxes = Array.isArray(rawTaxes) ? rawTaxes.map(Number).filter((n: number) => !isNaN(n) && n > 0) : []
        if (prodId) {
          taxByProduct.set(prodId, taxes)
        }
        if (taxes.length > 0 && fallbackTaxIds === null) {
          fallbackTaxIds = taxes
        }
      }

      const zidTaxTotal = Number((zidData as any)?.tax_total ?? (zidData as any)?.total_tax ?? (zidData as any)?.order_tax ?? -1)
      const destCountry = resolveOrderCountryCode(zidData).toUpperCase()
      const isExportOrder = !isSaudiShippingAddress(zidData) || (destCountry !== 'SA' && destCountry !== '')
      const orderHasZeroTaxInZid = zidTaxTotal === 0 || isExportOrder

      for (const createCmd of creates) {
        const line = createCmd[2]
        if (!line) continue
        const hasExplicitTax = line.tax_ids !== undefined || line.tax_id !== undefined
        if (!hasExplicitTax) {
          const prodId = typeof line.product_id === 'number' ? line.product_id : null
          const existingTaxes = prodId ? taxByProduct.get(prodId) : null
          if (existingTaxes !== undefined && existingTaxes !== null) {
            line.tax_ids = [[6, 0, existingTaxes]]
            console.info(`[SyncEngine] Preserved existing Odoo taxes ${JSON.stringify(existingTaxes)} for product #${prodId} on order #${odooRecordId} update`)
          } else if (orderHasZeroTaxInZid) {
            line.tax_ids = [[6, 0, []]]
            console.info(`[SyncEngine] Explicitly cleared taxes for order #${odooRecordId} line (Zid tax_total is 0 / export order)`)
          } else if (fallbackTaxIds) {
            line.tax_ids = [[6, 0, fallbackTaxIds]]
            console.info(`[SyncEngine] Preserved existing order tax ${JSON.stringify(fallbackTaxIds)} on order #${odooRecordId} update`)
          }
        }
      }
    }
  } catch (err) {
    console.warn(`[SyncEngine] Could not inspect existing lines for taxes on order #${odooRecordId}:`, err)
  }

  effectiveOdooValues.order_line = [[5, 0, 0], ...creates]
  console.info(`[SyncEngine] Order update will REPLACE ${creates.length} line(s) on Odoo #${odooRecordId} (no duplicates)`)
}

/**
 * Prepares sale.order values for updating an existing record in Odoo:
 * 1. Checks current order state & pricelist in Odoo.
 * 2. Prunes partner_id: Never re-write partner_id on an existing order.
 *    In Odoo, writing partner_id triggers onchange('partner_id') which overwrites
 *    pricelist_id with partner.property_product_pricelist (resetting AED to SAR)
 *    and recalculates fiscal positions and taxes.
 * 3. Handles pricelist_id:
 *    - On confirmed orders ('sale', 'done', 'cancel'): Odoo forbids changing pricelist.
 *      Prunes pricelist_id and currency_id.
 *    - On draft quotations ('draft', 'sent'): Preserves the resolved multi-currency
 *      pricelist_id so Odoo never resets it to partner default.
 * 4. Normalizes order lines (replaces lines only on draft/sent quotations).
 */
export async function prepareSaleOrderForUpdate(
  client: OdooClient,
  odooRecordId: number,
  zidData: Record<string, unknown>,
  effectiveOdooValues: Record<string, unknown>,
): Promise<void> {
  let state = ''
  let existingPricelistId: number | null = null
  try {
    const recs = await client.searchRead<any>(
      'sale.order',
      [['id', '=', odooRecordId]],
      ['id', 'state', 'pricelist_id', 'currency_id'],
      1
    )
    if (recs?.[0]) {
      state = String(recs[0].state || '')
      if (Array.isArray(recs[0].pricelist_id) && recs[0].pricelist_id[0]) {
        existingPricelistId = Number(recs[0].pricelist_id[0])
      }
    }
  } catch {
    state = ''
  }

  // Never re-write partner or address references on an existing sale.order (prevents Odoo recomputing fiscal position & taxes):
  delete effectiveOdooValues.partner_id
  delete effectiveOdooValues.partner_invoice_id
  delete effectiveOdooValues.partner_shipping_id
  delete effectiveOdooValues.fiscal_position_id

  // Never modify taxes or order lines on an existing sale.order:
  // Taxes and line items are established ONLY at order creation.
  delete effectiveOdooValues.tax_id
  delete effectiveOdooValues.tax_ids
  delete effectiveOdooValues.amount_tax
  delete effectiveOdooValues.order_line

  const isConfirmed = state && state !== 'draft' && state !== 'sent'
  if (isConfirmed) {
    // Confirmed orders in Odoo forbid mutating pricelist_id (raises UserError)
    delete effectiveOdooValues.pricelist_id
    delete effectiveOdooValues.currency_id
  } else {
    // On draft quotations, preserve the multi-currency pricelist!
    if (!effectiveOdooValues.pricelist_id && existingPricelistId) {
      effectiveOdooValues.pricelist_id = existingPricelistId
    }
  }

  await normalizeOrderLinesForUpdate(client, odooRecordId, zidData, effectiveOdooValues, state)
}

/**
 * Build order_line array from Zid payload with discount + shipping support.
 *
 * Three discount modes (per user choice):
 *   A) Line-level: each product has its own discount %
 *   B) Order-level: a discount line item is appended (like shipping)
 *   C) Auto-detect: only apply if discount data exists in payload
 *
 * Reads `__settings` from the field_mapping.mappings:
 *   - addShippingAsLine, shippingProductId, shippingProductSku
 *   - addDiscountAsLine, discountProductId, discountProductSku, discountMode
 *
 * Reads line-level mappings from mapping.mappings['sale.order.line'].
 */
export async function buildOrderLineItems(
  client: OdooClient,
  mapping: FieldMappingRow,
  zidData: Record<string, unknown>,
  parentFieldMeta: Map<string, OdooFieldMeta>,
  parentOdooValues: Record<string, unknown>,
  platform?: 'zid' | 'salla' | 'shopify',
  orderStdSettings?: Record<string, any> | null,
  storeId = '',
  event = '',
  odooOperation = 'create',
): Promise<Record<string, unknown>[]> {
  const lines: Record<string, unknown>[] = []

  // 1. Find products array in Zid payload
  const candidates = ['products', 'items', 'order_items', 'line_items', 'order_items_list']
  let products: any[] = []
  for (const key of candidates) {
    const raw = (zidData as any)[key]
    if (Array.isArray(raw) && raw.length > 0) {
      products = raw
      console.info(`[SyncEngine] Found order items at payload.${key} (${products.length})`)
      break
    }
  }

  if (products.length === 0) {
    throw new Error('Order has no product line items; refusing to create an incomplete sales order')
  }
  if (products.some(product => !product || typeof product !== 'object' || Array.isArray(product))) {
    throw new Error('Order contains an invalid product line item')
  }

  // 2. Read line-level mappings for sale.order.line
  const lineMappings: FieldMappingItem[] = (mapping.mappings as any)?.['sale.order.line'] ?? []
  // Standard fallback: when there is no line-level mapping (fixed/standard mapping
  // path), resolve the Odoo product by the Zid line SKU so lines are actually created.
  const effectiveLineMappings = lineMappings.length > 0
    ? lineMappings
    : [{ id: 'std_product_id', erpField: 'product_id', zidField: 'sku' }]
  const settings: Record<string, any> = (mapping.mappings as any)?.['__settings'] ?? {}
  const settingsKeys = new Set(Object.keys(settings))

  // Priority: __settings (camelCase) > orderStdSettings (snake_case) > hardcoded defaults
  const keyMap: Record<string, string> = {
    addShippingAsLine: 'add_shipping_as_line',
    shippingProductId: 'shipping_product_id',
    shippingProductSku: 'shipping_product_sku',
    addDiscountAsLine: 'add_discount_as_line',
    discountProductId: 'discount_product_id',
    discountProductSku: 'discount_product_sku',
    discountMode: 'discount_mode',
    addCodAsLine: 'add_cod_as_line',
    codProductId: 'cod_product_id',
    codProductSku: 'cod_product_sku',
    codAmount: 'cod_amount',
    productFallbackPolicy: 'product_fallback_policy',
    defaultProductId: 'default_product_id',
    enableVat: 'enable_vat',
    vatCountryRules: 'vat_country_rules',
    vatSaudiTaxId: 'vat_saudi_tax_id',
    vatNonSaudiTaxId: 'vat_non_saudi_tax_id',
    pricesIncludeTax: 'prices_include_tax',
    taxRatePercent: 'tax_rate_percent',
    taxRatesByCountry: 'tax_rates_by_country',
  }
  const orDefault = (camelKey: string, fallback: any) => {
    if (settingsKeys.has(camelKey)) return settings[camelKey]
    const snakeKey = keyMap[camelKey]
    if (orderStdSettings && snakeKey && snakeKey in orderStdSettings) return orderStdSettings[snakeKey]
    if (orderStdSettings?.order && snakeKey && snakeKey in orderStdSettings.order) return orderStdSettings.order[snakeKey]
    return fallback
  }

  const enableVat = !!orDefault('enableVat', false)
  const vatCountryRules: VatCountryRule[] = (
    orDefault('vatCountryRules', null)
    ?? orderStdSettings?.vat_country_rules
    ?? orderStdSettings?.order?.vat_country_rules
    ?? settings?.vat_country_rules
    ?? []
  )
  const vatSaudiTaxId = orDefault('vatSaudiTaxId', null) ? Number(orDefault('vatSaudiTaxId', null)) : null
  const vatNonSaudiTaxId = orDefault('vatNonSaudiTaxId', null) ? Number(orDefault('vatNonSaudiTaxId', null)) : null

  const isStatusUpdateEvent = event === 'order.status.update' || event.endsWith('.status.update') || event === 'order.status_update' || event === 'order.updated' || event.endsWith('.updated') || event === 'order.update' || odooOperation === 'update'
  const isCreation = (odooOperation === 'create' || !odooOperation) && !isStatusUpdateEvent && isOrderCreationEvent(event)

  const { taxId: resolvedVatTaxId, appliedCountryCode, destinationCountryCode } = resolveOrderVatTax(zidData, {
    enableVat,
    vatCountryRules,
    vatSaudiTaxId,
    vatNonSaudiTaxId,
    event,
    isOrderCreate: isCreation,
  })

  if (enableVat) {
    if (resolvedVatTaxId) {
      console.info(`[SyncEngine] VAT enabled for order: destination=${destinationCountryCode || 'Unknown'} (matched=${appliedCountryCode}), applied tax ID: ${resolvedVatTaxId}`)
    } else {
      console.info(`[SyncEngine] VAT enabled for order: destination=${destinationCountryCode || 'Unknown'}, but no tax configured for this destination — lines will be sent with 0% tax (clearing default taxes)`)
    }
  } else {
    console.info('[SyncEngine] VAT disabled for order in Standard Mapping')
  }

  const pricesIncludeTax = !!orDefault('pricesIncludeTax', false)
  const taxRatePercentRaw = orDefault('taxRatePercent', 15)
  const fallbackTaxRate = (taxRatePercentRaw !== null && taxRatePercentRaw !== undefined && !isNaN(Number(taxRatePercentRaw)))
    ? Number(taxRatePercentRaw)
    : 15
  const countryTaxRates = orDefault('taxRatesByCountry', null)
    ?? orderStdSettings?.tax_rates_by_country
    ?? orderStdSettings?.order?.tax_rates_by_country
    ?? settings?.tax_rates_by_country

  const { taxRate: taxRatePercent, matchedCountryCode, destinationCountryCode: taxDestCountry } = resolveEffectiveTaxRate(zidData, {
    pricesIncludeTax,
    countryTaxRates,
    fallbackTaxRatePercent: fallbackTaxRate,
  })

  const defaultLineTaxCmd: [number, number, number[]] | null = isCreation && enableVat && (resolvedVatTaxId || platform === 'salla')
    ? [6, 0, resolvedVatTaxId ? [resolvedVatTaxId] : []]
    : (isCreation && pricesIncludeTax && taxRatePercent === 0 ? [6, 0, []] : null)

  if (pricesIncludeTax) {
    if (taxRatePercent > 0) {
      console.info(`[SyncEngine] Prices include tax enabled (${taxRatePercent}% for country "${taxDestCountry}" matched="${matchedCountryCode}")`)
    } else {
      console.info(`[SyncEngine] Prices include tax enabled, but tax rate is 0% for destination "${taxDestCountry}" (export/unlisted) — amounts will not be divided`)
    }
  }


  // Product synchronization may be disabled while orders still need its
  // read-only match fields. Load once per order, never once per missing line.
  const relatedPlatform = platform || 'zid'
  const relatedStoreId = storeId || mapping.store_id || mapping.merchant_id || ''
  const prodStd = mapping.workspace_id
    ? await getCachedStandardMappingSettings(mapping.workspace_id, relatedPlatform, 'products', relatedStoreId)
    : null
  const { resolveOrderRelatedRecord } = await import('@/lib/orders/related-matching')
  const { findUniqueOrderLineProduct } = await import('@/lib/orders/line-product')
  const lineProductLookups = new Map<string, Promise<number | null>>()
  const lookupLineProduct = (value: string): Promise<number | null> => {
    const key = value.trim()
    let lookup = lineProductLookups.get(key)
    if (!lookup) {
      lookup = findUniqueOrderLineProduct(client, key, JSON.stringify([mapping.workspace_id, relatedPlatform, relatedStoreId]))
      lineProductLookups.set(key, lookup)
    }
    return lookup
  }

  const productFallbackPolicy = String(orDefault('productFallbackPolicy', 'create_new') || 'create_new')
  const defaultProductIdRaw = orDefault('defaultProductId', null)
  const defaultProductId = defaultProductIdRaw ? Number(defaultProductIdRaw) : null

  const shippingProductId = String(orDefault('shippingProductId', '') || '')
  const shippingProductSku = String(orDefault('shippingProductSku', '') || '')
  const addShippingAsLine = !!orDefault('addShippingAsLine', false) || !!shippingProductId

  const addDiscountAsLine = !!orDefault('addDiscountAsLine', false)
  const discountProductId = String(orDefault('discountProductId', '') || '')
  const discountProductSku = String(orDefault('discountProductSku', '') || '')
  const discountMode = String(orDefault('discountMode', 'fixed') || 'fixed')

  const addCodAsLine = !!orDefault('addCodAsLine', false)
  const codProductId = String(orDefault('codProductId', '') || '')
  const codProductSku = String(orDefault('codProductSku', '') || '')
  const codAmount = parseFloat(String(orDefault('codAmount', 0) ?? 0)) || 0
  // COD fee comes from the Zid payload first (payment.invoice[] COD row or named
  // keys); the settings amount is only a fallback when Zid sends none.
  // Shopify sends no COD fee amount at all (only the gateway name), so for
  // Shopify orders this is always the configured `cod_amount` — that is the
  // intended behaviour, not a missing read.
  const currencyConversionRate = typeof orderStdSettings?._currency_conversion_rate === 'number'
    ? orderStdSettings._currency_conversion_rate
    : (typeof orderStdSettings?.currency_conversion_rate === 'number' ? orderStdSettings.currency_conversion_rate : 1.0)

  const sallaCodFee = platform === 'salla' ? readSallaAmount(resolvePath(zidData, 'amounts.cash_on_delivery')) : undefined
  const rawCodFee = sallaCodFee ?? (resolveZidCodAmount(zidData) || codAmount)
  const codFeeAmount = convertCurrencyAmount(rawCodFee, currencyConversionRate)

  const rawShippingCost = resolveZidShippingCost(zidData)
  const shippingCost = convertCurrencyAmount(rawShippingCost, currencyConversionRate)

  const sallaOrderDiscount = platform === 'salla' ? readSallaOrderDiscount(zidData) : undefined
  let orderLevelDiscount = resolveOrderDiscountAmount(zidData)
  if (sallaOrderDiscount !== undefined) orderLevelDiscount = sallaOrderDiscount
  const convertedOrderDiscount = convertCurrencyAmount(orderLevelDiscount, currencyConversionRate)
  console.info(`[SyncEngine] Order line settings: addShipping=${addShippingAsLine} addDiscount=${addDiscountAsLine} discountMode=${discountMode} shippingCost=${shippingCost} addCod=${addCodAsLine} codFee=${codFeeAmount} orderDiscount=${convertedOrderDiscount} rate=${currencyConversionRate}`)

  // 3. Fetch line field meta (for many2one resolution and tax field detection)
  // analytic_distribution (Odoo 17+) / analytic_account_id (<=16) are probed
  // with the rest so the distribution can be attached without a second call,
  // and so an explicit line mapping for them survives the allowlist below.
  const lineFieldNames = [...new Set([
    ...effectiveLineMappings.map(m => m.erpField),
    'tax_id',
    'tax_ids',
    'analytic_distribution',
    'analytic_account_id',
  ])]
  const lineFieldMeta = lineFieldNames.length > 0
    ? await fetchFieldMeta(client, 'sale.order.line', lineFieldNames)
    : new Map<string, OdooFieldMeta>()

  // Odoo <= 17 uses `tax_id` on sale.order.line; Odoo 18+ (including 19) uses `tax_ids`
  let lineTaxField = 'tax_ids'
  if (lineFieldMeta.has('tax_ids')) {
    lineTaxField = 'tax_ids'
  } else if (lineFieldMeta.has('tax_id')) {
    lineTaxField = 'tax_id'
  } else {
    try {
      const fg = await client.execute<Record<string, unknown>>(
        'sale.order.line',
        'fields_get',
        [['tax_ids', 'tax_id']],
        { attributes: ['type'] }
      )
      if (fg?.tax_ids) {
        lineTaxField = 'tax_ids'
      } else if (fg?.tax_id) {
        lineTaxField = 'tax_id'
      }
    } catch {
      // Default to tax_ids
    }
  }
  console.info(`[SyncEngine] Using "${lineTaxField}" for sale.order.line taxes in Odoo`)

  // 4. Build each line
  let subtotalBeforeDiscount = 0
  let totalDiscountAmount = 0

  // First positive number from candidate keys (Zid price keys vary by payload
  // version and values may be numeric strings like "150.00 SAR").
  const numFromKeys = (source: Record<string, unknown>, keys: string[]): number => {
    for (const key of keys) {
      let raw = resolvePath(source, key)
      if (raw === undefined || raw === null) continue
      // Handle nested object amounts (e.g. Salla { amount: 150, currency: 'SAR' })
      if (typeof raw === 'object' && !Array.isArray(raw)) {
        const obj = raw as Record<string, unknown>
        raw = obj.amount ?? obj.value ?? obj.price ?? obj.total ?? undefined
      }
      if (raw === undefined || raw === null || typeof raw === 'object') continue
      const num = parseFloat(String(raw).replace(/[^0-9.\-]/g, ''))
      if (!isNaN(num) && num > 0) return num
    }
    return 0
  }

  // Check if user mapped a discount field at line level (Option A)
  const hasLineDiscountMapping = effectiveLineMappings.some(m => m.erpField === 'discount')
  // Track whether any product will actually carry discount to satisfy Option C rule
  let anyProductHasDiscount = false
  let appliedSallaLineDiscount = 0

  for (const product of products) {
    const productData = (product && typeof product === 'object') ? product as Record<string, unknown> : {}
    const line: Record<string, unknown> = {}
    const staticProductMapping = effectiveLineMappings.find(fm =>
      fm.erpField === 'product_id' && fm.staticValue !== undefined && fm.staticValue !== null && fm.staticValue !== '')
    const productMatch = staticProductMapping
      ? { configured: false, recordId: null, matchValues: undefined }
      : await resolveOrderRelatedRecord(client, supabaseAdmin, {
          workspaceId: mapping.workspace_id, platform: relatedPlatform, storeId: relatedStoreId,
        }, 'products', productData, prodStd, platform === 'zid'
          ? () => readOrderRelatedDetails(client, { workspaceId: mapping.workspace_id, platform, storeId: relatedStoreId }, 'products', productData)
          : undefined)
    if (productMatch.recordId) line.product_id = productMatch.recordId
    if (!staticProductMapping && !productMatch.configured) {
      const identifiable = ['id', 'product_id', 'sku', 'code', 'barcode', 'product_sku', 'product_barcode', 'name', 'title', 'product_name']
        .some(key => {
          const value = toNameString(productData[key])
          return value !== '' && value !== '[object Object]'
        })
      if (!identifiable) throw new Error('Order contains an incomplete product line without an identifier or name')
    }

    for (const fm of effectiveLineMappings) {
      if (fm.erpField === 'product_id') {
        if (staticProductMapping) {
          const staticId = Number(staticProductMapping.staticValue)
          if (!Number.isInteger(staticId) || staticId <= 0) throw new Error('Invalid static order-line product id')
          line.product_id = staticId
          continue
        }
        if (productMatch.configured) continue
      }
      if (!fm.erpField) continue
      if (fm.erpField === 'discount') {
        // Option A handled below
        continue
      }
      const rawValue = fm.zidField ? resolvePath(productData, fm.zidField) : fm.staticValue
      if (rawValue === undefined || rawValue === null) continue

      const meta = lineFieldMeta.get(fm.erpField)
      const ttype = meta?.ttype ?? ''
      const relation = meta?.relation ?? ''

      // Product identifiers are never interpreted as raw Odoo ids. Match
      // ambiguity/read failures must propagate before any sale.order write.
      if (fm.erpField === 'product_id' || (ttype === 'many2one' && relation === 'product.product')) {
        const foundId = await lookupLineProduct(String(rawValue).trim())
        if (foundId) line[fm.erpField] = foundId
        continue
      }
      if (ttype === 'many2one' && relation) {
        const fallback = parseInt(String(rawValue).trim(), 10)
        if (!isNaN(fallback) && fallback > 0) line[fm.erpField] = fallback
        continue
      }

      // Numeric
      let val: any = rawValue
      const isSallaNetPrice = platform === 'salla' &&
        (fm.zidField === 'amounts.price_without_tax' || fm.zidField === 'amounts.price_without_tax.amount')
      if (platform === 'salla' && fm.erpField === 'price_unit') {
        val = readSallaAmount(val)
        if (val === undefined) throw new Error('Mapped Salla order item price is invalid')
      }
      if (typeof val === 'string' && ['integer', 'float', 'monetary'].includes(ttype)) {
        const parsed = parseFloat(val)
        if (!isNaN(parsed)) val = parsed
      }
      if (fm.erpField === 'price_unit' && typeof val === 'number' && val > 0 && pricesIncludeTax && taxRatePercent > 0 && !isSallaNetPrice) {
        val = Math.round((val / (1 + (taxRatePercent / 100))) * 100) / 100
      }
      line[fm.erpField] = val
    }

    // Apply line-level discount (Option A)
    // Zid order-line price keys vary by payload version (price / net_sale_price /
    // gross_sale_price / price_before / net_price / total ...). Prefer explicit
    // unit keys, then derive the unit from line totals / quantity.
    const qty = parseFloat(String(productData.quantity ?? productData.qty ?? 1)) || 1
    const sallaNetPrice = platform === 'salla' ? readSallaAmount(resolvePath(productData, 'amounts.price_without_tax')) : undefined
    const sallaItemDiscount = platform === 'salla' ? readSallaAmount(resolvePath(productData, 'amounts.total_discount')) : undefined
    let zidPrice = numFromKeys(productData, orderItemBasePriceKeys)
      || numFromKeys(productData, ['total_before', 'total']) / qty
    let zidSalePrice = numFromKeys(productData, ['net_sale_price', 'gross_sale_price', 'sale_price', 'price_after_discount', 'discounted_price', 'discounted_total', 'price'])
      || numFromKeys(productData, ['discounted_total', 'total']) / qty
      || zidPrice
    const zidDiscountDirect = numFromKeys(productData, ['discount', 'discount_percentage'])

    if (sallaNetPrice !== undefined) {
      zidPrice = sallaNetPrice
      zidSalePrice = sallaItemDiscount === undefined ? zidPrice : Math.max(0, zidPrice - sallaItemDiscount / qty)
    } else if (pricesIncludeTax && taxRatePercent > 0) {
      const taxDivisor = 1 + (taxRatePercent / 100)
      if (zidPrice > 0) {
        zidPrice = Math.round((zidPrice / taxDivisor) * 100) / 100
      }
      if (zidSalePrice > 0) {
        zidSalePrice = Math.round((zidSalePrice / taxDivisor) * 100) / 100
      }
      console.info(`[SyncEngine] Prices include tax enabled (${taxRatePercent}%): converted unit price before tax (price=${zidPrice}, salePrice=${zidSalePrice})`)
    }
    console.info(`[SyncEngine] Order line sku=${String(productData.sku ?? '')} qty=${qty} price=${zidPrice} salePrice=${zidSalePrice} discountDirect=${zidDiscountDirect}`)

    if (platform === 'salla' && typeof line.price_unit !== 'number' && !hasSallaItemPrice(productData)) {
      throw new Error('Salla order item has no usable price')
    }

    if (zidDiscountDirect > 0 || (zidSalePrice < zidPrice && (zidSalePrice > 0 || sallaItemDiscount !== undefined))) {
      anyProductHasDiscount = true
    }

    const shouldApplyPercentToLine = hasLineDiscountMapping || (addDiscountAsLine && discountMode === 'percent')

    if (shouldApplyPercentToLine) {
      let discountPercent = 0
      if (zidDiscountDirect > 0) {
        // Use Zid's explicit discount value
        discountPercent = zidDiscountDirect
      } else if (zidPrice > 0 && zidSalePrice < zidPrice && (zidSalePrice > 0 || sallaItemDiscount !== undefined)) {
        // Calculate from price difference (Option C fallback)
        discountPercent = Math.round(((zidPrice - zidSalePrice) / zidPrice) * 100 * 100) / 100
      }

      if (discountPercent > 0) {
        line['discount'] = discountPercent
        // Odoo expects price_unit to be the FULL pre-discount price
        if (zidPrice > 0) line['price_unit'] = zidPrice
      }
    }

    // If price_unit wasn't set from mapping, derive it
    if (!line['price_unit'] && !(platform === 'salla' && line.price_unit === 0)) {
      line['price_unit'] = (zidPrice > 0) ? zidPrice : (zidSalePrice > 0 ? zidSalePrice : 0)
    }

    if (currencyConversionRate > 0 && currencyConversionRate !== 1.0 && typeof line['price_unit'] === 'number') {
      line['price_unit'] = convertCurrencyAmount(line['price_unit'], currencyConversionRate)
    }

    const baseUnit = typeof line['price_unit'] === 'number' ? line['price_unit'] : ((zidPrice > 0) ? zidPrice : (zidSalePrice > 0 ? zidSalePrice : 0))
    subtotalBeforeDiscount += baseUnit * qty
    totalDiscountAmount += convertCurrencyAmount(Math.max(0, zidPrice - zidSalePrice), currencyConversionRate) * qty
    if (platform === 'salla') appliedSallaLineDiscount += baseUnit * qty * (Number(line.discount) || 0) / 100

    // Auto-set product_uom_qty if user didn't map it explicitly
    if (!('product_uom_qty' in line)) {
      const hasQtyMapping = effectiveLineMappings.some(m => m.erpField === 'product_uom_qty')
      if (!hasQtyMapping) {
        line['product_uom_qty'] = qty
      }
    }

    // Migrate between tax_id and tax_ids if mapped differently
    if (line['tax_id'] && lineTaxField === 'tax_ids') {
      line['tax_ids'] = line['tax_id']
      delete line['tax_id']
    } else if (line['tax_ids'] && lineTaxField === 'tax_id') {
      line['tax_id'] = line['tax_ids']
      delete line['tax_ids']
    }

    // Resolve line-level tax from Standard Mapping VAT setting (or DB tax_mappings fallback)
    if (!line[lineTaxField]) {
      let resolvedMappingTaxId: number | null = null
      const zidTaxName = String(productData.tax_name ?? productData.tax ?? productData.tax_rate ?? '')
      if (mapping.workspace_id && zidTaxName && !enableVat) {
        try {
          let query = supabaseAdmin
            .from('tax_mappings')
            .select('odoo_tax_id')
            .eq('workspace_id', mapping.workspace_id)
            .eq('source_tax_name', zidTaxName)
          if (platform === 'salla') query = query.eq('platform', platform)
          const { data: taxRow } = await query.maybeSingle()
          if (taxRow?.odoo_tax_id) {
            resolvedMappingTaxId = taxRow.odoo_tax_id
          }
        } catch (err) {
          console.warn(`[SyncEngine] Failed to resolve tax for "${zidTaxName}":`, err)
        }
      }
      if (isCreation) {
        if (resolvedMappingTaxId) {
          line[lineTaxField] = [[6, 0, [resolvedMappingTaxId]]]
        } else if (defaultLineTaxCmd) {
          line[lineTaxField] = [defaultLineTaxCmd]
        }
      }
    }

    // Ensure 'name' (Description) is always populated; Odoo sale.order.line requires 'name'
    if (!line['name']) {
      let resolvedName = ''
      const rawProdName = productData.name ?? productData.title ?? productData.product_name
      if (typeof rawProdName === 'string') {
        resolvedName = rawProdName.trim()
      } else if (rawProdName && typeof rawProdName === 'object') {
        const ar = (rawProdName as any).ar
        const en = (rawProdName as any).en
        resolvedName = String(ar || en || Object.values(rawProdName)[0] || '').trim()
      }
      if (!resolvedName && productData.sku) {
        resolvedName = `[${String(productData.sku).trim()}]`
      }
      line['name'] = resolvedName || 'Product'
    }

    // If product_id was not matched in Odoo yet, try matching via productData properties
    if (!line['product_id'] && !productMatch.configured) {
      const candidates = [
        productData.sku,
        productData.code,
        productData.barcode,
        (productData as any).product_sku,
        (productData as any).product_barcode,
        line['name'],
      ].filter(Boolean).map(c => String(c).trim()).filter(Boolean)

      for (const candidate of candidates) {
        const found = await lookupLineProduct(candidate)
        if (found) {
          line['product_id'] = found
          console.info(`[SyncEngine] Resolved product #${found} for candidate "${candidate}"`)
          break
        }
      }
    }

    // If product_id was not matched in Odoo, apply the configured product fallback policy
    if (!line['product_id']) {
      if (productFallbackPolicy === 'default_product' && defaultProductId && defaultProductId > 0) {
        line['product_id'] = defaultProductId
        console.info(`[SyncEngine] Product not matched in Odoo for item "${String(productData.name || productData.sku || '')}". Using default product #${defaultProductId}`)
      } else if (productFallbackPolicy === 'skip_order') {
        const prodIdentifier = String(productData.name || productData.title || productData.sku || productData.id || 'Unknown')
        const skipErr = new Error(`تم إلغاء تسجيل الطلب: المنتج "${prodIdentifier}" (SKU: ${String(productData.sku || '-')}) غير مسجل في أودو وإعداد المطابقة محدد على إلغاء تسجيل الطلب (Order skipped: Product "${prodIdentifier}" not found in Odoo and policy is skip_order)`)
        ;(skipErr as any).isOrderSkipped = true
        throw skipErr
      } else if (productFallbackPolicy === 'create_new') {
        let newName = ''
        const rawProdName = productData.name ?? productData.title ?? productData.product_name
        if (typeof rawProdName === 'string') {
          newName = rawProdName.trim()
        } else if (rawProdName && typeof rawProdName === 'object') {
          const ar = (rawProdName as any).ar
          const en = (rawProdName as any).en
          newName = String(ar || en || Object.values(rawProdName)[0] || '').trim()
        }
        const sku = String(productData.sku ?? productData.code ?? productData.barcode ?? '').trim()
        if (!newName && sku) {
          newName = `Product [${sku}]`
        }
        const barcode = String(productData.barcode ?? '').trim()
        let price = sallaNetPrice ?? numFromKeys(productData, ['price', 'sale_price', 'unit_price', 'amount'])
        if (sallaNetPrice === undefined && pricesIncludeTax && taxRatePercent > 0 && price > 0) {
          price = Math.round((price / (1 + (taxRatePercent / 100))) * 100) / 100
        }

        // Calculate price markup if configured in Product Standard Mapping
        if (prodStd?.price?.markup_percent && Number(prodStd.price.markup_percent) > 0) {
          price = price * (1 + Number(prodStd.price.markup_percent) / 100)
          if (prodStd.price.rounding === 'round') price = Math.round(price)
          else if (prodStd.price.rounding === 'ceil') price = Math.ceil(price)
          else if (prodStd.price.rounding === 'floor') price = Math.floor(price)
        }

        // Resolve product type and storable settings from standard mapping
        const rawType = typeof prodStd?.product_type === 'object'
          ? prodStd?.product_type?.default_type
          : prodStd?.product_type
        const majorVer = await client.getMajorVersion().catch(() => 17)
        const wantsStorable = prodStd?.inventory?.track_inventory !== undefined
          ? Boolean(prodStd.inventory.track_inventory)
          : (rawType === 'product')

        const prodVals: Record<string, any> = {
          name: newName || (sku ? `Product ${sku}` : 'Unnamed Product'),
          sale_ok: true,
          purchase_ok: true,
        }
        if (majorVer >= 18) {
          prodVals.type = rawType === 'service' ? 'service' : 'consu'
          if (rawType !== 'service') {
            prodVals.is_storable = wantsStorable
          }
        } else {
          prodVals.type = rawType === 'service' ? 'service' : (wantsStorable ? 'product' : 'consu')
        }
        // Dynamic bundles and vouchers are never stocked, even when auto-created here.
        if (isDynamicBundle(productData) || isVoucher(productData)) {
          prodVals.type = 'service'
          if (majorVer >= 18) prodVals.is_storable = false
          const bundleNotes = isDynamicBundle(productData) ? formatBundleInternalNotes(productData) : ''
          if (bundleNotes) prodVals.description = bundleNotes
        }
        if (sku) prodVals.default_code = sku
        if (barcode) prodVals.barcode = barcode
        if (price > 0) prodVals.list_price = price

        // Apply Product Standard Mapping attributes
        if (prodStd) {
          // Category
          if (prodStd.category_id && Number(prodStd.category_id) > 0) {
            prodVals.categ_id = Number(prodStd.category_id)
          }
          // Customer Taxes
          const taxIds = prodStd.tax?.default_tax_ids || (prodStd.taxes_id ? [prodStd.taxes_id] : [])
          if (Array.isArray(taxIds) && taxIds.length > 0) {
            const cleanTaxIds = taxIds.map(Number).filter(n => !isNaN(n) && n > 0)
            if (cleanTaxIds.length > 0) {
              prodVals.taxes_id = [[6, 0, cleanTaxIds]]
            }
          }
          // Company
          if (prodStd.link_company !== false && prodStd.company_id && Number(prodStd.company_id) > 0) {
            prodVals.company_id = Number(prodStd.company_id)
          }
          // Tracking (lots/serials)
          // Odoo 20+ changed tracking: 'none' removed from selection ('lot', 'serial' only).
          // Tracked by quantity is tracking = false.
          if (prodStd.inventory?.tracking && prodStd.inventory.tracking !== 'none') {
            prodVals.tracking = prodStd.inventory.tracking
          } else if (majorVer >= 20) {
            if (wantsStorable) prodVals.tracking = false
          } else if (wantsStorable) {
            prodVals.tracking = 'none'
          }
          // Match values come from the configured source path, not the
          // order-line id (which can differ from the product id/barcode).
          if (productMatch.configured) {
            if (!productMatch.matchValues || Object.keys(productMatch.matchValues).length === 0) {
              throw new Error('Configured product match field cannot be written when creating a missing product')
            }
            Object.assign(prodVals, productMatch.matchValues)
          }
        }

        const newProdId = await client.create('product.product', prodVals)
        if (!Number.isInteger(newProdId) || newProdId <= 0) throw new Error('Odoo did not return a valid product id')
        line['product_id'] = newProdId
        if (!productMatch.configured) {
          if (sku) lineProductLookups.set(sku, Promise.resolve(newProdId))
          if (barcode) lineProductLookups.set(barcode, Promise.resolve(newProdId))
        }
        console.info(`[SyncEngine] Auto-created new product #${newProdId} in Odoo for SKU "${sku}" according to Standard Mapping`)
      }
    }

    // Without a resolvable product there is no valid sale.order.line in Odoo
    if (!line['product_id']) {
      if (defaultProductId && defaultProductId > 0) {
        line['product_id'] = defaultProductId
        console.warn(`[SyncEngine] Fallback: assigned default product #${defaultProductId} for unresolvable line`)
      } else {
        const prodIdentifier = String(line['name'] || productData.sku || productData.id || 'Unknown')
        const skipErr = new Error(`تم إلغاء تسجيل الطلب: المنتج "${prodIdentifier}" غير مسجل في أودو وإعداد المطابقة لم يتمكن من حله (Order skipped: Product "${prodIdentifier}" not found in Odoo)`)
        ;(skipErr as any).isOrderSkipped = true
        throw skipErr
      }
    }
    lines.push(line)

    // Dynamic bundle: the bundle line above already carries the full price.
    // Add the picked components as zero-price lines so Odoo picking/delivery
    // moves the real items, without changing the order total. Grouped
    // products keep their existing BoM behaviour and never reach this branch.
    const bundleComponents = extractBundleComponents(productData)
    const treatAsDynamicBundle =
      bundleComponents.length > 0 &&
      (isDynamicBundle(productData) || productData.product_class == null)
    if (treatAsDynamicBundle) {
      for (const comp of bundleComponents) {
        let compProductId: number | null = null
        if (comp.sku) compProductId = await lookupLineProduct(comp.sku)
        if (!compProductId && comp.barcode) compProductId = await lookupLineProduct(comp.barcode)
        if (!compProductId) {
          console.warn(
            `[SyncEngine] Dynamic bundle component skipped (not found in Odoo): ${comp.name || comp.sku || comp.barcode || ''} — bundle line still carries the full price`,
          )
          continue
        }
        // Zid already scales each component quantity by the ordered bundle
        // quantity in the order payload (ordering 2 bundles of X ×1 sends
        // quantity: 2 for X) — so the picked quantity is used as-is and must
        // NOT be multiplied by the bundle quantity again.
        lines.push({
          product_id: compProductId,
          product_uom_qty: comp.quantity,
          price_unit: 0,
          name: comp.name || comp.sku || 'Bundle component',
        })
        console.info(
          `[SyncEngine] Dynamic bundle zero-price line: product #${compProductId} qty=${comp.quantity}`,
        )
      }
    }
  }

  let effectiveOrderDiscount = orderLevelDiscount
  if (sallaOrderDiscount === undefined && pricesIncludeTax && taxRatePercent > 0 && effectiveOrderDiscount > 0) {
    const taxDivisor = 1 + (taxRatePercent / 100)
    effectiveOrderDiscount = Math.round((effectiveOrderDiscount / taxDivisor) * 100) / 100
  }
  if (platform === 'salla') effectiveOrderDiscount = convertCurrencyAmount(effectiveOrderDiscount, currencyConversionRate)
  if (effectiveOrderDiscount > 0) {
    totalDiscountAmount = Math.max(totalDiscountAmount, effectiveOrderDiscount)
    anyProductHasDiscount = true
  }

  // When discountMode is 'percent', apply discount directly to product lines.
  // If individual lines did not have explicit discounts, distribute the overall order discount % across lines.
  // Note: Only distribute if there is an explicit order-level discount (effectiveOrderDiscount > 0).
  // Line-level discounts belong strictly to their own items and must never be applied to other non-discounted products!
  if (platform === 'salla' && addDiscountAsLine) {
    totalDiscountAmount = Math.max(0, totalDiscountAmount - appliedSallaLineDiscount)
    const remainingSubtotal = subtotalBeforeDiscount - appliedSallaLineDiscount
    if (discountMode === 'percent' && totalDiscountAmount > 0 && remainingSubtotal > 0) {
      const rate = Math.min(1, totalDiscountAmount / remainingSubtotal)
      for (const line of lines) {
        const existing = Number(line.discount) || 0
        line.discount = Math.round((existing + (100 - existing) * rate) * 100) / 100
      }
    }
  } else if (addDiscountAsLine && discountMode === 'percent' && totalDiscountAmount > 0 && subtotalBeforeDiscount > 0) {
    if (effectiveOrderDiscount > 0) {
      const overallDiscountPercent = Math.round((totalDiscountAmount / subtotalBeforeDiscount) * 100 * 100) / 100
      if (overallDiscountPercent > 0) {
        for (const l of lines) {
          if (!l['discount'] || Number(l['discount']) <= 0) {
            l['discount'] = overallDiscountPercent
          }
        }
        console.info(`[SyncEngine] Applied ${overallDiscountPercent}% discount to sale order lines`)
      }
    }
  }

  if (lines.length === 0) {
    const emptyErr = new Error('تم إلغاء تسجيل الطلب: لا توجد بنود منتجات صالحة للتسجيل في أمر البيع بأودو (Order skipped: No valid product lines found for Odoo sales order)')
    ;(emptyErr as any).isOrderSkipped = true
    throw emptyErr
  }

  // ─── Shipping as Line Item ──────────────────────────────────────────────
  if (addShippingAsLine) {
    let finalShippingCost = shippingCost
    if (pricesIncludeTax && taxRatePercent > 0 && finalShippingCost > 0) {
      const taxDivisor = 1 + (taxRatePercent / 100)
      finalShippingCost = Math.round((finalShippingCost / taxDivisor) * 100) / 100
      console.info(`[SyncEngine] Prices include tax enabled (${taxRatePercent}%): converted shipping cost to tax-exclusive (${shippingCost} → ${finalShippingCost})`)
    }
    const shippingLine: Record<string, unknown> = {
      name: 'Shipping (شحن)',
      product_uom_qty: 1,
      price_unit: finalShippingCost,
    }
    if (isCreation && defaultLineTaxCmd) {
      shippingLine[lineTaxField] = [defaultLineTaxCmd]
    }

    if (shippingProductId) {
      shippingLine['product_id'] = Number(shippingProductId)
    } else if (shippingProductSku) {
      const foundId = await lookupLineProduct(shippingProductSku)
      if (foundId) shippingLine['product_id'] = foundId
    }

    // Resolve carrier_id from static shipping method mapping
    const zidShippingName = String(resolvePath(zidData, 'shipping_method.title')
      || resolvePath(zidData, 'shipping.title')
      || resolvePath(zidData, 'shipping_method')
      || '')
    if (zidShippingName && mapping.workspace_id) {
      try {
        const carrier = await resolveShippingCarrier(mapping.workspace_id, zidShippingName, platform)
        if (carrier?.carrier_id) {
          // carrier_id lives on sale.order, NOT on sale.order.line — putting it on
          // the line makes the whole create fail. Promote it to the parent order
          // values instead; safeWriteOdooRecord strips it if the delivery field
          // does not exist in this Odoo database.
          if (parentOdooValues && !('carrier_id' in parentOdooValues)) {
            parentOdooValues['carrier_id'] = carrier.carrier_id
          }
        }
        if (carrier?.product_id && !shippingLine['product_id']) {
          shippingLine['product_id'] = carrier.product_id
        }
      } catch (err) {
        console.warn(`[SyncEngine] Failed to resolve shipping carrier for "${zidShippingName}":`, err)
      }
    }

    // Only push the line when an Odoo product could actually be resolved; a
    // sale.order.line without product_id would make the whole order fail.
    if (Number.isInteger(shippingLine['product_id']) && Number(shippingLine['product_id']) > 0) {
      lines.push(shippingLine)
    } else if (finalShippingCost > 0) {
      throw new Error('Shipping fee is enabled but its Odoo product could not be resolved')
    }
  }

  // ─── Discount as Order Line (Fixed Mode Only) ──────────────────────────
  // If discountMode is 'percent', discount was applied to the order lines directly above.
  // In 'fixed' mode, append the discount line item with negative price_unit.
  // Note: totalDiscountAmount is already in pre-tax units when pricesIncludeTax is enabled
  // because line prices and orderLevelDiscount were converted before accumulating.
  if (addDiscountAsLine && discountMode !== 'percent' && anyProductHasDiscount && totalDiscountAmount > 0) {
    const discountValue = -Math.abs(totalDiscountAmount)
    const nameStr = 'Discount (خصم)'

    const discountLine: Record<string, unknown> = {
      name: nameStr,
      product_uom_qty: 1,
      price_unit: discountValue,
    }
    if (isCreation && defaultLineTaxCmd) {
      discountLine[lineTaxField] = [defaultLineTaxCmd]
    }

    if (discountProductId) {
      discountLine['product_id'] = Number(discountProductId)
    } else if (discountProductSku) {
      const foundId = await lookupLineProduct(discountProductSku)
      if (foundId) discountLine['product_id'] = foundId
    }

    if (!Number.isInteger(discountLine['product_id']) || Number(discountLine['product_id']) <= 0) {
      throw new Error('Discount line is enabled but its Odoo product could not be resolved')
    } else {
      lines.push(discountLine)
      console.info(`[SyncEngine] Discount line item appended: name="${nameStr}" price_unit=${discountValue}`)
    }
  }

  // ──── Cash on Delivery fee as Order Line ────
  // Zid payloads carry NO separate COD fee field, so the fee is a fixed amount
  // from Standard Mapping settings. Only added when the payment method is COD.
  const payMethodTitle = String(
    resolvePath(zidData, 'payment_method.title')
    || resolvePath(zidData, 'payment_gateway.title')
    || resolvePath(zidData, 'payment.method.name')
    || resolvePath(zidData, 'payment_method')
    || ''
  )
  const payMethodCode = String(resolvePath(zidData, 'payment_method.code') || resolvePath(zidData, 'payment.method.code') || '')
  const isCodPayment = payMethodCode === 'zid_cod'
    || /cod|cash.?on.?delivery|الدفع عند الاستلام|عند الاستلام/i.test(payMethodTitle)
    || (zidData as any)?.cod_confirmed === true
  if (addCodAsLine && isCodPayment && codFeeAmount > 0) {
    let finalCodFee = codFeeAmount
    if (pricesIncludeTax && taxRatePercent > 0 && finalCodFee > 0) {
      const taxDivisor = 1 + (taxRatePercent / 100)
      finalCodFee = Math.round((finalCodFee / taxDivisor) * 100) / 100
      console.info(`[SyncEngine] Prices include tax enabled (${taxRatePercent}%): converted COD fee to tax-exclusive (${codFeeAmount} → ${finalCodFee})`)
    }
    const codLine: Record<string, unknown> = {
      name: 'Cash on Delivery (الدفع عند الاستلام)',
      product_uom_qty: 1,
      price_unit: finalCodFee,
    }
    if (isCreation && defaultLineTaxCmd) {
      codLine[lineTaxField] = [defaultLineTaxCmd]
    }
    if (codProductId) {
      codLine['product_id'] = Number(codProductId)
    } else if (codProductSku) {
      const foundId = await lookupLineProduct(codProductSku)
      if (foundId) codLine['product_id'] = foundId
    }
    if (Number.isInteger(codLine['product_id']) && Number(codLine['product_id']) > 0) {
      lines.push(codLine)
      console.info(`[SyncEngine] COD line item appended: price_unit=${finalCodFee}`)
    } else {
      throw new Error('COD fee is enabled but its Odoo product could not be resolved')
    }
  }

  // Defensive: Odoo rejects the WHOLE order when a line carries an unknown key,
  // and safeWriteOdooRecord cannot strip nested one2many keys (it retried the
  // same failing payload 3 times in production). Drop anything outside the
  // known-good set — but keep live-validated mapped fields and custom x_ fields.
  const ALLOWED_LINE_KEYS = new Set([
    'product_id', 'name', 'product_uom_qty', 'product_uom',
    'price_unit', 'discount', 'tax_id', 'tax_ids',
  ])
  const inactiveTaxField = lineTaxField === 'tax_ids' ? 'tax_id' : 'tax_ids'
  for (const built of lines) {
    delete built[inactiveTaxField]
    for (const key of Object.keys(built)) {
      if (!ALLOWED_LINE_KEYS.has(key) && !lineFieldMeta.has(key) && !key.startsWith('x_')) {
        console.warn(`[SyncEngine] Dropping unsupported sale.order.line key "${key}" to avoid a failed order create`)
        delete built[key]
      }
    }
  }

  // Analytic distribution — Standard Mapping orders tab, Zid + Salla only.
  // Runs AFTER the allowlist so the JSON is attached to every built line
  // (products, shipping, discount, COD); a line that already carries an
  // explicit mapping for either analytic field is left untouched.
  if (platform === 'zid' || platform === 'salla') {
    const analyticConfig =
      (settings as any)?.analytic ??
      (orderStdSettings as any)?.analytic ??
      (orderStdSettings as any)?.order?.analytic

    if (analyticConfig?.enabled) {
      try {
        const { locationId, locationName } = extractOrderLocationInfo(zidData, platform)
        const distribution = resolveAnalyticDistribution({
          config: analyticConfig,
          locationId,
          locationName,
          paymentKeys: paymentKeysFromOrder(zidData, platform),
          // Send the merchant's configured percentages verbatim — no
          // re-normalisation to 100. Odoo accepts analytic_distribution
          // values whose percentages do not sum to 100.
          preservePercentages: true,
        })

        if (distribution.length > 0) {
          const hasDistributionField = lineFieldMeta.has('analytic_distribution')
          const hasAccountField = lineFieldMeta.has('analytic_account_id')

          if (!hasDistributionField && !hasAccountField) {
            if (platform === 'zid') {
              // Odoo 14/15 store the analytic account on the sale.order
              // header. Never send that header-only field to an order line.
              const headerMeta = parentFieldMeta.has('analytic_account_id')
                ? parentFieldMeta
                : await fetchFieldMeta(client, 'sale.order', ['analytic_account_id'])
              if (!headerMeta.has('analytic_account_id')) {
                throw new Error('Matched analytic rules cannot be applied: no supported Odoo analytic field was confirmed')
              }
              if (!('analytic_account_id' in parentOdooValues)) {
                Object.assign(parentOdooValues, toOdooAnalyticFields(distribution, false, true))
              }
            } else {
              console.warn('[SyncEngine] Analytic rules are enabled but sale.order.line has neither analytic_distribution nor analytic_account_id; skipped.')
            }
          } else {
            if (!hasDistributionField && distribution.length > 1) {
              const top = [...distribution].sort((a, b) => b.percentage - a.percentage)[0]
              console.warn(`[SyncEngine] Odoo without analytic_distribution; using analytic_account_id=${top?.accountId} although ${distribution.length} accounts were configured.`)
            }
            const analyticFields = toOdooAnalyticFields(distribution, hasDistributionField, hasAccountField)
            if (Object.keys(analyticFields).length > 0) {
              let applied = 0
              for (const line of lines) {
                if ('analytic_distribution' in line || 'analytic_account_id' in line) continue
                Object.assign(line, analyticFields)
                applied += 1
              }
              console.info(`[SyncEngine] Applied analytic distribution to ${applied}/${lines.length} order line(s):`, analyticFields)
            }
          }
        }
      } catch (err: any) {
        // Zid settings must not disappear from a seemingly successful order.
        if (platform === 'zid') throw err
        console.warn('[SyncEngine] Analytic distribution failed; continuing without it:', err?.message || err)
      }
    }
  }

  return lines
}
