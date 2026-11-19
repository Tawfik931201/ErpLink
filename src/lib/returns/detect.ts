/**
 * Pure return-detection rules shared by the webhook engine and the tests.
 *
 * Kept import-free on purpose (like `telegram/link-code.ts`): the rules are
 * the part that is easy to get silently wrong, so they must be unit-testable
 * without a database, an Odoo client or a Supabase mock.
 *
 * Verified against the platforms' own documentation (2026-10-21):
 *   - Zid publishes NO return webhook. Its order events are only
 *     `order.create`, `order.status.update`, `order.payment_status.update`,
 *     and the documented `conditions` enum for a status update is
 *     new/preparing/ready/inDelivery/delivered/cancelled - `reversed` is not
 *     in it. The status VALUE can still be `reversed` /
 *     `partially_reversed`, so the return is detected from the order status
 *     plus `view-for-return`, and treated as a trigger only.
 *   - Salla publishes `order.refunded` and the `order.shipment.return.*`
 *     family. Real payloads carry `refunded_items` on the order object (probed
 *     in `webhook_inbox` on 2026-10-21), which is the cumulative refunded
 *     quantity per line - exactly what a credit note needs.
 */

export type ReturnMode = 'nothing' | 'negative_so' | 'stock_return_credit_note'

export type ReturnFallback = 'skip' | 'negative_so'

export type ReturnReasonType = 'store_reason' | 'custom'

export interface ReturnSettings {
  mode: ReturnMode
  create_credit_note: boolean
  credit_note_journal_id: number | null
  fallback_when_missing: ReturnFallback
  reason: string
  reason_type: ReturnReasonType
}

export const DEFAULT_RETURN_SETTINGS: ReturnSettings = {
  mode: 'nothing',
  create_credit_note: true,
  credit_note_journal_id: null,
  fallback_when_missing: 'skip',
  reason: '',
  reason_type: 'store_reason',
}

export interface StoreReturnLine {
  storeProductId: string
  sku: string
  quantity: number
  name?: string
  priceUnit?: number
  /** Actual source VAT per unit already included in the Zid order total. */
  taxAmountPerUnit?: number
}

const ZID_RETURN_STATUSES = new Set(['reversed', 'partially_reversed', 'reverse_in_progress'])

const ARABIC_STATUS_MAP: Record<string, string> = {
  'مسترجع': 'reversed',
  'مرتجع': 'reversed',
  'استرجاع': 'reversed',
  'مسترجع جزئيا': 'partially_reversed',
  'مسترجع جزئي': 'partially_reversed',
  'مرتجع جزئيا': 'partially_reversed',
  'مرتجع جزئي': 'partially_reversed',
  'جاري الاسترجاع': 'reverse_in_progress',
  'جاري الإرجاع': 'reverse_in_progress',
  'جاري ارجاع': 'reverse_in_progress',
  'refund': 'reversed',
  'refunded': 'reversed',
  'reverse': 'reversed',
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null
}

function toText(value: unknown): string {
  if (value === null || value === undefined) return ''
  if (typeof value === 'object') return ''
  return String(value).trim()
}

function toPositiveQty(value: unknown): number {
  const n = Number(value)
  return Number.isFinite(n) && n > 0 ? n : 0
}

function firstText(source: Record<string, unknown>, keys: readonly string[]): string {
  for (const key of keys) {
    const text = toText(source[key])
    if (text) return text
  }
  return ''
}

function firstQty(source: Record<string, unknown>, keys: readonly string[]): number {
  for (const key of keys) {
    const qty = toPositiveQty(source[key])
    if (qty > 0) return qty
  }
  return 0
}

/**
 * Zid order status that means "goods came back". `reverse_in_progress` is
 * deliberately NOT treated as a completed return by itself - it is the
 * transient state before Zid finishes the reversal, and acting on it would
 * return goods that the merchant may still cancel.
 */
export function isZidReturnStatus(status: unknown, allowInProgress = false): boolean {
  const key = zidStatusKey(status).replace(/-/g, '_')
  if (!key) return false
  if (!allowInProgress && key.startsWith('reverse_in_progress')) return false
  return ZID_RETURN_STATUSES.has(key)
}

/**
 * Zid's order status appears as `{ code, name }` in the documented order
 * payload (`OrderForReturnSerializer.order_status`) and as `slug` in some
 * webhook builds. `code`/`slug`/`value` are stable machine keys; `name` is
 * localized ("مرتجع"), so it is only a last resort.
 */
function zidStatusKey(status: unknown): string {
  const record = asRecord(status)
  let raw = ''
  if (record) {
    raw = (
      toText(record.code) ||
      toText(record.slug) ||
      toText(record.value) ||
      toText(record.name)
    ).toLowerCase()
  } else {
    raw = toText(status).toLowerCase()
  }
  return ARABIC_STATUS_MAP[raw] || raw
}

function hasZidReturnLabelRequest(val: unknown): boolean {
  if (!val) return false
  if (Array.isArray(val)) return val.length > 0
  if (typeof val === 'object') return Object.keys(val as Record<string, unknown>).length > 0
  return false
}

export function isSallaReturnEvent(event: string): boolean {
  const key = String(event || '').toLowerCase()
  if (!key) return false
  if (key === 'order.refunded') return true
  return key === 'order.shipment.return.created'
}

/**
 * A return is detected from the EVENT/platform pair plus the payload.
 * `refunded_items` alone is not a trigger: it is also present (empty) on
 * every ordinary order, and a non-empty value on an `order.updated` means a
 * refund that may already have been processed by `order.refunded`.
 */
export function isReturnSignal(
  platform: 'zid' | 'salla' | 'shopify',
  event: string,
  data: Record<string, unknown> | null | undefined
): boolean {
  if (platform === 'zid') {
    const ev = String(event || '').toLowerCase()
    if (ev.includes('reversed') || ev.includes('refund') || ev.includes('return')) return true
    if (!data) return false
    // "Return in progress" is NOT a completed return: the merchant may
    // cancel it. Do not mutate Odoo stock or create credit notes yet.
    const nestedOrder = asRecord(data.order)
    const status =
      data.order_status ??
      nestedOrder?.order_status ??
      data.display_status ??
      nestedOrder?.display_status ??
      data.status ??
      nestedOrder?.status ??
      data.financial_status ??
      data.orderStatus ??
      data.current_status ??
      data.new_status ??
      data.order_status_code
    if (isZidReturnStatus(status, true) && !isZidReturnStatus(status)) return false
    if (
      hasZidReturnLabelRequest(data.reverse_order_label_request) ||
      hasZidReturnLabelRequest(data.reverse_order_label_requests)
    ) {
      return true
    }
    if (
      hasZidReturnLabelRequest(nestedOrder?.reverse_order_label_request) ||
      hasZidReturnLabelRequest(nestedOrder?.reverse_order_label_requests)
    ) {
      return true
    }
    // Check all standard and custom Zid status locations (including Arabic display names)
    return isZidReturnStatus(status)
  }
  if (platform === 'salla') {
    if (isSallaReturnEvent(event)) return true
    const nestedOrder = asRecord(data?.order)
    const items = collectRefundedItems(data) ?? collectRefundedItems(nestedOrder)
    return Array.isArray(items) && items.length > 0
  }
  return false
}

export function collectRefundedItems(
  source: Record<string, unknown> | null | undefined
): unknown[] | null {
  if (!source) return null
  const direct = source.refunded_items
  if (Array.isArray(direct)) return direct
  const nestedOrder = asRecord(source.order)
  if (nestedOrder && Array.isArray(nestedOrder.refunded_items)) {
    return nestedOrder.refunded_items as unknown[]
  }
  return null
}

function extractLinesFromArray(items: unknown[]): StoreReturnLine[] {
  const lines: StoreReturnLine[] = []
  for (const raw of items) {
    const item = asRecord(raw)
    if (!item) continue
    const product = asRecord(item.product) ?? asRecord(item.item) ?? {}
    const storeProductId = firstText(item, ['product_id', 'store_product_id']) ||
      firstText(product, ['id']) ||
      firstText(item, ['id'])
    const sku = firstText(item, ['sku', 'product_sku']) || firstText(product, ['sku'])
    const quantity = firstQty(item, [
      'quantity',
      'qty',
      'refunded_quantity',
      'returned_quantity',
      'return_quantity',
    ])
    if (!storeProductId && !sku) continue
    if (quantity <= 0) continue
    lines.push({
      storeProductId,
      sku,
      quantity,
      name: firstText(item, ['name', 'product_name']) || firstText(product, ['name']) || undefined,
      priceUnit:
        toPositiveQty(item.price_unit) ||
        toPositiveQty(asRecord(item.amounts)?.price_without_tax) ||
        toPositiveQty(asRecord(item.amounts)?.total) ||
        undefined,
    })
  }
  return lines
}

/** Salla: cumulative refunded quantities, from a real `refunded_items` array. */
export function extractSallaRefundedLines(
  data: Record<string, unknown> | null | undefined
): StoreReturnLine[] {
  const items = collectRefundedItems(data)
  return items ? extractLinesFromArray(items) : []
}


/**
 * The Zid reversal webhook embeds the completed reverse requests, including
 * received_quantity, not_received_quantity and damaged_quantity. These are
 * NOT interchangeable with reversed_quantity. In live QA, 3 units were
 * requested, only 1 received, and the actual refundable amount was one unit.
 * view-for-return reports zero remaining for that *whole request* and cannot
 * distinguish the 1 good unit from the 2 never received.
 *
 * Prefer cumulative, id-deduplicated received quantities from the webhook.
 * Unknown, damaged or grouped-component returns are blocked for review rather
 * than guessed as a full financial return.
 */
export function extractZidReceivedReturnLines(
  payload: Record<string, unknown> | null | undefined
): { known: boolean; lines: StoreReturnLine[]; error?: string } {
  if (!payload) return { known: false, lines: [] }
  const order = asRecord(payload.order)
  const many = payload.reverse_order_label_requests ?? order?.reverse_order_label_requests
  const single = payload.reverse_order_label_request ?? order?.reverse_order_label_request
  const requests = Array.isArray(many) && many.length > 0
    ? many
    : single ? [single] : []
  if (requests.length === 0) return { known: false, lines: [] }

  const seen = new Set<string>()
  const lines: StoreReturnLine[] = []
  for (let index = 0; index < requests.length; index++) {
    const req = asRecord(requests[index])
    if (!req) return { known: false, lines: [], error: 'return_request_unreadable' }
    const id = toText(req.id) || `index:${index}`
    if (seen.has(id)) continue
    seen.add(id)
    if (!Array.isArray(req.products)) {
      return { known: false, lines: [], error: 'return_receipt_products_missing' }
    }
    for (const raw of req.products) {
      const item = asRecord(raw)
      if (!item || item.received_quantity === undefined || item.received_quantity === null) {
        return { known: false, lines: [], error: 'return_received_quantity_missing' }
      }
      const received = Number(item.received_quantity)
      const damaged = Number(item.damaged_quantity ?? 0)
      const notReceived = Number(item.not_received_quantity ?? 0)
      const requested = Number(item.reversed_quantity ?? item.quantity)
      if ([received, damaged, notReceived, requested].some(n => !Number.isInteger(n) || n < 0) ||
          received + damaged + notReceived > requested) {
        return { known: false, lines: [], error: 'return_receipt_quantity_invalid' }
      }
      if (damaged > 0) {
        return { known: false, lines: [], error: 'return_damaged_requires_financial_review' }
      }
      const product = asRecord(item.product)
      const orderProduct = asRecord(item.order_product)
      if (asRecord(orderProduct?.meta)?.group_product_id) {
        // In Zid's completed FULL grouped return receipt the parent is the
        // single refundable financial line. Its child components are listed
        // with reversed_quantity=3/2 etc but received_quantity=0 even when
        // the parent has been received. Never refund the children at zero
        // price OR add their quantities to the parent. Inventory is returned
        // from the parent sale.line's actual Odoo delivered component moves.
        //
        // Explicit component-only receipts remain unsupported for automatic
        // financial valuation, and are terminal manual review instead.
        if (received > 0 || damaged > 0 || notReceived > 0) {
          return { known: false, lines: [], error: 'return_grouped_components_require_review' }
        }
        continue
      }
      // A completed Zid reversal may show requested quantities while all
      // receipt counters remain zero. That is NOT evidence that goods were
      // received or that a financial refund is due. Previously this silently
      // returned an empty list and logged nothing_to_return.
      // Check only real financial lines; grouped components are placeholders.
      const status = toText(asRecord(payload.order_status)?.code ||
        asRecord(order?.order_status)?.code ||
        payload.order_status || order?.order_status).toLowerCase()
      if ((status === 'reversed' || status === 'partially_reversed') &&
          received + damaged + notReceived < requested) {
        return { known: false, lines: [],
          error: 'return_receipt_quantities_unreconciled_requires_review' }
      }
      const sku = firstText(item, ['sku']) ||
        firstText(orderProduct || {}, ['sku']) ||
        firstText(product || {}, ['sku'])
      const storeProductId =
        firstText(item, ['product_uuid', 'product_id']) ||
        firstText(product || {}, ['id'])
      if (received > 0) {
        if (!sku && !storeProductId) {
          return { known: false, lines: [], error: 'return_receipt_product_unidentified' }
        }
        lines.push({ sku, storeProductId, quantity: received })
      }
    }
  }
  return { known: true, lines }
}

/**
 * Missing-original fallback cannot derive a return from the whole Zid order:
 * it must use ACTUALLY RECEIVED cumulative quantities and independently verify
 * the unit financial amount against the Zid order product snapshot. If there
 * are two identical product rows with different price bands and no line ID,
 * fail for review instead of assigning an arbitrary customer refund.
 */
export function extractPricedZidReceivedReturnLines(
  payload: Record<string, unknown>,
): StoreReturnLine[] {
  const receipt = extractZidReceivedReturnLines(payload)
  if (receipt.error) throw new Error(receipt.error)
  if (!receipt.known) throw new Error('return_receipt_quantities_unknown')
  const order = asRecord(payload.order)
  const products = Array.isArray(payload.products) ? payload.products
    : Array.isArray(order?.products) ? order.products : []
  const normalizeId = (value: unknown) => toText(value).toLowerCase().replace(/-/g, '')

  return receipt.lines.map(line => {
    const found = products.filter(raw => {
      const product = asRecord(raw)
      if (!product) return false
      const sku = firstText(product, ['sku', 'product_sku'])
      const id = firstText(product, ['id', 'product_id', 'product_uuid'])
      return (line.sku && sku && sku === line.sku) ||
        (line.storeProductId && id && normalizeId(id) === normalizeId(line.storeProductId))
    })
    if (found.length !== 1) {
      throw new Error('return_fallback_order_line_ambiguous:' + (line.sku || line.storeProductId))
    }
    const product = asRecord(found[0])!
    const ordered = Number(product.quantity)
    const discounted = product.discounted_total ?? product.total
    const includedTax = Number(product.discounted_tax_amount ?? product.tax_amount ?? 0)
    const explicitUnit = product.net_sale_price ?? product.net_price ?? product.price ?? product.price_unit
    const unit = discounted !== undefined && discounted !== null && discounted !== '' &&
      Number.isFinite(Number(discounted)) && Number.isFinite(includedTax) &&
      Number.isFinite(ordered) && ordered > 0
      ? (Number(discounted) - includedTax) / ordered
      : explicitUnit === undefined || explicitUnit === null ? NaN : Number(explicitUnit)
    if (!Number.isFinite(unit) || unit < 0) {
      throw new Error('return_fallback_unit_price_unavailable:' + (line.sku || line.storeProductId))
    }
    return {
      ...line,
      priceUnit: Math.round(unit * 1e6) / 1e6,
      ...(includedTax > 0 && Number.isFinite(ordered) && ordered > 0
        ? { taxAmountPerUnit: Math.round((includedTax / ordered) * 1e6) / 1e6 }
        : {}),
      name: firstText(product, ['name', 'product_name', 'title']) || line.name,
    }
  })
}

const ZID_LINE_ARRAY_KEYS = ['products', 'items', 'order_products'] as const

/**
 * Zid: remaining returnable quantities from `view-for-return`.
 *
 * Documented shape (2026-10-21, docs.zid.sa "Order Details – View for Return"):
 *
 *   order.products[] = { id (order-product UUID), order_product_id (integer),
 *                        name, sku, quantity, price, tax_percentage, total }
 *
 * `quantity` is the REMAINING quantity, not the ordered one. `id` is the
 * order-product UUID and `order_product_id` is its integer handle - neither is
 * the store product id, so product resolution goes through `sku` (the only
 * stable product key the endpoint returns).
 *
 * Rows with `quantity: 0` are kept: they still tell the caller "this product is
 * fully returned", which is different from "this product was not mentioned".
 */
export function extractZidRemainingLines(
  payload: Record<string, unknown> | null | undefined
): StoreReturnLine[] {
  if (!payload) return []
  const candidates: unknown[] = [payload]
  for (const key of ['data', 'order', 'result']) {
    const nested = asRecord(payload[key])
    if (nested) candidates.push(nested)
  }
  for (const container of candidates) {
    const record = asRecord(container)
    if (!record) continue
    for (const key of ZID_LINE_ARRAY_KEYS) {
      const arr = record[key]
      if (!Array.isArray(arr)) continue
      const lines: StoreReturnLine[] = []
      for (const raw of arr) {
        const item = asRecord(raw)
        if (!item) continue
        const product = asRecord(item.product) ?? {}
        const storeProductId =
          firstText(item, ['product_uuid', 'product_id', 'store_product_id']) ||
          firstText(product, ['id'])
        const sku = firstText(item, ['sku', 'product_sku']) || firstText(product, ['sku'])
        // `quantity` = remaining. The other names are tolerated in case a
        // custom build renames it, but the documented one comes first.
        const quantity =
          firstQty(item, ['quantity', 'remaining_quantity', 'remaining', 'returnable_quantity'])
        if (!storeProductId && !sku) continue
        // `price` is tax-inclusive; Odoo computes tax from the line's taxes,
        // so the net unit is what must be written when there is no mapping.
        const gross = toPositiveQty(item.price) || toPositiveQty(item.price_unit)
        const taxRate = Number(item.tax_percentage)
        const net =
          gross > 0 && Number.isFinite(taxRate) && taxRate > 0
            ? Math.round((gross / (1 + taxRate)) * 1e6) / 1e6
            : gross
        lines.push({
          storeProductId,
          sku,
          quantity,
          name: firstText(item, ['name', 'product_name']) || firstText(product, ['name']) || undefined,
          priceUnit: net > 0 ? net : undefined,
        })
      }
      // An explicit, empty products array is meaningful for a fully reversed
      // order: it means "everything already came back", not "unknown".
      return lines
    }
  }
  return []
}

/**
 * Stable content signature for a cumulative return snapshot. Used as the
 * idempotency key so a redelivered webhook cannot apply the same return twice
 * after its `sync_queue` row settles (the dedup index only covers pending
 * rows). FNV-1a, because the module stays import-free.
 */
/**
 * Zid distinguishes reverse_total (order value requested for reversal) from
 * refund_total (money actually refundable). A completed full reversal may
 * exclude shipping/COD fees, e.g. 316 SAR reversed but only 301 SAR refunded.
 * Including the original service fee in an Odoo credit note in that case
 * over-credits the customer. Missing or inconsistent totals are not consent
 * to refund the fee.
 */
export function zidReturnRefundsOrderFees(
  payload: Record<string, unknown> | null | undefined
): boolean {
  if (!payload) return false
  const order = asRecord(payload.order)
  const many = payload.reverse_order_label_requests ?? order?.reverse_order_label_requests
  const single = payload.reverse_order_label_request ?? order?.reverse_order_label_request
  const requests = Array.isArray(many) && many.length > 0
    ? many
    : single ? [single] : []
  if (requests.length === 0) return false

  for (const raw of requests) {
    const request = asRecord(raw)
    if (!request || request.refund_total == null || request.reverse_total == null) return false
    const refunded = Number(request.refund_total)
    const reversed = Number(request.reverse_total)
    if (!Number.isFinite(refunded) || !Number.isFinite(reversed) ||
        reversed <= 0 || refunded < 0 || Math.abs(refunded - reversed) > 0.01) {
      return false
    }
  }
  return true
}


/**
 * Project the negative sale order for a missing original against the real
 * money refunded by completed Zid return receipts, not the order grand total.
 * A full 316 SAR reversal may only refund 301 SAR worth of products.
 */
export function verifiedZidFallbackRefundTotal(
  payload: Record<string, unknown>,
  lines: readonly StoreReturnLine[],
  refundedFeeGross = 0,
): number {
  const order = asRecord(payload.order)
  const many = payload.reverse_order_label_requests ?? order?.reverse_order_label_requests
  const single = payload.reverse_order_label_request ?? order?.reverse_order_label_request
  const requests = Array.isArray(many) && many.length > 0
    ? many : single ? [single] : []
  if (requests.length === 0) throw new Error('return_fallback_refund_total_missing')

  let refunded = 0
  const seen = new Set<string>()
  for (let i = 0; i < requests.length; i++) {
    const request = asRecord(requests[i])
    const key = toText(request?.id) || ('index:' + i)
    if (seen.has(key)) continue
    seen.add(key)
    if (!request || request.refund_total === undefined || request.refund_total === null) {
      throw new Error('return_fallback_refund_total_missing')
    }
    const total = Number(request.refund_total)
    if (!Number.isFinite(total) || total < 0) throw new Error('return_fallback_refund_total_invalid')
    refunded += total
  }
  if (!Number.isFinite(refundedFeeGross) || refundedFeeGross < 0) {
    throw new Error('return_fallback_fee_invalid')
  }
  const projected = lines.reduce((sum, line) => {
    const quantity = Number(line.quantity)
    const netUnit = Number(line.priceUnit)
    const sourceVatUnit = Number(line.taxAmountPerUnit ?? 0)
    if (![quantity, netUnit, sourceVatUnit].every(Number.isFinite) ||
        quantity < 0 || netUnit < 0 || sourceVatUnit < 0) {
      throw new Error('return_fallback_line_amount_invalid')
    }
    return sum + quantity * (netUnit + sourceVatUnit)
  }, refundedFeeGross)

  if (Math.abs(Math.round(projected * 100) / 100 - Math.round(refunded * 100) / 100) > 0.021) {
    throw new Error('return_fallback_refund_total_mismatch_requires_review:' +
      projected.toFixed(2) + ':' + refunded.toFixed(2))
  }
  return Math.round(refunded * 100) / 100
}

export function returnSnapshotSignature(lines: readonly StoreReturnLine[], extra = ''): string {
  const parts = lines
    .map(line => `${line.storeProductId || line.sku}:${line.quantity}`)
    .sort()
  let hash = 0x811c9dc5
  const input = `${extra}|${parts.join('|')}`
  for (let i = 0; i < input.length; i += 1) {
    hash ^= input.charCodeAt(i)
    hash = Math.imul(hash, 0x01000193) >>> 0
  }
  return hash.toString(16).padStart(8, '0')
}

export function returnDedupeKey(platform: string, orderId: string, signature: string): string {
  return `${platform}:return:${orderId}:${signature}`
}

/**
 * Extract return/refund reason from platform payload (Zid / Salla).
 */
export function extractStoreReturnReason(
  payload: Record<string, unknown> | null | undefined,
  _platform?: string
): string {
  if (!payload) return ''
  const p = payload as any
  const nestedOrder = asRecord(p.order) as any

  const candidates = [
    p.reverse_order_label_request?.reason,
    nestedOrder?.reverse_order_label_request?.reason,
    p.reverse_order_label_requests?.[0]?.reason,
    nestedOrder?.reverse_order_label_requests?.[0]?.reason,
    p.reverse_reason,
    nestedOrder?.reverse_reason,
    p.return_reason,
    nestedOrder?.return_reason,
    p.refund_reason,
    nestedOrder?.refund_reason,
    p.reason,
    nestedOrder?.reason,
    p.cancel_reason,
    nestedOrder?.cancel_reason,
    p.customer_notes,
    nestedOrder?.customer_notes,
    p.notes,
    nestedOrder?.notes,
    p.note,
    nestedOrder?.note,
  ]

  for (const c of candidates) {
    if (!c) continue
    if (typeof c === 'string' && c.trim()) return c.trim().slice(0, 200)
    if (Array.isArray(c) && c.length > 0) {
      const parts = c
        .map((item: any) => {
          if (typeof item === 'string') return item.trim()
          if (item && typeof item === 'object') {
            return String(item.name || item.title || item.reason || item.description || item.id || '').trim()
          }
          return ''
        })
        .filter(Boolean)
      if (parts.length > 0) return parts.join(' - ').slice(0, 200)
    }
    if (typeof c === 'object') {
      const name = String((c as any).name || (c as any).title || (c as any).reason || '').trim()
      if (name) return name.slice(0, 200)
    }
  }
  return ''
}
